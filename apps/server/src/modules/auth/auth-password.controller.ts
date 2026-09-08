/**
 * 公开鉴权相关接口：忘记密码、重置密码。
 */

import { createHash, randomBytes } from 'crypto';

import { PASSWORD_DIGEST_REGEX } from '@inkweaver/shared';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { IsEmail, IsString, Matches } from 'class-validator';
import { IsNull, MoreThan, Repository } from 'typeorm';

import { MailDispatchService } from '../mail/mail-dispatch.service';
import { Session, SessionStatus } from './entity/session.entity';
import { hashDigestForStorage } from '../../common/password-crypto';
import { PasswordResetToken } from '../users/entity/password-reset-token.entity';
import { User } from '../users/entity/user.entity';
import { UsersService } from '../users/users.service';


class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @Matches(PASSWORD_DIGEST_REGEX, { message: '密码格式无效' })
  passwordHash!: string;
}

@Controller('/api/auth')
@UseGuards(ThrottlerGuard)
export class AuthPasswordController {
  constructor(
    private readonly usersService: UsersService,
    private readonly mailDispatch: MailDispatchService,
    @InjectRepository(PasswordResetToken)
    private readonly resetRepo: Repository<PasswordResetToken>,
  ) {}

  @Post('/forgot-password')
  @HttpCode(200)
  @Throttle({ default: { ttl: 300000, limit: 3 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (user) {
      const plainToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(plainToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await this.resetRepo.manager.transaction(async (manager) => {
        // 仅保留最新重置链接有效，避免旧邮件在新申请后仍可修改密码。
        await manager.update(
          PasswordResetToken,
          { userId: user.id, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
          { usedAt: new Date() },
        );
        await manager.save(
          PasswordResetToken,
          manager.create(PasswordResetToken, {
            userId: user.id,
            tokenHash,
            expiresAt,
            usedAt: null,
          }),
        );
      });

      const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3003';
      const resetUrl = `${base}/reset-password?token=${plainToken}`;
      await this.mailDispatch.enqueuePasswordReset(user.email, resetUrl, tokenHash);
    }

    return {
      message: '若该邮箱已注册，您将收到重置密码邮件，请查收。',
    };
  }

  @Post('/reset-password')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const password = await hashDigestForStorage(dto.passwordHash);
    const consumed = await this.resetRepo.manager.transaction(async (manager) => {
      const now = new Date();
      const result = await manager
        .createQueryBuilder()
        .update(PasswordResetToken)
        .set({ usedAt: now })
        .where('"tokenHash" = :tokenHash', { tokenHash })
        .andWhere('"usedAt" IS NULL')
        .andWhere('"expiresAt" > :now', { now })
        .returning(['userId'])
        .execute();
      const userId = (result.raw[0] as { userId?: string } | undefined)?.userId;
      if (!userId) return false;

      const userResult = await manager.update(User, { id: userId }, { password });
      if (userResult.affected !== 1) {
        throw new Error('密码重置用户不存在');
      }
      await manager.update(
        Session,
        { userId, status: SessionStatus.ACTIVE },
        { status: SessionStatus.REVOKED },
      );
      return true;
    });

    if (!consumed) {
      return { message: '链接无效或已过期，请重新申请重置。', success: false };
    }

    return { message: '密码已重置，请使用新密码登录。', success: true };
  }
}
