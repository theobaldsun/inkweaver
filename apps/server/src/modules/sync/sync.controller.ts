/**
 * 同步控制器（基于 Yjs CRDT）。
 *
 * 用途：
 * - POST /api/sync/push：客户端上行 Yjs updates，成功后广播到 Socket 房间
 * - POST /api/sync/pull：客户端下行拉取快照与增量 updates
 *
 * 输入：PushDto / PullDto（需 JWT）
 * 输出：push ack / PullResponseDto
 */

import {
  Body,
  Controller,
  Post,
  UseGuards,
  HttpException,
  HttpStatus,
  Request,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, MoreThan } from 'typeorm';

import { DocumentProjectionService } from './document-projection.service';
import { DocSnapshot } from './entity/doc-snapshot.entity';
import { DocumentsService } from '../documents/documents.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { PullDto, PushDto, PullResponseDto } from './dto/push.dto';
import { SyncUpdate } from './entity/sync-update.entity';
import { SnapshotService } from './snapshot.service';
import { SyncGateway } from './sync.gateway';
import { assertValidSyncUpdates } from './sync-update.validation';
import { getUserId } from '../../common/get-user-id';
import { AuthGuard } from '../auth/guard/auth.guard';

import type { Request as ExpressRequest } from 'express';

@Controller('/api/sync')
@UseGuards(AuthGuard)
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    @InjectRepository(SyncUpdate)
    private syncUpdateRepository: Repository<SyncUpdate>,
    @InjectRepository(DocSnapshot)
    private docSnapshotRepository: Repository<DocSnapshot>,
    private readonly storageUsageService: StorageUsageService,
    private readonly documentsService: DocumentsService,
    private readonly documentProjectionService: DocumentProjectionService,
    private readonly snapshotService: SnapshotService,
    private readonly syncGateway: SyncGateway,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 接收客户端 Yjs updates。
   *
   * 输入：PushDto
   * 输出：{ success, updateIds?, latestUpdateId? }
   */
  @Post('/push')
  async push(
    @Body() dto: PushDto,
    @Request() req: ExpressRequest,
  ): Promise<{
    success: boolean;
    updateIds?: number[];
    latestUpdateId?: number;
  }> {
    const { docId, updates, clientId, baseUpdateId } = dto;
    const userId = getUserId(req.user as { sub?: string; id?: string });

    await this.documentsService.assertDocumentActive(docId, userId);
    assertValidSyncUpdates(updates);

    const { savedUpdates, latestSavedUpdate }: {
      savedUpdates: SyncUpdate[];
      latestSavedUpdate: number;
    } = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const latestUpdate = await manager.findOne(SyncUpdate, {
          where: { docId },
          order: { updateId: 'DESC' },
          select: ['updateId'],
          lock: { mode: 'pessimistic_write' },
        });

        const serverLatestUpdateId = latestUpdate?.updateId || 0;

        if (baseUpdateId !== undefined && serverLatestUpdateId > baseUpdateId) {
          throw new HttpException(
            {
              docId,
              latestUpdateId: serverLatestUpdateId,
              message: 'Client is behind server version',
            },
            HttpStatus.CONFLICT,
          );
        }

        const updatesToSave: SyncUpdate[] = [];
        for (const update of updates) {
          const syncUpdate = manager.create(SyncUpdate, {
            docId,
            update,
            timestamp: Date.now(),
            clientId,
          });
          const saved = await manager.save(syncUpdate);
          updatesToSave.push(saved);
        }

        const latestId =
          updatesToSave[updatesToSave.length - 1]?.updateId ||
          serverLatestUpdateId;

        return { savedUpdates: updatesToSave, latestSavedUpdate: latestId };
      },
    );

    const updateIds = savedUpdates.map((u) => u.updateId);

    this.syncGateway.broadcastDocUpdates(docId, updates, updateIds, clientId);
    this.storageUsageService.scheduleRecalculateByDocId(docId);
    this.documentProjectionService.scheduleProjection(docId);
    this.snapshotService.scheduleSnapshot(docId);

    return {
      success: true,
      updateIds,
      latestUpdateId: latestSavedUpdate,
    };
  }

  /**
   * 拉取服务端 Yjs updates。
   *
   * 输入：PullDto
   * 输出：PullResponseDto
   */
  @Post('/pull')
  async pull(
    @Body() dto: PullDto,
    @Request() req: ExpressRequest,
  ): Promise<PullResponseDto> {
    const { docId, cursor = 0, limit = 100 } = dto;
    const userId = getUserId(req.user as { sub?: string; id?: string });

    await this.documentsService.assertDocumentActive(docId, userId);

    const latestUpdate = await this.syncUpdateRepository.findOne({
      where: { docId },
      order: { updateId: 'DESC' },
      select: ['updateId'],
    });

    const serverLatestUpdateId = latestUpdate?.updateId || 0;

    let snapshot: string | undefined;
    let snapshotCursor = cursor;
    const shouldReturnSnapshot =
      cursor === 0 || serverLatestUpdateId - cursor > 1000;

    if (shouldReturnSnapshot) {
      const latestSnapshot = await this.docSnapshotRepository.findOne({
        where: { docId },
        order: { version: 'DESC' },
      });

      if (latestSnapshot && Number(latestSnapshot.version) >= serverLatestUpdateId) {
        snapshot = latestSnapshot.snapshot;
        snapshotCursor = Number(latestSnapshot.version);
      } else {
        const updateCount = await this.syncUpdateRepository.count({ where: { docId } });
        if (updateCount === 0) {
          // 无更新则无法生成快照
        } else if (updateCount > 1000) {
          // 大文档异步生成，避免阻塞 pull；客户端可稍后重试
          this.logger.log(
            `Document ${docId} has ${updateCount} updates, scheduling snapshot`,
          );
          this.snapshotService.scheduleSnapshot(docId, 0);
        } else {
          // 统一走 SnapshotService，避免与 push 路径重复实现
          const generated = await this.snapshotService.generateSnapshot(docId);
          if (generated) {
            snapshot = generated.snapshot;
            snapshotCursor = Number(generated.version);
          } else {
            this.logger.warn(
              `Snapshot generation returned null for doc ${docId}; scheduling retry`,
            );
            this.snapshotService.scheduleSnapshot(docId, 0);
          }
        }
      }
    }

    const syncUpdates = await this.syncUpdateRepository.find({
      where: {
        docId,
        updateId: MoreThan(snapshot ? snapshotCursor : cursor),
      },
      order: { updateId: 'ASC' },
      take: limit,
    });

    const updates = syncUpdates.map((item) => item.update);
    const hasMore = syncUpdates.length === limit;
    const nextCursor =
      syncUpdates.length > 0
        ? syncUpdates[syncUpdates.length - 1]?.updateId || snapshotCursor
        : snapshot
          ? snapshotCursor
          : cursor;

    return {
      snapshot,
      snapshotVersion: snapshot ? Number(snapshotCursor) : undefined,
      updates,
      nextCursor: Number(nextCursor),
      hasMore,
      latestUpdateId: Number(serverLatestUpdateId),
    };
  }
}
