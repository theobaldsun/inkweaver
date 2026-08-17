import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSource } from 'typeorm';
import * as Y from 'yjs';

import { DocSnapshot } from './entity/doc-snapshot.entity';
import { SnapshotService } from './snapshot.service';
import { SyncUpdate } from './entity/sync-update.entity';
import { SyncController } from './sync.controller';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === '1';
const dataSource = new DataSource({
  type: 'postgres',
  host: '127.0.0.1',
  port: 5433,
  username: 'inkweaver_test',
  password: 'inkweaver_test',
  database: 'syncbox_test',
  entities: [SyncUpdate, DocSnapshot],
  synchronize: true,
});

function yjsUpdate(content: string): string {
  const document = new Y.Doc();
  document.getText('content').insert(0, content);
  return Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64');
}

test('REST push 后以快照恢复，并从快照游标继续拉取增量', { skip: !shouldRun }, async () => {
  await dataSource.initialize();
  const syncUpdates = dataSource.getRepository(SyncUpdate);
  const snapshots = dataSource.getRepository(DocSnapshot);
  // 使用真实 SnapshotService，覆盖 pull 路径的 generateSnapshot
  const snapshotService = new SnapshotService(syncUpdates, snapshots);
  const controller = new SyncController(
    syncUpdates,
    snapshots,
    { scheduleRecalculateByDocId() {} } as never,
    { async assertDocumentActive() {} } as never,
    { scheduleProjection() {} } as never,
    snapshotService,
    { broadcastDocUpdates() {} } as never,
    dataSource,
  );
  const request = { user: { sub: 'integration-user' } } as never;
  const docId = 'integration-sync-document';

  try {
    await snapshots.clear();
    await syncUpdates.clear();

    const firstPush = await controller.push(
      { docId, updates: [yjsUpdate('first')], clientId: 'integration-client' },
      request,
    );
    const snapshotPull = await controller.pull({ docId, cursor: 0, limit: 100 }, request);

    assert.equal(firstPush.success, true);
    assert.equal(snapshotPull.snapshotVersion, firstPush.latestUpdateId);
    assert.equal(snapshotPull.nextCursor, firstPush.latestUpdateId);
    assert.ok(snapshotPull.snapshot);
    assert.deepEqual(snapshotPull.updates, []);

    const secondPush = await controller.push(
      { docId, updates: [yjsUpdate('second')], clientId: 'integration-client' },
      request,
    );
    const incrementalPull = await controller.pull(
      { docId, cursor: snapshotPull.nextCursor, limit: 100 },
      request,
    );

    assert.equal(secondPush.success, true);
    assert.equal(incrementalPull.snapshot, undefined);
    assert.equal(incrementalPull.updates.length, 1);
    assert.equal(incrementalPull.nextCursor, secondPush.latestUpdateId);
  } finally {
    await snapshots.clear();
    await syncUpdates.clear();
    await dataSource.destroy();
  }
});
