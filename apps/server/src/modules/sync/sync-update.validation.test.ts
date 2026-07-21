import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { assertValidSyncUpdates, MAX_SYNC_UPDATES_PER_REQUEST } from './sync-update.validation';

test('拒绝空更新和非 Base64 更新', () => {
  assert.throws(() => assertValidSyncUpdates([]));
  assert.throws(() => assertValidSyncUpdates(['not base64']));
});

test('拒绝超过单批上限的更新', () => {
  const validUpdate = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64');
  assert.throws(() => assertValidSyncUpdates(Array(MAX_SYNC_UPDATES_PER_REQUEST + 1).fill(validUpdate)));
});

test('接受大小受限的 Base64 更新', () => {
  const validUpdate = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64');
  assert.doesNotThrow(() => assertValidSyncUpdates([validUpdate]));
});

test('拒绝 Base64 合法但不是 Yjs update 的数据', () => {
  const invalidUpdate = Buffer.from([1, 2, 3]).toString('base64');
  assert.throws(() => assertValidSyncUpdates([invalidUpdate]));
});
