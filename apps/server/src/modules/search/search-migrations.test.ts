/**
 * 搜索迁移 SQL 契约单测。
 *
 * 这里只验证迁移包含必要的正向/回滚语句；实际锁耗时、索引命中和回滚仍需 PostgreSQL 演练。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SearchInfraUpgrade1756000000000 } from "../../migrations/1756000000000-SearchInfraUpgrade";
import { AddSearchHistoryMode1756100000000 } from "../../migrations/1756100000000-AddSearchHistoryMode";

function queryRecorder() {
  const statements: string[] = [];
  return {
    statements,
    queryRunner: {
      async query(sql: string) {
        statements.push(sql);
      },
    },
  };
}

test("SearchInfraUpgrade 创建并回滚 HNSW、docTsv/GIN 和 lastOpenedAt", async () => {
  const migration = new SearchInfraUpgrade1756000000000();
  const up = queryRecorder();
  await migration.up(up.queryRunner as never);
  const upSql = up.statements.join("\n");

  assert.match(upSql, /CREATE EXTENSION IF NOT EXISTS vector/);
  assert.match(upSql, /USING hnsw \(embedding vector_cosine_ops\)/);
  assert.match(upSql, /WITH \(m = 16, ef_construction = 128\)/);
  assert.doesNotMatch(upSql, /efConstruction/);
  assert.match(upSql, /ADD COLUMN IF NOT EXISTS "docTsv" tsvector/);
  assert.match(upSql, /USING gin \("docTsv"\)/);
  assert.match(upSql, /ADD COLUMN IF NOT EXISTS "lastOpenedAt" timestamptz/);
  assert.match(upSql, /UPDATE documents[\s\S]*setweight\(to_tsvector/);

  const down = queryRecorder();
  await migration.down(down.queryRunner as never);
  const downSql = down.statements.join("\n");
  assert.match(downSql, /DROP INDEX IF EXISTS "IDX_document_chunks_embedding_hnsw"/);
  assert.match(downSql, /DROP INDEX IF EXISTS "IDX_documents_doc_tsv"/);
  assert.match(downSql, /DROP COLUMN IF EXISTS "docTsv"/);
  assert.match(downSql, /DROP COLUMN IF EXISTS "lastOpenedAt"/);
});

test("AddSearchHistoryMode 创建默认 smart 的非空列并提供回滚", async () => {
  const migration = new AddSearchHistoryMode1756100000000();
  const up = queryRecorder();
  await migration.up(up.queryRunner as never);
  assert.match(up.statements.join("\n"), /"mode" varchar\(20\) NOT NULL DEFAULT 'smart'/);

  const down = queryRecorder();
  await migration.down(down.queryRunner as never);
  assert.match(down.statements.join("\n"), /DROP COLUMN IF EXISTS "mode"/);
});
