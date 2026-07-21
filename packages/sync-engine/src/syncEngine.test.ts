import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { createSyncEngine, SYNC_REPLAY_ORIGIN } from './syncEngine';

import type { LocalDB } from '@inkweaver/db-adapter';
import type { Document, SyncUpdate } from '@inkweaver/shared';


test('首次同步会确认并清除本地 pending 更新', async () => {
  const docId = 'doc-first-sync';
  const sourceDoc = new Y.Doc();
  sourceDoc.getText('content').insert(0, 'offline change');
  const pending: SyncUpdate[] = [
    {
      id: 1,
      docId,
      update: Y.encodeStateAsUpdate(sourceDoc),
      clientId: 'client-a',
      timestamp: Date.now(),
      pending: true,
    },
  ];
  let persistedDoc: Document | null = null;
  const pushed: Uint8Array[][] = [];

  const localDB: LocalDB = {
    async saveDoc(doc) {
      persistedDoc = doc;
    },
    async getDoc() {
      if (!persistedDoc) throw new Error('document not found');
      return persistedDoc;
    },
    async saveUpdate() {},
    async getUpdatesSince() {
      return [];
    },
    async getPendingUpdates() {
      return pending;
    },
    async clearPending() {
      pending.length = 0;
    },
    async getPendingUpdatesBatch() {
      return pending;
    },
    async clearPendingBatch(_docId, ids) {
      for (const id of ids) {
        const index = pending.findIndex((update) => update.id === id);
        if (index >= 0) pending.splice(index, 1);
      }
    },
  };

  const engine = createSyncEngine({
    localDB,
    clientId: 'client-a',
    api: {
      async pull() {
        return { updates: [], nextCursor: 0, hasMore: false };
      },
      async push(_docId, updates) {
        pushed.push(updates);
        return { latestUpdateId: 1 };
      },
    },
  });

  const result = await engine.syncDoc(docId);

  assert.equal(result.pushed, 1);
  assert.equal(pushed.length, 1);
  assert.equal(pending.length, 0);
  const savedDoc = await localDB.getDoc(docId);
  assert.equal(savedDoc.lastUpdateId, 1);
  assert.ok(savedDoc.yjsSnapshot);

  const restored = new Y.Doc();
  Y.applyUpdate(restored, savedDoc.yjsSnapshot);
  assert.equal(restored.getText('content').toString(), 'offline change');
});

test('服务端拉取更新使用远端 origin，避免被客户端重新排队', async () => {
  const docId = 'doc-remote-origin';
  const remoteDoc = new Y.Doc();
  remoteDoc.getText('content').insert(0, 'remote change');
  const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);
  let persistedDoc: Document | null = null;

  const localDB: LocalDB = {
    async saveDoc(doc) {
      persistedDoc = doc;
    },
    async getDoc() {
      if (!persistedDoc) throw new Error('document not found');
      return persistedDoc;
    },
    async saveUpdate() {},
    async getUpdatesSince() {
      return [];
    },
    async getPendingUpdates() {
      return [];
    },
    async clearPending() {},
    async getPendingUpdatesBatch() {
      return [];
    },
    async clearPendingBatch() {},
  };

  const engine = createSyncEngine({
    localDB,
    clientId: 'client-a',
    api: {
      async pull() {
        return { updates: [remoteUpdate], nextCursor: 7, hasMore: false };
      },
      async push() {
        return {};
      },
    },
  });
  const origins: unknown[] = [];
  engine.getYDoc(docId).on('update', (_update, origin) => origins.push(origin));

  await engine.syncDoc(docId);

  assert.ok(origins.length > 0);
  assert.ok(origins.every((origin) => origin === SYNC_REPLAY_ORIGIN));
});

test('clearYDocCache 会 destroy 缓存中的 Y.Doc', () => {
  const docId = 'doc-destroy-cache';
  const localDB = {
    async saveDoc() {},
    async getDoc() {
      throw new Error('unused');
    },
    async saveUpdate() {},
    async getUpdatesSince() {
      return [];
    },
    async getPendingUpdates() {
      return [];
    },
    async clearPending() {},
    async getPendingUpdatesBatch() {
      return [];
    },
    async clearPendingBatch() {},
  } as unknown as LocalDB;

  const engine = createSyncEngine({
    localDB,
    clientId: 'client-destroy',
    api: {
      async pull() {
        return { updates: [], nextCursor: 0, hasMore: false };
      },
      async push() {
        return {};
      },
    },
  });

  const doc = engine.getYDoc(docId);
  let destroyed = false;
  const originalDestroy = doc.destroy.bind(doc);
  doc.destroy = () => {
    destroyed = true;
    originalDestroy();
  };

  engine.clearYDocCache(docId);
  assert.equal(destroyed, true);
});
