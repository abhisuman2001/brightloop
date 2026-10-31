import { addDays, todayISO } from '../../shared/dates';
import { db } from '../db';
import { conflict, money, notFound } from '../http';
import { logActivity, SYSTEM_ACTOR, type Actor } from './activity';
import { appUrl, button, escapeHtml, layout, sendEmail } from './email';

// Days past due and days before expiry. Matching exact days keeps the volume low, and the
// reminders table means a restart or a second run on the same day never sends one twice.
const OVERDUE_STAGES = [1, 7, 14, 30];
const RENEWAL_STAGES = [14, 7, 1];

interface OverdueInvoice {
  id: number;
  number: string;
  customer_name: string;
  customer_email: string;
  due_date: string;
  balance: number;
}

const OVERDUE_SELECT = `SELECT id, number, customer_name, customer_email, due_date, total - amount_paid AS balance FROM invoices`;

function sendOverdue(invoice: OverdueInvoice) {
  const link = `${appUrl()}/portal/invoices/${invoice.id}`;
  return sendEmail({
    to: invoice.customer_email,
    subject: `Payment reminder: invoice ${invoice.number} is overdue`,
    link,
    html: layout(
      `Invoice ${invoice.number} is overdue`,
      `<p style="font-size:14px">Hello ${escapeHtml(invoice.customer_name)},</p>
       <p style="font-size:14px"><b>₹${money(invoice.balance)}</b> was due on <b>${invoice.due_date}</b>. If you have already paid, please ignore this message.</p>
       ${button(link, 'View and pay')}`,
    ),
  });
}

const markSent = (id: number) => db().prepare('UPDATE invoices SET last_reminder_at = ? WHERE id = ?').run(new Date().toISOString(), id);

/** The "Send reminder" button: a person decided to chase this one now, so no schedule applies. */
export async function remindInvoice(id: number, actor: Actor) {
  const invoice = db().prepare(`${OVERDUE_SELECT} WHERE id = ? AND status = 'confirmed'`).get(id) as OverdueInvoice | undefined;
  if (!invoice) {
    if (!db().prepare('SELECT 1 FROM invoices WHERE id = ?').get(id)) throw notFound('Invoice');
    throw conflict('Only a confirmed invoice with money still owed can be chased');
  }
  const status = await sendOverdue(invoice);
  if (status !== 'failed') {
    markSent(id);
    logActivity(actor, 'reminder', 'invoice', id, `Sent a payment reminder for ${invoice.number} to ${invoice.customer_email}`);
  }
  return status;
}

export interface ReminderRun {
  overdue: number;
  renewals: number;
  failed: number;
}

/** Sends whatever falls due today. Safe to repeat: each stage goes out once per invoice or subscription. */
export async function runReminders(today = todayISO()): Promise<ReminderRun> {
  const run: ReminderRun = { overdue: 0, renewals: 0, failed: 0 };
  const claim = db().prepare(`INSERT OR IGNORE INTO reminders (kind, entity_id, stage, sent_at) VALUES (?, ?, ?, ?)`);
  const release = db().prepare('DELETE FROM reminders WHERE kind = ? AND entity_id = ? AND stage = ?');

  for (const stage of OVERDUE_STAGES) {
    const invoices = db().prepare(`${OVERDUE_SELECT} WHERE status = 'confirmed' AND due_date = ?`).all(addDays(today, -stage)) as OverdueInvoice[];
    for (const invoice of invoices) {
      if (claim.run('overdue', invoice.id, stage, new Date().toISOString()).changes === 0) continue;
      if ((await sendOverdue(invoice)) === 'failed') {
        release.run('overdue', invoice.id, stage);
        run.failed++;
      } else {
        markSent(invoice.id);
        run.overdue++;
      }
    }
  }

  for (const stage of RENEWAL_STAGES) {
    const subs = db()
      .prepare(
        `SELECT s.id, s.number, s.expiry_date, c.name, c.email, p.name AS plan FROM subscriptions s
         JOIN customers c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
         WHERE s.status = 'active' AND s.paused_at IS NULL AND p.renewable = 1 AND s.expiry_date = ?`,
      )
      .all(addDays(today, stage)) as Array<{ id: number; number: string; expiry_date: string; name: string; email: string; plan: string }>;
    for (const sub of subs) {
      if (claim.run('renewal', sub.id, stage, new Date().toISOString()).changes === 0) continue;
      const link = `${appUrl()}/portal/subscriptions/${sub.id}`;
      const status = await sendEmail({
        to: sub.email,
        subject: `Your ${sub.plan} subscription ends in ${stage} day${stage === 1 ? '' : 's'}`,
        link,
        html: layout(
          `${sub.number} ends on ${sub.expiry_date}`,
          `<p style="font-size:14px">Hello ${escapeHtml(sub.name)}, your ${escapeHtml(sub.plan)} subscription ends on <b>${sub.expiry_date}</b>. Renew it to keep everything running.</p>${button(link, 'Renew now')}`,
        ),
      });
      if (status === 'failed') {
        release.run('renewal', sub.id, stage);
        run.failed++;
      } else {
        run.renewals++;
      }
    }
  }

  if (run.overdue || run.renewals) logActivity(SYSTEM_ACTOR, 'reminder', 'billing', null, `Sent ${run.overdue} payment and ${run.renewals} renewal reminders`);
  return run;
}
