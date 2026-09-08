/**
 * 邮件模块：Mailer + Handlebars 模板 + BullMQ 异步发信。
 */

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { MailDispatchService } from './mail-dispatch.service';
import { MailTransportService } from './mail-transport.service';
import { MAIL_QUEUE } from './mail.constants';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: MAIL_QUEUE }),
  ],
  providers: [MailDispatchService, MailProcessor, MailTransportService],
  exports: [MailDispatchService],
})
export class MailModule {}
