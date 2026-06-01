/**
 * 存储模块。
 *
 * 用途：对象存储策略与用户存储用量统计。
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entity/user.entity';
import { Document } from '../documents/entity/document.entity';
import { Folder } from '../documents/entity/folder.entity';
import { StorageController } from './storage.controller';
import { StorageUsageService } from './storage-usage.service';
import { StorageAssetService } from './storage-asset.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { getJwtModuleOptions } from '../../config/jwt.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Document, Folder]),
    NotificationsModule,
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
  ],
  controllers: [StorageController],
  providers: [StorageUsageService, StorageAssetService],
  exports: [StorageUsageService, StorageAssetService],
})
export class StorageModule {}
