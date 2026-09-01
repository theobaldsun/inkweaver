/**
 * SearchService 混合检索单测。
 *
 * 使用数据库/向量层 mock 验证通道选择、SQL 契约、单路降级、docId 去重和分页。
 * PostgreSQL 运算符与索引执行计划仍需在隔离数据库做集成验证。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SearchService } from "./search.service";

type SqlChannel = "exact" | "fuzzy" | "related";

interface SqlCall {
  channel: SqlChannel;
  sql: string;
  params: unknown[];
}

interface MetadataDocument {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: Date;
  lastOpenedAt: Date | null;
}

interface HarnessOptions {
  exactRows?: Array<Record<string, unknown>>;
  fuzzyRows?: Array<Record<string, unknown>>;
  relatedRows?: Array<Record<string, unknown>>;
  semanticRows?: Array<{ docId: string; excerpt: string; sim: number }>;
  metadata?: MetadataDocument[];
  failChannel?: SqlChannel;
}

function sqlChannel(sql: string): SqlChannel {
  if (sql.includes('"exactScore"')) return "exact";
  if (sql.includes('"matchedTermCount"')) return "fuzzy";
  if (sql.includes('"relatedScore"')) return "related";
  throw new Error(`未识别的搜索 SQL: ${sql}`);
}

function metadata(id: string, title: string = id): MetadataDocument {
  return {
    id,
    title,
    content: `${title} 正文`,
    tags: ["同步"],
    updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    lastOpenedAt: null,
  };
}

function createHarness(options: HarnessOptions = {}) {
  const sqlCalls: SqlCall[] = [];
  let embeddingCalls = 0;
  let vectorCalls = 0;
  const dataSource = {
    async query(sql: string, params: unknown[]) {
      const channel = sqlChannel(sql);
      sqlCalls.push({ channel, sql, params });
      if (options.failChannel === channel) throw new Error(`${channel} unavailable`);
      if (channel === "exact") return options.exactRows ?? [];
      if (channel === "fuzzy") return options.fuzzyRows ?? [];
      return options.relatedRows ?? [];
    },
  };
  const documentsRepository = {
    async find() {
      return options.metadata ?? [];
    },
  };
  const embeddingClient = {
    async embedQuery() {
      embeddingCalls += 1;
      return [0.1, 0.2];
    },
  };
  const vectorStore = {
    async semanticSearchForHybrid() {
      vectorCalls += 1;
      return options.semanticRows ?? [];
    },
  };
  const Service = SearchService as unknown as new (...args: unknown[]) => SearchService;
  const service = new Service({}, documentsRepository, dataSource, embeddingClient, vectorStore);

  return {
    service,
    sqlCalls,
    get embeddingCalls() {
      return embeddingCalls;
    },
    get vectorCalls() {
      return vectorCalls;
    },
  };
}

test("keyword 模式只执行 exact/fuzzy，并按 docId 去重融合", async () => {
  const harness = createHarness({
    exactRows: [{ docId: "doc-1", title: "同步机制", exactScore: 100, exactHint: "命中标题" }],
    fuzzyRows: [
      { docId: "doc-1", excerpt: "<mark>同步</mark>机制", fuzzyScore: 40, matchedTermCount: 1 },
      { docId: "doc-2", excerpt: "<mark>同步</mark>说明", fuzzyScore: 30, matchedTermCount: 1 },
    ],
    metadata: [metadata("doc-1", "同步机制"), metadata("doc-2", "同步说明")],
  });

  const result = await harness.service.hybridSearch("user-1", "同步", 1, 10, "keyword");

  assert.deepEqual(
    harness.sqlCalls.map((call) => call.channel),
    ["exact", "fuzzy"],
  );
  assert.equal(harness.embeddingCalls, 0);
  assert.equal(harness.vectorCalls, 0);
  assert.equal(result.total, 2);
  assert.equal(result.documents.length, 2);
  assert.deepEqual(result.documents[0]?.matchedBy, ["exact", "fuzzy"]);
});

test("semantic 模式只执行 exact/semantic，不执行 fuzzy/related", async () => {
  const harness = createHarness({
    semanticRows: [{ docId: "doc-semantic", excerpt: "语义摘要", sim: 0.9 }],
    metadata: [metadata("doc-semantic", "语义文档")],
  });

  const result = await harness.service.hybridSearch("user-1", "概念关联", 1, 10, "semantic");

  assert.deepEqual(
    harness.sqlCalls.map((call) => call.channel),
    ["exact"],
  );
  assert.equal(harness.embeddingCalls, 1);
  assert.equal(harness.vectorCalls, 1);
  assert.deepEqual(result.documents[0]?.matchedBy, ["semantic"]);
});

test("smart 模式单路失败时保留其余通道结果", async () => {
  const harness = createHarness({
    failChannel: "fuzzy",
    exactRows: [{ docId: "doc-exact", title: "精确", exactScore: 100, exactHint: "命中标题" }],
    relatedRows: [{ docId: "doc-related", relatedScore: 20 }],
    semanticRows: [{ docId: "doc-semantic", excerpt: "语义摘要", sim: 0.8 }],
    metadata: [
      metadata("doc-exact", "精确"),
      metadata("doc-related", "关联"),
      metadata("doc-semantic", "语义"),
    ],
  });

  const result = await harness.service.hybridSearch("user-1", "同步", 1, 10, "smart");

  assert.deepEqual(
    harness.sqlCalls.map((call) => call.channel),
    ["exact", "fuzzy", "related"],
  );
  assert.equal(result.total, 3);
  assert.deepEqual(
    new Set(result.documents.flatMap((document) => document.matchedBy)),
    new Set(["exact", "related", "semantic"]),
  );
});

test("搜索 SQL 使用 JSONB 标签运算和真实交集计数，并保留 folderId 上下文", async () => {
  const folderId = "550e8400-e29b-41d4-a716-446655440000";
  const harness = createHarness();

  await harness.service.hybridSearch("user-1", "同步 2024年 3月份", 1, 10, "smart", { folderId });

  const exact = harness.sqlCalls.find((call) => call.channel === "exact");
  const fuzzy = harness.sqlCalls.find((call) => call.channel === "fuzzy");
  const related = harness.sqlCalls.find((call) => call.channel === "related");
  assert.ok(exact);
  assert.ok(fuzzy);
  assert.ok(related);
  assert.match(exact.sql, /tags @> to_jsonb\(\$3::varchar\[\]\)/);
  assert.doesNotMatch(exact.sql, /tags @> \$3::varchar\[\]/);
  assert.match(fuzzy.sql, /cardinality\(/);
  assert.match(fuzzy.sql, /INTERSECT/);
  assert.doesNotMatch(fuzzy.sql, /array_length\(/);
  assert.match(related.sql, /tags \?\| \$5::varchar\[\]/);
  assert.doesNotMatch(related.sql, /tags &&/);
  assert.equal(related.params[2], 2024);
  assert.equal(related.params[3], 3);
  assert.equal(related.params[5], folderId);
});

test("分页基于去重后的文档集合计算 total/hasMore", async () => {
  const exactRows = ["doc-1", "doc-2", "doc-3"].map((docId, index) => ({
    docId,
    title: docId,
    exactScore: 100 - index,
    exactHint: "命中标题",
  }));
  const harness = createHarness({
    exactRows,
    metadata: exactRows.map((row) => metadata(row.docId)),
  });

  const result = await harness.service.hybridSearch("user-1", "同步", 2, 2, "semantic");

  assert.equal(result.total, 3);
  assert.equal(result.page, 2);
  assert.equal(result.documents.length, 1);
  assert.equal(result.hasMore, false);
});
