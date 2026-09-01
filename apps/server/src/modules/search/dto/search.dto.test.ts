/**
 * 混合搜索查询参数 DTO 单测。
 *
 * 覆盖输入 trim、默认值、枚举/分页边界，以及预留 folderId 的 UUID 校验。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SearchHybridDto } from "./search.dto";

function validate(input: Record<string, unknown>) {
  const dto = plainToInstance(SearchHybridDto, input);
  const errors = validateSync(dto);
  return { dto, fields: errors.map((error) => error.property) };
}

test("SearchHybridDto trim 查询词并应用默认模式和分页", () => {
  const { dto, fields } = validate({ q: "  同步机制  " });

  assert.deepEqual(fields, []);
  assert.equal(dto.q, "同步机制");
  assert.equal(dto.mode, "smart");
  assert.equal(dto.page, 1);
  assert.equal(dto.pageSize, 10);
});

test("SearchHybridDto 拒绝空白查询和超长查询", () => {
  assert.deepEqual(validate({ q: "   " }).fields, ["q"]);
  assert.deepEqual(validate({ q: "x".repeat(201) }).fields, ["q"]);
});

test("SearchHybridDto 拒绝非法模式和分页参数", () => {
  assert.deepEqual(validate({ q: "x", mode: "invalid" }).fields, ["mode"]);
  assert.deepEqual(validate({ q: "x", page: "NaN" }).fields, ["page"]);
  assert.deepEqual(validate({ q: "x", page: 0 }).fields, ["page"]);
  assert.deepEqual(validate({ q: "x", pageSize: 101 }).fields, ["pageSize"]);
});

test("SearchHybridDto 保留可选 folderId 并校验 UUID v4", () => {
  const folderId = "550e8400-e29b-41d4-a716-446655440000";
  const valid = validate({ q: "x", folderId });

  assert.deepEqual(valid.fields, []);
  assert.equal(valid.dto.folderId, folderId);
  assert.deepEqual(validate({ q: "x", folderId: "not-a-uuid" }).fields, ["folderId"]);
});
