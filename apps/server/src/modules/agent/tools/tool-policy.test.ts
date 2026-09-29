import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolCatalog } from './tool-catalog';
import { ToolPolicy } from './tool-policy';

import type { ToolDefinition } from './tool-definition';
import type { ToolPolicyContext } from './tool-policy';


/** 使用真实装配目录验证注册与策略；适配器仅为离线测试桩。 */
function registerTool(catalog: ToolCatalog, definition: ToolDefinition): void {
  catalog.register(definition, {
    name: definition?.name, version: definition?.version, origin: definition?.origin,
    async execute() { return {}; },
  });
}

const request = { name: 'read_document', expectedVersion: '1' };
function context(): ToolPolicyContext {
  return { principal: { userId: 'user-1', permissions: ['documents:read'] }, allowedTools: ['read_document'] };
}
function setup(overrides: Partial<ToolDefinition> = {}) {
  const registry = new ToolCatalog();
  const definition: ToolDefinition = {
    name: request.name, version: '1', description: '读取文档',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    origin: { kind: 'builtin' }, riskLevel: 'L0', requiredPermissions: ['documents:read'],
    requiresConfirmation: false, timeoutMs: 1000, maxOutputBytes: 4096,
    supportsCancellation: true, retryPolicy: 'safe', ...overrides,
  };
  registerTool(registry, definition);
  return { registry, definition, policy: new ToolPolicy(registry) };
}

test('已认证且权限完整的只读工具通过预检查', () => {
  assert.deepEqual(setup().policy.evaluate(request, context()), { status: 'allowed' });
});

test('空权限要求仍需身份，未认证优先于目录和允许列表检查', () => {
  const { policy } = setup({ requiredPermissions: [] });
  for (const principal of [null, { userId: ' ', permissions: [] }]) {
    assert.deepEqual(policy.evaluate({ name: 'unknown', expectedVersion: '1' }, { ...context(), principal }), { status: 'denied', reason: 'UNAUTHENTICATED' });
  }
});

test('注册不自动开放，空允许列表及通配符均不能授予调用权', () => {
  const { policy } = setup();
  for (const allowedTools of [[], ['*'], ['another_tool']]) {
    assert.deepEqual(policy.evaluate(request, { ...context(), allowedTools }), { status: 'denied', reason: 'TOOL_NOT_ALLOWED' });
  }
});

test('工具撤销和版本升级立即影响下一次检查，不缓存授权', () => {
  const { policy, registry, definition } = setup();
  assert.equal(policy.evaluate(request, context()).status, 'allowed');
  registry.unregister(request.name);
  assert.deepEqual(policy.evaluate(request, context()), { status: 'denied', reason: 'TOOL_NOT_REGISTERED' });
  registerTool(registry, { ...definition, version: '2' });
  assert.deepEqual(policy.evaluate(request, context()), { status: 'denied', reason: 'VERSION_MISMATCH' });
  assert.equal(policy.evaluate({ ...request, expectedVersion: '2' }, context()).status, 'allowed');
});

test('默认关闭写工具，显式开放后也必须等待确认', () => {
  for (const riskLevel of ['L1', 'L2', 'L3'] as const) {
    const { policy } = setup({ riskLevel, requiresConfirmation: false });
    assert.deepEqual(policy.evaluate(request, context()), { status: 'denied', reason: 'RISK_DISABLED' });
    assert.deepEqual(policy.evaluate(request, { ...context(), allowedRiskLevels: [riskLevel] }), { status: 'confirmation_required' });
  }
  assert.deepEqual(setup().policy.evaluate(request, { ...context(), allowedRiskLevels: [] }), { status: 'denied', reason: 'RISK_DISABLED' });
});

test('MCP 连接需要单独授权，工具允许列表不能替代连接权限', () => {
  const { policy } = setup({ origin: { kind: 'mcp', connectionId: 'connection-1' } });
  for (const allowedMcpConnections of [undefined, [], ['*'], ['connection-2']]) {
    assert.deepEqual(policy.evaluate(request, { ...context(), allowedMcpConnections }), { status: 'denied', reason: 'CONNECTION_NOT_ALLOWED' });
  }
  assert.equal(policy.evaluate(request, { ...context(), allowedMcpConnections: ['connection-1'] }).status, 'allowed');
});

test('权限必须全部满足，缺失权限不能降级为待确认或被通配符覆盖', () => {
  const { policy } = setup({ requiredPermissions: ['documents:read', 'folders:read'], requiresConfirmation: true });
  for (const permissions of [[], ['documents:read'], ['*']]) {
    assert.deepEqual(policy.evaluate(request, { ...context(), principal: { userId: 'user-1', permissions } }), { status: 'denied', reason: 'MISSING_PERMISSION' });
  }
  assert.deepEqual(policy.evaluate(request, { ...context(), principal: { userId: 'user-1', permissions: ['documents:read', 'folders:read'] } }), { status: 'confirmation_required' });
});

test('用户之间不共享权限结果，预检查不修改上下文', () => {
  const { policy } = setup();
  const input = context();
  const snapshot = structuredClone(input);
  assert.equal(policy.evaluate(request, input).status, 'allowed');
  assert.deepEqual(policy.evaluate(request, { ...input, principal: { userId: 'user-2', permissions: [] } }), { status: 'denied', reason: 'MISSING_PERMISSION' });
  assert.deepEqual(input, snapshot);
});
