/** API Client 配置与特殊请求回归测试。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { apiClient, configureApiClient } from './client';
import { storageApi } from './storage/storageApi';
import { userApi } from './users/userApi';

test('上传和导出复用配置后的共享 API Client', async () => {
  const originalPost = apiClient.post;
  const calls: Array<{ url: string; responseType?: string }> = [];
  apiClient.post = (async (url: string, _data?: unknown, config?: { responseType?: string }) => {
    calls.push({ url, responseType: config?.responseType });
    return url === '/users/export' ? new Blob(['{}']) : { url: '/uploads/test.png' };
  }) as typeof apiClient.post;

  try {
    configureApiClient({ baseURL: 'https://api.example.test/v1' });
    await storageApi.uploadAsset(new Blob(['image']) as File);
    await userApi.uploadAvatar(new Blob(['avatar']) as File);
    await userApi.exportData('password');

    assert.equal(apiClient.defaults.baseURL, 'https://api.example.test/v1');
    assert.deepEqual(calls.map((call) => call.url), [
      '/storage/upload',
      '/users/avatar',
      '/users/export',
    ]);
    assert.equal(calls[2]?.responseType, 'blob');
  } finally {
    apiClient.post = originalPost;
    configureApiClient({ baseURL: '/api' });
  }
});
