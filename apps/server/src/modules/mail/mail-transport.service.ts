/**
 * 最小邮件传输服务。
 *
 * 仅负责读取受控 Handlebars 模板并通过 Nodemailer SMTP 发送，避免引入预览、MJML、
 * Liquid 等生产不使用的依赖链。模板名是内部联合类型，不能由 HTTP 输入任意指定。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Handlebars from 'handlebars';
import nodemailer from 'nodemailer';

import type { SendMailJobPayload } from './mail.constants';
import type { Transporter } from 'nodemailer';


@Injectable()
export class MailTransportService {
  private readonly transporter: Transporter | null;
  private readonly from: string;
  /** 模板编译缓存：模板文件只在 Worker 生命周期内读取和编译一次。 */
  private readonly templates = new Map<string, Handlebars.TemplateDelegate>();

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST')?.trim();
    this.from = config.get<string>('SMTP_FROM', 'InkWeaver <noreply@localhost>');
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: config.get<number>('SMTP_PORT', 587),
          secure: config.get<string>('SMTP_SECURE') === 'true',
          auth: config.get<string>('SMTP_USER')
            ? {
                user: config.get<string>('SMTP_USER'),
                pass: config.get<string>('SMTP_PASS'),
              }
            : undefined,
        })
      : null;
  }

  /** 发送已入队的受控模板邮件。 */
  async send(payload: SendMailJobPayload): Promise<void> {
    if (!this.transporter) {
      throw new ServiceUnavailableException('邮件服务未配置（缺少 SMTP_HOST）');
    }
    const html = (await this.getTemplate(payload.template))(payload.context);
    await this.transporter.sendMail({
      from: this.from,
      to: payload.to,
      subject: payload.subject,
      html,
      // 即使未来模板上下文扩展，也禁止 Nodemailer 从 URL 或本地路径取内容。
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  /** 从构建产物的受控模板目录读取并缓存模板。 */
  private async getTemplate(name: SendMailJobPayload['template']): Promise<Handlebars.TemplateDelegate> {
    const cached = this.templates.get(name);
    if (cached) return cached;
    const source = await readFile(join(__dirname, 'templates', `${name}.hbs`), 'utf8');
    const compiled = Handlebars.compile(source, { strict: true });
    this.templates.set(name, compiled);
    return compiled;
  }
}
