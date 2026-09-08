/**
 * 邮件入队服务：HTTP 层只 enqueue，不阻塞 SMTP。
 */

import { createHash } from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';


import { MAIL_QUEUE, type SendMailJobPayload } from './mail.constants';

@Injectable()
export class MailDispatchService {
  private readonly logger = new Logger(MailDispatchService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE)
    private readonly mailQueue: Queue<SendMailJobPayload>,
  ) {}

  /**
   * 将密码重置邮件加入队列。
   * @param to 收件人邮箱
   * @param resetUrl 重置链接
   * @param dedupeKey 幂等键（如 tokenHash）
   */
  async enqueuePasswordReset(to: string, resetUrl: string, dedupeKey: string): Promise<void> {
    const jobId = createHash('sha256')
      .update(`password-reset:${to}:${dedupeKey}`)
      .digest('hex');

    await this.mailQueue.add(
      'send',
      {
        template: 'password-reset',
        to,
        subject: 'InkWeaver 密码重置',
        context: { resetUrl },
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    this.logger.log(`Password reset mail enqueued for ${to}`);
  }
}
