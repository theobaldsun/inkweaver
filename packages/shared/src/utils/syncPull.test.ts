import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSyncPullPage } from './syncPull';

test('仅返回快照时也推进客户端游标', () => {
  const result = resolveSyncPullPage(0, {
    updateCount: 0,
    nextCursor: 7,
    hasMore: false,
    latestUpdateId: 7,
  });

  assert.deepEqual(result, {
    nextCursor: 7,
    latestUpdateId: 7,
    shouldContinue: false,
  });
});

test('服务端游标未前进时终止分页，避免重复拉取', () => {
  const result = resolveSyncPullPage(7, {
    updateCount: 1,
    nextCursor: 7,
    hasMore: true,
    latestUpdateId: 8,
  });

  assert.equal(result.shouldContinue, false);
});

