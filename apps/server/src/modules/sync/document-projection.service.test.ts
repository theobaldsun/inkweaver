import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { DocumentProjectionService } from './document-projection.service';

test('投影从快照恢复并只读取快照后的更新', async () => {
  const yDoc = new Y.Doc();
  yDoc.getText('content').insert(0, 'snapshot content');
  yDoc.getMap('metadata').set('title', 'Snapshot title');
  const syncUpdateRepository = {
    async find(options: { where: { updateId?: unknown } }) {
      assert.notEqual(typeof options.where.updateId, 'number');
      return [];
    },
  };
  const docSnapshotRepository = {
    async findOne() {
      return {
        version: 10,
        snapshot: Buffer.from(Y.encodeStateAsUpdate(yDoc)).toString('base64'),
      };
    },
  };
  let projected: { title: string; content: string } | null = null;
  const documentsService = {
    async projectSearchableContent(_docId: string, title: string, content: string) {
      projected = { title, content };
    },
  };
  const ProjectionService = DocumentProjectionService as unknown as new (...args: unknown[]) => DocumentProjectionService;
  const service = new ProjectionService(syncUpdateRepository, docSnapshotRepository, documentsService);

  await service.projectDocument('doc-1');

  assert.deepEqual(projected, { title: 'Snapshot title', content: 'snapshot content' });
});

test('存在损坏更新时不写入部分投影', async () => {
  const syncUpdateRepository = {
    async find() {
      return [{ updateId: 1, update: Buffer.from([1, 2, 3]).toString('base64') }];
    },
  };
  const docSnapshotRepository = {
    async findOne() {
      return null;
    },
  };
  let projected = false;
  const documentsService = {
    async projectSearchableContent() {
      projected = true;
    },
  };
  const ProjectionService = DocumentProjectionService as unknown as new (...args: unknown[]) => DocumentProjectionService;
  const service = new ProjectionService(syncUpdateRepository, docSnapshotRepository, documentsService);

  await service.projectDocument('doc-1');

  assert.equal(projected, false);
});
