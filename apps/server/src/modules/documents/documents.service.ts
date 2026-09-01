/**
 * 文档服务。
 *
 * 用途：
 * - 实现文档的 CRUD、回收站软删/恢复/永久删除
 * - 处理文档的业务逻辑（归属校验、存储用量联动、AI 索引调度）
 * - 管理分享链接、搜索、文件夹关联
 *
 * 数据来源：
 * - `documents` 表：文档主体（标题、内容、标签、公开状态、软删时间）
 * - `folders` 表：文件夹归属校验（防止越权）
 * - `sync_updates` 表：新建文档时写入首条 Yjs update
 * - `doc_snapshots` 表：新建文档时写入初始快照
 *
 * 关键策略：
 * - 软删除优先：移入回收站（deletedAt）而非物理删除，支持恢复
 * - 存储用量联动：任何文档字节变更后调度 StorageUsageService 重算
 * - 权限双校验：folderId 变更时校验归属（防止越权挂载）
 * - 房间踢出：删除文档后调用 evictFromDocRoom 清理 WebSocket 房间成员
 * - 初始快照原子性：新建文档时先保存文档行，失败则回滚（无 sync 基线的孤儿文档）
 */

import { randomBytes } from "crypto";

import { TRASH_RETENTION_DAYS, uint8ArrayToBase64 } from "@inkweaver/shared";
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, LessThan, Not, Repository } from "typeorm";
import * as Y from 'yjs';

import { DocumentIndexService } from "../ai/document-index.service";
import { EmbeddingClient } from "../ai/embedding.client";
import { VECTOR_STORE } from '../ai/vector/vector-store.token';
import { NotificationsService } from "../notifications/notifications.service";
import { StorageUsageService } from "../storage/storage-usage.service";
import { DocSnapshot } from "../sync/entity/doc-snapshot.entity";
import { SyncUpdate } from "../sync/entity/sync-update.entity";
import { SyncGateway } from "../sync/sync.gateway";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { Document } from "./entity/document.entity";
import { Folder } from "./entity/folder.entity";

import type { VectorStore } from '../ai/vector/vector-store';
/**
 * 回收站文档条目（扩展 purgeAt 字段供前端展示剩余保留时间）。
 */
export interface TrashDocumentItem extends Document {
  /** 预计永久删除时间（ISO 字符串） */
  purgeAt: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document)
    private documentsRepository: Repository<Document>,
    @InjectRepository(Folder)
    private foldersRepository: Repository<Folder>,
    @InjectRepository(SyncUpdate)
    private syncUpdateRepository: Repository<SyncUpdate>,
    @InjectRepository(DocSnapshot)
    private docSnapshotRepository: Repository<DocSnapshot>,
    private readonly storageUsageService: StorageUsageService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => DocumentIndexService))
    private readonly documentIndexService: DocumentIndexService,
    @Inject(forwardRef(() => SyncGateway))
    private readonly syncGateway: SyncGateway,
    private readonly embeddingClient: EmbeddingClient,
    @Inject(VECTOR_STORE)
    private readonly vectorStore: VectorStore
  ) {}

  /**
   * 创建文档。
   *
   * 流程：
   * 1. 若指定 folderId，校验归属（防止越权挂载）
   * 2. 保存文档行（此时尚无 sync 基线）
   * 3. 写入初始 Yjs 快照 + SyncUpdate（try/catch，失败则回滚文档行）
   * 4. 调度存储用量重算
   */
  async createDocument(userId: string, createDocumentDto: CreateDocumentDto): Promise<Document> {
    if (createDocumentDto.folderId) {
      await this.assertFolderOwnership(userId, createDocumentDto.folderId);
    }
    const document = this.documentsRepository.create({
      title: createDocumentDto.title,
      content: createDocumentDto.content,
      isPublic: createDocumentDto.isPublic,
      tags: createDocumentDto.tags,
      folderId: createDocumentDto.folderId,
      userId,
      deletedAt: null,
      deletedFromFolderId: null,
    });

    const savedDocument = await this.documentsRepository.save(document);
    try {
      await this.updateDocTsv(savedDocument.id, savedDocument.title, savedDocument.content);
      await this.generateInitialSnapshotAndUpdate(savedDocument.id, createDocumentDto);
    } catch (error) {
      this.logger.error(
        `初始快照失败，回滚文档 docId=${savedDocument.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.documentsRepository.delete(savedDocument.id);
      throw new InternalServerErrorException('文档初始化失败，请重试');
    }
    this.storageUsageService.scheduleRecalculate(userId);
    return savedDocument;
  }

  /**
   * 为新建文档写入首条 SyncUpdate 与 DocSnapshot。
   *
   * 使用临时 Yjs Doc 实例组装初始内容，编码为 Base64 后写入 sync_updates 和 doc_snapshots。
   * try/finally 确保 yDoc.destroy() 在所有路径（正常/异常）中都会被调用。
   */
  private async generateInitialSnapshotAndUpdate(
    docId: string,
    createDocumentDto: CreateDocumentDto,
  ): Promise<void> {
    const yDoc = new Y.Doc();

    try {
      const text = yDoc.getText('content');
      text.insert(0, createDocumentDto.content || '');
      const yMap = yDoc.getMap('metadata');
      yMap.set('title', createDocumentDto.title || 'Untitled Document');
      const snapshotBytes = Y.encodeStateAsUpdate(yDoc);
      const snapshot = uint8ArrayToBase64(snapshotBytes);

      const initialUpdate = new SyncUpdate();
      initialUpdate.docId = docId;
      initialUpdate.update = snapshot;
      initialUpdate.clientId = 'system';
      initialUpdate.timestamp = Date.now();
      const savedInitialUpdate = await this.syncUpdateRepository.save(initialUpdate);
      await this.docSnapshotRepository.upsert(
        {
          docId,
          snapshot,
          version: savedInitialUpdate.updateId,
          updateCount: 1,
          size: snapshotBytes.byteLength,
          createdAt: new Date(),
        },
        { conflictPaths: ['docId'] },
      );
    } finally {
      yDoc.destroy();
    }
  }

  /**
   * 获取未删除文档列表。
   *
   * 分页参数在 Service 层做 clamp：page 最小 1、pageSize 1~100，
   * 防止客户端传超大值导致数据库慢查询或内存峰值。
   *
   * @param userId 用户 ID
   * @param page 页码（从 1 开始）
   * @param pageSize 每页数量（1~100）
   * @param sortBy 排序字段（updatedAt/createdAt/title）
   * @param sortOrder 排序方向（ASC/DESC）
   * @param folderId 文件夹过滤（undefined=全部，null=无文件夹，string=指定文件夹）
   * @param filter 过滤器（all/recent/mine/public）
   */
  async getDocuments(
    userId: string,
    page: number = 1,
    pageSize: number = 10,
    sortBy: string = 'updatedAt',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    folderId?: string | null,
    filter: 'all' | 'recent' | 'mine' | 'public' = 'all',
  ): Promise<{ documents: Document[]; total: number; page: number; pageSize: number }> {
    page = Math.max(1, Math.floor(page));
    pageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const allowedSort = new Set(['updatedAt', 'createdAt', 'title']);
    const orderField = allowedSort.has(sortBy) ? sortBy : 'updatedAt';

    const qb = this.documentsRepository
      .createQueryBuilder('doc')
      .where('doc.userId = :userId', { userId })
      .andWhere('doc.deletedAt IS NULL');

    if (folderId !== undefined) {
      if (folderId === null) {
        qb.andWhere('doc.folderId IS NULL');
      } else {
        qb.andWhere('doc.folderId = :folderId', { folderId });
      }
    }

    if (filter === 'public') {
      qb.andWhere('doc.isPublic = :isPublic', { isPublic: true });
    } else if (filter === 'recent') {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      qb.andWhere('doc.updatedAt >= :since', { since });
    }

    qb.orderBy(`doc.${orderField}`, sortOrder)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [documents, total] = await qb.getManyAndCount();
    return { documents, total, page, pageSize };
  }

  /**
   * 获取单个未删除文档（含归属校验 + lastOpenedAt 副作用）。
   *
   * 用途：仅供 Controller 的「用户主动读文档」入口（GET /documents/:id）调用，
   * 会异步写回 lastOpenedAt 用于搜索关联召回加分。
   *
   * 内部 service 复用请改调 loadDocument，避免「生成分享链接」「软删」「更新」
   * 等非「用户主动打开」场景污染 lastOpenedAt。
   */
  async getDocument(docId: string, userId: string): Promise<Document> {
    const document = await this.loadDocument(docId, userId);
    // fire-and-forget：不阻塞读取响应；个人笔记 QPS 低，直接 UPDATE 不会拖慢主流程
    // 必须挂 .catch 兜底，否则 UPDATE 失败会触发 unhandledRejection 导致进程崩溃
    this.documentsRepository
      .update({ id: docId, userId }, { lastOpenedAt: new Date() })
      .catch((err) =>
        this.logger.warn(
          `lastOpenedAt 写回失败 docId=${docId}`,
          err instanceof Error ? err.stack : String(err),
        ),
      );
    return document;
  }

  /**
   * 内部加载文档（无副作用，含归属校验）。
   *
   * 与 getDocument 的区别：不写回 lastOpenedAt。
   * 专供 updateDocument / softDeleteDocument / generateShareLink 等内部方法复用，
   * 防止「编辑」「删除」「生成分享链接」误触发「最近打开」加分。
   */
  private async loadDocument(docId: string, userId: string): Promise<Document> {
    const document = await this.documentsRepository.findOne({
      where: { id: docId, userId, deletedAt: IsNull() },
    });
    if (!document) {
      throw new NotFoundException(`Document with id ${docId} not found`);
    }
    return document;
  }

  /**
   * 校验文档存在且未在回收站（供同步模块调用，可选 userId 校验归属）。
   */
  async assertDocumentActive(docId: string, userId?: string): Promise<Document> {
    const where: { id: string; deletedAt: ReturnType<typeof IsNull>; userId?: string } = {
      id: docId,
      deletedAt: IsNull(),
    };
    if (userId) {
      where.userId = userId;
    }
    const document = await this.documentsRepository.findOne({ where });
    if (!document) {
      throw new NotFoundException('文档不存在或已在回收站');
    }
    return document;
  }

  /**
   * 将 Yjs 投影的标题/正文写回 PG（供搜索、分享、列表使用），并调度向量索引。
   *
   * 仅在标题或正文实际变化时才更新文档行；若字节数变化则触发存储用量重算。
   */
  async projectSearchableContent(docId: string, title: string, content: string): Promise<void> {
    const document = await this.documentsRepository.findOne({
      where: { id: docId, deletedAt: IsNull() },
    });
    if (!document) {
      return;
    }

    if (document.title !== title || document.content !== content) {
      const previousBytes = this.storageUsageService.calculateDocumentBytes(
        document.title,
        document.content,
      );
      document.title = title;
      document.content = content;
      const saved = await this.documentsRepository.save(document);
      await this.updateDocTsv(saved.id, saved.title, saved.content);
      const nextBytes = this.storageUsageService.calculateDocumentBytes(saved.title, saved.content);
      if (nextBytes !== previousBytes) {
        this.storageUsageService.scheduleRecalculate(saved.userId);
      }
    }
    await this.documentIndexService.scheduleReindex({
      docId,
      userId: document.userId,
      title,
      content,
    });
  }

  /**
   * 更新文档元数据（标题、正文、公开状态、标签、文件夹）。
   *
   * folderId 变更时：设为具体文件夹需校验归属，设为 null（移出文件夹）无需校验。
   * 字节数变化时调度存储用量重算。
   */
  async updateDocument(docId: string, userId: string, updateDocumentDto: UpdateDocumentDto): Promise<Document> {
    // 内部加载（不走 lastOpenedAt 副作用，避免污染搜索关联召回）
    const document = await this.loadDocument(docId, userId);
    const previousBytes = this.storageUsageService.calculateDocumentBytes(document.title, document.content);
    if (updateDocumentDto.title !== undefined) document.title = updateDocumentDto.title;
    if (updateDocumentDto.content !== undefined) document.content = updateDocumentDto.content;
    if (updateDocumentDto.isPublic !== undefined) document.isPublic = updateDocumentDto.isPublic;
    if (updateDocumentDto.tags !== undefined) document.tags = updateDocumentDto.tags;
    if (updateDocumentDto.folderId !== undefined) {
      if (updateDocumentDto.folderId !== null) {
        await this.assertFolderOwnership(userId, updateDocumentDto.folderId);
      }
      document.folderId = updateDocumentDto.folderId;
    }
    const saved = await this.documentsRepository.save(document);
    // 仅当标题或正文变更时才同步 docTsv，避免无变更时的无谓 UPDATE
    if (updateDocumentDto.title !== undefined || updateDocumentDto.content !== undefined) {
      await this.updateDocTsv(saved.id, saved.title, saved.content);
    }
    const nextBytes = this.storageUsageService.calculateDocumentBytes(saved.title, saved.content);
    if (nextBytes !== previousBytes) {
      this.storageUsageService.scheduleRecalculate(userId);
    }
    return saved;
  }

  /**
   * 校验文件夹归属当前用户，防止越权将文档挂载到他人文件夹。
   *
   * @param userId 用户 ID
   * @param folderId 目标文件夹 ID
   * @throws ForbiddenException 文件夹不存在或不属于当前用户
   */
  private async assertFolderOwnership(userId: string, folderId: string): Promise<void> {
    const folder = await this.foldersRepository.findOne({
      where: { id: folderId, userId },
    });
    if (!folder) {
      throw new ForbiddenException("文件夹不存在或不属于当前用户");
    }
  }

  /**
   * 移入回收站（软删除）。
   */
  async deleteDocument(docId: string, userId: string): Promise<void> {
    await this.softDeleteDocument(docId, userId);
  }

  /**
   * 软删除单个文档：记录 deletedFromFolderId、设置 deletedAt、清空 folderId，
   * 调度存储用量重算，踢出 WebSocket 房间。
   */
  async softDeleteDocument(docId: string, userId: string): Promise<void> {
    // 内部加载（不走 lastOpenedAt 副作用，避免污染搜索关联召回）
    const document = await this.loadDocument(docId, userId);
    await this.applySoftDelete(document);
    this.storageUsageService.scheduleRecalculate(userId);
    this.syncGateway.evictFromDocRoom(docId);
  }

  /**
   * 将文件夹内文档移出文件夹（不删除，仅清空 folderId）。
   *
   * 供 folders.service.ts 的 deleteFolderOnly 使用——删除文件夹时将子文档挂到根层级。
   */
  async unlinkDocumentsFromFolder(userId: string, folderId: string): Promise<void> {
    await this.documentsRepository.update(
      { userId, folderId, deletedAt: IsNull() },
      { folderId: null },
    );
  }

  /**
   * 批量软删除文件夹内所有未删除文档。
   *
   * 逐条执行软删 + 踢出房间，最后统一调度存储用量重算。
   */
  async softDeleteDocumentsInFolder(userId: string, folderId: string): Promise<void> {
    const docs = await this.documentsRepository.find({
      where: { userId, folderId, deletedAt: IsNull() },
    });
    for (const doc of docs) {
      await this.applySoftDelete(doc);
      this.syncGateway.evictFromDocRoom(doc.id);
    }
    if (docs.length > 0) {
      this.storageUsageService.scheduleRecalculate(userId);
    }
  }

  /**
   * 执行软删除的核心逻辑：记录原 folderId、设置 deletedAt、清空 folderId、创建通知。
   *
   * @param document 已校验归属的文档实体
   */
  private async applySoftDelete(document: Document): Promise<void> {
    document.deletedFromFolderId = document.folderId ?? null;
    document.deletedAt = new Date();
    document.folderId = null;
    await this.documentsRepository.save(document);
    await this.notificationsService.create({
      userId: document.userId,
      type: 'document.trash',
      title: '文档已移入回收站',
      body: `「${document.title || '无标题'}」已移入回收站，${TRASH_RETENTION_DAYS} 天内可恢复。`,
      metadata: { docId: document.id },
    });
  }

  /**
   * 生成或刷新分享链接（需文档为公开状态）。
   *
   * 使用 crypto.randomBytes 生成 32 位十六进制 token，拼接 APP_PUBLIC_URL 产出分享 URL。
   */
  async generateShareLink(docId: string, userId: string): Promise<{ shareLink: string; shareUrl: string }> {
    // 内部加载（不走 lastOpenedAt 副作用，避免污染搜索关联召回）
    const document = await this.loadDocument(docId, userId);
    if (!document.isPublic) {
      throw new ForbiddenException('请先将文档设为公开');
    }
    const token = randomBytes(16).toString('hex');
    document.shareLink = token;
    await this.documentsRepository.save(document);
    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3003';
    return {
      shareLink: token,
      shareUrl: `${base}/shared/${token}`,
    };
  }

  /**
   * 通过分享 token 只读获取公开文档内容。
   *
   * 仅返回 title、content、updatedAt，不暴露 userId、tags 等敏感字段。
   */
  async getDocumentByShareToken(token: string): Promise<{ title: string; content: string; updatedAt: Date }> {
    const document = await this.documentsRepository.findOne({
      where: { shareLink: token, isPublic: true, deletedAt: IsNull() },
    });
    if (!document) {
      throw new NotFoundException('分享链接无效或已关闭');
    }
    return {
      title: document.title,
      content: document.content,
      updatedAt: document.updatedAt,
    };
  }

  /**
   * 从回收站恢复文档。
   *
   * 优先恢复到原文件夹（deletedFromFolderId），若原文件夹已删除则挂到根层级。
   */
  async restoreDocument(docId: string, userId: string): Promise<Document> {
    const document = await this.documentsRepository.findOne({
      where: { id: docId, userId, deletedAt: Not(IsNull()) },
    });
    if (!document) {
      throw new NotFoundException('回收站中未找到该文档');
    }

    let restoredFolderId: string | null = document.deletedFromFolderId;
    if (restoredFolderId) {
      const folderExists = await this.foldersRepository.exist({
        where: { id: restoredFolderId, userId },
      });
      if (!folderExists) {
        restoredFolderId = null;
      }
    }

    document.deletedAt = null;
    document.deletedFromFolderId = null;
    document.folderId = restoredFolderId;
    return this.documentsRepository.save(document);
  }

  /**
   * 立即永久删除（仅回收站内文档）。
   * 调用 hardDeleteDocument 清理所有关联数据后调度存储用量重算。
   */
  async permanentlyDeleteDocument(docId: string, userId: string): Promise<void> {
    const document = await this.documentsRepository.findOne({
      where: { id: docId, userId, deletedAt: Not(IsNull()) },
    });
    if (!document) {
      throw new NotFoundException('回收站中未找到该文档');
    }
    await this.hardDeleteDocument(document);
    this.storageUsageService.scheduleRecalculate(userId);
  }

  /**
   * 清空当前用户回收站（批量永久删除）。
   *
   * 逐个 hardDeleteDocument 清理，完成后统一调度存储用量重算并发送通知。
   */
  async emptyTrash(userId: string): Promise<{ deletedCount: number }> {
    const trashed = await this.documentsRepository.find({
      where: { userId, deletedAt: Not(IsNull()) },
    });
    for (const doc of trashed) {
      await this.hardDeleteDocument(doc);
    }
    if (trashed.length > 0) {
      this.storageUsageService.scheduleRecalculate(userId);
      await this.notificationsService.create({
        userId,
        type: 'trash.empty',
        title: '回收站已清空',
        body: `已永久删除 ${trashed.length} 篇文档。`,
      });
    }
    return { deletedCount: trashed.length };
  }

  /**
   * 清理超过保留期的回收站文档（定时任务）。
   *
   * 查找 deletedAt 早于（当前时间 - TRASH_RETENTION_DAYS）的文档，
   * 逐个 hardDelete 后汇总涉及的用户 ID 并触发存储用量重算。
   */
  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TRASH_RETENTION_DAYS);

    const expired = await this.documentsRepository.find({
      where: { deletedAt: LessThan(cutoff) },
    });

    const userIds = new Set<string>();
    for (const doc of expired) {
      await this.hardDeleteDocument(doc);
      userIds.add(doc.userId);
    }
    for (const userId of userIds) {
      this.storageUsageService.scheduleRecalculate(userId);
    }
    return expired.length;
  }

  /**
   * 回收站列表。
   *
   * 分页参数在 Service 层做 clamp：page 最小 1、pageSize 1~100。
   * 返回结果附带 purgeAt（预计永久删除时间）供前端展示倒计时。
   */
  async getTrashDocuments(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{ documents: TrashDocumentItem[]; total: number; page: number; pageSize: number }> {
    page = Math.max(1, Math.floor(page));
    pageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const [documents, total] = await this.documentsRepository.findAndCount({
      where: { userId, deletedAt: Not(IsNull()) },
      order: { deletedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const withPurge: TrashDocumentItem[] = documents.map((doc) => ({
      ...doc,
      purgeAt: this.computePurgeAt(doc.deletedAt!),
    }));

    return { documents: withPurge, total, page, pageSize };
  }

  /**
   * 计算文档预计永久删除时间（deletedAt + TRASH_RETENTION_DAYS）。
   */
  private computePurgeAt(deletedAt: Date): string {
    const purge = new Date(deletedAt);
    purge.setDate(purge.getDate() + TRASH_RETENTION_DAYS);
    return purge.toISOString();
  }

  /**
   * 永久删除文档及其所有关联数据。
   *
   * 清理顺序（从索引到主表，防止引用残留）：
   * 1. 删除 AI 向量索引（document_index 表）
   * 2. 删除增量同步更新（sync_updates 表）
   * 3. 删除快照（doc_snapshots 表）
   * 4. 删除文档行（documents 表）
   * 5. 踢出 WebSocket 房间（防止已删除文档仍接收广播）
   */
  private async hardDeleteDocument(document: Document): Promise<void> {
    const docId = document.id;
    await this.documentIndexService.deleteByDocId(docId);
    await this.syncUpdateRepository.delete({ docId });
    await this.docSnapshotRepository.delete({ docId });
    await this.documentsRepository.remove(document);
    this.syncGateway.evictFromDocRoom(docId);
  }

  /**
   * 同步文档全文检索列 docTsv。
   * 标题权重 A，正文权重 D（截断 10 万字避免超长文档拖慢 tsvector 构建）。
   * 在 createDocument / updateDocument 保存后调用，保证搜索与正文一致。
   */
  private async updateDocTsv(docId: string, title: string, content: string): Promise<void> {
    await this.documentsRepository.query(
      `UPDATE documents
       SET "docTsv" =
         setweight(to_tsvector('simple', COALESCE($2, '')), 'A') ||
         setweight(to_tsvector('simple', left(COALESCE($3, ''), 100000)), 'D')
       WHERE id = $1`,
      [docId, title, content],
    );
  }

  /**
   * 搜索文档（标题 + 内容模糊匹配）。
   *
   * 分页参数在 Service 层做 clamp：page 最小 1、pageSize 1~100。
   * 使用 LIKE 模糊匹配，支持 %keyword% 包裹。
   *
   * @param userId 用户 ID
   * @param keyword 搜索关键词
   * @param page 页码（从 1 开始）
   * @param pageSize 每页数量（1~100）
   */
  async searchDocuments(
    userId: string,
    keyword: string,
    page: number = 1,
    pageSize: number = 10,
  ): Promise<{ documents: Document[]; total: number; page: number; pageSize: number }> {
    page = Math.max(1, Math.floor(page));
    pageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));

    const query = this.documentsRepository
      .createQueryBuilder('document')
      .where('document.userId = :userId', { userId })
      .andWhere('document.deletedAt IS NULL')
      .andWhere('(document.title LIKE :keyword OR document.content LIKE :keyword)', {
        keyword: `%${keyword}%`,
      })
      .orderBy('document.updatedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [documents, total] = await query.getManyAndCount();
    return { documents, total, page, pageSize };
  }
}
