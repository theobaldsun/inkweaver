/**
 * PostgreSQL 连通性探测（就绪探针用）。
 */

import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class PostgresHealthService {
  constructor(@Optional() private readonly dataSource?: DataSource) {}

  /**
   * 探测 PostgreSQL；未启用 TypeORM 时返回 skipped。
   */
  async ping(): Promise<'up' | 'down' | 'skipped'> {
    if (!this.dataSource?.isInitialized) {
      return 'skipped';
    }

    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }
}
