import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushThrottle } from './pushThrottle';

test('节流窗口内的每次调用都会在窗口结束时执行', async () => {
  const calls: string[] = [];
  const throttled = createPushThrottle((value: string) => calls.push(value), 5);

  throttled('doc-a');
  throttled('doc-b');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(calls, ['doc-a', 'doc-b']);
});

