/** 固定基准稿的半开区间替换；位置使用 JavaScript UTF-16 偏移，不依赖可能重复的标题。 */
export interface AgentRevisionRange {
  /** 起点，包含该位置；单位为 UTF-16 代码单元。 */
  start: number;
  /** 终点，不包含该位置；必须大于起点。 */
  end: number;
}

/** 拒绝越界、截断代理对/CRLF 或引用标签的范围，避免保存损坏的正文。 */
export function validateRevisionRange(content: string, range: AgentRevisionRange): void {
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end)
    || range.start < 0 || range.end <= range.start || range.end > content.length) throw new Error('INVALID_AGENT_REVISION_RANGE');
  for (const offset of [range.start, range.end]) {
    if ((/[\uD800-\uDBFF]/.test(content[offset - 1] ?? '') && /[\uDC00-\uDFFF]/.test(content[offset] ?? ''))
      || (content[offset - 1] === '\r' && content[offset] === '\n')) throw new Error('INVALID_AGENT_REVISION_RANGE');
    for (const token of content.matchAll(/\[S[^\]\r\n]*\]/g)) {
      if (offset > token.index! && offset < token.index! + token[0].length) throw new Error('INVALID_AGENT_REVISION_RANGE');
    }
  }
}

/** 只拼接选中片段；范围外字符逐字保留。生成内容不能指定新的偏移或覆盖整稿。 */
export function applyRevisionRange(content: string, range: AgentRevisionRange, replacement: string): string {
  validateRevisionRange(content, range);
  if (typeof replacement !== 'string' || !replacement.trim() || replacement.includes('\0')) throw new Error('INVALID_AGENT_REVISION_REPLACEMENT');
  const result = content.slice(0, range.start) + replacement + content.slice(range.end);
  if (Buffer.byteLength(result, 'utf8') > 262144) throw new Error('AGENT_ARTIFACT_TOO_LARGE');
  return result;
}


/** 持久化入口的第二道约束：即使调用方绕过 Graph，整稿也不得改写固定范围以外的字符。 */
export function assertRevisionBoundary(base: string, range: AgentRevisionRange, content: string): void {
  validateRevisionRange(base, range);
  const prefix = base.slice(0, range.start);
  const suffix = base.slice(range.end);
  if (content.length < prefix.length + suffix.length || !content.startsWith(prefix) || !content.endsWith(suffix)) {
    throw new Error('AGENT_REVISION_OUTSIDE_RANGE');
  }
}
