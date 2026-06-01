/**
 * 健康检查控制器。
 */

import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { RedisHealthService } from './redis-health.service';
import { PostgresHealthService } from './postgres-health.service';

@Controller()
export class HealthController {
  constructor(
    private readonly redisHealth: RedisHealthService,
    private readonly postgresHealth: PostgresHealthService,
  ) {}

  /**
   * 存活探针：仅进程是否响应。
   */
  @Get('/healthz')
  healthz(): { ok: true; service: string; timeMs: number } {
    return { ok: true, service: 'syncbox-server', timeMs: Date.now() };
  }

  /**
   * 就绪探针：Redis + PostgreSQL 连通性。
   */
  @Get('/readyz')
  async readyz(): Promise<{
    ok: boolean;
    service: string;
    redis: 'up' | 'down';
    postgres: 'up' | 'down' | 'skipped';
    timeMs: number;
  }> {
    const [redisOk, postgresStatus] = await Promise.all([
      this.redisHealth.ping(),
      this.postgresHealth.ping(),
    ]);
    const timeMs = Date.now();

    const postgresDown = postgresStatus === 'down';
    if (!redisOk || postgresDown) {
      throw new ServiceUnavailableException({
        ok: false,
        service: 'syncbox-server',
        redis: redisOk ? 'up' : 'down',
        postgres: postgresStatus,
        timeMs,
      });
    }

    return {
      ok: true,
      service: 'syncbox-server',
      redis: 'up',
      postgres: postgresStatus,
      timeMs,
    };
  }
}
