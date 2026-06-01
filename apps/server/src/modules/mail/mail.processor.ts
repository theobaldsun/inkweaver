/**
 * BullMQ 邮件 Worker：渲染 Handlebars 模板并发送 SMTP。
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { Job } from 'bullmq';
import { MAIL_QUEUE, type SendMailJobPayload } from './mail.constants';

@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailer: MailerService) {
    super();
  }

  /**
   * 处理单条邮件任务。
   */
  async process(job: Job<SendMailJobPayload>): Promise<void> {
    const { template, to, subject, context } = job.data;

    if (!process.env.SMTP_HOST) {
      throw new ServiceUnavailableException('邮件服务未配置（缺少 SMTP_HOST）');
    }

    await this.mailer.sendMail({
      to,
      subject,
      template: `./${template}`,
      context,
    });

    this.logger.log(`Mail sent (${template}) to ${to}, jobId=${job.id}`);
  }
}
