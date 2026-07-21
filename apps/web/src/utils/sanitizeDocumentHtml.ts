/**
 * 公开文档 HTML 消毒。
 *
 * 用途：将编辑器 HTML 收敛到可安全渲染的标签与属性集合，供分享页/预览使用。
 * 输入：原始 HTML 字符串
 * 输出：消毒后的 HTML；无 DOMParser 时降级为实体转义纯文本
 */

const ALLOWED_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'li', 'mark', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table', 'tbody',
  'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const REMOVE_WITH_CONTENT = new Set([
  'base', 'button', 'embed', 'form', 'iframe', 'input', 'link', 'meta', 'object', 'script',
  'style', 'svg', 'template',
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 判断 URL 是否可安全写入 href/src。
 * 输入：属性值；输出：是否允许（仅 http/https，拒绝 protocol-relative）
 */
function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('//')) return false;
  try {
    const url = new URL(trimmed, 'https://inkweaver.local');
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 将编辑器 HTML 收敛到可公开、安全渲染的标签与属性集合。 */
export function sanitizeDocumentHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return escapeHtml(html);

  const document = new DOMParser().parseFromString(html, 'text/html');
  const elements = Array.from(document.body.querySelectorAll('*')).reverse();

  for (const element of elements) {
    const tagName = element.tagName.toLowerCase();
    if (REMOVE_WITH_CONTENT.has(tagName)) {
      element.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const isLink = tagName === 'a' && name === 'href' && isSafeUrl(value);
      const isImage = tagName === 'img' && name === 'src' && isSafeUrl(value);
      const isImageMetadata = tagName === 'img' && ['alt', 'title', 'width', 'height'].includes(name);
      const isTableSpan = ['td', 'th'].includes(tagName) && ['colspan', 'rowspan'].includes(name);
      const isCodeClass = ['code', 'pre'].includes(tagName) && name === 'class' && /^language-[\w-]+$/.test(value);

      if (!isLink && !isImage && !isImageMetadata && !isTableSpan && !isCodeClass) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tagName === 'a') {
      element.setAttribute('rel', 'noopener noreferrer');
    }
  }

  return document.body.innerHTML;
}
