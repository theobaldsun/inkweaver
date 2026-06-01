/**
 * JWT 模块统一配置（避免各子模块硬编码不同 secret）。
 */

import { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';

/**
 * 构建 JwtModule 注册选项。
 */
export function getJwtModuleOptions(config?: ConfigService): JwtModuleOptions {
  const secret =
    config?.get<string>('JWT_SECRET') ??
    process.env.JWT_SECRET ??
    'fallback-secret-key';
  const expiresIn =
    config?.get<string>('JWT_EXPIRES_IN') ??
    process.env.JWT_EXPIRES_IN ??
    '7d';

  return {
    secret,
    signOptions: { expiresIn: expiresIn as `${number}d` | `${number}h` | `${number}m` | `${number}s` },
  };
}
