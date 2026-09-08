/**
 * 用户控制器
 *
 * 用途：注册/登录/资料/偏好/头像/数据导出/会话管理
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

import { parseClientMeta } from '../../common/parse-client-meta';
import { AuthGuard } from '../auth/guard/auth.guard';
import { SessionService } from '../auth/session.service';
import { ChangePasswordDto } from './dto/changePassword.dto';
import { CreateUserDto } from './dto/createUser.dto';
import { DeleteWithPasswordDto } from './dto/delete-with-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UpdateUserDto } from './dto/updateUser.dto';
import { UserDataService } from './user-data.service';
import { UsersService } from './users.service';
import { getUserId } from '../../common/get-user-id';

import type { Request as ExpressRequest, Response } from 'express';

@Controller('/api/users')
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(ThrottlerGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userDataService: UserDataService,
    private readonly sessionService: SessionService,
  ) {}

  @ApiOperation({ summary: '注册用户' })
  @Post('/register')
  async register(@Body() dto: CreateUserDto, @Request() req: ExpressRequest) {
    const clientMeta = parseClientMeta(
      req.headers['user-agent'],
      req.ip ?? req.socket?.remoteAddress,
    );
    return await this.usersService.register(dto.email, dto.passwordHash, dto.name, clientMeta);
  }

  @ApiOperation({ summary: '用户登录' })
  @Post('/login')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async login(@Body() dto: LoginDto, @Request() req: ExpressRequest) {
    const clientMeta = parseClientMeta(
      req.headers['user-agent'],
      req.ip ?? req.socket?.remoteAddress,
    );
    return await this.usersService.login(dto.email, dto.passwordHash, clientMeta);
  }

  @UseGuards(AuthGuard)
  @Get('/profile')
  async getProfile(@Request() req: ExpressRequest) {
    return this.usersService.getUserProfile(getUserId(req.user as { sub?: string; id?: string }));
  }

  @UseGuards(AuthGuard)
  @Put('/profile')
  async updateProfile(@Request() req: ExpressRequest, @Body() dto: UpdateUserDto) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.usersService.updateUser(userId, dto);
  }

  @UseGuards(AuthGuard)
  @Post('/change-password')
  async changePassword(@Request() req: ExpressRequest, @Body() dto: ChangePasswordDto) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    await this.usersService.changePassword(userId, dto.oldPasswordHash, dto.newPasswordHash);
    return { message: '密码已更新，请使用新密码重新登录' };
  }

  @UseGuards(AuthGuard)
  @Get('/storage')
  async getStorageStats(@Request() req: ExpressRequest) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.usersService.getUserStorageStats(userId);
  }

  @UseGuards(AuthGuard)
  @Get('/preferences')
  async getPreferences(@Request() req: ExpressRequest) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.usersService.getUserSettings(userId);
  }

  @UseGuards(AuthGuard)
  @Put('/preferences')
  async updatePreferences(@Request() req: ExpressRequest, @Body() dto: UpdateUserSettingsDto) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.usersService.updateUserSettings(userId, dto);
  }

  @UseGuards(AuthGuard)
  @Post('/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(
    @Request() req: ExpressRequest,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    if (!file) {
      throw new BadRequestException('请上传图片文件');
    }
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.usersService.updateAvatar(userId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @UseGuards(AuthGuard)
  @Post('/export')
  async exportData(@Request() req: ExpressRequest, @Body() dto: DeleteWithPasswordDto, @Res() res: Response) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    const data = await this.userDataService.exportUserData(userId, dto.passwordHash);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inkweaver-export-${date}.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @UseGuards(AuthGuard)
  @Delete('/data')
  async deleteAllData(@Request() req: ExpressRequest, @Body() dto: DeleteWithPasswordDto) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.userDataService.purgeUserData(userId, dto.passwordHash);
  }

  @UseGuards(AuthGuard)
  @Delete('/account')
  async deleteAccount(@Request() req: ExpressRequest, @Body() dto: DeleteWithPasswordDto) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.userDataService.deleteUserAccount(userId, dto.passwordHash);
  }

  @UseGuards(AuthGuard)
  @Get('/sessions')
  async getSessions(
    @Request() req: ExpressRequest,
    @Query('currentSessionId') currentSessionId?: string,
  ) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    const sessions = await this.sessionService.getUserSessions(userId);
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        deviceType: s.deviceType,
        deviceName: s.deviceName,
        os: s.os,
        browser: s.browser,
        ipAddress: s.ipAddress,
        lastActivityAt: s.lastActivityAt,
        createdAt: s.createdAt,
        isCurrent: currentSessionId ? s.id === currentSessionId : false,
      })),
    };
  }

  @UseGuards(AuthGuard)
  @Delete('/sessions/:sessionId')
  async revokeSession(
    @Request() req: ExpressRequest,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    await this.sessionService.revokeSession(sessionId, userId);
    return { message: '会话已撤销' };
  }

  @UseGuards(AuthGuard)
  @Delete('/sessions')
  async revokeAllSessions(
    @Request() req: ExpressRequest,
    @Query('exceptSessionId') exceptSessionId?: string,
  ) {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    const sessions = await this.sessionService.getUserSessions(userId);
    for (const session of sessions) {
      if (exceptSessionId && session.id === exceptSessionId) {
        continue;
      }
      await this.sessionService.revokeSession(session.id, userId);
    }
    return { message: '已撤销其他会话' };
  }
}
