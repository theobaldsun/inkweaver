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

import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";

import { getTypeOrmOptions, isTypeOrmEnabled } from "./config/database.config";
import { getBullMqRootConfig } from "./config/redis.config";
import { AiModule } from "./modules/ai/ai.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { HealthModule } from "./modules/health/health.module";
import { MailModule } from "./modules/mail/mail.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { SearchModule } from "./modules/search/search.module";
import { StorageModule } from "./modules/storage/storage.module";
import { SyncModule } from "./modules/sync/sync.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      // 集成测试通过显式环境变量装配隔离服务，禁止意外读取开发者本地 .env。
      ignoreEnvFile: process.env.NODE_ENV === "test",
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
