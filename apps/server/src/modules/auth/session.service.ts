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

import { createHash } from "crypto";

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcrypt";
import { LessThan, MoreThan, IsNull, Repository } from "typeorm";

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
   *
   * 同时写入 bcrypt 哈希（用于最终安全校验）和 SHA-256 哈希（用于索引定位），
   * 避免 validateRefreshToken 对全部活跃会话逐条 bcrypt 扫描。
   */
  async createSession(data: CreateSessionData): Promise<Session> {
    const refreshTokenHash = await bcrypt.hash(data.refreshToken, 10);
    const refreshTokenLookup = createHash('sha256').update(data.refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天后

    const session = this.sessionRepository.create({
      user: data.user,
      userId: data.user.id,
      refreshTokenHash,
      refreshTokenLookup,
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
   *
   * 策略：先用 SHA-256 哈希在索引列上定位候选会话（O(1)），
   * 再对命中的会话做单次 bcrypt.compare 校验。
   * 兼容历史数据：refreshTokenLookup 为空时回退为全量扫描（一次性迁移后不再触发）。
   */
  async validateRefreshToken(refreshToken: string, userId: string): Promise<Session> {
    const lookup = createHash('sha256').update(refreshToken).digest('hex');

    // 优先走索引定位：命中后只做 1 次 bcrypt
    const candidates = await this.sessionRepository.find({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        expiresAt: MoreThan(new Date()),
        refreshTokenLookup: lookup,
      },
    });

    for (const session of candidates) {
      const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      if (isValid) {
        session.lastActivityAt = new Date();
        await this.sessionRepository.save(session);
        return session;
      }
    }

    // 回退：历史数据 refreshTokenLookup 为空，逐条扫描 bcrypt
    if (candidates.length === 0) {
      const legacySessions = await this.sessionRepository.find({
        where: {
          userId,
          status: SessionStatus.ACTIVE,
          expiresAt: MoreThan(new Date()),
          refreshTokenLookup: IsNull(),
        },
      });

      for (const session of legacySessions) {
        const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
        if (isValid) {
          // 命中后回填 lookup，避免下次再次扫描
          session.refreshTokenLookup = lookup;
          session.lastActivityAt = new Date();
          await this.sessionRepository.save(session);
          return session;
        }
      }
    }

    throw new UnauthorizedException("无效的刷新令牌");
  }

  /**
   * 原子轮换刷新令牌。
   *
   * 先按旧 lookup 定位并校验 bcrypt，再以旧 lookup 作为条件写入新哈希、lookup 和
   * 有效期。并发请求即使同时通过 JWT 校验，也只有一个能消费旧令牌。
   */
  async rotateRefreshToken(
    refreshToken: string,
    userId: string,
    newRefreshToken: string,
  ): Promise<Session> {
    const oldLookup = createHash('sha256').update(refreshToken).digest('hex');
    const newLookup = createHash('sha256').update(newRefreshToken).digest('hex');
    const newHash = await bcrypt.hash(newRefreshToken, 10);
    const now = new Date();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    return this.sessionRepository.manager.transaction(async (manager) => {
      let session = await manager.findOne(Session, {
        where: {
          userId,
          status: SessionStatus.ACTIVE,
          expiresAt: MoreThan(now),
          refreshTokenLookup: oldLookup,
        },
        lock: { mode: 'pessimistic_write' },
      });

      let legacy = false;
      if (!session) {
        // 历史行没有 lookup；条件更新仍会保证并发时只能有一个请求完成轮换。
        const legacySessions = await manager.find(Session, {
          where: {
            userId,
            status: SessionStatus.ACTIVE,
            expiresAt: MoreThan(now),
            refreshTokenLookup: IsNull(),
          },
        });
        for (const candidate of legacySessions) {
          if (await bcrypt.compare(refreshToken, candidate.refreshTokenHash)) {
            session = candidate;
            legacy = true;
            break;
          }
        }
      }

      if (!session || !(await bcrypt.compare(refreshToken, session.refreshTokenHash))) {
        throw new UnauthorizedException('无效的刷新令牌');
      }

      const result = await manager.update(
        Session,
        {
          id: session.id,
          userId,
          status: SessionStatus.ACTIVE,
          refreshTokenLookup: legacy ? IsNull() : oldLookup,
        },
        {
          refreshTokenHash: newHash,
          refreshTokenLookup: newLookup,
          expiresAt,
          lastActivityAt: now,
        },
      );
      if (result.affected !== 1) {
        throw new UnauthorizedException('刷新令牌已被使用');
      }

      return Object.assign(session, {
        refreshTokenHash: newHash,
        refreshTokenLookup: newLookup,
        expiresAt,
        lastActivityAt: now,
      });
    });
  }

  /**
   * 检查会话是否有效（应用启动时使用）
   */
  async checkSessionValidity(userId: string, refreshToken: string): Promise<{ isValid: boolean; session?: Session }> {
    try {
      const session = await this.validateRefreshToken(refreshToken, userId);
      return { isValid: true, session };
    } catch {
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
        expiresAt: LessThan(new Date())
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
