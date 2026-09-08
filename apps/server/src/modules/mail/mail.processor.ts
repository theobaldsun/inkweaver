/**
 * BullMQ 邮件 Worker：渲染 Handlebars 模板并发送 SMTP。
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { MailTransportService } from './mail-transport.service';
import { MAIL_QUEUE, type SendMailJobPayload } from './mail.constants';

@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailer: MailTransportService) {
    super();
  }

  /**
   * 处理单条邮件任务。
   */
  async process(job: Job<SendMailJobPayload>): Promise<void> {
    const { template, to, subject, context } = job.data;

    await this.mailer.send({ template, to, subject, context });

    this.logger.log(`Mail sent (${template}) to ${to}, jobId=${job.id}`);
  }
}
