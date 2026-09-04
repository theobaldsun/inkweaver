/**
 * 将 Yjs 状态投影到 documents.title/content，供搜索、分享与列表摘要使用。
 */

import { base64ToUint8Array } from '@inkweaver/shared';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import * as Y from 'yjs';

import { DocSnapshot } from './entity/doc-snapshot.entity';
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
    @InjectRepository(DocSnapshot)
    private readonly docSnapshotRepository: Repository<DocSnapshot>,
    // DocumentsService -> SyncGateway -> 本 Service 构成三方循环，必须延迟解析。
    @Inject(forwardRef(() => DocumentsService))
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

    timer.unref?.();
    this.pending.set(docId, timer);
  }

  /**
   * 合并全部 Yjs updates 并写回 documents 表。
   */
  async projectDocument(docId: string): Promise<void> {
    const yDoc = new Y.Doc();

    try {
      let snapshotVersion = 0;
      let restoredSnapshot = false;
      const latestSnapshot = await this.docSnapshotRepository.findOne({
        where: { docId },
        order: { version: 'DESC' },
      });

      if (latestSnapshot) {
        try {
          Y.applyUpdate(yDoc, base64ToUint8Array(latestSnapshot.snapshot));
          snapshotVersion = latestSnapshot.version;
          restoredSnapshot = true;
        } catch (error) {
          this.logger.warn(`应用快照失败，回退到完整更新重放 docId=${docId}`, error);
        }
      }

      const updates = await this.syncUpdateRepository.find({
        where: {
          docId,
          updateId: MoreThan(snapshotVersion),
        },
        order: { updateId: 'ASC' },
      });

      if (!restoredSnapshot && updates.length === 0) {
        return;
      }

      for (const row of updates) {
        try {
          Y.applyUpdate(yDoc, base64ToUint8Array(row.update));
        } catch (error) {
          this.logger.error(`应用 update ${row.updateId} 失败 docId=${docId}`, error);
          return;
        }
      }

      const { title, content } = extractProjectedFields(yDoc);
      await this.documentsService.projectSearchableContent(docId, title, content);
    } finally {
      yDoc.destroy();
    }
  }
}
