/**
 * HTML/纯文本切块工具：供 RAG 索引使用。
 */

const DEFAULT_CHUNK_SIZE = 700;
const DEFAULT_OVERLAP = 100;

/**
 * 去掉 HTML 标签并压缩空白。
 * 输入：htmlOrText；输出：纯文本
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
 * 输入：text、可选 size/overlap；输出：非空切块数组
 */
export function chunkPlainText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  const step = Math.max(1, chunkSize - overlap);

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize);
    const slice = normalized.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= normalized.length) break;
    start += step;
  }

  return chunks;
}
