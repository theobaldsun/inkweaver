/** 回答引用的结构校验；验证标签可解析，不证明正文结论得到来源语义支持。 */
export interface AgentCitationBinding {
  /** 本次上下文的引用标签，如 S1。 */
  label: string;
  /** 对应的持久化来源 UUID。 */
  sourceId: string;
}

/**
 * 校验模型回答中的引用标签合法性。
 *
 * 核心规则：
 *   1. binding 本身合法：label 必须是 `S数字`（S1-S20）、sourceId 必须是 UUID，不重复
 *   2. 回答中每个 `[S...]` 格式必须合法（`[S数字]`，不能是 `[S0]`/`[S01]`/`[S1,S2]`）
 *   3. 回答中每个合法标签必须在 bindings 列表中存在映射
 *
 * 重要：正则会扫描**全文**（包括代码块和示例中的同形文本），模型在代码块里写 `[S1]` 同样会被捕获。
 * 这是"保留引用语法"的设计——不静默修复、不排除代码块，防止模型在代码块里伪造引用。
 *
 * @returns 实际被引用的 sourceId 列表（去重后的 Set 转数组）
 */
export function validateAgentCitations(answer: string, bindings: readonly AgentCitationBinding[]): string[] {
  const fail = () => { throw new Error('INVALID_AGENT_CITATION'); };
  // 前置守卫：answer 必须是有效字符串；bindings 必须是数组且不超过 20 个（与来源上限对齐）。
  if (typeof answer !== 'string' || !answer.trim() || !Array.isArray(bindings) || bindings.length > 20) fail();
  // 构建 label → sourceId 映射表，同时校验每个 binding 的格式与唯一性。
  const labels = new Map<string, string>();
  const ids = new Set<string>();
  for (const binding of bindings) {
    // label 必须是 S1-S20（S0 和带前导零的 S01 都非法）；sourceId 必须是标准 UUID。
    if (!binding || !/^S[1-9][0-9]*$/.test(binding.label) || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(binding.sourceId)
      || labels.has(binding.label) || ids.has(binding.sourceId)) fail();
    labels.set(binding.label, binding.sourceId); ids.add(binding.sourceId);
  }
  // 扫描回答全文，捕获所有 `[S...` 开头的片段（到右括号或行尾为止）。
  const cited = new Set<string>();
  for (const match of answer.matchAll(/\[S[^\]\r\n]*(?:\]|(?=\r?\n|$))/g)) {
    // 严格校验：必须是 `[S数字]` 的完整形式。防止 S0/S01/组合标签混过关。
    if (!/^\[S[1-9][0-9]*\]$/.test(match[0])) fail();
    // 去掉左右括号，在映射表中查找对应的 sourceId；找不到 = 引用了不存在的标签。
    const sourceId = labels.get(match[0].slice(1, -1));
    if (!sourceId) fail();
    cited.add(sourceId!);
  }
  return [...cited];
}
