/**
 * SyncController 单元测试。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { SyncController } from './sync.controller';

const noopGateway = { broadcastDocUpdates() {} };

test('返回完整快照时将游标推进到快照版本', async () => {
  const syncUpdateRepository = {
    async findOne() {
      return { updateId: 10 };
    },
    async find() {
      return [];
    },
  };
  const docSnapshotRepository = {
    async findOne() {
      return { snapshot: 'snapshot-data', version: 10 };
    },
  };
  const documentsService = {
    async assertDocumentActive() {},
  };
  const controller = new SyncController(
    syncUpdateRepository as never,
    docSnapshotRepository as never,
    {} as never,
    documentsService as never,
    {} as never,
    {} as never,
    noopGateway as never,
  );

  const response = await controller.pull(
    { docId: 'doc-1', cursor: 0, limit: 100 },
    { user: { sub: 'user-1' } } as never,
  );

  assert.equal(response.snapshot, 'snapshot-data');
  assert.equal(response.nextCursor, 10);
});

test('push 使用 JWT 用户校验文档归属后才持久化更新', async () => {
  let assertedOwner: string | undefined;
  let saved = false;
  let broadcastedClientId: string | undefined;
  const syncUpdateRepository = {
    async findOne() {
      return null;
    },
    async save(value: object) {
      saved = true;
      return { ...value, updateId: 1 };
    },
  };
  const documentsService = {
    async assertDocumentActive(docId: string, userId: string) {
      assert.equal(docId, 'doc-1');
      assertedOwner = userId;
    },
  };
  const controller = new SyncController(
    syncUpdateRepository as never,
    {} as never,
    { scheduleRecalculateByDocId() {} } as never,
    documentsService as never,
    { scheduleProjection() {} } as never,
    { scheduleSnapshot() {} } as never,
    {
      broadcastDocUpdates(
        _docId: string,
        _updates: string[],
        _updateIds: number[],
        clientId?: string,
      ) {
        broadcastedClientId = clientId;
      },
    } as never,
  );
  const update = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64');

  await controller.push(
    { docId: 'doc-1', updates: [update], clientId: 'client-1' },
    { user: { sub: 'owner-1' } } as never,
  );

  assert.equal(assertedOwner, 'owner-1');
  assert.equal(saved, true);
  assert.equal(broadcastedClientId, 'client-1');
});

test('文档归属校验失败时 push 不写入更新', async () => {
  let saved = false;
  const syncUpdateRepository = {
    async save() {
      saved = true;
    },
  };
  const documentsService = {
    async assertDocumentActive() {
      throw new Error('document not owned by user');
    },
  };
  const controller = new SyncController(
    syncUpdateRepository as never,
    {} as never,
    {} as never,
    documentsService as never,
    {} as never,
    {} as never,
    noopGateway as never,
  );

  await assert.rejects(
    () =>
      controller.push(
        { docId: 'doc-1', updates: ['ignored'] },
        { user: { sub: 'intruder' } } as never,
      ),
    { message: 'document not owned by user' },
  );
  assert.equal(saved, false);
});
