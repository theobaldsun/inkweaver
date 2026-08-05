/**
 * 启用 pgvector 并创建 document_chunks 表（向量维度 512，对齐 bge-small-zh-v1.5）。
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentChunksPgvector1753200000000 implements MigrationInterface {
  name = 'AddDocumentChunksPgvector1753200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_chunks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "docId" uuid NOT NULL,
        "chunkIndex" integer NOT NULL,
        "content" text NOT NULL,
        "title" character varying NOT NULL DEFAULT '',
        "embedding" vector(512) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_chunks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_document_chunks_doc_chunk" UNIQUE ("docId", "chunkIndex")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_chunks_userId" ON "document_chunks" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_chunks_docId" ON "document_chunks" ("docId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "document_chunks"`);
  }
}
