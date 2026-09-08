/** Web 认证存储策略测试。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { webStorageAdapter } from './storage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('记住登录在 localStorage 与 sessionStorage 间迁移令牌', async () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });

  await webStorageAdapter.setItem('syncbox_auth_tokens', 'token');
  assert.equal(session.getItem('syncbox_auth_tokens'), 'token');

  await webStorageAdapter.setPersistence?.(true);
  assert.equal(local.getItem('syncbox_remember_me'), 'true');
  assert.equal(local.getItem('syncbox_auth_tokens'), 'token');
  assert.equal(session.getItem('syncbox_auth_tokens'), null);

  await webStorageAdapter.setPersistence?.(false);
  assert.equal(local.getItem('syncbox_remember_me'), null);
  assert.equal(local.getItem('syncbox_auth_tokens'), null);
  assert.equal(session.getItem('syncbox_auth_tokens'), 'token');

  await webStorageAdapter.removeItem('syncbox_auth_tokens');
  assert.equal(await webStorageAdapter.getItem('syncbox_auth_tokens'), null);
});

test('升级前 localStorage 令牌按持久会话兼容', async () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  local.setItem('syncbox_auth_tokens', 'legacy');
  Object.assign(globalThis, { localStorage: local, sessionStorage: session });

  assert.equal(await webStorageAdapter.getItem('syncbox_auth_tokens'), 'legacy');
  assert.equal(local.getItem('syncbox_remember_me'), 'true');
});
