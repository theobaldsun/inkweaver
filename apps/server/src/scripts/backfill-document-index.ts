/**
 * 生产文档向量索引回填入口。
 *
 * 用途：将所有未删除文档按批次重新提交到 AI 索引队列，修复历史文档、失败任务和
 * 功能上线前未生成的 document_chunks。固定 jobId 与 replaceDocChunks 共同保证幂等。
 *
 * 用法：node dist/scripts/backfill-document-index.js
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AppModule } from '../app.module';
import { DocumentIndexService } from '../modules/ai/document-index.service';
import { Document } from '../modules/documents/entity/document.entity';

const BATCH_SIZE = 100;

/**
 * 分批提交全部有效文档，避免一次性把大体量正文加载进内存。
 */
async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  let queued = 0;
  let failed = 0;
  let cursor: string | null = null;

  try {
    const dataSource = app.get(DataSource);
    const indexService = app.get(DocumentIndexService, { strict: false });
    const repository = dataSource.getRepository(Document);

    while (true) {
      const query = repository
        .createQueryBuilder('document')
        .select([
          'document.id',
          'document.userId',
          'document.title',
          'document.content',
        ])
        .where('document.deletedAt IS NULL')
        .orderBy('document.id', 'ASC')
        .take(BATCH_SIZE);

      if (cursor) {
        query.andWhere('document.id > :cursor', { cursor });
      }

      const documents = await query.getMany();
      if (documents.length === 0) break;

      for (const document of documents) {
        const accepted = await indexService.scheduleReindex({
          docId: document.id,
          userId: document.userId,
          title: document.title,
          content: document.content,
        });
        if (accepted) queued += 1;
        else failed += 1;
      }

      cursor = documents[documents.length - 1]!.id;
    }

    console.log(`[ai-index-backfill] queued=${queued} failed=${failed}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  console.error('[ai-index-backfill] failed', error);
  process.exitCode = 1;
});
