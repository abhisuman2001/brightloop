import { addDays, nextBillingDate, todayISO, type BillingPeriod } from '../../shared/dates';
import { priceLines, type PricingTax } from '../../shared/pricing';
import type { BillingRunResult } from '../../shared/types';
import { db, nextNumber } from '../db';
import { HttpError, conflict, money, notFound } from '../http';
import { logActivity, SYSTEM_ACTOR, type Actor } from './activity';
import { appUrl, button, emailDeliveryConfigured, escapeHtml, layout, sendEmail } from './email';
import { getPlan, getSubscriptionEntity, loadDiscounts, loadLines, loadTaxes, refreshAmounts, repriceAll, toPricingLine, transition, variantLabel, type SubscriptionEntity } from './subscriptions';

const MAX_CATCH_UP_PERIODS = 1000;

interface InvoiceEntity {
  id: number;
  number: string;
  subscription_id: number;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: 'draft' | 'confirmed' | 'paid' | 'cancelled';
  total: number;
  amount_paid: number;
}

function getInvoice(id: number): InvoiceEntity {
  const invoice = db().prepare('SELECT * FROM invoices WHERE id = ?').get(id) as InvoiceEntity | undefined;
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

/** Creates the draft invoice for one period. Must run inside a transaction. */
function createInvoiceForPeriod(sub: SubscriptionEntity, period: BillingPeriod, periodStart: string, today: string, taxes: PricingTax[]) {
  const customer = db().prepare('SELECT * FROM customers WHERE id = ?').get(sub.customer_id) as {
    name: string;
    company: string;
    email: string;
    address: string;
    tax_id: string;
  };
  const entities = loadLines(sub.id);
  if (entities.length === 0) throw new Error('Subscription has no lines');
  // Discounts are re-read for every invoice so a usage limit is honoured mid-run.
  const priced = priceLines(entities.map(toPricingLine), taxes, loadDiscounts(), periodStart);
  const nextStart = nextBillingDate(sub.start_date, period, periodStart);
  let periodEnd = addDays(nextStart, -1);
  if (sub.expiry_date && periodEnd > sub.expiry_date) periodEnd = sub.expiry_date;
  const number = nextNumber('INV');
  const { lastInsertRowid } = db()
    .prepare(
      `INSERT INTO invoices (number, subscription_id, customer_id, customer_name, customer_company, customer_email, customer_address, customer_tax_id,
         period_start, period_end, issue_date, due_date, subtotal, discount_total, tax_total, total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      number,
      sub.id,
      sub.customer_id,
      customer.name,
      customer.company,
      customer.email,
      customer.address,
      customer.tax_id,
      periodStart,
      periodEnd,
      today,
      addDays(today, sub.payment_term_days),
      priced.subtotal,
      priced.discountTotal,
      priced.taxTotal,
      priced.total,
      `${today}T00:00:00.000Z`,
    );
  const invoiceId = Number(lastInsertRowid);
  const insertLine = db().prepare(
    `INSERT INTO invoice_lines (invoice_id, product_id, product_name, variant_label, quantity, unit_price, variant_extra, discount_amount, discount_name, tax_amount, tax_label, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  entities.forEach((line, i) => {
    const p = priced.lines[i];
    insertLine.run(invoiceId, line.product_id, line.product_name, variantLabel(line), line.quantity, line.unit_price, line.variant_extra, p.discount, p.discountName, p.tax, p.taxLabel, p.total);
  });
  for (const discountId of priced.appliedDiscountIds) {
    db().prepare('INSERT INTO invoice_discounts (invoice_id, discount_id) VALUES (?, ?)').run(invoiceId, discountId);
    db().prepare('UPDATE discounts SET used_count = used_count + 1 WHERE id = ?').run(discountId);
  }
  return { invoiceId, total: priced.total };
}

const periodExists = () => db().prepare(`SELECT 1 FROM invoices WHERE subscription_id = ? AND period_start = ? AND status <> 'cancelled'`);

interface BillOutcome {
  created: number[];
  skipped: number;
  amount: number;
}

/**
 * Bills every period that is due up to `today`, oldest first, so a missed run catches up rather
 * than skipping periods. A period that already has a live invoice is passed over, and the partial
 * unique index on invoices makes a double bill impossible even if this logic were ever wrong.
 */
export function billSubscription(subscriptionId: number, today: string, taxes: PricingTax[] = loadTaxes()): BillOutcome {
  return db().transaction((): BillOutcome => {
    const sub = getSubscriptionEntity(subscriptionId);
    const outcome: BillOutcome = { created: [], skipped: 0, amount: 0 };
    if (sub.status !== 'active' || sub.paused_at || !sub.next_invoice_date) return outcome;
    const { billing_period: period } = getPlan(sub.plan_id);
    const exists = periodExists();
    let cursor = sub.next_invoice_date;
    let guard = 0;
    while (cursor <= today && (!sub.expiry_date || cursor <= sub.expiry_date)) {
      if (++guard > MAX_CATCH_UP_PERIODS) throw new Error(`More than ${MAX_CATCH_UP_PERIODS} periods overdue for billing`);
      if (exists.get(sub.id, cursor)) {
        outcome.skipped++;
      } else {
        const { invoiceId, total } = createInvoiceForPeriod(sub, period, cursor, today, taxes);
        outcome.created.push(invoiceId);
        outcome.amount += total;
      }
      cursor = nextBillingDate(sub.start_date, period, cursor);
    }
    if (cursor !== sub.next_invoice_date) {
      db().prepare('UPDATE subscriptions SET next_invoice_date = ? WHERE id = ?').run(cursor, sub.id);
    }
    return outcome;
  })();
}

/** Bills the next unbilled period immediately, even ahead of its date (the "Create Invoice" action). */
export function billNextPeriod(subscriptionId: number, actor: Actor, today = todayISO()): number {
  return db().transaction(() => {
    const sub = getSubscriptionEntity(subscriptionId);
    if (sub.status !== 'active') throw conflict('Only an active subscription can be invoiced');
    if (sub.paused_at) throw conflict(`${sub.number} is paused. Resume it before invoicing.`);
    const { billing_period: period } = getPlan(sub.plan_id);
    const exists = periodExists();
    let cursor = sub.next_invoice_date ?? sub.start_date;
    while (exists.get(sub.id, cursor)) cursor = nextBillingDate(sub.start_date, period, cursor);
    if (sub.expiry_date && cursor > sub.expiry_date) {
      throw conflict(`Every period up to the expiry date (${sub.expiry_date}) has been invoiced`);
    }
    const { invoiceId } = createInvoiceForPeriod(sub, period, cursor, today, loadTaxes());
    db().prepare('UPDATE subscriptions SET next_invoice_date = ? WHERE id = ?').run(nextBillingDate(sub.start_date, period, cursor), sub.id);
    logActivity(actor, 'invoiced', 'subscription', sub.id, `Created invoice for ${sub.number}, period from ${cursor}`);
    return invoiceId;
  })();
}

export interface RunOptions {
  today?: string;
  trigger?: string;
  actor?: Actor;
  /** The seeder simulates a year day by day and only needs a reprice and record at the end. */
  light?: boolean;
}

/** The daily job: activate what has started, bill what is due, close what has ended. */
export function runBilling(options: RunOptions = {}): BillingRunResult {
  const today = options.today ?? todayISO();
  const actor = options.actor ?? SYSTEM_ACTOR;
  const trigger = options.trigger ?? 'manual';
  const at = `${today}T06:00:00.000Z`;

  const starting = db().prepare(`SELECT id FROM subscriptions WHERE status = 'confirmed' AND start_date <= ?`).all(today) as Array<{ id: number }>;
  let activated = 0;
  for (const { id } of starting) {
    transition(id, 'active', SYSTEM_ACTOR, { today, at, silent: options.light });
    activated++;
  }

  const taxes = loadTaxes();
  const due = db()
    .prepare(
      `SELECT id, number FROM subscriptions
       WHERE status = 'active' AND paused_at IS NULL AND next_invoice_date <= ?
         AND (expiry_date IS NULL OR next_invoice_date <= expiry_date)
       ORDER BY id`,
    )
    .all(today) as Array<{ id: number; number: string }>;
  let created = 0;
  let skipped = 0;
  let totalAmount = 0;
  const errors: BillingRunResult['errors'] = [];
  for (const sub of due) {
    // One transaction per subscription: a bad record is reported without stopping billing day.
    try {
      const outcome = billSubscription(sub.id, today, taxes);
      created += outcome.created.length;
      skipped += outcome.skipped;
      totalAmount += outcome.amount;
    } catch (err) {
      errors.push({ subscriptionId: sub.id, number: sub.number, message: err instanceof Error ? err.message : String(err) });
    }
  }

  const ending = db()
    .prepare(
      `SELECT s.id FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active' AND p.auto_close = 1 AND s.expiry_date < ?`,
    )
    .all(today) as Array<{ id: number }>;
  for (const { id } of ending) {
    transition(id, 'closed', { ...SYSTEM_ACTOR, isAdmin: true }, { reason: 'Term ended', today, at, silent: options.light });
  }

  if (!options.light) repriceAll(today);
  const { lastInsertRowid } = db()
    .prepare(
      `INSERT INTO billing_runs (run_date, created, skipped, failed, total_amount, closed, activated, errors_json, trigger, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(today, created, skipped, errors.length, totalAmount, ending.length, activated, JSON.stringify(errors), trigger, new Date().toISOString());
  if (!options.light) {
    logActivity(actor, 'billing_run', 'billing', Number(lastInsertRowid), `Billing run created ${created} invoices worth $${money(totalAmount)}${errors.length ? `, ${errors.length} failed` : ''}`);
  }
  return {
    id: Number(lastInsertRowid),
    runDate: today,
    created,
    skipped,
    failed: errors.length,
    totalAmount,
    closed: ending.length,
    activated,
    errors,
    trigger,
    createdAt: new Date().toISOString(),
  };
}

export function confirmInvoice(id: number, actor: Actor, silent = false) {
  const invoice = getInvoice(id);
  if (invoice.status !== 'draft') throw conflict(`${invoice.number} is ${invoice.status}, only a draft can be confirmed`);
  db().prepare(`UPDATE invoices SET status = 'confirmed' WHERE id = ?`).run(id);
  if (!silent) logActivity(actor, 'confirmed', 'invoice', id, `Confirmed ${invoice.number}`);
}

export function confirmAllDrafts(actor: Actor): number[] {
  const ids = db().prepare(`SELECT id FROM invoices WHERE status = 'draft' ORDER BY id`).all() as Array<{ id: number }>;
  db().transaction(() => {
    db().prepare(`UPDATE invoices SET status = 'confirmed' WHERE status = 'draft'`).run();
    if (ids.length) logActivity(actor, 'confirmed', 'invoice', null, `Confirmed ${ids.length} draft invoices`);
  })();
  return ids.map((r) => r.id);
}

/**
 * Cancelling gives back the discount usage and reopens the period, so the next billing run bills
 * it again correctly instead of leaving a hole. An invoice that has money against it cannot be cancelled.
 */
export function cancelInvoice(id: number, actor: Actor, today = todayISO()) {
  db().transaction(() => {
    const invoice = getInvoice(id);
    if (invoice.status === 'cancelled') throw conflict(`${invoice.number} is already cancelled`);
    if (invoice.status === 'paid' || invoice.amount_paid > 0) throw conflict(`${invoice.number} has payments recorded. Void them before cancelling.`);
    db().prepare(`UPDATE invoices SET status = 'cancelled' WHERE id = ?`).run(id);
    const used = db().prepare('SELECT discount_id FROM invoice_discounts WHERE invoice_id = ?').all(id) as Array<{ discount_id: number }>;
    for (const { discount_id } of used) {
      db().prepare('UPDATE discounts SET used_count = MAX(used_count - 1, 0) WHERE id = ?').run(discount_id);
    }
    const sub = getSubscriptionEntity(invoice.subscription_id);
    if (sub.status === 'active' && sub.next_invoice_date && invoice.period_start < sub.next_invoice_date) {
      db().prepare('UPDATE subscriptions SET next_invoice_date = ? WHERE id = ?').run(invoice.period_start, sub.id);
    }
    refreshAmounts(sub.id, getPlan(sub.plan_id).billing_period, today);
    logActivity(actor, 'cancelled', 'invoice', id, `Cancelled ${invoice.number}`);
  })();
}

export async function sendInvoice(id: number, actor: Actor) {
  const invoice = getInvoice(id);
  if (invoice.status === 'draft') throw conflict('Confirm this invoice before sending it');
  if (invoice.status === 'cancelled') throw conflict('A cancelled invoice cannot be sent');
  const link = `${appUrl()}/portal/invoices/${invoice.id}`;
  const status = await sendEmail({
    to: invoice.customer_email,
    subject: `Invoice ${invoice.number} from Brightloop Software`,
    link,
    html: layout(
      `Invoice ${invoice.number}`,
      `<p style="font-size:14px">Hello ${escapeHtml(invoice.customer_name)},</p>
       <p style="font-size:14px">Your invoice for ${invoice.period_start} to ${invoice.period_end} is ready. The total is <b>$${money(invoice.total)}</b>, due on <b>${invoice.due_date}</b>.</p>
       ${button(link, 'View invoice')}`,
    ),
  });
  if (status === 'failed') throw new HttpError(502, `The email to ${invoice.customer_email} could not be delivered`);
  db().prepare('UPDATE invoices SET sent_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  logActivity(actor, 'sent', 'invoice', id, `Sent ${invoice.number} to ${invoice.customer_email}`);
  return { status, delivered: emailDeliveryConfigured() };
}

export interface PaymentInput {
  invoiceId: number;
  method: string;
  amount: number;
  paymentDate: string;
  note: string;
}

export function recordPayment(input: PaymentInput, actor: Actor, today = todayISO(), silent = false): number {
  return db().transaction(() => {
    const invoice = getInvoice(input.invoiceId);
    if (invoice.status === 'draft') throw conflict(`Confirm ${invoice.number} before recording a payment`);
    if (invoice.status === 'cancelled') throw conflict(`${invoice.number} is cancelled`);
    if (invoice.status === 'paid') throw conflict(`${invoice.number} is already paid in full`);
    const balance = invoice.total - invoice.amount_paid;
    if (input.amount > balance) {
      throw new HttpError(422, `That is more than the $${money(balance)} still owed on ${invoice.number}`, { amount: `Balance is $${money(balance)}` });
    }
    if (input.paymentDate > today) throw new HttpError(422, 'Payment date cannot be in the future', { paymentDate: 'Cannot be in the future' });
    const { lastInsertRowid } = db()
      .prepare('INSERT INTO payments (invoice_id, method, amount, payment_date, note, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.invoiceId, input.method, input.amount, input.paymentDate, input.note, actor.id, new Date().toISOString());
    const paid = invoice.amount_paid + input.amount;
    db()
      .prepare('UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?')
      .run(paid, paid >= invoice.total ? 'paid' : 'confirmed', input.invoiceId);
    if (!silent) logActivity(actor, 'payment', 'invoice', input.invoiceId, `Recorded $${money(input.amount)} against ${invoice.number}`);
    return Number(lastInsertRowid);
  })();
}

export function voidPayment(id: number, actor: Actor) {
  db().transaction(() => {
    const payment = db().prepare('SELECT * FROM payments WHERE id = ?').get(id) as
      | { id: number; invoice_id: number; amount: number; voided_at: string | null }
      | undefined;
    if (!payment) throw notFound('Payment');
    if (payment.voided_at) throw conflict('This payment is already void');
    const invoice = getInvoice(payment.invoice_id);
    db().prepare('UPDATE payments SET voided_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    db().prepare(`UPDATE invoices SET amount_paid = amount_paid - ?, status = 'confirmed' WHERE id = ?`).run(payment.amount, payment.invoice_id);
    logActivity(actor, 'payment_void', 'invoice', payment.invoice_id, `Voided $${money(payment.amount)} on ${invoice.number}`);
  })();
}
