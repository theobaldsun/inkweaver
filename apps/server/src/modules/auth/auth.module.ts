/**
 * 认证模块。
 *
 * 用途：
 * - 配置 JWT 认证与会话
 * - 提供 AuthService / SessionService / AuthGuard
 *
 * 输入：JWT 配置、Session / User 实体
 * 输出：认证相关 providers（供 UsersModule 等导入）
 */

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";

import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { AuthController } from "./auth.controller";
import { Session } from "./entity/session.entity";
import { AuthGuard } from "./guard/auth.guard";
import { User } from "../users/entity/user.entity";
import { getJwtModuleOptions } from '../../config/jwt.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => getJwtModuleOptions(configService),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthGuard],
  exports: [AuthService, SessionService, AuthGuard, JwtModule],
})
export class AuthModule {}
