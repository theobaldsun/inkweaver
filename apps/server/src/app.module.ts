/**
 * NestJS 根模块。
 *
 * 用途：
 * - 聚合业务模块（用户/文档/同步/AI/队列/存储等）
 * - 统一加载配置与全局能力
 *
 * 输入：进程环境变量（ConfigModule）
 * 输出：Nest 应用模块树
 */

import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule } from "@nestjs/throttler";

import { AiModule } from "./modules/ai/ai.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { HealthModule } from "./modules/health/health.module";
import { SearchModule } from "./modules/search/search.module";
import { StorageModule } from "./modules/storage/storage.module";
import { SyncModule } from "./modules/sync/sync.module";
import { UsersModule } from "./modules/users/users.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { MailModule } from "./modules/mail/mail.module";
import { getBullMqRootConfig } from "./config/redis.config";
import {
  getTypeOrmOptions,
  isTypeOrmEnabled,
} from "./config/database.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => getBullMqRootConfig(config),
    }),
    HealthModule,
    ...(isTypeOrmEnabled()
      ? [
          TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => getTypeOrmOptions(config),
          }),
          UsersModule,
          DocumentsModule,
          SearchModule,
          StorageModule,
          NotificationsModule,
          MailModule,
          AiModule,
        ]
      : []),
    SyncModule,
  ],
})
export class AppModule {}
