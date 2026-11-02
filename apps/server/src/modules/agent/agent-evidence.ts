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

/**
 * 解析并校验模型产出的结构化证据报告（JSON）。
 *
 * 校验清单：
 *   1. 顶层结构：schemaVersion=1、status='unverified'、items 是数组且 ≤20 条
 *   2. 每条 issue：type 只能是 'conflict'/'gap'、description 非空且 ≤2000 字符
 *   3. sourceLabels 必须在当前 citations 列表中存在、不重复；conflict 至少关联 2 个来源
 *   4. description 中提到的 [S...] 标签必须也在 sourceLabels 中显式列出（防自然语言引用遗漏）
 *   5. 整体序列化后 ≤64KiB；拒绝额外字段（record 校验 key 数量严格匹配）
 *
 * 核心设计：**结构合法 ≠ 事实正确**。本函数只保证 JSON 格式和引用关系合法，
 * 不验证模型说的"来源矛盾"是否真实存在——那是人工 review 的职责。
 */
export function parseAgentEvidenceReport(input: unknown, citations: readonly AgentCitationBinding[]): AgentEvidenceReport {
  const fail = (): never => { throw new Error('INVALID_AGENT_EVIDENCE'); };
  // record 辅助：校验 value 是非 null 对象、非数组、key 数量严格匹配、无额外字段。
  const record = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return fail();
    return value as Record<string, unknown>;
  };
  // 先校验 citations 本身合法（label 格式/sourceId 唯一性），作为后续 sourceLabels 校验的基础。
  validateAgentCitations('证据引用映射', citations);
  // 校验顶层结构：固定三个字段，schemaVersion 和 status 有白名单。
  const report = record(input, ['schemaVersion', 'status', 'items']);
  if (report.schemaVersion !== 1 || report.status !== 'unverified' || !Array.isArray(report.items) || report.items.length > 20) return fail();
  // 构建当前上下文中所有合法标签的集合，用于快速查找。
  const labels = new Set(citations.map((binding) => binding.label));
  // 逐条校验 issue。
  const items = report.items.map((value): AgentEvidenceIssue => {
    const item = record(value, ['type', 'description', 'sourceLabels']);
    // type/conflict/gap 白名单；description 长度/内容守卫；sourceLabels 数组且 ≤20。
    if ((item.type !== 'conflict' && item.type !== 'gap') || typeof item.description !== 'string'
      || !item.description.trim() || item.description.length > 2000 || item.description.includes('\0')
      || !Array.isArray(item.sourceLabels) || item.sourceLabels.length > 20
      || item.sourceLabels.some((label) => typeof label !== 'string' || !labels.has(label))
      || new Set(item.sourceLabels).size !== item.sourceLabels.length
      || (item.type === 'conflict' && item.sourceLabels.length < 2)) return fail();
    const sourceLabels = [...item.sourceLabels] as string[];
    // 描述中提到的 [S...] 编号也必须显式进入 sourceLabels 关系，
    // 避免模型只在描述里自然语言提到"来源 S1"，但 sourceLabels 数组漏了 S1 → 权限检查遗漏。
    const referenced = validateAgentCitations(item.description, citations);
    if (referenced.some((id) => !sourceLabels.some((label) => citations.some((binding) => binding.label === label && binding.sourceId === id)))) return fail();
    return { type: item.type, description: item.description.trim(), sourceLabels };
  });
  // 规范化输出：固定 schemaVersion 和 status，防止模型传其他值。
  const normalized: AgentEvidenceReport = { schemaVersion: 1, status: 'unverified', items };
  // 整体大小守卫：序列化后 ≤64KiB，防止超大 JSON 拖垮存储/传输。
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 65536) return fail();
  return normalized;
}

/**
 * 把模型产出的 JSON 文本解析为证据报告。
 *
 * 本函数是 `reviewEvidence` 节点（agent-graph.ts:161）的调用入口。
 * 模型被要求输出纯 JSON（无代码围栏包装），所以这里直接 `JSON.parse`，
 * 不从 Markdown 代码块或混杂正文中猜测提取——格式不对就失败。
 */
export function parseAgentEvidenceText(text: string, citations: readonly AgentCitationBinding[]): AgentEvidenceReport {
  if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('INVALID_AGENT_EVIDENCE');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('INVALID_AGENT_EVIDENCE'); }
  return parseAgentEvidenceReport(value, citations);
}
