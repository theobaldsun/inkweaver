import assert from 'node:assert/strict';
import test from 'node:test';

import { Command, MemorySaver } from '@langchain/langgraph';

import { validateAgentCitations } from './agent-citations';
import { createAgentGraph } from './agent-graph';
import { agentCheckpointKey } from './agent-graph.runner';

import type { AgentGraphPorts } from './agent-graph';

function fixture() {
  let models = 0;
  let executed = 0;
  let finished = 0;
  const ledger = new Map<string, string>();
  const ports: AgentGraphPorts = {
    async guard() {},
    async initialize() { return { messages: [{ role: 'system', text: '规则' }, { role: 'user', text: '问题' }], citations: [], versions: { read_document: '1' } }; },
    async tools() { return []; },
    async model(messages) {
      models += 1;
      const metrics = { model: 'fake', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 0 };
      return messages.at(-1)?.role === 'tool' ? { ...metrics, kind: 'answer', text: '回答' }
        : { ...metrics, kind: 'tool_calls', text: '', toolCalls: [{ id: 'call_1', name: 'read_document', input: { docId: 'doc' } }] };
    },
    async tool(_call, _version, key) {
      if (!ledger.has(key)) { executed += 1; ledger.set(key, '正文'); }
      return { status: 'done', text: ledger.get(key)! };
    },
    async finish(text) { assert.equal(text, '回答'); finished += 1; },
  };
  return { ports, ledger, counts: () => ({ models, executed, finished }) };
}

test('真实 StateGraph 串联模型、受控工具端口与最终业务提交', async () => {
  const f = fixture();
  const result = await createAgentGraph(f.ports, new MemorySaver()).invoke({}, { configurable: { thread_id: 'one' } });
  assert.equal(result.answer, '回答');
  assert.deepEqual(f.counts(), { models: 2, executed: 1, finished: 1 });
  assert.deepEqual([...f.ledger.keys()], ['graph-v1:1:0']);
});

test('业务结果已提交而节点失败：新 Graph 从 Checkpoint 恢复，不重新执行工具', async () => {
  const f = fixture();
  const saver = new MemorySaver();
  const tool = f.ports.tool;
  let crash = true;
  f.ports.tool = async (...args) => {
    const result = await tool(...args);
    if (crash) { crash = false; throw new Error('模拟结果提交后断线'); }
    return result;
  };
  const config = { configurable: { thread_id: 'recovery' } };
  await assert.rejects(createAgentGraph(f.ports, saver).invoke({}, config), /断线/);
  assert.equal(f.counts().executed, 1);
  await createAgentGraph(f.ports, saver).invoke(null, config);
  assert.deepEqual(f.counts(), { models: 2, executed: 1, finished: 1 });
});

test('resume 不能替代审批：仍未批准再次暂停，业务放行后才继续', async () => {
  const f = fixture();
  let approved = false;
  const tool = f.ports.tool;
  f.ports.tool = async (...args) => approved ? tool(...args) : { status: 'paused', reason: 'WAITING_CONFIRMATION' };
  const saver = new MemorySaver();
  const config = { configurable: { thread_id: 'confirmation' } };
  const graph = createAgentGraph(f.ports, saver);
  await graph.invoke({}, config);
  await graph.invoke(new Command({ resume: true }), config);
  assert.equal(f.counts().executed, 0);
  assert.ok((await graph.getState(config)).tasks.some((task) => task.interrupts?.length));
  approved = true;
  await createAgentGraph(f.ports, saver).invoke(new Command({ resume: true }), config);
  assert.equal(f.counts().finished, 1);
});

test('用户和 Run 构成不同 checkpoint 键；预算超限在模型调用前失败', async () => {
  const user = '11111111-1111-1111-1111-111111111111';
  const run = '22222222-2222-2222-2222-222222222222';
  assert.notEqual(agentCheckpointKey(user, run), agentCheckpointKey(run, user));
  assert.throws(() => agentCheckpointKey('other', run), /INVALID_AGENT_GRAPH_ID/);
  const f = fixture();
  f.ports.initialize = async () => ({ messages: [{ role: 'user', text: '字'.repeat(1000) }], versions: {}, citations: [] });
  await assert.rejects(createAgentGraph(f.ports, new MemorySaver(), { maxRounds: 2, maxInputTokens: 256 }).invoke({}, { configurable: { thread_id: 'budget' } }), /AGENT_CONTEXT_BUDGET_EXCEEDED/);
  assert.equal(f.counts().models, 0);
});


test('引用绑定随 Checkpoint 恢复；非法引用不会进入最终业务提交', async () => {
  const f = fixture();
  const source = { label: 'S1', sourceId: '11111111-1111-1111-1111-111111111111' };
  const initialize = f.ports.initialize;
  f.ports.initialize = async () => ({ ...await initialize(), citations: [source] });
  const saver = new MemorySaver();
  const tool = f.ports.tool;
  let crash = true;
  f.ports.tool = async (...args) => {
    const result = await tool(...args);
    if (crash) { crash = false; throw new Error('模拟中断'); }
    return result;
  };
  const config = { configurable: { thread_id: 'citations' } };
  await assert.rejects(createAgentGraph(f.ports, saver).invoke({}, config), /模拟中断/);
  f.ports.model = async () => ({ kind: 'answer', text: '回答[S2]', model: 'fake', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 });
  let committed = false;
  f.ports.finish = async (answer, citations) => {
    assert.deepEqual(citations, [source]);
    validateAgentCitations(answer, citations);
    committed = true;
  };
  await assert.rejects(createAgentGraph(f.ports, saver).invoke(null, config), /INVALID_AGENT_CITATION/);
  assert.equal(committed, false);
});


test('工具来源随恢复进入引用集合，结果提交后重跑不会重复标签', async () => {
  const f = fixture();
  const binding = { sourceId: '11111111-1111-1111-1111-111111111111', label: 'S1' };
  const tool = f.ports.tool;
  let crash = true;
  f.ports.tool = async (...args) => {
    const result = await tool(...args);
    if (crash) { crash = false; throw new Error('工具来源已保存，模拟中断'); }
    return { ...result, citation: binding };
  };
  f.ports.finish = async (_answer, citations) => { assert.deepEqual(citations, [binding]); };
  const saver = new MemorySaver();
  const config = { configurable: { thread_id: 'tool-source' } };
  await assert.rejects(createAgentGraph(f.ports, saver).invoke({}, config), /模拟中断/);
  const result = await createAgentGraph(f.ports, saver).invoke(null, config);
  assert.deepEqual(result.citations, [binding]);
  assert.equal(f.counts().executed, 1);
});


test('任务依次生成提纲和草稿；发布后中断恢复不重调模型或新增版本', async () => {
  for (const crashKind of ['outline', 'draft'] as const) {
    const f = fixture();
    const saver = new MemorySaver();
    const config = { configurable: { thread_id: `artifact-${crashKind}` }, durability: 'sync' as const };
    let models = 0;
    let crash = true;
    let finished = '';
    const saved = new Map<string, string>();
    f.ports.model = async (_messages, tools) => {
      models++;
      assert.deepEqual(tools, []);
      return { kind: 'answer', text: ['综合事实', '提纲', '草稿'][models - 1]!, model: 'fake', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 };
    };
    f.ports.artifact = { publish: async (kind, content) => {
      if (saved.has(kind)) assert.equal(saved.get(kind), content);
      saved.set(kind, content);
      if (kind === crashKind && crash) { crash = false; throw new Error('发布已提交后断线'); }
    } };
    f.ports.finish = async (answer) => { finished = answer; };
    await assert.rejects(createAgentGraph(f.ports, saver).invoke({}, config), /断线/);
    assert.equal(models, crashKind === 'outline' ? 2 : 3);
    await createAgentGraph(f.ports, saver).invoke(null, config);
    assert.equal(models, 3);
    assert.deepEqual([...saved], [['outline', '提纲'], ['draft', '草稿']]);
    assert.equal(finished, '草稿');
  }
});

test('成果模型未知引用或要求执行工具均不能发布', async () => {
  for (const invalid of ['citation', 'tool']) {
    const f = fixture();
    let models = 0;
    let saved = 0;
    f.ports.artifact = { publish: async () => { saved++; } };
    f.ports.model = async () => {
      models++;
      const metrics = { model: 'fake', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 };
      return models === 1 ? { ...metrics, kind: 'answer', text: '事实' }
        : invalid === 'citation' ? { ...metrics, kind: 'answer', text: '虚假 [S99]' }
          : { ...metrics, kind: 'tool_calls', text: '', toolCalls: [{ id: 'bad', name: 'read_document', input: {} }] };
    };
    await assert.rejects(createAgentGraph(f.ports, new MemorySaver()).invoke({}, { configurable: { thread_id: invalid } }), /INVALID_AGENT_CITATION|MODEL_RESULT_INVALID/);
    assert.equal(saved, 0);
    assert.equal(f.counts().finished, 0);
  }
});

test('生成阶段也受上下文预算和总模型轮次约束', async () => {
  for (const budget of ['tokens', 'rounds']) {
    const f = fixture();
    let models = 0;
    f.ports.artifact = { publish: async () => assert.fail('不得发布') };
    f.ports.model = async () => {
      models++;
      return { kind: 'answer', text: '字'.repeat(2000), model: 'fake', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 };
    };
    await assert.rejects(createAgentGraph(f.ports, new MemorySaver(), {
      maxRounds: budget === 'rounds' ? 1 : 10, maxInputTokens: budget === 'tokens' ? 256 : 12000,
    }).invoke({}, { configurable: { thread_id: budget } }), /BUDGET_EXCEEDED|ROUND_LIMIT/);
    assert.equal(models, 1);
  }
});


test('定向修订跳过提纲，仅发布一次草稿；提交后恢复复用正文', async () => {
  const f = fixture();
  let models = 0;
  let crash = true;
  let saved = '';
  f.ports.model = async () => ({ kind: 'answer', text: ++models === 1 ? '核对结果' : '完整修订稿',
    model: 'fake', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 });
  f.ports.artifact = { revision: true, publish: async (kind, content) => {
    assert.equal(kind, 'draft');
    if (saved) assert.equal(content, saved);
    saved = content;
    if (crash) { crash = false; throw new Error('提交后断线'); }
  } };
  f.ports.finish = async (answer) => { assert.equal(answer, '完整修订稿'); };
  const saver = new MemorySaver();
  const config = { configurable: { thread_id: 'revision' }, durability: 'sync' as const };
  await assert.rejects(createAgentGraph(f.ports, saver).invoke({}, config), /断线/);
  await createAgentGraph(f.ports, saver).invoke(null, config);
  assert.equal(models, 2);
  assert.equal(saved, '完整修订稿');
});


test('章节草稿先由服务端拼接；发布后恢复不会再次把整稿当替换片段', async () => {
  const f = fixture();
  let calls = 0;
  let assembled = 0;
  let crash = true;
  f.ports.model = async () => ({ kind: 'answer', text: ++calls === 1 ? '核对结果' : '新章节',
    model: 'fake', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 });
  f.ports.artifact = { revision: true, section: { assemble: async (text) => {
    assembled++;
    assert.equal(text, '新章节');
    return '前文\n' + text + '\n后文';
  } }, publish: async (kind, text) => {
    assert.equal(kind, 'draft');
    assert.equal(text, '前文\n新章节\n后文');
    if (crash) { crash = false; throw new Error('提交后断线'); }
  } };
  f.ports.finish = async (text) => { assert.equal(text, '前文\n新章节\n后文'); };
  const saver = new MemorySaver();
  const config = { configurable: { thread_id: 'section' }, durability: 'sync' as const };
  await assert.rejects(createAgentGraph(f.ports, saver).invoke({}, config), /断线/);
  await createAgentGraph(f.ports, saver).invoke(null, config);
  assert.equal(assembled, 1);
  assert.equal(calls, 2);
});


test('证据报告先入检查点再随草稿发布；恢复不重复分析，旧版提纲未分析', async () => {
  const f = fixture();
  let models = 0;
  let crash = true;
  const report = { schemaVersion: 1, status: 'unverified', items: [{ type: 'gap', description: '缺少依据', sourceLabels: [] }] };
  f.ports.model = async () => ({ kind: 'answer', text: ['事实', '提纲', '草稿', JSON.stringify(report)][models++]!,
    model: 'fake', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, latencyMs: 0 });
  f.ports.artifact = { reviewEvidence: true, publish: async (kind, content, _citations, evidence) => {
    if (kind === 'outline') { assert.equal(evidence, undefined); return; }
    assert.equal(content, '草稿');
    assert.deepEqual(evidence, report);
    if (crash) { crash = false; throw new Error('提交后断线'); }
  } };
  f.ports.finish = async (text) => { assert.equal(text, '草稿'); };
  const saver = new MemorySaver();
  const config = { configurable: { thread_id: 'evidence' }, durability: 'sync' as const };
  await assert.rejects(createAgentGraph(f.ports, saver).invoke({}, config), /断线/);
  await createAgentGraph(f.ports, saver).invoke(null, config);
  assert.equal(models, 4);
});
