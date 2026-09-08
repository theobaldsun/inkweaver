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

import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DocumentsPublicController } from "./documents-public.controller";
import { DocumentsTrashController } from "./documents-trash.controller";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { Document } from "./entity/document.entity";
import { Folder } from "./entity/folder.entity";
import { FoldersController } from "./folders.controller";
import { FoldersService } from "./folders.service";
import { TrashCleanupService } from "./trash-cleanup.service";
import { getJwtModuleOptions } from '../../config/jwt.config';
import { NotificationsModule } from "../notifications/notifications.module";
import { StorageModule } from "../storage/storage.module";
import { DocSnapshot } from "../sync/entity/doc-snapshot.entity";
import { SyncUpdate } from "../sync/entity/sync-update.entity";
import { SyncModule } from "../sync/sync.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Folder, SyncUpdate, DocSnapshot]),
    StorageModule,
    NotificationsModule,
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
    forwardRef(() => AiModule),
    forwardRef(() => SyncModule),
  ],
  controllers: [DocumentsTrashController, DocumentsController, DocumentsPublicController, FoldersController],
  providers: [DocumentsService, FoldersService, TrashCleanupService],
  exports: [DocumentsService],
})
export class DocumentsModule {}

