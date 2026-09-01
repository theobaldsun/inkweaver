import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../../../..');

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('header icon actions expose accessible names', async () => {
  const header = await source('apps/web/src/components/Header.tsx');

  assert.match(header, /aria-label="新建文档"/);
  assert.match(header, /aria-label="退出登录"/);
  assert.match(header, /aria-label="个人资料"/);
  assert.match(header, /aria-label="清空搜索"/);
});

test('confirmation modal exposes dialog semantics', async () => {
  const modal = await source('apps/web/src/components/CustomModal.tsx');

  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby=/);
  assert.match(modal, /aria-describedby=/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /autoFocus/);
  assert.match(modal, /btn-primary[\s\S]*autoFocus|autoFocus[\s\S]*确认/);
  assert.match(modal, /Tab/);
});

test('rich editor exposes named toolbar actions and title input', async () => {
  const editor = await source('packages/editor-web/src/components/InkWeaverEditor.tsx');

  assert.match(editor, /role="toolbar"/);
  assert.match(editor, /aria-label="编辑工具栏"/);
  assert.match(editor, /aria-label="加粗"/);
  assert.match(editor, /aria-label="插入链接"/);
  assert.match(editor, /aria-label="文档标题"/);
});

test('rich editor exposes names for every icon-only toolbar action', async () => {
  const editor = await source('packages/editor-web/src/components/InkWeaverEditor.tsx');

  const expectedLabels = [
    '展开目录',
    '折叠目录',
    '标题 1',
    '标题 2',
    '标题 3',
    '无序列表',
    '有序列表',
    '任务列表',
    '引用',
    '代码块',
    '分割线',
    '插入图片',
    '撤销',
    '重做',
    '打开目录',
    '展开 AI 助手',
    '折叠 AI 助手',
    '关闭插入链接对话框',
    '链接地址',
  ];

  for (const label of expectedLabels) {
    assert.match(editor, new RegExp(`aria-label="${label}"`));
  }
});

test('rich editor link modal exposes dialog semantics and Escape dismissal', async () => {
  const editor = await source('packages/editor-web/src/components/InkWeaverEditor.tsx');

  assert.match(editor, /role="dialog"/);
  assert.match(editor, /aria-modal="true"/);
  assert.match(editor, /aria-labelledby=/);
  assert.match(editor, /event\.key === 'Escape'/);
});

test('editor connection status subscribes to socket lifecycle updates', async () => {
  const syncClient = await source('packages/sync-client/src/syncService.ts');
  const webSyncService = await source('apps/web/src/services/syncService.ts');
  const page = await source('apps/web/src/pages/DocumentEditPage.tsx');

  assert.match(syncClient, /connectionListeners/);
  assert.match(syncClient, /const onConnectionChange/);
  assert.match(webSyncService, /onConnectionChange/);
  assert.match(page, /onConnectionChange/);
});

test('remote sync updates are tagged and never re-enqueued as local pending updates', async () => {
  const page = await source('apps/web/src/pages/DocumentEditPage.tsx');

  assert.match(page, /Y\.applyUpdate\(yDoc, update, SYNC_REPLAY_ORIGIN\)/);
  assert.match(page, /origin !== SYNC_REPLAY_ORIGIN/);
});

test('web sync pull uses the shared cursor advancement policy', async () => {
  const syncClient = await source('packages/sync-client/src/syncService.ts');

  assert.match(syncClient, /resolveSyncPullPage/);
});

test('throttled local persistence merges every Yjs update instead of dropping intermediate edits', async () => {
  const page = await source('apps/web/src/pages/DocumentEditPage.tsx');

  assert.match(page, /pendingUpdateBufferRef/);
  assert.match(page, /Y\.mergeUpdates\(pendingUpdates\)/);
});

test('document editor removes Yjs and socket listeners when switching documents', async () => {
  const page = await source('apps/web/src/pages/DocumentEditPage.tsx');

  assert.match(page, /const unsubscribeDocRoom = subscribeDocRoom\(id, handleRemoteUpdates\)/);
  assert.match(page, /unsubscribeDocRoom\(\)/);
  assert.match(page, /yDoc\.off\('update', handleUpdate\)/);
  assert.match(page, /yMap\.unobserve\(handleMapUpdate\)/);
});
