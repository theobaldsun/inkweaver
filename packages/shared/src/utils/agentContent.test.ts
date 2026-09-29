import assert from "node:assert/strict";
import test from "node:test";

import { parseAgentContentBlock } from "./agentContent";

const enabledTypes = ["text", "image", "audio", "file"] as const;
const asset = { assetId: "asset-1", mimeType: "image/png", sizeBytes: 128, status: "ready" };
const parse = (input: unknown) => parseAgentContentBlock(input, { enabledTypes });

test("默认仅开放文本，空允许列表关闭全部类型", () => {
  assert.deepEqual(parseAgentContentBlock({ type: "text", text: "你好" }), { ok: true, value: { type: "text", text: "你好" } });
  for (const type of ["image", "audio", "file"]) {
    assert.deepEqual(parseAgentContentBlock({ type, asset }), { ok: false, code: "TYPE_DISABLED" });
  }
  assert.deepEqual(parseAgentContentBlock({ type: "text", text: "" }, { enabledTypes: [] }), { ok: false, code: "TYPE_DISABLED" });
});

test("显式开放媒体后解析三种引用，并返回深度独立的资源副本", () => {
  for (const [type, mimeType] of [["image", "image/png"], ["audio", "audio/wav"], ["file", "application/pdf"]]) {
    const input = { type, asset: { ...asset, mimeType } };
    const result = parse(input);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("解析失败");
    assert.deepEqual(result.value, input);
    assert.notEqual(result.value, input);
    assert.notEqual(result.value.asset, input.asset);
    input.asset.assetId = "changed";
    assert.equal(result.value.asset?.assetId, "asset-1");
  }
});

test("拒绝非对象、未知类型、缺失字段和混合载荷", () => {
  for (const input of [null, undefined, [], "text", 1, new Date(), {}, { type: "text" }, { type: "image" }, { type: "text", text: "x", asset }, { type: "image", asset, text: undefined }]) {
    assert.equal(parse(input).ok, false);
  }
  assert.deepEqual(parse({ type: "video", asset }), { ok: false, code: "UNSUPPORTED_TYPE" });
  assert.deepEqual(parse({ type: "text", text: 123 }), { ok: false, code: "INVALID_TEXT" });
});

test("未知或敏感字段不会被静默删除或回显", () => {
  for (const key of ["url", "path", "credentials", "token", "extra"]) {
    assert.deepEqual(parse({ type: "file", asset: { ...asset, [key]: "private-value" } }), { ok: false, code: "INVALID_ASSET" });
    assert.deepEqual(parse({ type: "text", text: "x", [key]: "private-value" }), { ok: false, code: "INVALID_BLOCK" });
  }
  assert.equal(parse(JSON.parse('{"type":"text","text":"x","__proto__":{}}')).ok, false);
});

test("资源字段完整，大小为非负安全整数且不做类型转换", () => {
  for (const sizeBytes of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "128"]) {
    assert.deepEqual(parse({ type: "file", asset: { ...asset, sizeBytes } }), { ok: false, code: "INVALID_ASSET" });
  }
  for (const sizeBytes of [0, Number.MAX_SAFE_INTEGER]) assert.equal(parse({ type: "file", asset: { ...asset, sizeBytes } }).ok, true);
  for (const key of Object.keys(asset)) {
    const incomplete: Record<string, unknown> = { ...asset };
    delete incomplete[key];
    assert.equal(parse({ type: "file", asset: incomplete }).ok, false);
  }
});

test("资源标识不能使用路径、地址、空白或超长字符串", () => {
  for (const assetId of ["", " ", "../file", "C:\\private", "https://example.com", "a".repeat(129)]) {
    assert.equal(parse({ type: "file", asset: { ...asset, assetId } }).ok, false);
  }
  assert.equal(parse({ type: "file", asset: { ...asset, assetId: "550e8400-e29b-41d4-a716-446655440000" } }).ok, true);
});

test("MIME 必须规范且匹配媒体块；通用文件支持具体 MIME", () => {
  for (const mimeType of ["", "image/", "image/*", "IMAGE/PNG", "image/png; charset=utf-8", "image/png\n", "audio/wav"]) {
    assert.equal(parse({ type: "image", asset: { ...asset, mimeType } }).ok, false);
  }
  assert.equal(parse({ type: "audio", asset }).ok, false);
  assert.equal(parse({ type: "file", asset: { ...asset, mimeType: "application/vnd.api+json" } }).ok, true);
});

test("接受四种资源状态，但不接受上传状态代替处理状态", () => {
  for (const status of ["pending", "processing", "ready", "failed"]) assert.equal(parse({ type: "file", asset: { ...asset, status } }).ok, true);
  assert.equal(parse({ type: "file", asset: { ...asset, status: "uploaded" } }).ok, false);
});

test("拒绝继承字段、访问器和符号字段，不触发 getter", () => {
  assert.equal(parse(Object.create({ type: "text", text: "x" })).ok, false);
  const input = { get type() { throw new Error("不得执行"); }, text: "x" };
  assert.deepEqual(parse(input), { ok: false, code: "INVALID_BLOCK" });
  const accessorAsset = { ...asset, get sizeBytes() { throw new Error("不得执行"); } };
  assert.deepEqual(parse({ type: "file", asset: accessorAsset }), { ok: false, code: "INVALID_ASSET" });
  assert.equal(parse({ type: "text", text: "x", [Symbol("secret")]: "x" }).ok, false);
});
