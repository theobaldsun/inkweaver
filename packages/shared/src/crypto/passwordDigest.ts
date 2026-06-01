/**
 * 密码传输摘要：客户端对用户输入做 SHA-256，仅将十六进制摘要发往服务端。
 * 服务端再对摘要做 bcrypt 存储，从不保存用户可读的登录密码。
 */

import { sha256HexFromBytes } from './sha256Pure';

/** 传输用密码摘要格式：64 位十六进制 SHA-256 */
export const PASSWORD_DIGEST_REGEX = /^[a-f0-9]{64}$/i;

/**
 * 判断字符串是否为合法的密码传输摘要。
 * @param value 待检测字符串
 */
export function isPasswordDigest(value: string): boolean {
  return PASSWORD_DIGEST_REGEX.test(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 是否处于安全上下文（HTTPS 或 localhost）。HTTP + 局域网 IP 通常为 false。
 */
function isSecureContext(): boolean {
  const g = globalThis as typeof globalThis & { isSecureContext?: boolean };
  return g.isSecureContext !== false;
}

/**
 * 是否可使用 Web Crypto subtle。
 */
function canUseWebCryptoSubtle(): boolean {
  if (!isSecureContext()) {
    return false;
  }
  return Boolean(globalThis.crypto?.subtle);
}

/**
 * 将用户输入密码转为传输用 SHA-256 摘要（小写十六进制）。
 * 优先 Web Crypto；在 HTTP 局域网、部分 WebView 等环境自动降级为纯 JS 实现。
 * @param password 用户输入的明文密码（仅留在客户端内存，不写入请求体）
 * @returns 64 字符十六进制摘要
 */
export async function hashPasswordForTransport(password: string): Promise<string> {
  const encoded = new TextEncoder().encode(password);

  if (canUseWebCryptoSubtle()) {
    try {
      const digest = await globalThis.crypto!.subtle!.digest('SHA-256', encoded);
      return bytesToHex(new Uint8Array(digest));
    } catch {
      // 降级到纯 JS
    }
  }

  return sha256HexFromBytes(encoded);
}
