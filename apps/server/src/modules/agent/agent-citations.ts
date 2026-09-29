/** 回答引用的结构校验；验证标签可解析，不证明正文结论得到来源语义支持。 */
export interface AgentCitationBinding {
  /** 本次上下文的引用标签，如 S1。 */
  label: string;
  /** 对应的持久化来源 UUID。 */
  sourceId: string;
}

/** [S...] 是保留引用语法，包括代码块和示例中的同形文本；不静默修复模型标签。 */
export function validateAgentCitations(answer: string, bindings: readonly AgentCitationBinding[]): string[] {
  const fail = () => { throw new Error('INVALID_AGENT_CITATION'); };
  if (typeof answer !== 'string' || !answer.trim() || !Array.isArray(bindings) || bindings.length > 20) fail();
  const labels = new Map<string, string>();
  const ids = new Set<string>();
  for (const binding of bindings) {
    if (!binding || !/^S[1-9][0-9]*$/.test(binding.label) || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(binding.sourceId)
      || labels.has(binding.label) || ids.has(binding.sourceId)) fail();
    labels.set(binding.label, binding.sourceId); ids.add(binding.sourceId);
  }
  const cited = new Set<string>();
  // 先捕获所有保留前缀，再严格校验闭合和格式，防止 S0/S01/组合标签被当作普通正文。
  for (const match of answer.matchAll(/\[S[^\]\r\n]*(?:\]|(?=\r?\n|$))/g)) {
    if (!/^\[S[1-9][0-9]*\]$/.test(match[0])) fail();
    const sourceId = labels.get(match[0].slice(1, -1));
    if (!sourceId) fail();
    cited.add(sourceId!);
  }
  return [...cited];
}
