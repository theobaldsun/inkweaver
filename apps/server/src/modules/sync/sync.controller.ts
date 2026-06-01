/**
 * 同步控制器（基于 Yjs CRDT）。
 *
 * 用途：
 * - 提供 Yjs 同步协议端点：
 *   - POST /api/sync/push：客户端上行 Yjs updates
 *   - POST /api/sync/pull：客户端下行拉取 Yjs updates
 *
 * 输入：push docId + updates / pull docId + clientVersion
 * 输出：{ success: boolean } / { updates: [] }
 */

import { Body, Controller, Post, UseGuards, HttpException, HttpStatus, Request } from "@nestjs/common";
import type { Request as ExpressRequest } from 'express';
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThan } from "typeorm";
import { AuthGuard } from "../auth/guard/auth.guard";
import { getUserId } from '../../common/get-user-id';
import * as Y from 'yjs';

import { PullDto, PushDto, PullResponseDto } from "./dto/push.dto";
import { SyncUpdate } from "./entity/sync-update.entity";
import { DocSnapshot } from "./entity/doc-snapshot.entity";
import { StorageUsageService } from "../storage/storage-usage.service";
import { DocumentsService } from "../documents/documents.service";
import { DocumentProjectionService } from './document-projection.service';

@Controller("/api/sync")
@UseGuards(AuthGuard)
export class SyncController {
  constructor(
    @InjectRepository(SyncUpdate)
    private syncUpdateRepository: Repository<SyncUpdate>,
    @InjectRepository(DocSnapshot)
    private docSnapshotRepository: Repository<DocSnapshot>,
    private readonly storageUsageService: StorageUsageService,
    private readonly documentsService: DocumentsService,
    private readonly documentProjectionService: DocumentProjectionService,
  ) {}

  /**
   * 接收客户端 Yjs updates。
   *
   * 输入：PushDto
   * 输出：{ success: boolean, updateIds?: number[], latestUpdateId?: number }
   */
  @Post("/push")
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

    const latestUpdate = await this.syncUpdateRepository.findOne({
      where: { docId },
      order: { updateId: 'DESC' },
      select: ['updateId'],
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

    // 保存 updates 到数据库
    if (updates && updates.length > 0) {
      const savedUpdates = [];
      
      for (const update of updates) {
        const syncUpdate = new SyncUpdate();
        syncUpdate.docId = docId;
        syncUpdate.update = update;
        syncUpdate.timestamp = Date.now();
        syncUpdate.clientId = clientId;
        // updateId 由数据库自增主键自动生成，保证并发安全
        
        const saved = await this.syncUpdateRepository.save(syncUpdate);
        savedUpdates.push(saved);
      }

      // 获取保存后的最新updateId
      const latestSavedUpdate = savedUpdates[savedUpdates.length - 1]?.updateId || serverLatestUpdateId;

      this.storageUsageService.scheduleRecalculateByDocId(docId);
      this.documentProjectionService.scheduleProjection(docId);

      return { 
        success: true, 
        updateIds: savedUpdates.map(u => u.updateId),
        latestUpdateId: latestSavedUpdate
      };
    }

    return { success: true, latestUpdateId: serverLatestUpdateId };
  }



  /**
   * 异步生成快照
   */
  private async generateSnapshotAsync(docId: string, allUpdates: SyncUpdate[], version: number): Promise<void> {
    try {
      console.log(`Starting async snapshot generation for doc ${docId} with ${allUpdates.length} updates`);
      
      // 使用 Yjs 重建文档并生成快照
      const yDoc = new Y.Doc();
      
      // 应用所有历史更新
      for (const updateItem of allUpdates) {
        // 使用 Buffer.from 高效转换 Base64 更新
        const update = Buffer.from(updateItem.update, 'base64');
        
        // 应用更新到 Yjs 文档
        Y.applyUpdate(yDoc, update);
      }
      
      // 生成快照
      const snapshotBytes = Y.encodeStateAsUpdate(yDoc);
      
      // 将 Uint8Array 转换为 Base64 编码的字符串
      let binaryString = '';
      for (let i = 0; i < snapshotBytes.length; i++) {
        binaryString += String.fromCharCode(snapshotBytes[i]!);
      }
      const snapshot = btoa(binaryString);
      
      // 保存新生成的快照（使用 upsert 更新现有记录）
      await this.docSnapshotRepository.upsert(
        {
          docId,
          snapshot,
          version,
          createdAt: new Date(),
        },
        { conflictPaths: ['docId'] }
      );
      
      console.log(`Async snapshot generation completed for doc ${docId}`);
    } catch (error) {
      console.error('Failed to generate snapshot asynchronously:', error);
    }
  }

  /**
   * 拉取服务端 Yjs updates。
   *
   * 输入：PullDto
   * 输出：PullResponseDto
   */
  @Post("/pull")
  async pull(
    @Body() dto: PullDto,
    @Request() req: ExpressRequest,
  ): Promise<PullResponseDto> {
    const { docId, cursor = 0, limit = 100, snapshotVersion = 0 } = dto;
    const userId = getUserId(req.user as { sub?: string; id?: string });

    await this.documentsService.assertDocumentActive(docId, userId);

    // 获取服务端最新的 update_id
    const latestUpdate = await this.syncUpdateRepository.findOne({
      where: { docId },
      order: { updateId: 'DESC' },
      select: ['updateId'],
    });
    
    const serverLatestUpdateId = latestUpdate?.updateId || 0;

    // 检查是否需要返回快照
    let snapshot: string | undefined;
    const shouldReturnSnapshot = cursor === 0 || (serverLatestUpdateId - cursor > 1000); // 差距过大时返回快照
    
    if (shouldReturnSnapshot) {
      // 查找最新的快照
      const latestSnapshot = await this.docSnapshotRepository.findOne({
        where: { docId },
        order: { version: 'DESC' },
      });
      
      if (latestSnapshot && latestSnapshot.version >= serverLatestUpdateId) {
        // 使用现有的快照
        snapshot = latestSnapshot.snapshot;
      } else {
        // 生成新的快照
        const allUpdates = await this.syncUpdateRepository.find({
          where: { docId },
          order: { updateId: 'ASC' },
        });
        
        if (allUpdates.length > 0) {
          // 检查是否有可用的缓存快照（1小时内生成的）
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const cachedSnapshot = await this.docSnapshotRepository.findOne({
            where: { 
              docId,
              createdAt: MoreThan(oneHourAgo)
            },
            order: { version: 'DESC' },
          });
          
          if (cachedSnapshot && cachedSnapshot.version >= serverLatestUpdateId) {
            // 使用缓存快照
            snapshot = cachedSnapshot.snapshot;
          } else {
            // 对于更新量大的文档，异步生成快照，避免阻塞请求
            if (allUpdates.length > 1000) {
              // 返回快照待生成标志，客户端可等待重试
              snapshot = undefined;
              console.log(`Document ${docId} has ${allUpdates.length} updates, snapshot generation in progress`);
              
              // 异步生成快照（不阻塞当前请求）
              this.generateSnapshotAsync(docId, allUpdates, serverLatestUpdateId).catch(error => {
                console.error('Async snapshot generation failed:', error);
              });
            } else {
              // 使用 Yjs 重建文档并生成快照
              const yDoc = new Y.Doc();
              
              // 应用所有历史更新
              for (const updateItem of allUpdates) {
                // 使用 Buffer.from 高效转换 Base64 更新
                const update = Buffer.from(updateItem.update, 'base64');
                
                // 应用更新到 Yjs 文档
                Y.applyUpdate(yDoc, update);
              }
              
              // 生成快照
              const snapshotBytes = Y.encodeStateAsUpdate(yDoc);
              
              // 将 Uint8Array 转换为 Base64 编码的字符串
              let binaryString = '';
              for (let i = 0; i < snapshotBytes.length; i++) {
                binaryString += String.fromCharCode(snapshotBytes[i]!);
              }
              snapshot = btoa(binaryString);
              
              // 保存新生成的快照（使用 upsert 更新现有记录）
              await this.docSnapshotRepository.upsert(
                {
                  docId,
                  snapshot,
                  version: serverLatestUpdateId,
                  createdAt: new Date(),
                },
                { conflictPaths: ['docId'] }
              );
            }
          }
        }
      }
    }

    // 获取增量更新
    const syncUpdates = await this.syncUpdateRepository.find({
      where: {
        docId,
        updateId: MoreThan(cursor)
      },
      order: {
        updateId: "ASC"
      },
      take: limit
    });

    const updates = syncUpdates.map(item => item.update);
    const hasMore = syncUpdates.length === limit;
    const nextCursor = syncUpdates.length > 0 ? syncUpdates[syncUpdates.length - 1]?.updateId || cursor : cursor;

    return {
      snapshot,
      updates,
      nextCursor: Number(nextCursor), // 确保返回number类型
      hasMore,
      latestUpdateId: Number(serverLatestUpdateId) // 确保返回number类型
    };
  }
}
