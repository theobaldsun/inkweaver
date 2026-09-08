/** SearchPage 真实 DOM 交互回归测试。 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import React from "react";

import type { HybridSearchHit, HybridSearchResult, SearchMode } from "@inkweaver/api";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/search",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  DOMParser: dom.window.DOMParser,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

const { cleanup, render, screen } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { MemoryRouter } = await import("react-router-dom");
const { searchApi } = await import("../services/apiClient");
const { SearchPage } = await import("./SearchPage");

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function hit(id: string, title: string, excerpt = "安全摘要"): HybridSearchHit {
  return {
    id,
    title,
    excerpt,
    score: 100,
    matchedBy: ["exact"],
    updatedAt: "2026-09-01T00:00:00.000Z",
    tags: [],
    recentlyOpen: false,
  };
}

function response(
  documents: HybridSearchHit[],
  page: number,
  options: { total?: number; hasMore?: boolean; truncated?: boolean } = {},
): HybridSearchResult {
  return {
    documents,
    total: options.total ?? documents.length,
    page,
    pageSize: 20,
    hasMore: options.hasMore ?? false,
    truncated: options.truncated ?? false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderPage(initialEntry = "/search"): void {
  searchApi.getSearchHistory = async () => ({ history: [] });
  searchApi.addSearchHistory = async () => ({ message: "ok" });
  searchApi.deleteSearchHistory = async () => ({ message: "ok" });
  searchApi.clearSearchHistory = async () => ({ message: "ok" });
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SearchPage />
    </MemoryRouter>,
  );
}

test("深链只触发一次请求并按后端 total/hasMore 完成分页", async () => {
  const calls: Array<{ query: string; mode: SearchMode; page: number }> = [];
  searchApi.hybridSearch = async (query, mode, page) => {
    const resolvedMode = mode ?? "smart";
    const resolvedPage = page ?? 1;
    calls.push({ query, mode: resolvedMode, page: resolvedPage });
    return resolvedPage === 1
      ? response([hit("first", "Project Phoenix")], 1, { total: 21, hasMore: true })
      : response([hit("second", "Project Phoenix 第二页")], 2, { total: 21 });
  };

  renderPage("/search?q=Project%20Phoenix&mode=keyword&page=1");

  assert.ok(await screen.findByText("找到 21 个结果"));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { query: "Project Phoenix", mode: "keyword", page: 1 });
  const previous = screen.getByRole("button", { name: "上一页" });
  const next = screen.getByRole("button", { name: "下一页" });
  assert.equal(previous.hasAttribute("disabled"), true);
  assert.equal(next.hasAttribute("disabled"), false);

  await userEvent.setup().click(next);
  assert.ok(await screen.findByText(/第二页/));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { query: "Project Phoenix", mode: "keyword", page: 2 });
  assert.equal(screen.getByRole("button", { name: "上一页" }).hasAttribute("disabled"), false);
  assert.equal(screen.getByRole("button", { name: "下一页" }).hasAttribute("disabled"), true);
});

test("输入不逐键请求，提交保留已选模式并从第一页搜索", async () => {
  const calls: Array<{ query: string; mode: SearchMode; page: number }> = [];
  searchApi.hybridSearch = async (query, mode, page) => {
    const resolvedMode = mode ?? "smart";
    const resolvedPage = page ?? 1;
    calls.push({ query, mode: resolvedMode, page: resolvedPage });
    return response([hit("one", query)], resolvedPage);
  };

  renderPage("/search?mode=semantic&page=9");
  const input = screen.getByPlaceholderText("搜索笔记...");
  await userEvent.setup().type(input, "向量 搜索");
  assert.equal(calls.length, 0);
  await userEvent.setup().type(input, "{Enter}");

  assert.ok(await screen.findByText("找到 1 个结果"));
  assert.deepEqual(calls, [{ query: "向量 搜索", mode: "semantic", page: 1 }]);
});

test("新请求与清空操作都会阻止旧响应回填页面", async () => {
  const oldRequest = deferred<HybridSearchResult>();
  const newRequest = deferred<HybridSearchResult>();
  searchApi.hybridSearch = async (query) =>
    query === "旧查询" ? oldRequest.promise : newRequest.promise;

  renderPage("/search?q=%E6%97%A7%E6%9F%A5%E8%AF%A2");
  const input = await screen.findByDisplayValue("旧查询");
  await userEvent.setup().click(screen.getByRole("button", { name: "清空搜索" }));
  await userEvent.setup().type(input, "新查询{Enter}");
  newRequest.resolve(response([hit("new", "最新结果")], 1));
  assert.ok(await screen.findByText("最新结果"));
  oldRequest.resolve(response([hit("old", "过期结果")], 1));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(screen.queryByText("过期结果"), null);
  assert.ok(screen.getByText("最新结果"));
});

test("服务端摘要在写入 DOM 前移除脚本和事件属性", async () => {
  searchApi.hybridSearch = async () =>
    response(
      [
        hit(
          "safe",
          "净化测试",
          '<mark>命中</mark><img src=x onerror="alert(1)"><script>bad()</script>',
        ),
      ],
      1,
    );

  renderPage("/search?q=%E5%87%80%E5%8C%96%E6%B5%8B%E8%AF%95");
  assert.ok(await screen.findByText("命中"));
  assert.equal(document.querySelector(".result-content script"), null);
  assert.equal(document.querySelector(".result-content img")?.hasAttribute("onerror"), false);
});
