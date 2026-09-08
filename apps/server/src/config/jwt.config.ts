/**
 * JWT 模块统一配置（避免各子模块硬编码不同 secret / TTL）。
 *
 * 用途：
 * - JwtModule 注册选项
 * - access / refresh 过期时间常量（auth.service 签发与 expires_in 对齐）
 */

import { ConfigService } from '@nestjs/config';

import type { JwtModuleOptions } from '@nestjs/jwt';

/** access token 默认有效期（可被 JWT_EXPIRES_IN 覆盖） */
export const JWT_ACCESS_EXPIRES_IN = '1h';

/** access token 默认有效期（秒），与登录/刷新响应 expires_in 对齐 */
export const JWT_ACCESS_EXPIRES_SECONDS = 60 * 60;

/** refresh token 有效期 */
export const JWT_REFRESH_EXPIRES_IN = '30d';

/**
 * 将 `15m` / `1h` / `7d` 等时长解析为秒；无法解析时回退默认 access 秒数。
 * 输入：expiresIn 字符串；输出：秒
 */
export function parseJwtExpiresInToSeconds(expiresIn: string): number {
  const match = /^(\d+)([smhd])$/i.exec(expiresIn.trim());
  if (!match) return JWT_ACCESS_EXPIRES_SECONDS;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return amount * (multipliers[unit] ?? 1);
}

/**
 * 当前 access token 过期配置（环境变量优先）。
 * 输入：无；输出：{ expiresIn, expiresSeconds }
 */
export function getAccessTokenTtl(): {
  expiresIn: string;
  expiresSeconds: number;
} {
  const expiresIn =
    process.env.JWT_EXPIRES_IN?.trim() || JWT_ACCESS_EXPIRES_IN;
  return {
    expiresIn,
    expiresSeconds: parseJwtExpiresInToSeconds(expiresIn),
  };
}

/**
 * 构建 JwtModule 注册选项。
 *
 * 要求：`JWT_SECRET` 必须通过 ConfigService 或环境变量提供；
 * 缺失时直接抛错，禁止使用硬编码回退值，防止弱密钥在非生产环境被绕过。
 *
 * 输入：可选 ConfigService；输出：JwtModuleOptions（默认 access TTL 1h）
 * 抛错：当 JWT_SECRET 未配置时
 */
export function getJwtModuleOptions(config?: ConfigService): JwtModuleOptions {
  const secret =
    config?.get<string>('JWT_SECRET') ??
    process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      'JWT_SECRET 未配置：请在 .env 或 ConfigService 中设置 JWT_SECRET，禁止使用硬编码回退值',
    );
  }

  const expiresIn =
    config?.get<string>('JWT_EXPIRES_IN') ??
    process.env.JWT_EXPIRES_IN ??
    JWT_ACCESS_EXPIRES_IN;

  return {
    secret,
    signOptions: {
      expiresIn: expiresIn as
        | `${number}d`
        | `${number}h`
        | `${number}m`
        | `${number}s`,
    },
  };
}
