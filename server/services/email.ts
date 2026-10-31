import nodemailer from 'nodemailer';
import { db } from '../db';

const smtpUrl = () => process.env.SMTP_URL;
let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export const appUrl = () => (process.env.APP_URL ?? `http://localhost:${process.env.NODE_ENV === 'production' ? (process.env.PORT ?? 4000) : 5173}`).replace(/\/$/, '');
export const emailDeliveryConfigured = () => Boolean(smtpUrl());

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function layout(title: string, body: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <p style="font-weight:600;font-size:14px;color:#4f46e5">Brightloop Software</p>
  <h1 style="font-size:18px;margin:16px 0">${escapeHtml(title)}</h1>
  ${body}
  <p style="margin-top:32px;font-size:12px;color:#64748b">Sent by Brightloop Software billing.</p>
</div>`;
}

export function button(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none;font-size:14px">${escapeHtml(label)}</a></p>`;
}

interface Mail {
  to: string;
  subject: string;
  html: string;
  /** The primary link in the message. Kept in the log so it is recoverable before SMTP is set up. */
  link?: string;
}

/**
 * Sends a message and records the outcome. Never throws: a mail outage must not roll back a
 * billing or password flow. Returns the recorded status so callers can tell the user the truth.
 */
export async function sendEmail(mail: Mail): Promise<'sent' | 'logged' | 'failed'> {
  let status: 'sent' | 'logged' | 'failed' = 'logged';
  let error: string | null = null;
  if (smtpUrl()) {
    try {
      transport ??= nodemailer.createTransport(smtpUrl());
      await transport.sendMail({
        from: process.env.MAIL_FROM ?? 'Brightloop Billing <billing@brightloop.dev>',
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
      });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
      console.error(`Email to ${mail.to} failed: ${error}`);
    }
  } else if (process.env.NODE_ENV !== 'test') {
    console.log(`[email not delivered: SMTP_URL unset] to=${mail.to} subject="${mail.subject}"${mail.link ? ` link=${mail.link}` : ''}`);
  }
  db()
    .prepare('INSERT INTO email_log (recipient, subject, status, error, link, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(mail.to, mail.subject, status, error, mail.link ?? null, new Date().toISOString());
  return status;
}
