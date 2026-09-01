/**
 * SearchPage 源码行为契约测试。
 *
 * Web 当前未配置 DOM 测试运行时，因此沿用现有 accessibility.test.ts 的源码契约方式，
 * 保护 URL 单一请求入口、竞态失效、总数/分页和摘要净化等关键实现。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

async function searchPageSource(): Promise<string> {
  return readFile(path.join(projectRoot, "apps/web/src/pages/SearchPage.tsx"), "utf8");
}

function handler(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = [\\s\\S]*?\\n  };`));
  assert.ok(match, `未找到 ${name}`);
  return match[0];
}

test("输入、模式和分页只更新状态或 URL，不直接重复请求", async () => {
  const source = await searchPageSource();
  const input = handler(source, "handleInputChange");
  const mode = handler(source, "handleModeChange");
  const page = handler(source, "handlePageChange");

  assert.match(input, /setQuery\(value\)/);
  assert.doesNotMatch(input, /setSearchParams|handleSearch/);
  assert.match(mode, /setSearchParams\(next\)/);
  assert.doesNotMatch(mode, /handleSearch\(/);
  assert.match(page, /setSearchParams\(next\)/);
  assert.doesNotMatch(page, /handleSearch\(/);
  assert.match(source, /URL 变化 → 同步 state \+ 触发搜索[\s\S]*void handleSearch\(q, m, p\)/);
});

test("提交保留模式，清空会让在飞请求失效", async () => {
  const source = await searchPageSource();
  const submit = handler(source, "handleSearchSubmit");
  const clear = handler(source, "handleClear");

  assert.match(submit, /if \(!next\.get\('mode'\)\) next\.set\('mode', 'smart'\)/);
  assert.match(submit, /next\.set\('page', '1'\)/);
  assert.match(clear, /searchRequestIdRef\.current\+\+/);
  assert.match(clear, /setSearchParams\(\{\}\)/);
});

test("结果使用后端 total、保留最后一页返回能力并净化摘要", async () => {
  const source = await searchPageSource();

  assert.match(source, /找到 \{total\} 个结果/);
  assert.match(source, /\{results\.length > 0 && \([\s\S]*search-pagination/);
  assert.match(source, /disabled=\{page <= 1\}/);
  assert.match(source, /disabled=\{!hasMore\}/);
  assert.match(source, /sanitizeDocumentHtml\(result\.excerpt\)/);
});
