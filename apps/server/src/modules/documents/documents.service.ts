/**
 * 文档服务
 *
 * 用途：
 * - 实现文档的 CRUD、回收站软删/恢复/永久删除
 * - 处理文档的业务逻辑
 */

import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { randomBytes, createHash } from "crypto";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, LessThan, Not, Repository } from "typeorm";
import * as Y from 'yjs';

import { TRASH_RETENTION_DAYS } from "@inkweaver/shared";
import { Document } from "./entity/document.entity";
import { Folder } from "./entity/folder.entity";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { SyncUpdate } from "../sync/entity/sync-update.entity";
import { DocSnapshot } from "../sync/entity/doc-snapshot.entity";
import { StorageUsageService } from "../storage/storage-usage.service";
import { NotificationsService } from "../notifications/notifications.service";

export interface TrashDocumentItem extends Document {
  purgeAt: string;
}

@Injectable()
export class DocumentsService {
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
  ) {}

  /**
   * 创建文档
   */
  async createDocument(userId: string, createDocumentDto: CreateDocumentDto): Promise<Document> {
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
    await this.generateInitialSnapshotAndUpdate(savedDocument.id, createDocumentDto);
    this.storageUsageService.scheduleRecalculate(userId);
    return savedDocument;
  }

  private async generateInitialSnapshotAndUpdate(docId: string, createDocumentDto: CreateDocumentDto): Promise<void> {
    try {
      const yDoc = new Y.Doc();
      const text = yDoc.getText('content');
      text.insert(0, createDocumentDto.content || '');
      const yMap = yDoc.getMap('metadata');
      yMap.set('title', createDocumentDto.title || 'Untitled Document');
      const snapshotBytes = Y.encodeStateAsUpdate(yDoc);
      let binaryString = '';
      for (let i = 0; i < snapshotBytes.length; i++) {
        binaryString += String.fromCharCode(snapshotBytes[i]!);
      }
      const snapshot = btoa(binaryString);
      await this.docSnapshotRepository.upsert(
        { docId, snapshot, version: 1, createdAt: new Date() },
        { conflictPaths: ['docId'] },
      );
      const initialUpdate = new SyncUpdate();
      initialUpdate.docId = docId;
      initialUpdate.update = snapshot;
      initialUpdate.clientId = 'system';
      initialUpdate.timestamp = Date.now();
      await this.syncUpdateRepository.save(initialUpdate);
    } catch (error) {
      console.error('Failed to generate initial snapshot and update:', error);
    }
  }

  /**
   * 获取未删除文档列表
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
   * 获取单个未删除文档
   */
  async getDocument(docId: string, userId: string): Promise<Document> {
    const document = await this.documentsRepository.findOne({
      where: { id: docId, userId, deletedAt: IsNull() },
    });
    if (!document) {
      throw new NotFoundException(`Document with id ${docId} not found`);
    }
    return document;
  }

  /**
   * 校验文档存在且未在回收站（供同步模块调用）
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
   * 将 Yjs 投影的标题/正文写回 PG（搜索、分享、列表用）。
   */
  async projectSearchableContent(docId: string, title: string, content: string): Promise<void> {
    const document = await this.documentsRepository.findOne({
      where: { id: docId, deletedAt: IsNull() },
    });
    if (!document) {
      return;
    }
    if (document.title === title && document.content === content) {
      return;
    }

    const previousBytes = this.storageUsageService.calculateDocumentBytes(
      document.title,
      document.content,
    );
    document.title = title;
    document.content = content;
    const saved = await this.documentsRepository.save(document);
    const nextBytes = this.storageUsageService.calculateDocumentBytes(saved.title, saved.content);
    if (nextBytes !== previousBytes) {
      this.storageUsageService.scheduleRecalculate(saved.userId);
    }
  }

  async updateDocument(docId: string, userId: string, updateDocumentDto: UpdateDocumentDto): Promise<Document> {
    const document = await this.getDocument(docId, userId);
    const previousBytes = this.storageUsageService.calculateDocumentBytes(document.title, document.content);
    if (updateDocumentDto.title !== undefined) document.title = updateDocumentDto.title;
    if (updateDocumentDto.content !== undefined) document.content = updateDocumentDto.content;
    if (updateDocumentDto.isPublic !== undefined) document.isPublic = updateDocumentDto.isPublic;
    if (updateDocumentDto.tags !== undefined) document.tags = updateDocumentDto.tags;
    if (updateDocumentDto.folderId !== undefined) document.folderId = updateDocumentDto.folderId;
    const saved = await this.documentsRepository.save(document);
    const nextBytes = this.storageUsageService.calculateDocumentBytes(saved.title, saved.content);
    if (nextBytes !== previousBytes) {
      this.storageUsageService.scheduleRecalculate(userId);
    }
    return saved;
  }

  /**
   * 移入回收站（软删除）
   */
  async deleteDocument(docId: string, userId: string): Promise<void> {
    await this.softDeleteDocument(docId, userId);
  }

  async softDeleteDocument(docId: string, userId: string): Promise<void> {
    const document = await this.getDocument(docId, userId);
    await this.applySoftDelete(document);
    this.storageUsageService.scheduleRecalculate(userId);
  }

  /**
   * 将指定文件夹下所有未删除文档移入回收站
   */
  /**
   * 将文件夹内文档移出文件夹（不删除，仅 deleteFolderOnly 使用）
   */
  async unlinkDocumentsFromFolder(userId: string, folderId: string): Promise<void> {
    await this.documentsRepository.update(
      { userId, folderId, deletedAt: IsNull() },
      { folderId: null },
    );
  }

  async softDeleteDocumentsInFolder(userId: string, folderId: string): Promise<void> {
    const docs = await this.documentsRepository.find({
      where: { userId, folderId, deletedAt: IsNull() },
    });
    for (const doc of docs) {
      await this.applySoftDelete(doc);
    }
    if (docs.length > 0) {
      this.storageUsageService.scheduleRecalculate(userId);
    }
  }

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
   * 生成或刷新分享 token（需 isPublic）。
   */
  async generateShareLink(docId: string, userId: string): Promise<{ shareLink: string; shareUrl: string }> {
    const document = await this.getDocument(docId, userId);
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
   * 通过分享 token 只读获取公开文档。
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
   * 从回收站恢复
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
   * 立即永久删除（仅回收站内文档）
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
   * 清空当前用户回收站
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
   * 清理超过保留期的回收站文档（定时任务）
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
   * 回收站列表
   */
  async getTrashDocuments(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<{ documents: TrashDocumentItem[]; total: number; page: number; pageSize: number }> {
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

  private computePurgeAt(deletedAt: Date): string {
    const purge = new Date(deletedAt);
    purge.setDate(purge.getDate() + TRASH_RETENTION_DAYS);
    return purge.toISOString();
  }

  private async hardDeleteDocument(document: Document): Promise<void> {
    const docId = document.id;
    await this.syncUpdateRepository.delete({ docId });
    await this.docSnapshotRepository.delete({ docId });
    await this.documentsRepository.remove(document);
  }

  async searchDocuments(
    userId: string,
    keyword: string,
    page: number = 1,
    pageSize: number = 10,
  ): Promise<{ documents: Document[]; total: number; page: number; pageSize: number }> {
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
