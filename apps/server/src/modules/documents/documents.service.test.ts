/**
 * DocumentsService 单测。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { InternalServerErrorException } from "@nestjs/common";

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
