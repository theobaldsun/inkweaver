/**
 * Redis 连通性探测（健康检查用）。
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { getRedisConnectionOptions } from '../../config/redis.config';

@Injectable()
export class RedisHealthService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Ping Redis，返回是否可用。
   */
  async ping(): Promise<boolean> {
    const url = this.config.get<string>('REDIS_URL');
    const redis = url
      ? new Redis(url, {
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          lazyConnect: true,
        })
      : new Redis({
          ...getRedisConnectionOptions(this.config),
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          lazyConnect: true,
        });

    try {
      await redis.connect();
      const pong = await redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    } finally {
      redis.disconnect();
    }
  }
}
