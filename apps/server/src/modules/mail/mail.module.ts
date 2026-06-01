/**
 * 邮件模块：Mailer + Handlebars 模板 + BullMQ 异步发信。
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'path';
import { MAIL_QUEUE } from './mail.constants';
import { MailDispatchService } from './mail-dispatch.service';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('SMTP_HOST');
        if (!host) {
          return {
            transport: { jsonTransport: true },
            defaults: {
              from: config.get<string>('SMTP_FROM', 'InkWeaver <noreply@localhost>'),
            },
            template: {
              dir: join(__dirname, 'templates'),
              adapter: new HandlebarsAdapter(),
              options: { strict: true },
            },
          };
        }

        return {
          transport: {
            host,
            port: config.get<number>('SMTP_PORT', 587),
            secure: config.get<string>('SMTP_SECURE') === 'true',
            auth: config.get<string>('SMTP_USER')
              ? {
                  user: config.get<string>('SMTP_USER'),
                  pass: config.get<string>('SMTP_PASS'),
                }
              : undefined,
          },
          defaults: {
            from: config.get<string>('SMTP_FROM', 'InkWeaver <noreply@localhost>'),
          },
          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: { strict: true },
          },
        };
      },
    }),
  ],
  providers: [MailDispatchService, MailProcessor],
  exports: [MailDispatchService],
})
export class MailModule {}
