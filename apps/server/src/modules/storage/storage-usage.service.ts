/**
 * 用户存储用量计算与缓存服务。
 *
 * 用途：
 * - 聚合文档、文件夹、Yjs 同步数据占用
 * - 在 User 表缓存结果以降低读负载
 * - 文档变更时增量调度重算
 */

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../users/entity/user.entity';
import { Document } from '../documents/entity/document.entity';
import { Folder } from '../documents/entity/folder.entity';
import { DEFAULT_STORAGE_QUOTA_BYTES, STORAGE_USAGE_CACHE_TTL_MS } from '@inkweaver/shared';
import { NotificationsService } from '../notifications/notifications.service';

export interface ServerStorageUsage {
  usedBytes: number;
  quotaBytes: number;
  documentCount: number;
  folderCount: number;
  syncDataBytes: number;
  documentDataBytes: number;
  usagePercent: number;
  lastUpdatedAt: string;
  recalculated?: boolean;
  stale?: boolean;
}

@Injectable()
export class StorageUsageService {
  private readonly logger = new Logger(StorageUsageService.name);
  private readonly pendingRecalc = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly quotaWarnedUsers = new Set<string>();

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
    @InjectRepository(Folder)
    private readonly foldersRepository: Repository<Folder>,
    private readonly notificationsService: NotificationsService,
  ) {}

  calculateDocumentBytes(title?: string | null, content?: string | null): number {
    const titleBytes = Buffer.byteLength(title ?? '', 'utf8');
    const contentBytes = Buffer.byteLength(content ?? '', 'utf8');
    return titleBytes + contentBytes;
  }

  async getUserStorageUsage(
    userId: string,
    options?: { recalculate?: boolean },
  ): Promise<ServerStorageUsage> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const quotaBytes = this.parseBigInt(user.storageQuotaBytes, DEFAULT_STORAGE_QUOTA_BYTES);
    const cachedUsed = this.parseBigInt(user.storageUsedBytes, 0);
    const calculatedAt = user.storageCalculatedAt?.getTime() ?? 0;
    const cacheExpired = Date.now() - calculatedAt > STORAGE_USAGE_CACHE_TTL_MS;

    if (!options?.recalculate && calculatedAt > 0 && !cacheExpired) {
      return this.buildCachedResponse(userId, user, cachedUsed, quotaBytes);
    }

    try {
      return await this.recalculateAndPersist(userId);
    } catch (error) {
      this.logger.error(`存储重算失败 userId=${userId}`, error);
      if (calculatedAt > 0) {
        const cached = await this.buildCachedResponse(userId, user, cachedUsed, quotaBytes);
        return { ...cached, stale: true };
      }
      throw error;
    }
  }

  scheduleRecalculate(userId: string, delayMs = 2000): void {
    const existing = this.pendingRecalc.get(userId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingRecalc.delete(userId);
      this.recalculateAndPersist(userId).catch((err) => {
        this.logger.warn(`后台存储重算失败 userId=${userId}`, err);
      });
    }, delayMs);

    this.pendingRecalc.set(userId, timer);
  }

  async scheduleRecalculateByDocId(docId: string): Promise<void> {
    const doc = await this.documentsRepository.findOne({
      where: { id: docId },
      select: ['id', 'userId'],
    });
    if (doc?.userId) {
      this.scheduleRecalculate(doc.userId);
    }
  }

  async recalculateAndPersist(userId: string): Promise<ServerStorageUsage> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const quotaBytes = this.parseBigInt(user.storageQuotaBytes, DEFAULT_STORAGE_QUOTA_BYTES);

    const [documentCount, folderCount, documentDataBytes] = await Promise.all([
      this.documentsRepository.count({ where: { userId } }),
      this.foldersRepository.count({ where: { userId } }),
      this.calculateTotalDocumentBytes(userId),
    ]);

    const snapshotBytes = await this.calculateTotalSnapshotBytes(userId);
    const updateBytes = await this.calculateTotalUpdateBytes(userId);

    const syncDataBytes = snapshotBytes + updateBytes;
    const usedBytes = documentDataBytes + syncDataBytes;

    user.storageUsedBytes = String(usedBytes);
    user.storageCalculatedAt = new Date();
    await this.usersRepository.save(user);

    const usagePercent = this.getUsagePercent(usedBytes, quotaBytes);
    if (usagePercent >= 90 && !this.quotaWarnedUsers.has(userId)) {
      this.quotaWarnedUsers.add(userId);
      await this.notificationsService.create({
        userId,
        type: 'storage.quota',
        title: '存储空间即将用尽',
        body: `已使用 ${usagePercent}% 存储配额，请清理文档或升级配额。`,
        metadata: { usagePercent, usedBytes, quotaBytes },
      });
    } else if (usagePercent < 85) {
      this.quotaWarnedUsers.delete(userId);
    }

    return {
      usedBytes,
      quotaBytes,
      documentCount,
      folderCount,
      syncDataBytes,
      documentDataBytes,
      usagePercent,
      lastUpdatedAt: user.storageCalculatedAt.toISOString(),
      recalculated: true,
    };
  }

  /**
   * 使用原生 SQL 聚合，避免 TypeORM QueryBuilder.select(expr, alias) 生成非法 AS 语法。
   */
  private async calculateTotalDocumentBytes(userId: string): Promise<number> {
    const rows = await this.documentsRepository.manager.query<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(
          octet_length(COALESCE(content, '')) + octet_length(COALESCE(title, ''))
        ), 0)::bigint AS total
       FROM documents
       WHERE "userId" = $1::uuid`,
      [userId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  private async calculateTotalSnapshotBytes(userId: string): Promise<number> {
    const rows = await this.documentsRepository.manager.query<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(octet_length(COALESCE(ds.snapshot, ''))), 0)::bigint AS total
       FROM doc_snapshot ds
       INNER JOIN documents d ON d.id = ds."docId"::uuid
       WHERE d."userId" = $1::uuid`,
      [userId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  private async calculateTotalUpdateBytes(userId: string): Promise<number> {
    const rows = await this.documentsRepository.manager.query<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(octet_length(COALESCE(su.update, ''))), 0)::bigint AS total
       FROM sync_update su
       INNER JOIN documents d ON d.id = su."docId"::uuid
       WHERE d."userId" = $1::uuid`,
      [userId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  toLegacyStats(usage: ServerStorageUsage) {
    return {
      ...usage,
      usedStorage: usage.usedBytes,
      totalStorage: usage.quotaBytes,
    };
  }

  private async buildCachedResponse(
    userId: string,
    user: User,
    usedBytes: number,
    quotaBytes: number,
  ): Promise<ServerStorageUsage> {
    const [documentCount, folderCount, documentDataBytes] = await Promise.all([
      this.documentsRepository.count({ where: { userId } }),
      this.foldersRepository.count({ where: { userId } }),
      this.calculateTotalDocumentBytes(userId),
    ]);

    const syncDataBytes = Math.max(0, usedBytes - documentDataBytes);

    return {
      usedBytes,
      quotaBytes,
      documentCount,
      folderCount,
      syncDataBytes,
      documentDataBytes,
      usagePercent: this.getUsagePercent(usedBytes, quotaBytes),
      lastUpdatedAt: (user.storageCalculatedAt ?? new Date()).toISOString(),
      recalculated: false,
    };
  }

  private getUsagePercent(usedBytes: number, quotaBytes: number): number {
    if (quotaBytes <= 0) return 0;
    return Math.min(100, Math.round((usedBytes / quotaBytes) * 10000) / 100);
  }

  private parseBigInt(value: string | number | null | undefined, fallback: number): number {
    if (value === null || value === undefined) return fallback;
    const n = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(n) ? n : fallback;
  }
}