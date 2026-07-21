/**
 * StorageAssetService 单测。
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConfigService } from '@nestjs/config';

import { ObjectStorageService } from './object-storage.service';
import { StorageAssetService } from './storage-asset.service';

async function withTemporaryWorkingDirectory(run: () => Promise<void>): Promise<void> {
  const originalCwd = process.cwd();
  const temporaryCwd = await mkdtemp(join(tmpdir(), 'syncbox-storage-'));
  process.chdir(temporaryCwd);
  try {
    await run();
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryCwd, { recursive: true, force: true });
  }
}

function createLocalObjectStorage(): ObjectStorageService {
  return new ObjectStorageService({
    get(key: string, defaultValue?: string) {
      if (key === 'MINIO_ENDPOINT') return undefined;
      return defaultValue;
    },
  } as ConfigService);
}

test('拒绝 MIME 声称为图片但内容不是图片的上传', async () => {
  const service = new StorageAssetService(
    { scheduleRecalculate() {} } as never,
    createLocalObjectStorage(),
  );

  await assert.rejects(
    () => service.saveUserAsset('user-1', {
      buffer: Buffer.from('not an image'),
      mimetype: 'image/png',
      size: 12,
    }),
    { message: '上传内容与图片类型不匹配' },
  );
});

test('拒绝只有 RIFF 前缀但缺少 WEBP 标识的伪造图片', async () => {
  await withTemporaryWorkingDirectory(async () => {
    const service = new StorageAssetService(
      { scheduleRecalculate() {} } as never,
      createLocalObjectStorage(),
    );
    const fakeWebp = Buffer.alloc(12);
    fakeWebp.write('RIFF', 0, 'ascii');
    fakeWebp.write('NOPE', 8, 'ascii');

    await assert.rejects(
      () => service.saveUserAsset('user-1', {
        buffer: fakeWebp,
        mimetype: 'image/webp',
        size: fakeWebp.length,
      }),
      { message: '上传内容与图片类型不匹配' },
    );
  });
});

test('以实际缓冲区长度执行 5MB 上限校验', async () => {
  await withTemporaryWorkingDirectory(async () => {
    const service = new StorageAssetService(
      { scheduleRecalculate() {} } as never,
      createLocalObjectStorage(),
    );
    const oversizedPng = Buffer.alloc(5 * 1024 * 1024 + 1);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPng);

    await assert.rejects(
      () => service.saveUserAsset('user-1', {
        buffer: oversizedPng,
        mimetype: 'image/png',
        size: 8,
      }),
      { message: '图片不能超过 5MB' },
    );
  });
});

test('拒绝空缓冲区上传', async () => {
  const service = new StorageAssetService(
    { scheduleRecalculate() {} } as never,
    createLocalObjectStorage(),
  );

  await assert.rejects(
    () => service.saveUserAsset('user-1', {
      buffer: Buffer.alloc(0),
      mimetype: 'image/png',
      size: 0,
    }),
    { message: '上传内容不能为空' },
  );
});

test('接受合法 PNG 并返回 uploads URL', async () => {
  await withTemporaryWorkingDirectory(async () => {
    const service = new StorageAssetService(
      { scheduleRecalculate() {} } as never,
      createLocalObjectStorage(),
    );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

    const result = await service.saveUserAsset('user-1', {
      buffer: png,
      mimetype: 'image/png',
      size: png.length,
    });

    assert.match(result.url, /^\/uploads\/assets\/user-1\/.+\.png$/);
  });
});
