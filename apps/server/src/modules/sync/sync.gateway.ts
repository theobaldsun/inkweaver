/**
 * WebSocket 网关 - 实时同步（需 JWT 鉴权与文档归属校验）。
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger, UnauthorizedException } from '@nestjs/common';

import { SyncUpdate } from './entity/sync-update.entity';
import { StorageUsageService } from '../storage/storage-usage.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentProjectionService } from './document-projection.service';
import { AuthService } from '../auth/auth.service';

interface UpdateMessage {
  type: 'update';
  docId: string;
  data: {
    updates: string[];
    baseUpdateId?: number;
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

  @SubscribeMessage('join-doc')
  async handleJoinDoc(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { docId: string },
  ) {
    const userId = this.getUserId(client);
    const { docId } = data;

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

  @SubscribeMessage('update')
  async handleUpdate(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() message: UpdateMessage,
  ) {
    const userId = this.getUserId(client);
    const { docId, data } = message;
    const { updates, baseUpdateId } = data;

    try {
      await this.documentsService.assertDocumentActive(docId, userId);

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
        });
        const saved = await this.syncUpdateRepository.save(syncUpdate);
        savedUpdates.push(saved);
      }

      const roomName = `doc-${docId}`;
      client.to(roomName).emit('update', {
        type: 'update',
        docId,
        data: {
          updates,
          updateIds: savedUpdates.map((u) => u.updateId),
        },
      });

      this.storageUsageService.scheduleRecalculateByDocId(docId);
      this.documentProjectionService.scheduleProjection(docId);

      return {
        success: true,
        updateIds: savedUpdates.map((u) => u.updateId),
      };
    } catch (error) {
      this.logger.error(`Failed to process update for doc ${docId}:`, error);
      client.emit('error', {
        type: 'update-error',
        docId,
        message: 'Failed to process update',
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
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
