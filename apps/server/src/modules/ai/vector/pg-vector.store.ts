/**
 * PostgreSQL + pgvector 向量存储实现。
 */

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AI_EMBEDDING_DIMENSIONS } from '../../../config/ai.config';
import type {
  SimilarityHit,
  VectorChunkRecord,
  VectorStore,
} from './vector-store';

/**
 * 将 number[] 转为 pgvector 字面量。
 * 输入：向量；输出：如 `[0.1,0.2]`
 */
export function toPgVectorLiteral(embedding: number[]): string {
  if (embedding.length !== AI_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding 维度必须为 ${AI_EMBEDDING_DIMENSIONS}，实际 ${embedding.length}`,
    );
  }
  return `[${embedding.map((n) => Number(n)).join(',')}]`;
}

@Injectable()
export class PgVectorStore implements VectorStore {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * 删除旧切块后批量插入新切块。
   */
  async replaceDocChunks(chunks: VectorChunkRecord[]): Promise<void> {
    if (chunks.length === 0) return;
    const docId = chunks[0]!.docId;
    const userId = chunks[0]!.userId;

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM document_chunks WHERE "docId" = $1`, [
        docId,
      ]);

      for (const chunk of chunks) {
        if (chunk.docId !== docId || chunk.userId !== userId) {
          throw new Error('replaceDocChunks 要求同一 docId/userId');
        }
        const vector = toPgVectorLiteral(chunk.embedding);
        await manager.query(
          `
          INSERT INTO document_chunks
            ("userId", "docId", "chunkIndex", content, title, embedding)
          VALUES ($1, $2, $3, $4, $5, $6::vector)
          `,
          [
            chunk.userId,
            chunk.docId,
            chunk.chunkIndex,
            chunk.content,
            chunk.title,
            vector,
          ],
        );
      }
    });
  }

  async deleteByDocId(docId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM document_chunks WHERE "docId" = $1`,
      [docId],
    );
  }

  async similaritySearch(
    userId: string,
    queryEmbedding: number[],
    topK: number,
    docIds?: string[],
  ): Promise<SimilarityHit[]> {
    const vector = toPgVectorLiteral(queryEmbedding);
    const limit = Math.max(1, Math.min(topK, 20));

    let sql = `
      SELECT
        "docId",
        "chunkIndex",
        title,
        content,
        1 - (embedding <=> $1::vector) AS score
      FROM document_chunks
      WHERE "userId" = $2
    `;
    const params: unknown[] = [vector, userId];

    if (docIds && docIds.length > 0) {
      params.push(docIds);
      sql += ` AND "docId" = ANY($${params.length}::uuid[])`;
    }

    params.push(limit);
    sql += ` ORDER BY embedding <=> $1::vector ASC LIMIT $${params.length}`;

    const rows = (await this.dataSource.query(sql, params)) as Array<{
      docId: string;
      chunkIndex: number;
      title: string;
      content: string;
      score: string | number;
    }>;

    return rows.map((row) => ({
      docId: row.docId,
      chunkIndex: Number(row.chunkIndex),
      title: row.title,
      content: row.content,
      score: Number(row.score),
    }));
  }
}
