/**
 * 刷新令牌 DTO。
 *
 * 用途：
 * - 为刷新令牌接口提供输入校验契约
 *
 * 输入：HTTP 请求 body（JSON）
 * 输出：经过验证/转换的 DTO 实例（ValidationPipe）
 */

import { IsString } from "class-validator";
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  /**
   * 刷新令牌。
   */
  @IsString()
  @ApiProperty({ description: '刷新令牌' })
  refresh_token!: string;
}