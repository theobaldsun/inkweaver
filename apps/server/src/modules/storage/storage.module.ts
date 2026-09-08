/**
 * 存储模块。
 *
 * 用途：对象存储策略与用户存储用量统计。
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ObjectStorageService } from './object-storage.service';
import { StorageAssetService } from './storage-asset.service';
import { StorageUsageService } from './storage-usage.service';
import { StorageController } from './storage.controller';
import { getJwtModuleOptions } from '../../config/jwt.config';
import { AuthModule } from '../auth/auth.module';
import { Document } from '../documents/entity/document.entity';
import { Folder } from '../documents/entity/folder.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entity/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Document, Folder]),
    NotificationsModule,
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
  ],
  controllers: [StorageController],
  providers: [StorageUsageService, StorageAssetService, ObjectStorageService],
  exports: [StorageUsageService, StorageAssetService, ObjectStorageService],
})
export class StorageModule {}
