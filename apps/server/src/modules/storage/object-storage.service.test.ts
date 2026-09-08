/**
 * ObjectStorageService 单测（本地模式）。
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConfigService } from '@nestjs/config';

import { ObjectStorageService, toObjectKey } from './object-storage.service';

test('toObjectKey 规范化 uploads 路径并拒绝 ..', () => {
  assert.equal(toObjectKey('/uploads/assets/a.png'), 'assets/a.png');
  assert.equal(toObjectKey('assets/a.png'), 'assets/a.png');
  assert.equal(toObjectKey('../etc/passwd'), null);
});

test('本地模式 put/get 往返', async () => {
  const originalCwd = process.cwd();
  const temporaryCwd = await mkdtemp(join(tmpdir(), 'syncbox-object-'));
  process.chdir(temporaryCwd);
  try {
    const storage = new ObjectStorageService({
      get(key: string, defaultValue?: string) {
        if (key === 'MINIO_ENDPOINT') return undefined;
        return defaultValue;
      },
    } as ConfigService);

    const body = Buffer.from([1, 2, 3, 4]);
    await storage.putObject({
      key: 'assets/u1/test.bin',
      body,
      contentType: 'application/octet-stream',
    });

    const loaded = await storage.getObject('assets/u1/test.bin');
    assert.ok(loaded);
    assert.deepEqual(loaded.body, body);

    await storage.deleteObject('assets/u1/test.bin');
    await storage.deleteObject('assets/u1/test.bin');
    assert.equal(await storage.getObject('assets/u1/test.bin'), null);

    await storage.putObject({
      key: 'assets/u1/nested/one.bin',
      body,
      contentType: 'application/octet-stream',
    });
    await storage.deletePrefix('assets/u1');
    await storage.deletePrefix('assets/u1');
    assert.equal(await storage.getObject('assets/u1/nested/one.bin'), null);
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryCwd, { recursive: true, force: true });
  }
});

test('deletePrefix 拒绝根级范围', async () => {
  const storage = new ObjectStorageService({
    get(_key: string, defaultValue?: string) {
      return defaultValue;
    },
  } as ConfigService);
  await assert.rejects(() => storage.deletePrefix('assets'), /范围过大/);
});
