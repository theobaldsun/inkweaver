import assert from 'node:assert/strict';
import test from 'node:test';

import { SnapshotService } from './snapshot.service';

test('快照阈值只统计快照版本之后的更新', async () => {
  const syncUpdateRepository = {
    async count(options: { where: { updateId: unknown } }) {
      return typeof options.where.updateId === 'number' ? 0 : 1;
    },
  };
  const docSnapshotRepository = {
    async findOne() {
      return {
        docId: 'doc-1',
        version: 10,
        updatedAt: new Date(),
      };
    },
  };
  const service = new SnapshotService(syncUpdateRepository as never, docSnapshotRepository as never);

  assert.equal(await service.shouldGenerateSnapshot('doc-1', { maxUpdates: 1 }), true);
});

test('存在损坏更新时不生成覆盖该版本的快照', async () => {
  let upserted = false;
  const syncUpdateRepository = {
    async find() {
      return [{ docId: 'doc-1', updateId: 11, update: Buffer.from([1, 2, 3]).toString('base64') }];
    },
  };
  const docSnapshotRepository = {
    async upsert() {
      upserted = true;
    },
    async findOne() {
      return null;
    },
  };
  const service = new SnapshotService(syncUpdateRepository as never, docSnapshotRepository as never);

  assert.equal(await service.generateSnapshot('doc-1'), null);
  assert.equal(upserted, false);
});
