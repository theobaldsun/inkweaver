/**
 * DocumentsService 单测。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ForbiddenException, InternalServerErrorException } from "@nestjs/common";

import { DocumentsService } from "./documents.service";

test("初始快照版本与持久化后的 updateId 保持一致", async () => {
  let snapshotVersion: number | undefined;
  let docTsvParams: unknown[] | undefined;
  let reindexPayload: Record<string, unknown> | undefined;
  const documentsRepository = {
    create(value: object) {
      return { id: "doc-1", ...value };
    },
    async save(value: object) {
      return value;
    },
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /UPDATE documents/);
      docTsvParams = params;
    },
    async delete() {},
  };
  const syncUpdateRepository = {
    async save(value: object) {
      return { ...value, updateId: 42 };
    },
  };
  const docSnapshotRepository = {
    async upsert(value: { version: number }) {
      snapshotVersion = value.version;
    },
  };
  const storageUsageService = {
    scheduleRecalculate() {},
  };

  const service = new DocumentsService(
    documentsRepository as never,
    {} as never,
    syncUpdateRepository as never,
    docSnapshotRepository as never,
    storageUsageService as never,
    {} as never,
    {
      async scheduleReindex(payload: Record<string, unknown>) {
        reindexPayload = payload;
        return true;
      },
      async deleteByDocId() {},
    } as never,
    { evictFromDocRoom() {} } as never,
    {} as never, // embeddingClient mock（search 增强后注入，本测试不涉及向量路径）
    {} as never, // vectorStore mock
  );

  await service.createDocument("user-1", { title: "标题", content: "正文" });

  assert.equal(snapshotVersion, 42);
  assert.deepEqual(docTsvParams, ["doc-1", "标题", "正文"]);
  assert.deepEqual(reindexPayload, {
    docId: "doc-1",
    userId: "user-1",
    title: "标题",
    content: "正文",
  });
});

test("初始快照失败时删除文档并抛出 500", async () => {
  let deletedId: string | undefined;
  const documentsRepository = {
    create(value: object) {
      return { id: "doc-orphan", ...value };
    },
    async save(value: object) {
      return value;
    },
    async query() {},
    async delete(id: string) {
      deletedId = id;
    },
  };
  const syncUpdateRepository = {
    async save() {
      throw new Error("db unavailable");
    },
  };

  const service = new DocumentsService(
    documentsRepository as never,
    {} as never,
    syncUpdateRepository as never,
    {} as never,
    { scheduleRecalculate() {} } as never,
    {} as never,
    { async scheduleReindex() {}, async deleteByDocId() {} } as never,
    { evictFromDocRoom() {} } as never,
    {} as never, // embeddingClient mock
    {} as never, // vectorStore mock
  );

  await assert.rejects(
    () => service.createDocument("user-1", { title: "标题", content: "正文" }),
    (error: unknown) => error instanceof InternalServerErrorException,
  );
  assert.equal(deletedId, "doc-orphan");
});

test("docTsv 初始化失败时删除已保存文档且不写入同步基线", async () => {
  let deletedId: string | undefined;
  let syncBaselineWritten = false;
  const documentsRepository = {
    create(value: object) {
      return { id: "doc-tsv-failed", ...value };
    },
    async save(value: object) {
      return value;
    },
    async query() {
      throw new Error("docTsv unavailable");
    },
    async delete(id: string) {
      deletedId = id;
    },
  };
  const syncUpdateRepository = {
    async save() {
      syncBaselineWritten = true;
      return { updateId: 1 };
    },
  };

  const service = new DocumentsService(
    documentsRepository as never,
    {} as never,
    syncUpdateRepository as never,
    {} as never,
    { scheduleRecalculate() {} } as never,
    {} as never,
    { async scheduleReindex() {}, async deleteByDocId() {} } as never,
    { evictFromDocRoom() {} } as never,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    () => service.createDocument("user-1", { title: "标题", content: "正文" }),
    (error: unknown) => error instanceof InternalServerErrorException,
  );
  assert.equal(deletedId, "doc-tsv-failed");
  assert.equal(syncBaselineWritten, false);
});

test("更新标题或正文后同步提交向量重建", async () => {
  const document = {
    id: "doc-update",
    userId: "user-1",
    title: "旧标题",
    content: "旧正文",
    deletedAt: null,
  };
  let reindexPayload: Record<string, unknown> | undefined;
  const documentsRepository = {
    async findOne() {
      return document;
    },
    async save(value: object) {
      return value;
    },
    async query() {},
    manager: {
      async transaction(operation: (manager: unknown) => Promise<unknown>) {
        return operation({
          async save(_entity: unknown, value: object) {
            return value;
          },
          async query() {},
        });
      },
    },
  };
  const storageUsageService = {
    calculateDocumentBytes(title: string, content: string) {
      return title.length + content.length;
    },
    scheduleRecalculate() {},
  };
  const service = new DocumentsService(
    documentsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    storageUsageService as never,
    {} as never,
    {
      async scheduleReindex(payload: Record<string, unknown>) {
        reindexPayload = payload;
        return true;
      },
      async deleteByDocId() {},
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await service.updateDocument("doc-update", "user-1", {
    title: "新标题",
    content: "新正文",
  });

  assert.deepEqual(reindexPayload, {
    docId: "doc-update",
    userId: "user-1",
    title: "新标题",
    content: "新正文",
  });
});

test("docTsv 更新失败时正文事务失败且不提交向量重建", async () => {
  let reindexCalls = 0;
  const document = {
    id: "doc-transaction",
    userId: "user-1",
    title: "旧标题",
    content: "旧正文",
    deletedAt: null,
  };
  const documentsRepository = {
    async findOne() { return document; },
    manager: {
      async transaction(operation: (manager: unknown) => Promise<unknown>) {
        return operation({
          async save(_entity: unknown, value: object) { return value; },
          async query() { throw new Error("docTsv unavailable"); },
        });
      },
    },
  };
  const service = new DocumentsService(
    documentsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    { calculateDocumentBytes() { return 0; }, scheduleRecalculate() {} } as never,
    {} as never,
    {
      async scheduleReindex() { reindexCalls += 1; },
      async deleteByDocId() {},
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await assert.rejects(
    () => service.updateDocument("doc-transaction", "user-1", { content: "新正文" }),
    /docTsv unavailable/,
  );
  assert.equal(reindexCalls, 0);
});

test("向量索引入队异常不破坏已提交的正文更新", async () => {
  const document = {
    id: "doc-index-unavailable",
    userId: "user-1",
    title: "旧标题",
    content: "旧正文",
    deletedAt: null,
  };
  const documentsRepository = {
    async findOne() { return document; },
    manager: {
      async transaction(operation: (manager: unknown) => Promise<unknown>) {
        return operation({
          async save(_entity: unknown, value: object) { return value; },
          async query() {},
        });
      },
    },
  };
  const service = new DocumentsService(
    documentsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    { calculateDocumentBytes() { return 0; }, scheduleRecalculate() {} } as never,
    {} as never,
    {
      async scheduleReindex() { throw new Error("redis unavailable"); },
      async deleteByDocId() {},
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const result = await service.updateDocument(
    "doc-index-unavailable",
    "user-1",
    { content: "已提交正文" },
  );
  assert.equal(result.content, "已提交正文");
});

test("恢复文档后重新提交向量索引", async () => {
  const document = {
    id: "doc-restore",
    userId: "user-1",
    title: "恢复标题",
    content: "恢复正文",
    deletedAt: new Date(),
    deletedFromFolderId: null,
    folderId: null,
  };
  let reindexPayload: Record<string, unknown> | undefined;
  const documentsRepository = {
    async findOne() {
      return document;
    },
    async save(value: object) {
      return value;
    },
  };
  const service = new DocumentsService(
    documentsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      async scheduleReindex(payload: Record<string, unknown>) {
        reindexPayload = payload;
        return true;
      },
      async deleteByDocId() {},
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await service.restoreDocument("doc-restore", "user-1");

  assert.equal(document.deletedAt, null);
  assert.deepEqual(reindexPayload, {
    docId: "doc-restore",
    userId: "user-1",
    title: "恢复标题",
    content: "恢复正文",
  });
});

function createMoveHarness(folderExists: boolean) {
  const document = {
    id: "doc-move",
    userId: "user-1",
    title: "移动文档",
    content: "正文",
    folderId: "11111111-1111-4111-8111-111111111111",
    deletedAt: null,
  };
  let folderChecks = 0;
  const documentsRepository = {
    async findOne() { return document; },
    async save(value: object) { return value; },
  };
  const foldersRepository = {
    async findOne() {
      folderChecks += 1;
      return folderExists ? { id: "22222222-2222-4222-8222-222222222222", userId: "user-1" } : null;
    },
  };
  const service = new DocumentsService(
    documentsRepository as never,
    foldersRepository as never,
    {} as never,
    {} as never,
    { calculateDocumentBytes() { return 0; }, scheduleRecalculate() {} } as never,
    {} as never,
    { async scheduleReindex() {}, async deleteByDocId() {} } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, document, get folderChecks() { return folderChecks; } };
}

test("文档可从子目录显式移动到根目录", async () => {
  const harness = createMoveHarness(false);
  const result = await harness.service.updateDocument("doc-move", "user-1", { folderId: null });
  assert.equal(result.folderId, null);
  assert.equal(harness.folderChecks, 0);
});

test("文档跨层级移动前验证目标目录归属", async () => {
  const target = "22222222-2222-4222-8222-222222222222";
  const harness = createMoveHarness(true);
  const result = await harness.service.updateDocument("doc-move", "user-1", { folderId: target });
  assert.equal(result.folderId, target);
  assert.equal(harness.folderChecks, 1);
});

test("文档不能移动到其他用户的目录", async () => {
  const harness = createMoveHarness(false);
  await assert.rejects(
    () => harness.service.updateDocument(
      "doc-move",
      "user-1",
      { folderId: "22222222-2222-4222-8222-222222222222" },
    ),
    (error: unknown) => error instanceof ForbiddenException,
  );
  assert.equal(harness.document.folderId, "11111111-1111-4111-8111-111111111111");
});
