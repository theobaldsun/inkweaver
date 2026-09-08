/**
 * 认证服务。
 *
 * 用途：
 * - JWT 令牌生成和验证
 * - 密码哈希和验证
 *
 * 输入：用户信息、密码、令牌
 * 输出：JWT 令牌、验证结果
 */

import { randomUUID } from "crypto";

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { SessionService, type CreateSessionData } from "./session.service";
import { verifyPasswordDigest } from "../../common/password-crypto";
import {
  getAccessTokenTtl,
  JWT_REFRESH_EXPIRES_IN,
} from "../../config/jwt.config";
import { User } from "../users/entity/user.entity";

export interface JwtPayload {
  sub: string; // 用户ID
  email: string;
  type: 'access' | 'refresh'; // 令牌类型
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  sessionId: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface CheckSessionResponse {
  isValid: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly sessionService: SessionService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * 按用户 ID 从数据库加载用户；不存在则视为未授权。
   * 输入：userId；输出：User 实体
   */
  private async requireUserById(userId: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在或已被删除');
    }
    return user;
  }

  /**
   * 验证密码传输摘要（SHA-256 十六进制）与库中 bcrypt 哈希。
   * @param passwordDigest 客户端提交的 SHA-256 摘要，非明文
   * @param hashedPassword 数据库存储的 bcrypt 哈希
   */
  async validatePassword(passwordDigest: string, hashedPassword: string): Promise<boolean> {
    return verifyPasswordDigest(passwordDigest, hashedPassword);
  }

  /**
   * 生成访问令牌
   */
  async generateAccessToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'access',
    };

    const { expiresIn } = getAccessTokenTtl();
    return this.jwtService.sign(payload, {
      expiresIn: expiresIn as `${number}d` | `${number}h` | `${number}m` | `${number}s`,
    });
  }

  /**
   * 生成刷新令牌
   */
  async generateRefreshToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      type: 'refresh',
    };

    return this.jwtService.sign(payload, {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
      jwtid: randomUUID(),
    });
  }

  /**
   * 验证 JWT 令牌
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException("无效的令牌");
    }
  }

  /**
   * 用户登录
   */
  async login(user: User, sessionData?: Partial<CreateSessionData>): Promise<LoginResponse> {
    const [access_token, refresh_token] = await Promise.all([
      this.generateAccessToken(user),
      this.generateRefreshToken(user),
    ]);

    const session = await this.sessionService.createSession({
      user,
      refreshToken: refresh_token,
      ...sessionData,
    });

    return {
      access_token,
      refresh_token,
      expires_in: getAccessTokenTtl().expiresSeconds,
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }

  /**
   * 刷新访问令牌
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    const payload = await this.verifyToken(refreshToken);
    
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException("无效的刷新令牌");
    }

    const user = await this.requireUserById(payload.sub);
    
    const [access_token, new_refresh_token] = await Promise.all([
      this.generateAccessToken(user),
      this.generateRefreshToken(user),
    ]);

    await this.sessionService.rotateRefreshToken(
      refreshToken,
      payload.sub,
      new_refresh_token,
    );

    return {
      access_token,
      refresh_token: new_refresh_token,
      expires_in: getAccessTokenTtl().expiresSeconds,
    };
  }

  /**
   * 应用启动时检查会话有效性并自动刷新令牌
   */
  async checkSessionAndRefresh(userId: string, refreshToken: string): Promise<CheckSessionResponse> {
    try {
      const payload = await this.verifyToken(refreshToken);
      if (payload.type !== 'refresh' || payload.sub !== userId) {
        return { isValid: false };
      }

      const user = await this.requireUserById(userId);
      const [access_token, new_refresh_token] = await Promise.all([
        this.generateAccessToken(user),
        this.generateRefreshToken(user),
      ]);
      await this.sessionService.rotateRefreshToken(
        refreshToken,
        userId,
        new_refresh_token,
      );

      return {
        isValid: true,
        access_token,
        refresh_token: new_refresh_token,
        expires_in: getAccessTokenTtl().expiresSeconds,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      };
    } catch {
      return { isValid: false };
    }
  }

  /**
   * 退出登录：撤销与 refresh_token 关联的会话。
   */
  async logout(userId: string, refreshToken: string): Promise<{ message: string }> {
    await this.sessionService.revokeByRefreshToken(refreshToken, userId);
    return { message: '已退出登录' };
  }
}
