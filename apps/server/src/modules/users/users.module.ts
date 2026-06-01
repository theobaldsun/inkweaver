/**
 * 用户模块（骨架）。
 *
 * 用途：
 * - 作为用户系统的聚合边界：注册/登录/资料/多设备会话
 *
 * 输入：HTTP 请求
 * 输出：用户相关响应
 */

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";

import { User } from "./entity/user.entity";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UserDataService } from "./user-data.service";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { Document } from "../documents/entity/document.entity";
import { Folder } from "../documents/entity/folder.entity";
import { SearchHistory } from "../search/entity/search-history.entity";
import { Session } from "../auth/entity/session.entity";
import { SyncUpdate } from "../sync/entity/sync-update.entity";
import { DocSnapshot } from "../sync/entity/doc-snapshot.entity";
import { PasswordResetToken } from "./entity/password-reset-token.entity";
import { MailModule } from "../mail/mail.module";
import { AuthPasswordController } from "../auth/auth-password.controller";
import { getJwtModuleOptions } from '../../config/jwt.config';

@Module({
  controllers: [UsersController, AuthPasswordController],
  imports: [
    TypeOrmModule.forFeature([
      User,
      Document,
      Folder,
      SearchHistory,
      Session,
      SyncUpdate,
      DocSnapshot,
      PasswordResetToken,
    ]),
    StorageModule,
    MailModule,
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
  ],
  providers: [UsersService, UserDataService],
  exports: [UsersService],
})
export class UsersModule {}

