/**
 * WebSocket 网关 - 实时同步（需 JWT 鉴权与文档归属校验）。
 *
 * 用途：
 * - 握手鉴权、加入/离开文档房间、实时 update 持久化与广播
 * - 供 REST push 复用的房间广播（`broadcastDocUpdates`）
 *
 * 输入：Socket.IO 事件（join-doc / leave-doc / update）
 * 输出：房间广播与 ack
 */

import {
  BadRequestException,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';

import { DocumentProjectionService } from './document-projection.service';
import { SyncUpdate } from './entity/sync-update.entity';
import { SnapshotService } from './snapshot.service';
import { assertValidSyncUpdates } from './sync-update.validation';
import { AuthService } from '../auth/auth.service';
import { DocumentsService } from '../documents/documents.service';
import { StorageUsageService } from '../storage/storage-usage.service';

interface UpdateMessage {
  type: 'update';
  docId: string;
  data: {
    updates: string[];
    baseUpdateId?: number;
    clientId?: string;
  };
}

type AuthedSocket = Socket & { data: { userId?: string } };

@WebSocketGateway({
  namespace: '/sync',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    methods: ['GET', 'POST'],
  },
})
export class SyncGateway implements OnGatewayConnection {
  private readonly logger = new Logger(SyncGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @InjectRepository(SyncUpdate)
    private syncUpdateRepository: Repository<SyncUpdate>,
    private readonly storageUsageService: StorageUsageService,
    private readonly documentsService: DocumentsService,
    private readonly documentProjectionService: DocumentProjectionService,
    private readonly snapshotService: SnapshotService,
    private readonly authService: AuthService,
  ) {}

  /**
   * 握手时校验 JWT，将 userId 写入 socket.data。
   */
  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const authHeader = client.handshake.headers.authorization;
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : undefined);

      if (!token) {
        throw new UnauthorizedException('缺少认证令牌');
      }

      const payload = await this.authService.verifyToken(token);
      if (!payload.sub) {
        throw new UnauthorizedException('认证令牌缺少用户标识');
      }

      client.data.userId = payload.sub;
      this.logger.log(`Client connected: ${client.id} user=${payload.sub}`);
    } catch (error) {
      this.logger.warn(`WebSocket 鉴权失败: ${client.id}`, error);
      client.disconnect(true);
    }
  }

  async handleDisconnect(@ConnectedSocket() client: AuthedSocket): Promise<void> {
    this.logger.log(`Client disconnected: ${client.id}`);
    const rooms = Array.from(client.rooms);
    rooms.forEach((room) => {
      if (room !== client.id) {
        client.leave(room);
      }
    });
  }

  private getUserId(client: AuthedSocket): string {
    const userId = client.data.userId;
    if (!userId) {
      throw new UnauthorizedException('未认证连接');
    }
    return userId;
  }

  /**
   * 向文档房间广播 Yjs updates（REST push 与 WS update 共用）。
   *
   * 输入：docId、Base64 updates、对应 updateIds、可选 clientId（发送端用于自忽略）
   * 输出：无（副作用：房间 emit）
   */
  broadcastDocUpdates(
    docId: string,
    updates: string[],
    updateIds: number[],
    clientId?: string,
  ): void {
    if (!this.server) return;
    this.server.to(`doc-${docId}`).emit('update', {
      type: 'update',
      docId,
      data: { updates, updateIds, clientId },
    });
  }

  @SubscribeMessage('join-doc')
  async handleJoinDoc(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { docId: string },
  ) {
    const userId = this.getUserId(client);
    const { docId } = data;
    if (!docId || typeof docId !== 'string') {
      throw new BadRequestException('docId 不能为空');
    }

    await this.documentsService.assertDocumentActive(docId, userId);

    const currentRooms = Array.from(client.rooms);
    currentRooms.forEach((room) => {
      if (room !== client.id && room.startsWith('doc-')) {
        client.leave(room);
      }
    });

    const roomName = `doc-${docId}`;
    await client.join(roomName);
    this.logger.log(`Client ${client.id} joined room: ${roomName}`);

    return { success: true, room: roomName };
  }

  @SubscribeMessage('leave-doc')
  async handleLeaveDoc(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { docId: string },
  ) {
    this.getUserId(client);
    const { docId } = data;
    if (!docId || typeof docId !== 'string') {
      throw new BadRequestException('docId 不能为空');
    }

    const roomName = `doc-${docId}`;
    await client.leave(roomName);
    this.logger.log(`Client ${client.id} left room: ${roomName}`);
    return { success: true, room: roomName };
  }

  @SubscribeMessage('update')
  async handleUpdate(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() message: UpdateMessage,
  ) {
    const userId = this.getUserId(client);
    const { docId, data } = message;
    const { updates, baseUpdateId, clientId } = data ?? { updates: [] as string[] };

    try {
      if (!docId || typeof docId !== 'string') {
        throw new BadRequestException('docId 不能为空');
      }

      await this.documentsService.assertDocumentActive(docId, userId);
      assertValidSyncUpdates(updates);

      if (baseUpdateId !== undefined) {
        const latestUpdate = await this.syncUpdateRepository.findOne({
          where: { docId },
          order: { updateId: 'DESC' },
          select: ['updateId'],
        });

        if (latestUpdate && latestUpdate.updateId > baseUpdateId) {
          client.emit('conflict', {
            docId,
            serverUpdateId: latestUpdate.updateId,
            message: 'Client is behind server version',
          });
          return { success: false, reason: 'conflict' };
        }
      }

      const savedUpdates = [];
      for (const updateData of updates) {
        const syncUpdate = this.syncUpdateRepository.create({
          docId,
          update: updateData,
          timestamp: Date.now(),
          clientId,
        });
        const saved = await this.syncUpdateRepository.save(syncUpdate);
        savedUpdates.push(saved);
      }

      const updateIds = savedUpdates.map((u) => u.updateId);
      // client.to 已排除本 socket；附带 clientId 供多连接场景自忽略
      client.to(`doc-${docId}`).emit('update', {
        type: 'update',
        docId,
        data: { updates, updateIds, clientId },
      });

      this.storageUsageService.scheduleRecalculateByDocId(docId);
      this.documentProjectionService.scheduleProjection(docId);
      this.snapshotService.scheduleSnapshot(docId);

      return { success: true, updateIds };
    } catch (error) {
      this.logger.error(`Failed to process update for doc ${docId}:`, error);
      const status =
        error instanceof HttpException ? error.getStatus() : undefined;
      const message =
        error instanceof Error ? error.message : 'Failed to process update';
      client.emit('error', {
        type: 'update-error',
        docId,
        status,
        message,
      });
      return { success: false, error: message, status };
    }
  }

  @SubscribeMessage('get-latest-update-id')
  async handleGetLatestUpdateId(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { docId: string },
  ) {
    const userId = this.getUserId(client);
    const { docId } = data;

    await this.documentsService.assertDocumentActive(docId, userId);

    const latestUpdate = await this.syncUpdateRepository.findOne({
      where: { docId },
      order: { updateId: 'DESC' },
      select: ['updateId'],
    });

    return {
      docId,
      latestUpdateId: latestUpdate?.updateId || 0,
    };
  }

  getRoomClientCount(docId: string): number {
    const roomName = `doc-${docId}`;
    const room = this.server.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
  }
}
