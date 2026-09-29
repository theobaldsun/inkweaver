import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentModelCallRecorder } from './agent-model-call.recorder';
import { AgentModelError, normalizeAgentTokenCount } from './agent-model.client';

import type { AgentModelStepRequest, AgentModelStepResult } from './agent-model.client';
import type { EntityManager } from 'typeorm';

const limits = { contextTokens: 12000, outputTokens: 2000, callsPerRun: 10, callsPerUserDay: 100, reservedTokensPerRun: 120000, reservedTokensPerUserDay: 1200000 };
const userId = '11111111-1111-1111-1111-111111111111';
const runId = '22222222-2222-2222-2222-222222222222';
const request: AgentModelStepRequest = { messages: [{ role: 'system', text: '规则' }, { role: 'user', text: '私人正文' }], maxOutputTokens: 100 };
const response: AgentModelStepResult = { kind: 'answer', text: '私人回答', model: 'model', usage: { inputTokens: 10, outputTokens: 0, totalTokens: null }, latencyMs: 20 };

function fixture(writeFailure = false, budget = { runCalls: 0, dayCalls: 0, runTokens: '0', dayTokens: '0' }) {
  const writes: unknown[][] = [];
  let active = false;
  const transaction = { queryRunner: { isTransactionActive: true }, query: async (sql: string, parameters: unknown[]) => {
    if (sql.startsWith('INSERT') || sql.includes('UPDATE agent_model_calls')) writes.push(parameters);
    if (sql.includes('UPDATE agent_model_calls') && writeFailure) throw new Error('audit write failed');
    if (sql.includes('count(*) FILTER')) return [budget];
    return [{ id: userId }];
  } };
  const manager = { transaction: async (_isolation: string, action: (value: unknown) => Promise<unknown>) => {
    active = true;
    try { return await action(transaction); } finally { active = false; }
  } } as unknown as EntityManager;
  return { writes, manager, isActive: () => active };
}

test('外部调用在事务外；成功记录真实零与未知用量，不保存正文', async () => {
  const f = fixture();
  const recorder = new AgentModelCallRecorder(f.manager, { limits: () => limits, configuredModel: () => 'model', step: async () => {
    assert.equal(f.writes.length % 2, 1); assert.equal(f.isActive(), false); return response;
  } });
  assert.deepEqual(await recorder.step(userId, runId, request), response);
  assert.deepEqual(f.writes[1]!.slice(3), ['SUCCEEDED', null, 'model', 10, 0, null, 20]);
  assert.ok(!JSON.stringify(f.writes).includes('私人'));
  await recorder.step(userId, runId, request);
  assert.notEqual(f.writes[0]![0], f.writes[2]![0]);
});

test('协议失败仍保留已收到用量；超时/取消没有用量时保持 null', async () => {
  for (const code of ['AGENT_MODEL_OUTPUT_INVALID', 'AGENT_MODEL_TIMED_OUT', 'AGENT_MODEL_CANCELLED'] as const) {
    const f = fixture();
    const error = new AgentModelError(code, code === 'AGENT_MODEL_OUTPUT_INVALID' ? { observation: response } : undefined);
    const recorder = new AgentModelCallRecorder(f.manager, { limits: () => limits, configuredModel: () => 'model', async step() { throw error; } });
    await assert.rejects(recorder.step(userId, runId, request), (actual) => actual === error);
    assert.equal(f.writes[1]![4], code);
    assert.equal(f.writes[1]![6], code === 'AGENT_MODEL_OUTPUT_INVALID' ? 10 : null);
  }
});

test('成功后审计写入失败不会再写模型失败记录，也不重复调用供应商', async () => {
  const f = fixture(true);
  let count = 0;
  const recorder = new AgentModelCallRecorder(f.manager, { limits: () => limits, configuredModel: () => 'model', async step() { count += 1; return response; } });
  await assert.rejects(recorder.step(userId, runId, request), /audit write failed/);
  assert.equal(count, 1); assert.equal(f.writes.length, 2); assert.equal(f.writes[1]![3], 'SUCCEEDED');
  assert.equal(normalizeAgentTokenCount(0), 0);
  for (const invalid of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) assert.equal(normalizeAgentTokenCount(invalid), null);
});

test('任一累计额度不足时不预占、不调用模型', async () => {
  for (const budget of [
    { runCalls: 10, dayCalls: 0, runTokens: '0', dayTokens: '0' },
    { runCalls: 0, dayCalls: 100, runTokens: '0', dayTokens: '0' },
    { runCalls: 0, dayCalls: 0, runTokens: '120000', dayTokens: '0' },
    { runCalls: 0, dayCalls: 0, runTokens: '0', dayTokens: '1200000' },
  ]) {
    const f = fixture(false, budget);
    const recorder = new AgentModelCallRecorder(f.manager, { limits: () => limits, configuredModel: () => 'model',
      async step() { throw new Error('NETWORK_FORBIDDEN'); } });
    await assert.rejects(recorder.step(userId, runId, request), /AGENT_MODEL_BUDGET_EXCEEDED/);
    assert.equal(f.writes.length, 0);
  }
});
