import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolAssemblyError, ToolCatalog } from './tool-catalog';
import { ToolRegistryError } from './tool-definition-validator';
import { ToolPolicy } from './tool-policy';
import { ToolSchemaCompileError } from './tool-schema-validator';

import type { ToolAdapter } from './tool-catalog';
import type { ToolDefinition } from './tool-definition';

function definition(): ToolDefinition {
  return {
    name: 'read_document', version: '1', description: '读取文档',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    outputSchema: { type: 'string' }, origin: { kind: 'builtin' },
    riskLevel: 'L0', requiredPermissions: ['documents:read'], requiresConfirmation: false,
    timeoutMs: 1000, maxOutputBytes: 4096, supportsCancellation: true, retryPolicy: 'safe',
  };
}
function adapter(tool = definition()): ToolAdapter {
  return { name: tool.name, version: tool.version, origin: tool.origin, async execute() { throw new Error('本单元不得调用工具'); } };
}

test('装配绑定定义和已编译校验器，重复解析复用函数且不执行工具', () => {
  const catalog = new ToolCatalog();
  catalog.register(definition(), adapter());
  const first = catalog.resolve('read_document', '1');
  const second = catalog.resolve('read_document', '1');
  assert.deepEqual(first.definition, definition());
  assert.equal(first.validateInput, second.validateInput);
  assert.equal(first.validateOutput, second.validateOutput);
  assert.equal(first.execute, second.execute);
  assert.deepEqual(first.validateInput({ id: 'doc-1' }), { ok: true });
  assert.equal(first.validateInput({ id: 123 }).ok, false);
  assert.equal(first.validateOutput('正文').ok, true);
  assert.equal(first.validateOutput({}).ok, false);
});

test('输入或输出 Schema 编译失败均不发布目录，可用修正定义重新注册', () => {
  const catalog = new ToolCatalog();
  for (const tool of [
    { ...definition(), inputSchema: { type: 'object' as const, unknownKeyword: true } },
    { ...definition(), outputSchema: { type: 'invalid' } },
  ]) {
    assert.throws(() => catalog.register(tool, adapter()), ToolSchemaCompileError);
    assert.equal(catalog.get(tool.name), undefined);
    assert.deepEqual(catalog.list(), []);
    assert.throws(() => catalog.resolve(tool.name, '1'), ToolAssemblyError);
  }
  catalog.register(definition(), adapter());
  assert.equal(catalog.list().length, 1);
});

test('结构错误及适配器名称、版本、来源不匹配均不发布', () => {
  const catalog = new ToolCatalog();
  assert.throws(() => catalog.register({ ...definition(), timeoutMs: 0 }, adapter()), ToolRegistryError);
  for (const binding of [
    { ...adapter(), name: 'other' }, { ...adapter(), version: '2' },
    { ...adapter(), origin: { kind: 'mcp' as const, connectionId: 'c1' } },
  ]) {
    assert.throws(() => catalog.register(definition(), binding), (e) => e instanceof ToolAssemblyError && e.code === 'ADAPTER_MISMATCH');
  }
  assert.deepEqual(catalog.list(), []);
});

test('MCP 连接 ID 必须匹配，内置和远端定义共用目录', () => {
  const catalog = new ToolCatalog();
  const remote = { ...definition(), name: 'remote_read', origin: { kind: 'mcp' as const, connectionId: 'c1' } };
  assert.throws(() => catalog.register(remote, { ...adapter(remote), origin: { kind: 'mcp', connectionId: 'c2' } }), ToolAssemblyError);
  catalog.register(remote, adapter(remote));
  catalog.register(definition(), adapter());
  assert.deepEqual(catalog.list().map((t) => t.name), ['read_document', 'remote_read']);
  assert.equal(catalog.get('unknown'), undefined);
});

test('重复注册不覆盖已绑定函数；版本不匹配不能解析', () => {
  const catalog = new ToolCatalog();
  catalog.register(definition(), adapter());
  const original = catalog.resolve('read_document', '1');
  const next = { ...definition(), version: '2' };
  for (const tool of [definition(), next]) {
    assert.throws(() => catalog.register(tool, adapter(tool)), (e) => e instanceof ToolRegistryError && e.code === 'DUPLICATE_TOOL');
  }
  assert.equal(catalog.get('read_document')?.version, '1');
  assert.equal(catalog.resolve('read_document', '1').execute, original.execute);
  assert.throws(() => catalog.resolve('read_document', '2'), (e) => e instanceof ToolAssemblyError && e.code === 'VERSION_MISMATCH');
});

test('外部修改定义、返回副本或适配器函数不改变装配快照', () => {
  const catalog = new ToolCatalog();
  const tool = definition();
  const binding = adapter();
  catalog.register(tool, binding);
  const original = catalog.resolve(tool.name, '1');
  tool.inputSchema.required = [];
  tool.requiredPermissions.length = 0;
  tool.inputSchema.properties = {};
  binding.execute = async () => 'changed';
  original.definition.requiredPermissions.length = 0;
  catalog.list()[0]!.inputSchema.required = [];
  catalog.list()[0]!.origin = { kind: 'mcp', connectionId: 'changed' };
  catalog.get(tool.name)!.version = 'changed';
  const found = catalog.get(tool.name)!;
  found.requiredPermissions.length = 0;
  found.inputSchema.properties = {};
  const current = catalog.resolve(tool.name, '1');
  assert.deepEqual(current.definition, definition());
  assert.equal(current.execute, original.execute);
  assert.equal(current.validateInput({}).ok, false);
  assert.equal(Object.isFrozen(current), true);
});

test('撤销同步影响发现、策略及解析，重新装配使用新版本', () => {
  const catalog = new ToolCatalog();
  const policy = new ToolPolicy(catalog);
  const request = { name: 'read_document', expectedVersion: '1' };
  const context = { principal: { userId: 'u1', permissions: ['documents:read'] }, allowedTools: ['read_document'] };
  catalog.register(definition(), adapter());
  assert.equal(new ToolCatalog().get(request.name), undefined);
  assert.equal(policy.evaluate(request, context).status, 'allowed');
  assert.equal(catalog.unregister(request.name), true);
  assert.equal(catalog.unregister(request.name), false);
  assert.deepEqual(catalog.list(), []);
  assert.deepEqual(policy.evaluate(request, context), { status: 'denied', reason: 'TOOL_NOT_REGISTERED' });
  assert.throws(() => catalog.resolve(request.name, '1'), (e) => e instanceof ToolAssemblyError && e.code === 'TOOL_NOT_ASSEMBLED');
  const next = { ...definition(), version: '2', outputSchema: { type: 'integer' } };
  catalog.register(next, adapter(next));
  assert.equal(catalog.resolve(request.name, '2').validateOutput(2).ok, true);
  assert.equal(catalog.resolve(request.name, '2').validateOutput('text').ok, false);
});
