/**
 * 回收站定时清理服务。
 *
 * 用途：每日清理超过保留期的已软删文档。
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DocumentsService } from './documents.service';

@Injectable()
export class TrashCleanupService {
  private readonly logger = new Logger(TrashCleanupService.name);

  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * 每天凌晨 3 点清理过期回收站文档。
   */
  @Cron('0 3 * * *')
  async purgeExpiredDocuments(): Promise<void> {
    try {
      const count = await this.documentsService.purgeExpiredTrash();
      if (count > 0) {
        this.logger.log(`已永久清理 ${count} 篇过期回收站文档`);
      }
    } catch (error) {
      this.logger.error('回收站定时清理失败', error);
    }
  }
}
