/**
 * 认证控制器。
 *
 * 用途：
 * - 提供认证相关的 HTTP 接口
 *
 * 输入：HTTP 请求
 * 输出：JSON 响应
 */

import { Body, Controller, Post } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { AuthService } from "./auth.service";
import { CheckSessionDto } from "./dto/check-session.dto";
import { LogoutDto } from "./dto/logout.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";

@Controller("/api/auth")
@ApiTags('auth')
@ApiBearerAuth()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 刷新访问令牌。
   *
   * 输入：RefreshTokenDto
   * 输出：新的访问令牌和刷新令牌
   */
  @ApiOperation({ summary: '刷新访问令牌' })
  @ApiResponse({ status: 200, description: '刷新令牌成功' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Post("/refresh")
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return await this.authService.refreshToken(dto.refresh_token);
  }

  /**
   * 应用启动时检查会话有效性并自动刷新令牌。
   *
   * 输入：CheckSessionDto
   * 输出：会话状态和新的令牌（如果有效）
   */
  @ApiOperation({ summary: '检查会话有效性并自动刷新令牌' })
  @ApiResponse({ status: 200, description: '会话有效并已刷新令牌' })
  @ApiResponse({ status: 401, description: '未授权' })
  @Post("/check-session")
  async checkSession(@Body() dto: CheckSessionDto) {
    return await this.authService.checkSessionAndRefresh(dto.userId, dto.refresh_token);
  }

  /**
   * 退出登录：撤销当前 refresh_token 对应的服务端会话。
   */
  @ApiOperation({ summary: '退出登录' })
  @ApiResponse({ status: 200, description: '已退出登录' })
  @Post("/logout")
  async logout(@Body() dto: LogoutDto) {
    if (dto.userId && dto.refresh_token) {
      return await this.authService.logout(dto.userId, dto.refresh_token);
    }
    return { message: '已退出登录' };
  }
}