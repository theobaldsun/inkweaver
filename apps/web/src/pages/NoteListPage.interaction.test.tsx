/** NoteListPage 真实 DOM 交互回归测试。 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { JSDOM } from 'jsdom';
import React from 'react';

import type { Document } from '@inkweaver/shared';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/notes',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const userEvent = (await import('@testing-library/user-event')).default;
const { MemoryRouter } = await import('react-router-dom');
const { documentService, folderApi } = await import('../services/apiClient');
const { FolderProvider } = await import('../contexts/FolderContext');
const { default: NoteListPage } = await import('./NoteListPage');

afterEach(() => cleanup());

function note(id: string, title: string, folderId: string | null = null): Document {
  return {
    id,
    title,
    content: `${title} content`,
    userId: 'user-1',
    folderId,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/notes']}>
      <FolderProvider>
        <NoteListPage />
      </FolderProvider>
    </MemoryRouter>,
  );
}

test('旧列表响应不会覆盖用户最新选择的筛选结果', async () => {
  const recentRequest = deferred<{ documents: Document[]; total: number; page: number; pageSize: number }>();
  const mineRequest = deferred<{ documents: Document[]; total: number; page: number; pageSize: number }>();
  let calls = 0;
  folderApi.getFolderTree = async () => [];
  documentService.getDocuments = (async () => {
    calls += 1;
    if (calls === 1) {
      return { documents: [note('initial', '初始结果')], total: 1, page: 1, pageSize: 20 };
    }
    return calls === 2 ? recentRequest.promise : mineRequest.promise;
  }) as typeof documentService.getDocuments;

  renderPage();
  assert.ok(await screen.findByText('初始结果'));
  await userEvent.setup().click(screen.getByRole('button', { name: '最近编辑' }));
  await waitFor(() => assert.equal(calls, 2));
  await userEvent.setup().click(screen.getByRole('button', { name: '我创建的' }));
  await waitFor(() => assert.equal(calls, 3));

  mineRequest.resolve({ documents: [note('mine', '最新结果')], total: 1, page: 1, pageSize: 20 });
  assert.ok(await screen.findByText('最新结果'));
  recentRequest.resolve({ documents: [note('stale', '过期结果')], total: 1, page: 1, pageSize: 20 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(screen.queryByText('过期结果'), null);
  assert.ok(screen.getByText('最新结果'));
});

test('从移动弹窗选择根目录时提交显式 null', async () => {
  const source = note('doc-1', '待移动文档', '33333333-3333-4333-8333-333333333333');
  folderApi.getFolderTree = async () => [{
    id: '33333333-3333-4333-8333-333333333333',
    name: '目录 A',
    userId: 'user-1',
    parentId: undefined,
    documentCount: 1,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }];
  documentService.getDocuments = (async () => ({
    documents: [source],
    total: 1,
    page: 1,
    pageSize: 20,
  })) as typeof documentService.getDocuments;
  let submittedFolderId: string | null | undefined;
  documentService.updateDocument = (async (_id, data) => {
    submittedFolderId = data.folderId;
    return { ...source, ...data };
  }) as typeof documentService.updateDocument;

  renderPage();
  assert.ok(await screen.findByText('待移动文档'));
  await userEvent.setup().click(screen.getByTitle('归档到文件夹'));
  const select = await screen.findByRole('combobox');
  await userEvent.setup().selectOptions(select, '');
  await userEvent.setup().click(screen.getByRole('button', { name: '确认' }));

  await waitFor(() => assert.equal(submittedFolderId, null));
});
