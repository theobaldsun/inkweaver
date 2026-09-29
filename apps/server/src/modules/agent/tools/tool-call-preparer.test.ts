import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolCallPreparer } from './tool-call-preparer';
import { ToolCatalog } from './tool-catalog';

import type { ToolDefinition } from './tool-definition';
import type { ToolPolicyContext } from './tool-policy';

function definition(): ToolDefinition {
  return {
    name: 'read_document', version: '1', description: '读取文档',
    inputSchema: {
      type: 'object', properties: { source: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
      required: ['source'], additionalProperties: false,
    },
    outputSchema: { type: 'string' }, origin: { kind: 'builtin' }, riskLevel: 'L0',
    requiredPermissions: ['documents:read'], requiresConfirmation: false,
    timeoutMs: 1000, maxOutputBytes: 4096, supportsCancellation: true, retryPolicy: 'safe',
  };
}
function context(): ToolPolicyContext {
  return { principal: { userId: 'user-1', permissions: ['documents:read'] }, allowedTools: ['read_document'] };
}
function request() {
  return { name: 'read_document', expectedVersion: '1', input: { source: { id: 'doc-1' } } };
}
function setup(overrides: Partial<ToolDefinition> = {}) {
  const catalog = new ToolCatalog();
  const tool = { ...definition(), ...overrides };
  catalog.register(tool, { name: tool.name, version: tool.version, origin: tool.origin, async execute() { assert.fail('准备阶段不得执行工具'); } });
  return { catalog, preparer: new ToolCallPreparer(catalog) };
}

test('串联已装配工具与 Schema，生成参数快照而不执行', () => {
  const { preparer } = setup();
  assert.deepEqual(preparer.prepare(request(), context()), {
    status: 'prepared', requiresConfirmation: false,
    call: { userId: 'user-1', name: 'read_document', version: '1', input: request().input },
  });
});

test('策略拒绝先于装配解析和参数校验，不回显参数', () => {
  const { catalog, preparer } = setup();
  catalog.resolve = () => assert.fail('策略拒绝后不得解析');
  const invalid = { ...request(), input: { private_field: 'private-value' } };
  assert.deepEqual(preparer.prepare(invalid, { ...context(), principal: null }), { status: 'rejected', reason: 'UNAUTHENTICATED' });
  assert.deepEqual(preparer.prepare(invalid, { ...context(), allowedTools: [] }), { status: 'rejected', reason: 'TOOL_NOT_ALLOWED' });
  assert.deepEqual(preparer.prepare(invalid, { ...context(), principal: { userId: 'user-1', permissions: [] } }), { status: 'rejected', reason: 'MISSING_PERMISSION' });
});

test('输入不合法时拒绝，待确认工具也先验证参数', () => {
  for (const requiresConfirmation of [false, true]) {
    const { preparer } = setup({ requiresConfirmation });
    assert.deepEqual(preparer.prepare({ ...request(), input: {} }, context()), { status: 'rejected', reason: 'INVALID_TOOL_INPUT' });
    const result = preparer.prepare(request(), context());
    assert.equal(result.status, 'prepared');
    if (result.status === 'prepared') assert.equal(result.requiresConfirmation, requiresConfirmation);
  }
});

test('写工具默认拒绝，显式开放仅返回需要后续确认的准备结果', () => {
  const { preparer } = setup({ riskLevel: 'L1' });
  assert.deepEqual(preparer.prepare(request(), context()), { status: 'rejected', reason: 'RISK_DISABLED' });
  const result = preparer.prepare(request(), { ...context(), allowedRiskLevels: ['L1'] });
  assert.equal(result.status, 'prepared');
  if (result.status === 'prepared') assert.equal(result.requiresConfirmation, true);
});

test('嵌套参数双向隔离，准备过程不更改输入', () => {
  const { preparer } = setup();
  const input = request();
  const result = preparer.prepare(input, context());
  assert.deepEqual(input, request());
  assert.equal(result.status, 'prepared');
  if (result.status !== 'prepared') return;
  input.input.source.id = 'changed';
  assert.deepEqual(result.call.input, { source: { id: 'doc-1' } });
  result.call.input = null;
  assert.equal(input.input.source.id, 'changed');
});

test('撤销、版本变化和权限撤销不会复用上次通过结果', () => {
  const { catalog, preparer } = setup();
  assert.equal(preparer.prepare(request(), context()).status, 'prepared');
  assert.deepEqual(preparer.prepare({ ...request(), expectedVersion: '2' }, context()), { status: 'rejected', reason: 'VERSION_MISMATCH' });
  assert.deepEqual(preparer.prepare(request(), { ...context(), principal: { userId: 'user-2', permissions: [] } }), { status: 'rejected', reason: 'MISSING_PERMISSION' });
  catalog.unregister('read_document');
  assert.deepEqual(preparer.prepare(request(), context()), { status: 'rejected', reason: 'TOOL_NOT_REGISTERED' });
});

test('通过策略后解析失败也不返回准备成功', () => {
  const { catalog, preparer } = setup();
  const resolve = catalog.resolve.bind(catalog);
  catalog.resolve = (name, version) => {
    catalog.unregister(name);
    return resolve(name, version);
  };
  assert.deepEqual(preparer.prepare(request(), context()), { status: 'rejected', reason: 'TOOL_NOT_REGISTERED' });
});
