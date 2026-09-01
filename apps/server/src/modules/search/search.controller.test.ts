/**
 * SearchController 转发契约单测。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SearchHybridDto } from "./dto/search.dto";
import { SearchController } from "./search.controller";

test("hybridSearch 转发用户、查询、分页和模式，folderId 保持预留不参与当前调用", async () => {
  let received: unknown[] = [];
  const searchService = {
    async hybridSearch(...args: unknown[]) {
      received = args;
      return { documents: [], total: 0, page: 2, pageSize: 20, hasMore: false, truncated: false };
    },
  };
  const controller = new SearchController(searchService as never);
  const query = Object.assign(new SearchHybridDto(), {
    q: "同步机制",
    mode: "keyword" as const,
    page: 2,
    pageSize: 20,
    folderId: "550e8400-e29b-41d4-a716-446655440000",
  });

  const result = await controller.hybridSearch({ user: { sub: "user-1" } } as never, query);

  assert.deepEqual(received, ["user-1", "同步机制", 2, 20, "keyword"]);
  assert.equal(result.total, 0);
});
