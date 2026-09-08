/**
 * 健康检查模块。
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HealthController } from './health.controller';
import { PostgresHealthService } from './postgres-health.service';
import { RedisHealthService } from './redis-health.service';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [RedisHealthService, PostgresHealthService],
})
export class HealthModule {}
