/**
 * DocumentIndexService 固定 jobId 重入队与清理行为测试。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DocumentIndexService } from './document-index.service';

const payload = {
  docId: 'doc-1',
  userId: 'user-1',
  title: '标题',
  content: '正文',
};

test('failed 终态任务先删除再复用固定 jobId 入队', async () => {
  let removed = false;
  let addedOptions: Record<string, unknown> | undefined;
  const queue = {
    async getJob() {
      return {
        async getState() {
          return 'failed';
        },
        async remove() {
          removed = true;
        },
      };
    },
    async add(
      _name: string,
      _payload: object,
      options: Record<string, unknown>,
    ) {
      assert.equal(removed, true);
      addedOptions = options;
    },
  };
  const service = new DocumentIndexService(queue as never, {} as never);

  const accepted = await service.scheduleReindex(payload);

  assert.equal(accepted, true);
  assert.equal(addedOptions?.jobId, 'reindex-doc-1');
});

test('主任务 active 时提交独立延迟任务保留最新内容', async () => {
  const additions: Array<{
    payload: object;
    options: Record<string, unknown>;
  }> = [];
  const queue = {
    async getJob(jobId: string) {
      if (jobId === 'reindex-doc-1') {
        return {
          async getState() {
            return 'active';
          },
        };
      }
      return null;
    },
    async add(
      _name: string,
      jobPayload: object,
      options: Record<string, unknown>,
    ) {
      additions.push({ payload: jobPayload, options });
    },
  };
  const service = new DocumentIndexService(queue as never, {} as never);

  const accepted = await service.scheduleReindex(payload);

  assert.equal(accepted, true);
  assert.equal(additions.length, 1);
  assert.deepEqual(additions[0]!.payload, payload);
  assert.equal(additions[0]!.options.jobId, 'reindex-doc-1-delayed');
  assert.equal(additions[0]!.options.delay, 30_000);
});

test('队列异常时返回 false 而不向文档主流程抛错', async () => {
  const queue = {
    async getJob() {
      throw new Error('redis unavailable');
    },
  };
  const service = new DocumentIndexService(queue as never, {} as never);

  const accepted = await service.scheduleReindex(payload);

  assert.equal(accepted, false);
});

test('删除文档时同时移除主任务和延迟任务', async () => {
  const removed: string[] = [];
  let chunksDeleted = false;
  const queue = {
    async remove(jobId: string) {
      removed.push(jobId);
    },
  };
  const vectorStore = {
    async deleteByDocId() {
      chunksDeleted = true;
    },
  };
  const service = new DocumentIndexService(
    queue as never,
    vectorStore as never,
  );

  await service.deleteByDocId('doc-1');

  assert.deepEqual(removed.sort(), [
    'reindex-doc-1',
    'reindex-doc-1-delayed',
  ]);
  assert.equal(chunksDeleted, true);
});
