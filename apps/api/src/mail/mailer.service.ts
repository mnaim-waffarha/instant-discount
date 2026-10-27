import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

/** Sends email over SMTP, or just logs it (and keeps it in `outbox`) when SMTP is not configured. */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport?: Transporter;
  /** Last messages, for development and tests. */
  readonly outbox: Mail[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.SMTP_URL) this.transport = nodemailer.createTransport(config.SMTP_URL);
  }

  async send(mail: Mail): Promise<void> {
    this.outbox.push(mail);
    if (this.outbox.length > 50) this.outbox.shift();
    if (!this.transport) {
      this.logger.log(
        `[mail not sent: SMTP_URL unset] to=${mail.to} subject="${mail.subject}"\n${mail.text}`,
      );
      return;
    }
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...mail });
  }
}
