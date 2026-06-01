/**
 * 文档模块
 *
 * 用途：
 * - 聚合文档 CRUD、搜索、分享协作等能力
 * - 集成数据库与权限系统
 *
 * 输入：HTTP 请求
 * 输出：文档相关响应
 */

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";

import { DocumentsController } from "./documents.controller";
import { DocumentsTrashController } from "./documents-trash.controller";
import { DocumentsService } from "./documents.service";
import { Document } from "./entity/document.entity";
import { Folder } from "./entity/folder.entity";
import { SyncUpdate } from "../sync/entity/sync-update.entity";
import { DocSnapshot } from "../sync/entity/doc-snapshot.entity";
import { FoldersController } from "./folders.controller";
import { FoldersService } from "./folders.service";
import { TrashCleanupService } from "./trash-cleanup.service";
import { StorageModule } from "../storage/storage.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { DocumentsPublicController } from "./documents-public.controller";

import { getJwtModuleOptions } from '../../config/jwt.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Folder, SyncUpdate, DocSnapshot]),
    StorageModule,
    NotificationsModule,
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
  ],
  controllers: [DocumentsTrashController, DocumentsController, DocumentsPublicController, FoldersController],
  providers: [DocumentsService, FoldersService, TrashCleanupService],
  exports: [DocumentsService],
})
export class DocumentsModule {}

