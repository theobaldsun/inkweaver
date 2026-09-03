/**
 * 搜索基础设施升级：HNSW 向量索引 + docTsv 全文列 + lastOpenedAt 打开时间列。
 * 三项是搜索地基，同时上线（对应设计文档第 8 节问题 6 选 A）。
 *
 * 数据来源：document_chunks.embedding / documents.title+content / 用户打开行为
 * 关键策略：HNSW 增量友好、docTsv 标题权重 A 正文权重 D、lastOpenedAt 软回填
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SearchInfraUpgrade1756000000000 implements MigrationInterface {
  name = 'SearchInfraUpgrade1756000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) HNSW 向量索引（通道④地基）。vector_cosine_ops 必须匹配查询算子 <=>
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_document_chunks_embedding_hnsw"
        ON document_chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 128)
    `);

    // 2) documents 全文检索列 + GIN 索引（通道②地基）
    await queryRunner.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS "docTsv" tsvector`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_documents_doc_tsv"
        ON documents USING gin ("docTsv")
    `);

    // 3) documents 打开时间列（通道③地基）
    await queryRunner.query(
      `ALTER TABLE documents ADD COLUMN IF NOT EXISTS "lastOpenedAt" timestamptz NULL`,
    );

    // 4) 回填现有文档 docTsv（标题权重 A，正文权重 D，正文截断 10 万字避免拖慢）
    await queryRunner.query(`
      UPDATE documents
      SET "docTsv" =
        setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
        setweight(to_tsvector('simple', left(COALESCE(content, ''), 100000)), 'D')
      WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_document_chunks_embedding_hnsw"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_documents_doc_tsv"`);
    await queryRunner.query(`ALTER TABLE documents DROP COLUMN IF EXISTS "docTsv"`);
    await queryRunner.query(`ALTER TABLE documents DROP COLUMN IF EXISTS "lastOpenedAt"`);
  }
}