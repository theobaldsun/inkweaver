/** 结构化证据报告只验证数据形状和引用关系，不验证语义真实性。 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAgentEvidenceReport, parseAgentEvidenceText } from './agent-evidence';

const citations = [1, 2].map((n) => ({ label: `S${n}`, sourceId: `${n}1111111-1111-4111-8111-111111111111` }));
const report = { schemaVersion: 1, status: 'unverified', items: [
  { type: 'conflict', description: '两份资料的日期不同 [S1] [S2]', sourceLabels: ['S1', 'S2'] },
  { type: 'gap', description: '缺少测量数据', sourceLabels: [] },
] };

test('冲突及无来源缺口可解析，复制数据且保留未核实状态', () => {
  const result = parseAgentEvidenceText(JSON.stringify(report), citations);
  assert.deepEqual(result, report);
  result.items[0]!.sourceLabels.pop();
  assert.equal(report.items[0]!.sourceLabels.length, 2);
  assert.deepEqual(parseAgentEvidenceReport({ ...report, items: [] }, citations).items, []);
});

test('拒绝未知字段、伪造状态、单来源冲突、未知或遗漏引用及超量数据', () => {
  const issue = report.items[0]!;
  for (const value of [null, { ...report, extra: true }, { ...report, status: 'verified' },
    { ...report, schemaVersion: 2 }, { ...report, items: Array(21).fill(issue) },
    ...[{ ...issue, sourceLabels: ['S1'] }, { ...issue, sourceLabels: ['S1', 'S99'] },
      { ...issue, sourceLabels: ['S1', 'S1'] }, { ...issue, type: 'gap', sourceLabels: [] },
      { ...issue, description: 'a'.repeat(2001) }, { ...issue, extra: 'field' }].map((item) => ({ ...report, items: [item] }))]) {
    assert.throws(() => parseAgentEvidenceReport(value, citations), /INVALID_AGENT_EVIDENCE/);
  }
  assert.throws(() => parseAgentEvidenceText('```json\n{}\n```', citations), /INVALID_AGENT_EVIDENCE/);
});
