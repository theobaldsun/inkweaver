import assert from 'node:assert/strict';
import test from 'node:test';

import { assertToolDefinition, ToolRegistryError } from './tool-definition-validator';

import type { ToolDefinition } from './tool-definition';

function tool(name = 'search_documents'): ToolDefinition {
  return {
    name, version: '1', description: '搜索文档',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    outputSchema: { type: 'object' }, origin: { kind: 'builtin' },
    riskLevel: 'L0', requiredPermissions: ['documents:read'], requiresConfirmation: false,
    timeoutMs: 1000, maxOutputBytes: 4096, supportsCancellation: true, retryPolicy: 'safe',
  };
}

test('内置与 MCP 工具定义均通过结构校验', () => {
  assert.doesNotThrow(() => assertToolDefinition(tool()));
  assert.doesNotThrow(() => assertToolDefinition({ ...tool('z_remote'), origin: { kind: 'mcp', connectionId: 'connection-1' } }));
});

test('非法定义被拒绝并返回稳定错误码', () => {
  const invalidDefinitions: unknown[] = [
    null, {}, { ...tool(), credentials: 'placeholder' },
    { ...tool(), origin: { kind: 'builtin', url: 'https://example.com' } },
    { ...tool(), name: 'bad name' }, { ...tool(), version: '' }, { ...tool(), description: ' ' },
    { ...tool(), timeoutMs: -1 }, { ...tool(), timeoutMs: 1.5 },
    { ...tool(), maxOutputBytes: Infinity }, { ...tool(), maxOutputBytes: 0 },
    { ...tool(), inputSchema: { type: 'string' } }, { ...tool(), outputSchema: [] },
    { ...tool(), riskLevel: 'unknown' }, { ...tool(), retryPolicy: 'always' },
    { ...tool(), supportsCancellation: 'yes' }, { ...tool(), requiresConfirmation: null },
    { ...tool(), requiredPermissions: ['x', 'x'] },
    { ...tool(), origin: { kind: 'mcp', connectionId: 'https://example.com' } },
    { ...tool(), outputSchema: { custom: () => true } },
  ];
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  invalidDefinitions.push({ ...tool(), outputSchema: cycle });
  for (const definition of invalidDefinitions) {
    assert.throws(() => assertToolDefinition(definition as ToolDefinition), (error) => error instanceof ToolRegistryError && error.code === 'INVALID_DEFINITION');
  }
});
