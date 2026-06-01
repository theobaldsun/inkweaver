/**
 * 会话服务。
 *
 * 用途：
 * - 管理用户登录会话
 * - 处理刷新令牌的存储和验证
 * - 支持多设备登录管理
 *
 * 输入：用户信息、设备信息、令牌
 * 输出：会话记录、验证结果
 */

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcrypt";
import { MoreThan, Repository } from "typeorm";

import { Session, SessionStatus } from "./entity/session.entity";
import { User } from "../users/entity/user.entity";

export interface CreateSessionData {
  user: User;
  refreshToken: string;
  deviceType?: string;
  deviceName?: string;
  os?: string;
  browser?: string;
  ipAddress?: string;
}

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
  ) {}

  /**
   * 创建新会话
   */
  async createSession(data: CreateSessionData): Promise<Session> {
    const refreshTokenHash = await bcrypt.hash(data.refreshToken, 10);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天后

    const session = this.sessionRepository.create({
      user: data.user,
      userId: data.user.id,
      refreshTokenHash,
      deviceType: data.deviceType,
      deviceName: data.deviceName,
      os: data.os,
      browser: data.browser,
      ipAddress: data.ipAddress,
      expiresAt,
      status: SessionStatus.ACTIVE,
    });

    return this.sessionRepository.save(session);
  }

  /**
   * 验证刷新令牌
   */
  async validateRefreshToken(refreshToken: string, userId: string): Promise<Session> {
    const sessions = await this.sessionRepository.find({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        expiresAt: MoreThan(new Date()),
      },
    });

    for (const session of sessions) {
      const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      if (isValid) {
        // 更新最后活动时间
        session.lastActivityAt = new Date();
        await this.sessionRepository.save(session);
        return session;
      }
    }

    throw new UnauthorizedException("无效的刷新令牌");
  }

  /**
   * 检查会话是否有效（应用启动时使用）
   */
  async checkSessionValidity(userId: string, refreshToken: string): Promise<{ isValid: boolean; session?: Session }> {
    try {
      const session = await this.validateRefreshToken(refreshToken, userId);
      return { isValid: true, session };
    } catch (error) {
      return { isValid: false };
    }
  }

  /**
   * 获取用户的所有活跃会话
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    return this.sessionRepository.find({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        expiresAt: MoreThan(new Date()),
      },
      order: { lastActivityAt: 'DESC' },
    });
  }

  /**
   * 根据刷新令牌撤销对应会话（退出登录）。
   */
  async revokeByRefreshToken(refreshToken: string, userId: string): Promise<void> {
    try {
      const session = await this.validateRefreshToken(refreshToken, userId);
      await this.revokeSession(session.id, userId);
    } catch {
      // 令牌无效或会话已过期，视为已登出
    }
  }

  /**
   * 撤销会话（校验归属）
   */
  async revokeSession(sessionId: string, userId?: string): Promise<void> {
    const where: { id: string; userId?: string } = { id: sessionId };
    if (userId) {
      where.userId = userId;
    }
    const session = await this.sessionRepository.findOne({ where });
    if (!session) {
      throw new UnauthorizedException('会话不存在');
    }
    await this.sessionRepository.update(sessionId, {
      status: SessionStatus.REVOKED,
    });
  }

  /**
   * 撤销用户的所有会话
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.sessionRepository.update(
      { userId, status: SessionStatus.ACTIVE },
      { status: SessionStatus.REVOKED }
    );
  }

  /**
   * 清理过期会话
   */
  async cleanupExpiredSessions(): Promise<void> {
    await this.sessionRepository.update(
      { 
        status: SessionStatus.ACTIVE, 
        expiresAt: new Date() 
      },
      { status: SessionStatus.EXPIRED }
    );
  }

  /**
   * 更新会话设备信息
   */
  async updateSessionDeviceInfo(sessionId: string, deviceInfo: Partial<Session>): Promise<void> {
    await this.sessionRepository.update(sessionId, deviceInfo as Record<string, unknown>);
  }
}