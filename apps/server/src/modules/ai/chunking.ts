/**
 * HTML/纯文本切块工具：供 RAG 索引使用。
 *
 * 用于将文档内容切分为适合向量化的小块，支持重叠窗口以保留上下文。
 * 默认 700 字符一块，重叠 100 字符。
 */

const DEFAULT_CHUNK_SIZE = 700;
const DEFAULT_OVERLAP = 100;

/**
 * 去掉 HTML 标签并压缩空白。
 *
 * @param htmlOrText 可能包含 HTML 的文本
 * @returns 纯文本
 */
export function htmlToPlainText(htmlOrText: string): string {
  if (!htmlOrText) return '';
  return htmlOrText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 按字符窗口切块（带重叠）。
 *
 * 策略：
 * - chunkSize：每块的字符数（默认 700）
 * - overlap：相邻块重叠的字符数（默认 100），用于保留上下文
 * - step：块起始位置的步进 = chunkSize - overlap
 *
 * @param text 待切块的纯文本
 * @param chunkSize 每块字符数，必须为正整数
 * @param overlap 重叠字符数，必须满足 0 <= overlap < chunkSize
 * @returns 切块数组
 * @throws 当 chunkSize <= 0 或 overlap >= chunkSize 时抛出错误
 */
export function chunkPlainText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): string[] {
  // 参数校验：防止 overlap >= chunkSize 导致 step=1 退化为逐字符切块（DoS）
  if (chunkSize <= 0) {
    throw new Error('chunkSize 必须为正整数');
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error(`overlap 必须满足 0 <= overlap < chunkSize，当前 overlap=${overlap}, chunkSize=${chunkSize}`);
  }

  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  const step = chunkSize - overlap;

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize);
    const slice = normalized.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= normalized.length) break;
    start += step;
  }

  return chunks;
}
