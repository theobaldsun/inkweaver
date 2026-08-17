/**
 * 公开鉴权相关接口：忘记密码、重置密码。
 */

import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { PasswordResetToken } from '../users/entity/password-reset-token.entity';
import { MailDispatchService } from '../mail/mail-dispatch.service';
import { PASSWORD_DIGEST_REGEX } from '@inkweaver/shared';
import { IsEmail, IsString, Matches } from 'class-validator';

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

      await this.resetRepo.save(
        this.resetRepo.create({
          userId: user.id,
          tokenHash,
          expiresAt,
          usedAt: null,
        }),
      );

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
    const row = await this.resetRepo.findOne({
      where: { tokenHash, usedAt: IsNull() },
    });

    if (!row || row.expiresAt < new Date()) {
      return { message: '链接无效或已过期，请重新申请重置。', success: false };
    }

    await this.usersService.setPasswordFromReset(row.userId, dto.passwordHash);
    row.usedAt = new Date();
    await this.resetRepo.save(row);

    return { message: '密码已重置，请使用新密码登录。', success: true };
  }
}
