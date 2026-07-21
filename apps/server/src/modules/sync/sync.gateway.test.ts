import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { SyncGateway } from './sync.gateway';

test('握手 JWT 载荷缺少 sub 时断开连接', async () => {
  let disconnected = false;
  const gateway = new SyncGateway(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      async verifyToken() {
        return {};
      },
    } as never,
  );
  const client = {
    id: 'socket-missing-sub',
    data: {} as { userId?: string },
    handshake: { auth: { token: 'valid-token' }, headers: {} },
    disconnect() {
      disconnected = true;
    },
  };

  await gateway.handleConnection(client as never);

  assert.equal(disconnected, true);
  assert.equal(client.data.userId, undefined);
});

test('文档归属校验失败时不允许加入同步房间', async () => {
  let joined = false;
  const gateway = new SyncGateway(
    {} as never,
    {} as never,
    {
      async assertDocumentActive() {
        throw new Error('document not owned by user');
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const client = {
    id: 'socket-intruder',
    data: { userId: 'intruder' },
    rooms: new Set(['socket-intruder']),
    async join() {
      joined = true;
    },
    leave() {},
  };

  await assert.rejects(
    () => gateway.handleJoinDoc(client as never, { docId: 'doc-1' }),
    { message: 'document not owned by user' },
  );
  assert.equal(joined, false);
});

test('空 docId 时拒绝加入房间', async () => {
  const gateway = new SyncGateway(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const client = {
    id: 'socket-empty-doc',
    data: { userId: 'user-1' },
    rooms: new Set(['socket-empty-doc']),
    async join() {},
    leave() {},
  };

  await assert.rejects(
    () => gateway.handleJoinDoc(client as never, { docId: '' }),
    (error: unknown) => {
      const err = error as { message?: string; getResponse?: () => unknown };
      const response = err.getResponse?.();
      const text =
        typeof response === 'string'
          ? response
          : typeof response === 'object' && response && 'message' in response
            ? String((response as { message: unknown }).message)
            : String(err.message ?? '');
      return text.includes('docId');
    },
  );
});
test('非法 Base64 update 时返回失败并 emit update-error', async () => {
  let errorPayload: { type?: string; message?: string } | undefined;
  const gateway = new SyncGateway(
    {
      async findOne() {
        return null;
      },
      create(value: object) {
        return value;
      },
      async save() {
        throw new Error('should not save');
      },
    } as never,
    {} as never,
    {
      async assertDocumentActive() {},
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const client = {
    id: 'socket-bad-update',
    data: { userId: 'user-1' },
    rooms: new Set(['socket-bad-update', 'doc-1']),
    emit(event: string, payload: object) {
      if (event === 'error') errorPayload = payload as { type?: string; message?: string };
    },
    to() {
      return { emit() {} };
    },
  };

  const result = await gateway.handleUpdate(client as never, {
    type: 'update',
    docId: 'doc-1',
    data: { updates: ['@@@@'] },
  });

  assert.equal(result.success, false);
  assert.equal(errorPayload?.type, 'update-error');
});

test('版本冲突时 emit conflict 且不写入', async () => {
  let conflictPayload: { docId?: string } | undefined;
  let saved = false;
  const gateway = new SyncGateway(
    {
      async findOne() {
        return { updateId: 9 };
      },
      create(value: object) {
        return value;
      },
      async save() {
        saved = true;
        return { updateId: 10 };
      },
    } as never,
    {} as never,
    {
      async assertDocumentActive() {},
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const client = {
    id: 'socket-conflict',
    data: { userId: 'user-1' },
    rooms: new Set(['socket-conflict']),
    emit(event: string, payload: object) {
      if (event === 'conflict') conflictPayload = payload as { docId?: string };
    },
    to() {
      return { emit() {} };
    },
  };
  const update = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64');

  const result = await gateway.handleUpdate(client as never, {
    type: 'update',
    docId: 'doc-1',
    data: { updates: [update], baseUpdateId: 3 },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'conflict');
  assert.equal(conflictPayload?.docId, 'doc-1');
  assert.equal(saved, false);
});
