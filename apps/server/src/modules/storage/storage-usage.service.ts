/**
 * 用户存储用量计算与缓存服务。
 *
 * 用途：
 * - 聚合文档、文件夹、Yjs 同步数据占用
 * - 在 User 表缓存结果以降低读负载
 * - 文档变更时增量调度重算
 *
 * 数据来源：
 * - documents.content + documents.title → 文档内容字节数
 * - doc_snapshot.snapshot → 快照字节数
 * - sync_update.update → Yjs 同步增量字节数
 *
 * 缓存策略：
 * - 使用 User.storageUsedBytes + User.storageCalculatedAt 作为缓存
 * - STORAGE_USAGE_CACHE_TTL_MS 超时或 force=true 时触发全量重算
 * - 重算失败时降级返回缓存值（标记 stale=true）
 */

import { DEFAULT_STORAGE_QUOTA_BYTES, STORAGE_USAGE_CACHE_TTL_MS } from '@inkweaver/shared';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Document } from '../documents/entity/document.entity';
import { Folder } from '../documents/entity/folder.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entity/user.entity';

/**
 * 存储用量统计结果（面向客户端的响应结构）。
 */
export interface ServerStorageUsage {
  /** 已使用字节数（文档 + 同步数据） */
  usedBytes: number;
  /** 存储配额字节数 */
  quotaBytes: number;
  /** 文档数量 */
  documentCount: number;
  /** 文件夹数量 */
  folderCount: number;
  /** 同步数据字节数（快照 + Yjs updates） */
  syncDataBytes: number;
  /** 文档内容字节数（content + title） */
  documentDataBytes: number;
  /** 使用率百分比（0-100，保留两位小数） */
  usagePercent: number;
  /** 最后计算时间（ISO 字符串） */
  lastUpdatedAt: string;
  /** 本次是否触发了全量重算 */
  recalculated?: boolean;
  /** 缓存是否已过期（重算失败降级时为 true） */
  stale?: boolean;
}

@Injectable()
export class StorageUsageService {
  private readonly logger = new Logger(StorageUsageService.name);

  /** 防抖定时器：userId → setTimeout 句柄。用于合并同一用户的多次重算请求 */
  private readonly pendingRecalc = new Map<string, ReturnType<typeof setTimeout>>();

  /** 已发送配额告警的用户集合，避免重复推送通知 */
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

  /**
   * 计算单篇文档的字节数（用于本地快速估算）。
   */
  calculateDocumentBytes(title?: string | null, content?: string | null): number {
    const titleBytes = Buffer.byteLength(title ?? '', 'utf8');
    const contentBytes = Buffer.byteLength(content ?? '', 'utf8');
    return titleBytes + contentBytes;
  }

  /**
   * 获取用户存储用量。
   *
   * 策略：
   * 1. 缓存有效 → 直接返回缓存（recalculated=false）
   * 2. 缓存过期或 force=true → 触发全量重算
   * 3. 重算失败 → 降级返回缓存（stale=true）
   * 4. 无缓存且重算失败 → 抛出异常
   *
   * @param userId 用户 ID
   * @param options.recalculate 是否强制重算（忽略缓存）
   */
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

    // 缓存有效，直接返回
    if (!options?.recalculate && calculatedAt > 0 && !cacheExpired) {
      return this.buildCachedResponse(userId, user, cachedUsed, quotaBytes);
    }

    // 触发全量重算
    try {
      return await this.recalculateAndPersist(userId);
    } catch (error) {
      this.logger.error(`存储重算失败 userId=${userId}`, error);
      // 重算失败，降级返回缓存（标记 stale）
      if (calculatedAt > 0) {
        const cached = await this.buildCachedResponse(userId, user, cachedUsed, quotaBytes);
        return { ...cached, stale: true };
      }
      // 无缓存可用，抛出异常
      throw error;
    }
  }

  /**
   * 调度延迟重算（防抖）。
   *
   * 同一 userId 在 delayMs 内多次调用会被合并为一次执行。
   * 适用于文档保存、删除等高频操作后，聚合所有变更再统一重算。
   *
   * @param userId 用户 ID
   * @param delayMs 延迟毫秒数（默认 2 秒）
   */
  scheduleRecalculate(userId: string, delayMs = 2000): void {
    // 清除已有的定时器，重新计时
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

  /**
   * 根据文档 ID 调度重算。
   * 查找文档所属用户，然后调用 scheduleRecalculate。
   */
  async scheduleRecalculateByDocId(docId: string): Promise<void> {
    const doc = await this.documentsRepository.findOne({
      where: { id: docId },
      select: ['id', 'userId'],
    });
    if (doc?.userId) {
      this.scheduleRecalculate(doc.userId);
    }
  }

  /**
   * 全量重算用户存储用量并持久化。
   *
   * 计算流程：
   * 1. 聚合文档内容字节数（content + title）
   * 2. 聚合快照字节数（doc_snapshot.snapshot）
   * 3. 聚合 Yjs 更新字节数（sync_update.update）
   * 4. 求和得到总用量，写入 User 表缓存
   * 5. 检查配额告警阈值
   *
   * 注意：此操作是全量重算（非增量累加），即使并发执行多个请求，
   * 结果也只是相互覆盖，不会产生数据不一致。
   */
  async recalculateAndPersist(userId: string): Promise<ServerStorageUsage> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const quotaBytes = this.parseBigInt(user.storageQuotaBytes, DEFAULT_STORAGE_QUOTA_BYTES);

    // 并行获取：文档数、文件夹数、文档内容字节数
    const [documentCount, folderCount, documentDataBytes] = await Promise.all([
      this.documentsRepository.count({ where: { userId } }),
      this.foldersRepository.count({ where: { userId } }),
      this.calculateTotalDocumentBytes(userId),
    ]);

    // 串行获取：快照字节数、Yjs 更新字节数
    const snapshotBytes = await this.calculateTotalSnapshotBytes(userId);
    const updateBytes = await this.calculateTotalUpdateBytes(userId);

    const syncDataBytes = snapshotBytes + updateBytes;
    const usedBytes = documentDataBytes + syncDataBytes;

    // 写回缓存
    user.storageUsedBytes = String(usedBytes);
    user.storageCalculatedAt = new Date();
    await this.usersRepository.save(user);

    // 配额告警检查：>= 90% 时推送通知，< 85% 时重置告警状态
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
   * 聚合计算指定用户所有文档的内容字节数。
   *
   * 使用原生 SQL + octet_length() 精确计算 UTF-8 字节数，
   * 避免 Node.js Buffer 在大数据量下的性能问题。
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

  /**
   * 聚合计算指定用户所有文档的快照字节数。
   *
   * doc_snapshot 存储文档的 Yjs 完整快照，通常在文档编辑一段时间后生成，
   * 用于加速客户端同步（替代全量 update 回放）。
   */
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

  /**
   * 聚合计算指定用户所有 Yjs 增量更新的字节数。
   *
   * sync_update 存储客户端的每次 Yjs 更新（OP 操作），
   * 是协同编辑的核心数据。随着时间推移，update 数量会持续增长，
   * 因此定期生成快照可以减少总存储量。
   */
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

  /**
   * 将新格式的统计结果转换为旧版 API 兼容格式。
   */
  toLegacyStats(usage: ServerStorageUsage) {
    return {
      ...usage,
      usedStorage: usage.usedBytes,
      totalStorage: usage.quotaBytes,
    };
  }

  /**
   * 基于缓存构建响应（不触发全量重算）。
   *
   * 文档数、文件夹数、文档字节数仍需实时查询，
   * 但总用量直接使用缓存值，同步数据字节数通过差值推算。
   */
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

    // 同步数据字节数 = 总用量 - 文档内容字节数（差值推算）
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

  /**
   * 计算使用率百分比（保留两位小数，上限 100%）。
   */
  private getUsagePercent(usedBytes: number, quotaBytes: number): number {
    if (quotaBytes <= 0) return 0;
    return Math.min(100, Math.round((usedBytes / quotaBytes) * 10000) / 100);
  }

  /**
   * 安全解析大整数字符串或数字，解析失败时返回 fallback。
   */
  private parseBigInt(value: string | number | null | undefined, fallback: number): number {
    if (value === null || value === undefined) return fallback;
    const n = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(n) ? n : fallback;
  }
}
