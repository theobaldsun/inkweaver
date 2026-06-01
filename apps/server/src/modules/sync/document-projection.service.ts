/**
 * 将 Yjs 状态投影到 documents.title/content，供搜索、分享与列表摘要使用。
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as Y from 'yjs';
import { base64ToUint8Array } from '@inkweaver/shared';

import { SyncUpdate } from './entity/sync-update.entity';
import { DocumentsService } from '../documents/documents.service';

export interface ProjectedDocumentFields {
  title: string;
  content: string;
}

/**
 * 从 Y.Doc 提取可搜索的标题与正文。
 */
export function extractProjectedFields(yDoc: Y.Doc): ProjectedDocumentFields {
  const content = yDoc.getText('content').toString();
  const metadata = yDoc.getMap('metadata');
  const rawTitle = metadata.get('title');
  const title =
    typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : '无标题文档';
  return { title, content };
}

@Injectable()
export class DocumentProjectionService {
  private readonly logger = new Logger(DocumentProjectionService.name);
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectRepository(SyncUpdate)
    private readonly syncUpdateRepository: Repository<SyncUpdate>,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * 防抖调度：sync push 后延迟写回 PG。
   */
  scheduleProjection(docId: string, delayMs = 1500): void {
    const existing = this.pending.get(docId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pending.delete(docId);
      this.projectDocument(docId).catch((err) => {
        this.logger.warn(`文档投影失败 docId=${docId}`, err);
      });
    }, delayMs);

    this.pending.set(docId, timer);
  }

  /**
   * 合并全部 Yjs updates 并写回 documents 表。
   */
  async projectDocument(docId: string): Promise<void> {
    const updates = await this.syncUpdateRepository.find({
      where: { docId },
      order: { updateId: 'ASC' },
    });

    if (updates.length === 0) {
      return;
    }

    const yDoc = new Y.Doc();
    for (const row of updates) {
      try {
        Y.applyUpdate(yDoc, base64ToUint8Array(row.update));
      } catch (error) {
        this.logger.error(`应用 update ${row.updateId} 失败 docId=${docId}`, error);
      }
    }

    const { title, content } = extractProjectedFields(yDoc);
    await this.documentsService.projectSearchableContent(docId, title, content);
  }
}
