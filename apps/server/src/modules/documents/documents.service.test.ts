/**
 * DocumentsService 单测。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { InternalServerErrorException } from '@nestjs/common';

import { DocumentsService } from './documents.service';

test('初始快照版本与持久化后的 updateId 保持一致', async () => {
  let snapshotVersion: number | undefined;
  const documentsRepository = {
    create(value: object) {
      return { id: 'doc-1', ...value };
    },
    async save(value: object) {
      return value;
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
    { async scheduleReindex() {}, async deleteByDocId() {} } as never,
    { evictFromDocRoom() {} } as never,
  );

  await service.createDocument('user-1', { title: '标题', content: '正文' });

  assert.equal(snapshotVersion, 42);
});

test('初始快照失败时删除文档并抛出 500', async () => {
  let deletedId: string | undefined;
  const documentsRepository = {
    create(value: object) {
      return { id: 'doc-orphan', ...value };
    },
    async save(value: object) {
      return value;
    },
    async delete(id: string) {
      deletedId = id;
    },
  };
  const syncUpdateRepository = {
    async save() {
      throw new Error('db unavailable');
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
  );

  await assert.rejects(
    () => service.createDocument('user-1', { title: '标题', content: '正文' }),
    (error: unknown) => error instanceof InternalServerErrorException,
  );
  assert.equal(deletedId, 'doc-orphan');
});
