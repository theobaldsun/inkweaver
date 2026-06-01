/**
 * 邮件队列常量。
 */

export const MAIL_QUEUE = 'mail';

export type MailTemplateName = 'password-reset';

export interface SendMailJobPayload {
  template: MailTemplateName;
  to: string;
  subject: string;
  context: Record<string, unknown>;
}
