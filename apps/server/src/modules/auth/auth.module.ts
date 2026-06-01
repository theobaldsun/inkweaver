/**
 * 认证模块。
 *
 * 用途：
 * - 配置 JWT 认证
 * - 提供认证相关服务
 *
 * 输入：JWT 配置
 * 输出：认证服务
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
import { getJwtModuleOptions } from '../../config/jwt.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session]),
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