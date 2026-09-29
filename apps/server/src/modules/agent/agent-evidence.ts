/** 成果的证据问题契约。记录待核实的模型发现，不把结构合法等同于事实正确。 */
import { validateAgentCitations } from './agent-citations';

import type { AgentCitationBinding } from './agent-citations';

export interface AgentEvidenceIssue {
  /** conflict 表示来源之间可能矛盾；gap 表示证据不足。 */
  type: 'conflict' | 'gap';
  /** 对矛盾或缺失证据的描述，最多 2000 个 UTF-16 代码单元。 */
  description: string;
  /** 本版本来源标签，不带方括号；冲突至少关联两个不同来源，缺口可为空。 */
  sourceLabels: string[];
}
export interface AgentEvidenceReport {
  /** 首版结构；不接受未知版本。 */
  schemaVersion: 1;
  /** 固定为待核实；模型不能自行声明经人工确认。 */
  status: 'unverified';
  /** 最多 20 条；空数组表示本次分析未报告问题，不代表没有问题。 */
  items: AgentEvidenceIssue[];
}

/** 接收 JSON 数据并复制规范化结果；拒绝额外字段、未知标签和过大输入。 */
export function parseAgentEvidenceReport(input: unknown, citations: readonly AgentCitationBinding[]): AgentEvidenceReport {
  const fail = (): never => { throw new Error('INVALID_AGENT_EVIDENCE'); };
  const record = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return fail();
    return value as Record<string, unknown>;
  };
  validateAgentCitations('证据引用映射', citations);
  const report = record(input, ['schemaVersion', 'status', 'items']);
  if (report.schemaVersion !== 1 || report.status !== 'unverified' || !Array.isArray(report.items) || report.items.length > 20) return fail();
  const labels = new Set(citations.map((binding) => binding.label));
  const items = report.items.map((value): AgentEvidenceIssue => {
    const item = record(value, ['type', 'description', 'sourceLabels']);
    if ((item.type !== 'conflict' && item.type !== 'gap') || typeof item.description !== 'string'
      || !item.description.trim() || item.description.length > 2000 || item.description.includes('\0')
      || !Array.isArray(item.sourceLabels) || item.sourceLabels.length > 20
      || item.sourceLabels.some((label) => typeof label !== 'string' || !labels.has(label))
      || new Set(item.sourceLabels).size !== item.sourceLabels.length
      || (item.type === 'conflict' && item.sourceLabels.length < 2)) return fail();
    const sourceLabels = [...item.sourceLabels] as string[];
    // 描述中提到的编号也必须显式进入关系，避免只保存自然语言引用而遗漏权限检查。
    const referenced = validateAgentCitations(item.description, citations);
    if (referenced.some((id) => !sourceLabels.some((label) => citations.some((binding) => binding.label === label && binding.sourceId === id)))) return fail();
    return { type: item.type, description: item.description.trim(), sourceLabels };
  });
  const normalized: AgentEvidenceReport = { schemaVersion: 1, status: 'unverified', items };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 65536) return fail();
  return normalized;
}

/** 模型只能返回一个完整 JSON 对象；不从代码围栏或混杂正文中猜测提取。 */
export function parseAgentEvidenceText(text: string, citations: readonly AgentCitationBinding[]): AgentEvidenceReport {
  if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('INVALID_AGENT_EVIDENCE');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('INVALID_AGENT_EVIDENCE'); }
  return parseAgentEvidenceReport(value, citations);
}
