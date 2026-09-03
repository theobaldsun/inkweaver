/**
 * 同步模块。
 *
 * 用途：
 * - REST：`/api/sync/push`、`/api/sync/pull`（校验、冲突水位、投影与快照调度）
 * - WebSocket：Socket.IO 命名空间 `/sync`（加入房间、实时 update）
 *
 * 输入：鉴权后的文档变更 / 同步水位
 * 输出：持久化更新、快照/增量拉取结果、房间广播
 */

import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DocumentProjectionService } from './document-projection.service';
import { DocSnapshot } from "./entity/doc-snapshot.entity";
import { SyncUpdate } from "./entity/sync-update.entity";
import { SnapshotService } from "./snapshot.service";
import { SyncController } from "./sync.controller";
import { SyncGateway } from "./sync.gateway";
import { getJwtModuleOptions } from '../../config/jwt.config';
import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([SyncUpdate, DocSnapshot]),
    StorageModule,
    // DocumentsService 与 SyncGateway 双向协作，模块两端都必须延迟解析。
    forwardRef(() => DocumentsModule),
    AuthModule,
    JwtModule.register(getJwtModuleOptions()),
  ],
  controllers: [SyncController],
  providers: [SyncGateway, SnapshotService, DocumentProjectionService],
  exports: [SyncGateway],
})
export class SyncModule {}
