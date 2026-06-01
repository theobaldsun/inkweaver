/**
 * 服务端密码摘要处理：仅接收客户端 SHA-256 摘要，用 bcrypt 存取。
 */

import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { isPasswordDigest } from '@inkweaver/shared';

/**
 * 将明文密码转为传输摘要（仅用于迁移脚本等管理场景）。
 * @param plainPassword 明文密码
 */
export function digestPlainPassword(plainPassword: string): string {
  return createHash('sha256').update(plainPassword, 'utf8').digest('hex');
}

/**
 * 校验客户端传来的字段是否为摘要格式。
 * @param value 请求中的密码字段
 */
export function assertPasswordDigest(value: string, fieldName: string): void {
  if (!isPasswordDigest(value)) {
    throw new Error(`${fieldName} 必须为 SHA-256 十六进制摘要（64 位），禁止提交明文密码`);
  }
}

/**
 * 将传输摘要写入数据库（bcrypt）。
 * @param passwordDigest SHA-256 十六进制摘要
 */
export async function hashDigestForStorage(passwordDigest: string): Promise<string> {
  assertPasswordDigest(passwordDigest, 'passwordDigest');
  return bcrypt.hash(passwordDigest, 10);
}

/**
 * 比对客户端摘要与库中 bcrypt 哈希。
 * @param clientDigest 客户端 SHA-256 摘要
 * @param storedHash 数据库存储的 bcrypt 哈希
 */
export async function verifyPasswordDigest(
  clientDigest: string,
  storedHash: string,
): Promise<boolean> {
  assertPasswordDigest(clientDigest, 'clientDigest');
  return bcrypt.compare(clientDigest, storedHash);
}
