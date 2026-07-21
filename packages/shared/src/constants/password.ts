/**
 * 密码明文长度约定（跨端共享）。
 *
 * 用途：注册/重置/改密前端校验与文案统一；服务端仍只接收 SHA-256 摘要。
 * 输入：明文密码字符串
 * 输出：是否满足最小长度
 */

/** 用户可见密码最小长度 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * 校验明文密码长度是否达标。
 * 输入：明文密码；输出：是否 >= MIN_PASSWORD_LENGTH
 */
export function isPasswordLengthValid(password: string): boolean {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}
