/**
 * 同步模块（骨架）。
 *
 * 用途：
 * - 提供同步相关接口：push/pull（MVP：REST；后续：WebSocket 网关）
 *
 * 输入：HTTP 请求（变更列表/同步水位）
 * 输出：ackSeq / changes/**
 * 同步模块
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";

import { SyncController } from "./sync.controller";
import { SyncGateway } from "./sync.gateway";
import { SnapshotService } from "./snapshot.service";
import { DocumentProjectionService } from './document-projection.service';
import { SyncUpdate } from "./entity/sync-update.entity";
import { DocSnapshot } from "./entity/doc-snapshot.entity";
import { StorageModule } from "../storage/storage.module";
import { DocumentsModule } from "../documents/documents.module";
import { getJwtModuleOptions } from '../../config/jwt.config';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([SyncUpdate, DocSnapshot]),
    StorageModule,
    DocumentsModule,
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
  ],
  controllers: [SyncController],
  providers: [SyncGateway, SnapshotService, DocumentProjectionService],
})
export class SyncModule {}

