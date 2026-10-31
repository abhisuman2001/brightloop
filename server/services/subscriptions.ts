import { z } from 'zod';
import { addDays, daysBetween, firstBillingDateOnOrAfter, isBillableDate, toMonthly, todayISO, type BillingPeriod } from '../../shared/dates';
import { priceLines, taxesForSale, type PricingDiscount, type PricingLine, type PricingTax } from '../../shared/pricing';
import { subscriptionSchema } from '../../shared/schemas';
import type { InvoiceRow, SubscriptionDetail, SubscriptionLine, SubscriptionRow, SubscriptionStatus } from '../../shared/types';
import { db, nextNumber } from '../db';
import { HttpError, conflict, notFound } from '../http';
import { logActivity, type Actor } from './activity';
import { sellerInfo } from './company';

export type SubscriptionInput = z.output<typeof subscriptionSchema>;

export interface PlanRow {
  id: number;
  name: string;
  product_id: number;
  price: number;
  billing_period: BillingPeriod;
  min_quantity: number;
  start_date: string | null;
  end_date: string | null;
  auto_close: number;
  closable: number;
  pausable: number;
  renewable: number;
  active: number;
}

export interface SubscriptionEntity {
  id: number;
  number: string;
  customer_id: number;
  plan_id: number;
  template_id: number | null;
  start_date: string;
  expiry_date: string | null;
  payment_term_days: number;
  validity_days: number;
  status: SubscriptionStatus;
  quote_valid_until: string | null;
  next_invoice_date: string | null;
  paused_at: string | null;
  activated_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  notes: string;
  recurring_amount: number;
  monthly_amount: number;
  term_days: number | null;
}

/** SQL twin of isBillableDate, for queries that join subscriptions as s and plans as p. */
export const BILLABLE_SQL = `(s.expiry_date IS NULL OR s.next_invoice_date < s.expiry_date
  OR (s.next_invoice_date = s.expiry_date AND (s.next_invoice_date = s.start_date OR p.billing_period = 'daily')))`;

export interface LineEntity {
  id: number;
  subscription_id: number;
  product_id: number;
  variant_id: number | null;
  quantity: number;
  unit_price: number;
  variant_extra: number;
  is_plan_line: number;
  product_name: string;
  product_type: string;
  product_hsn: string;
  variant_attribute: string | null;
  variant_value: string | null;
}

export function getPlan(id: number): PlanRow {
  const plan = db().prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
  if (!plan) throw notFound('Plan');
  return plan;
}

export function getSubscriptionEntity(id: number): SubscriptionEntity {
  const sub = db().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as SubscriptionEntity | undefined;
  if (!sub) throw notFound('Subscription');
  return sub;
}

export function loadTaxes(): PricingTax[] {
  return db()
    .prepare('SELECT id, name, rate_bps AS rateBps, product_type AS productType, supply FROM tax_rules WHERE active = 1')
    .all() as PricingTax[];
}

/** The live rules that apply to a sale to this customer. */
export function taxesForCustomer(taxes: PricingTax[], buyerGstin: string | null | undefined): PricingTax[] {
  return taxesForSale(taxes, sellerInfo().gstin, buyerGstin);
}

export function loadDiscounts(): PricingDiscount[] {
  const rows = db().prepare('SELECT * FROM discounts WHERE active = 1').all() as Array<Record<string, never>>;
  return rows.map(
    (r): PricingDiscount => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      value: r.value,
      minPurchase: r.min_purchase,
      minQuantity: r.min_quantity,
      startDate: r.start_date,
      endDate: r.end_date,
      usageLimit: r.usage_limit,
      usedCount: r.used_count,
      scope: r.scope,
      productIds: JSON.parse(r.product_ids_json),
      active: true,
    }),
  );
}

export function loadLines(subscriptionId: number): LineEntity[] {
  return db()
    .prepare(
      `SELECT sl.*, p.name AS product_name, p.type AS product_type, p.hsn_code AS product_hsn, v.attribute AS variant_attribute, v.value AS variant_value
       FROM subscription_lines sl
       JOIN products p ON p.id = sl.product_id
       LEFT JOIN product_variants v ON v.id = sl.variant_id
       WHERE sl.subscription_id = ?
       ORDER BY sl.is_plan_line DESC, sl.id`,
    )
    .all(subscriptionId) as LineEntity[];
}

export const toPricingLine = (l: LineEntity): PricingLine => ({
  key: l.id,
  productId: l.product_id,
  productType: l.product_type,
  quantity: l.quantity,
  unitPrice: l.unit_price,
  variantExtra: l.variant_extra,
});

export const variantLabel = (l: Pick<LineEntity, 'variant_attribute' | 'variant_value'>) =>
  l.variant_value ? `${l.variant_attribute}: ${l.variant_value}` : null;

/** Stores what this subscription bills per period and per month, net of discounts and before tax. */
export function refreshAmounts(subscriptionId: number, period: BillingPeriod, date: string, taxes = loadTaxes(), discounts = loadDiscounts()) {
  const priced = priceLines(loadLines(subscriptionId).map(toPricingLine), taxes, discounts, date);
  const recurring = priced.subtotal - priced.discountTotal;
  db()
    .prepare('UPDATE subscriptions SET recurring_amount = ?, monthly_amount = ? WHERE id = ?')
    .run(recurring, toMonthly(recurring, period), subscriptionId);
}

/** Re-prices every open subscription after tax or discount rules change, or as rules expire. */
export function repriceAll(date: string) {
  const taxes = loadTaxes();
  const discounts = loadDiscounts();
  const open = db()
    .prepare(
      `SELECT s.id, p.billing_period AS period FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status <> 'closed'`,
    )
    .all() as Array<{ id: number; period: BillingPeriod }>;
  db().transaction(() => {
    for (const s of open) refreshAmounts(s.id, s.period, date, taxes, discounts);
  })();
}

function resolveProductPrice(productId: number, variantId: number | null | undefined) {
  const product = db().prepare('SELECT id, name, sales_price, active FROM products WHERE id = ?').get(productId) as
    | { id: number; name: string; sales_price: number; active: number }
    | undefined;
  if (!product) throw new HttpError(422, 'A selected product no longer exists');
  let extra = 0;
  if (variantId) {
    const variant = db().prepare('SELECT extra_price FROM product_variants WHERE id = ? AND product_id = ? AND active = 1').get(variantId, productId) as
      | { extra_price: number }
      | undefined;
    if (!variant) throw new HttpError(422, `That variant is not available for ${product.name}`);
    extra = variant.extra_price;
  }
  return { salesPrice: product.sales_price, extra, active: product.active };
}

function writeLines(subscriptionId: number, plan: PlanRow, input: Pick<SubscriptionInput, 'planQuantity' | 'planVariantId' | 'lines'>) {
  if (input.planQuantity < plan.min_quantity) {
    throw new HttpError(422, `${plan.name} requires a minimum quantity of ${plan.min_quantity}`, {
      planQuantity: `Minimum quantity is ${plan.min_quantity}`,
    });
  }
  const insert = db().prepare(
    `INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, variant_extra, is_plan_line)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // A line already on this subscription may stay after its product goes off sale; only new ones are refused.
  const existing = new Set((db().prepare('SELECT product_id FROM subscription_lines WHERE subscription_id = ?').all(subscriptionId) as Array<{ product_id: number }>).map((l) => l.product_id));
  db().prepare('DELETE FROM subscription_lines WHERE subscription_id = ?').run(subscriptionId);
  const planProduct = resolveProductPrice(plan.product_id, input.planVariantId);
  insert.run(subscriptionId, plan.product_id, input.planVariantId ?? null, input.planQuantity, plan.price, planProduct.extra, 1);
  for (const line of input.lines) {
    const product = resolveProductPrice(line.productId, line.variantId);
    if (!product.active && !existing.has(line.productId)) throw new HttpError(422, 'A selected product is no longer on sale');
    insert.run(subscriptionId, line.productId, line.variantId ?? null, line.quantity, product.salesPrice, product.extra, 0);
  }
}

function assertPlanAvailable(plan: PlanRow, startDate: string) {
  const product = db().prepare('SELECT active FROM products WHERE id = ?').get(plan.product_id) as { active: number } | undefined;
  if (!plan.active || !product?.active) throw new HttpError(422, `${plan.name} is not on sale`);
  if (plan.start_date && startDate < plan.start_date) {
    throw new HttpError(422, `${plan.name} is available from ${plan.start_date}`, { startDate: `Plan is available from ${plan.start_date}` });
  }
  if (plan.end_date && startDate > plan.end_date) {
    throw new HttpError(422, `${plan.name} stopped being available on ${plan.end_date}`, { startDate: `Plan ended on ${plan.end_date}` });
  }
}

export function createSubscription(input: SubscriptionInput, actor: Actor, today = todayISO(), silent = false): number {
  return db().transaction(() => {
    const plan = getPlan(input.planId);
    assertPlanAvailable(plan, input.startDate);
    const customer = db().prepare('SELECT id FROM customers WHERE id = ?').get(input.customerId);
    if (!customer) throw new HttpError(422, 'Choose a customer', { customerId: 'Choose a customer' });
    const number = nextNumber('SUB');
    const { lastInsertRowid } = db()
      .prepare(
        `INSERT INTO subscriptions (number, customer_id, plan_id, template_id, start_date, expiry_date, payment_term_days, validity_days, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number,
        input.customerId,
        input.planId,
        input.templateId ?? null,
        input.startDate,
        input.expiryDate ?? null,
        input.paymentTermDays,
        input.validityDays,
        input.notes,
        actor.id,
        new Date().toISOString(),
      );
    const id = Number(lastInsertRowid);
    writeLines(id, plan, input);
    refreshAmounts(id, plan.billing_period, today);
    if (!silent) logActivity(actor, 'created', 'subscription', id, `Created ${number}`);
    return id;
  })();
}

/** Commercial terms lock once a subscription is live; only lines can change, from the next invoice on. */
export function updateSubscription(id: number, input: SubscriptionInput, actor: Actor, today = todayISO()) {
  db().transaction(() => {
    const sub = getSubscriptionEntity(id);
    if (sub.status === 'closed') throw conflict('A closed subscription cannot be changed');
    const live = sub.status === 'active';
    if (live && (input.planId !== sub.plan_id || input.customerId !== sub.customer_id || input.startDate !== sub.start_date)) {
      throw conflict('Customer, plan and start date cannot change once a subscription is active');
    }
    const plan = getPlan(input.planId);
    if (!live) assertPlanAvailable(plan, input.startDate);
    if (!db().prepare('SELECT 1 FROM customers WHERE id = ?').get(input.customerId)) throw new HttpError(422, 'Choose a customer', { customerId: 'Choose a customer' });
    db()
      .prepare(
        `UPDATE subscriptions SET customer_id = ?, plan_id = ?, template_id = ?, start_date = ?, expiry_date = ?, payment_term_days = ?, validity_days = ?, notes = ? WHERE id = ?`,
      )
      .run(input.customerId, input.planId, input.templateId ?? null, input.startDate, input.expiryDate ?? null, input.paymentTermDays, input.validityDays, input.notes, id);
    // Editing a quotation's validity, or reviving an expired one, restarts its clock from today.
    if (sub.status === 'quotation' && (input.validityDays !== sub.validity_days || (sub.quote_valid_until && sub.quote_valid_until < today))) {
      db().prepare('UPDATE subscriptions SET quote_valid_until = ? WHERE id = ?').run(addDays(today, input.validityDays), id);
    }
    writeLines(id, plan, input);
    refreshAmounts(id, plan.billing_period, today);
    logActivity(actor, 'updated', 'subscription', id, `Updated ${sub.number}`);
  })();
}

const NEXT_STEP: Record<SubscriptionStatus, SubscriptionStatus | null> = {
  draft: 'quotation',
  quotation: 'confirmed',
  confirmed: 'active',
  active: 'closed',
  closed: null,
};

export function transition(id: number, to: SubscriptionStatus, actor: Actor, opts: { reason?: string; today?: string; at?: string; silent?: boolean } = {}) {
  const today = opts.today ?? todayISO();
  const at = opts.at ?? new Date().toISOString();
  db().transaction(() => {
    const sub = getSubscriptionEntity(id);
    const plan = getPlan(sub.plan_id);
    if (sub.status === to) throw conflict(`${sub.number} is already ${to}`);
    const isClosing = to === 'closed' && sub.status !== 'closed';
    if (NEXT_STEP[sub.status] !== to && !isClosing) {
      throw conflict(`${sub.number} cannot move from ${sub.status} to ${to}`);
    }
    const update = db().prepare(
      `UPDATE subscriptions SET status = ?, quote_valid_until = ?, next_invoice_date = ?, activated_at = ?, closed_at = ?, closed_reason = ?, paused_at = ? WHERE id = ?`,
    );
    let { quote_valid_until, next_invoice_date, activated_at, closed_at, closed_reason, paused_at } = sub;
    switch (to) {
      case 'quotation':
        quote_valid_until = addDays(today, sub.validity_days);
        break;
      case 'confirmed':
        if (sub.quote_valid_until && sub.quote_valid_until < today) {
          throw conflict(`This quotation expired on ${sub.quote_valid_until}. Update its validity before confirming.`);
        }
        break;
      case 'active':
        if (sub.start_date > today) throw conflict(`${sub.number} starts on ${sub.start_date} and activates automatically that day`);
        activated_at = at;
        next_invoice_date = sub.start_date;
        break;
      case 'closed': {
        const beforeExpiry = !sub.expiry_date || sub.expiry_date >= today;
        if (sub.status === 'active' && beforeExpiry && !plan.closable && !actor.isAdmin) {
          throw conflict(`${plan.name} cannot be closed early. Ask an admin to review it.`);
        }
        closed_at = at;
        closed_reason = opts.reason ?? null;
        next_invoice_date = null;
        paused_at = null;
        break;
      }
      case 'draft':
        break;
    }
    update.run(to, quote_valid_until, next_invoice_date, activated_at, closed_at, closed_reason, paused_at, id);
    if (!opts.silent) logActivity(actor, to, 'subscription', id, `${sub.number} moved to ${to}${opts.reason ? `: ${opts.reason}` : ''}`);
  })();
}

export function pause(id: number, actor: Actor) {
  const sub = getSubscriptionEntity(id);
  const plan = getPlan(sub.plan_id);
  if (sub.status !== 'active') throw conflict('Only an active subscription can be paused');
  if (sub.paused_at) throw conflict(`${sub.number} is already paused`);
  if (!plan.pausable) throw conflict(`${plan.name} does not allow pausing`);
  db().prepare('UPDATE subscriptions SET paused_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  logActivity(actor, 'paused', 'subscription', id, `Paused ${sub.number}`);
}

/** Periods that fell inside the pause are deliberately not billed; billing resumes at the next scheduled date. */
export function resume(id: number, actor: Actor, today = todayISO()) {
  const sub = getSubscriptionEntity(id);
  const plan = getPlan(sub.plan_id);
  if (!sub.paused_at) throw conflict(`${sub.number} is not paused`);
  const next = firstBillingDateOnOrAfter(sub.start_date, plan.billing_period, today);
  const nextInvoice = sub.next_invoice_date && sub.next_invoice_date > next ? sub.next_invoice_date : next;
  db().prepare('UPDATE subscriptions SET paused_at = NULL, next_invoice_date = ? WHERE id = ?').run(nextInvoice, id);
  logActivity(actor, 'resumed', 'subscription', id, `Resumed ${sub.number}`);
}

const MAX_RENEWAL_YEARS = 10;

/** The expiry a plain renewal gives: the original term again, counted from the later of expiry and today. */
export function defaultRenewalDate(sub: Pick<SubscriptionEntity, 'start_date' | 'expiry_date' | 'term_days'>, today: string): string | null {
  if (!sub.expiry_date) return null;
  const term = sub.term_days ?? Math.max(daysBetween(sub.start_date, sub.expiry_date), 1);
  return addDays(sub.expiry_date > today ? sub.expiry_date : today, term);
}

/**
 * Extends the term. The original length is remembered at the first renewal, because the start date
 * and expiry drift apart after that. Periods after a lapsed expiry were never in force, so billing
 * restarts from today rather than back-billing them.
 */
export function renew(id: number, actor: Actor, expiryDate?: string, today = todayISO()) {
  const sub = getSubscriptionEntity(id);
  const plan = getPlan(sub.plan_id);
  if (sub.status !== 'active') throw conflict('Only an active subscription can be renewed');
  if (!plan.renewable) throw conflict(`${plan.name} does not allow renewal`);
  if (!sub.expiry_date) throw conflict(`${sub.number} has no expiry date, so it keeps billing without renewal`);
  const term = sub.term_days ?? Math.max(daysBetween(sub.start_date, sub.expiry_date), 1);
  const next = expiryDate ?? defaultRenewalDate(sub, today)!;
  if (next <= sub.expiry_date || next <= today) throw new HttpError(422, 'The new expiry must be after the current one and in the future');
  if (next > addDays(today, MAX_RENEWAL_YEARS * 366)) throw new HttpError(422, `A renewal can run for at most ${MAX_RENEWAL_YEARS} years`);
  const lapsed = sub.expiry_date < today && sub.next_invoice_date !== null && sub.next_invoice_date >= sub.expiry_date && sub.next_invoice_date < today;
  const nextInvoice = lapsed ? firstBillingDateOnOrAfter(sub.start_date, plan.billing_period, today) : sub.next_invoice_date;
  db().prepare('UPDATE subscriptions SET expiry_date = ?, term_days = ?, next_invoice_date = ? WHERE id = ?').run(next, term, nextInvoice, id);
  logActivity(actor, 'renewed', 'subscription', id, `Renewed ${sub.number} until ${next}`);
  return next;
}

export const SUB_ROW_SELECT = `
  SELECT s.id, s.number, s.customer_id AS customerId, c.name AS customerName, c.company,
    s.plan_id AS planId, pl.name AS planName, v.value AS variantLabel, pl.billing_period AS billingPeriod,
    s.start_date AS startDate, s.expiry_date AS expiryDate, s.next_invoice_date AS nextInvoiceDate,
    s.status, s.paused_at IS NOT NULL AS paused, pl.pausable, s.recurring_amount AS recurringAmount,
    s.quote_valid_until AS quoteValidUntil,
    EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id = s.id AND i.status = 'confirmed' AND i.due_date < @today) AS overdue
  FROM subscriptions s
  JOIN customers c ON c.id = s.customer_id
  JOIN plans pl ON pl.id = s.plan_id
  LEFT JOIN subscription_lines sl ON sl.subscription_id = s.id AND sl.is_plan_line = 1
  LEFT JOIN product_variants v ON v.id = sl.variant_id`;

type RawRow = Omit<SubscriptionRow, 'paused' | 'pausable' | 'overdue' | 'quoteExpired'> & { paused: number; pausable: number; overdue: number; quoteValidUntil: string | null };

export function mapSubRow(row: RawRow, today: string): SubscriptionRow {
  const { quoteValidUntil, ...rest } = row;
  const billable = row.status === 'active' && !row.paused && isBillableDate(row.nextInvoiceDate ?? '', row.startDate, row.expiryDate, row.billingPeriod);
  return {
    ...rest,
    paused: Boolean(row.paused),
    pausable: Boolean(row.pausable),
    overdue: Boolean(row.overdue),
    nextInvoiceDate: billable ? row.nextInvoiceDate : null,
    quoteExpired: row.status === 'quotation' && Boolean(quoteValidUntil && quoteValidUntil < today),
  };
}

export const INVOICE_ROW_SELECT = `
  SELECT i.id, i.number, i.subscription_id AS subscriptionId, s.number AS subscriptionNumber,
    i.customer_id AS customerId, i.customer_name AS customerName, i.customer_company AS company,
    i.period_start AS periodStart, i.period_end AS periodEnd, i.issue_date AS issueDate, i.due_date AS dueDate,
    i.status, i.status = 'confirmed' AND i.due_date < @today AS overdue, i.total, i.amount_paid AS amountPaid,
    CASE WHEN i.status IN ('confirmed','draft') THEN i.total - i.amount_paid ELSE 0 END AS balance, i.sent_at AS sentAt
  FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id`;

export const mapInvoiceRow = (row: Omit<InvoiceRow, 'overdue'> & { overdue: number }): InvoiceRow => ({ ...row, overdue: Boolean(row.overdue) });

export function getSubscriptionDetail(id: number, today = todayISO()): SubscriptionDetail {
  const raw = db()
    .prepare(`${SUB_ROW_SELECT} WHERE s.id = @id`)
    .get({ id, today }) as RawRow | undefined;
  if (!raw) throw notFound('Subscription');
  const row = mapSubRow(raw, today);
  const sub = getSubscriptionEntity(id);
  const plan = getPlan(sub.plan_id);
  const entities = loadLines(id);
  const { tax_id: buyerGstin } = db().prepare('SELECT tax_id FROM customers WHERE id = ?').get(sub.customer_id) as { tax_id: string };
  const priced = priceLines(entities.map(toPricingLine), taxesForCustomer(loadTaxes(), buyerGstin), loadDiscounts(), row.nextInvoiceDate ?? today);
  const lines = entities.map((l, i): SubscriptionLine => {
    const p = priced.lines[i];
    return {
      id: l.id,
      productId: l.product_id,
      productName: l.product_name,
      productType: l.product_type as SubscriptionLine['productType'],
      variantId: l.variant_id,
      variantLabel: variantLabel(l),
      quantity: l.quantity,
      unitPrice: l.unit_price,
      variantExtra: l.variant_extra,
      isPlanLine: Boolean(l.is_plan_line),
      gross: p.gross,
      discount: p.discount,
      discountName: p.discountName,
      net: p.net,
      tax: p.tax,
      taxLabel: p.taxLabel,
      total: p.total,
    };
  });
  const extras = db()
    .prepare(
      `SELECT c.email AS customerEmail, t.name AS templateName FROM subscriptions s JOIN customers c ON c.id = s.customer_id
       LEFT JOIN quotation_templates t ON t.id = s.template_id WHERE s.id = ?`,
    )
    .get(id) as { customerEmail: string; templateName: string | null };
  const invoices = (
    db().prepare(`${INVOICE_ROW_SELECT} WHERE i.subscription_id = @id ORDER BY i.period_start DESC, i.id DESC LIMIT 24`).all({ id, today }) as Array<
      Omit<InvoiceRow, 'overdue'> & { overdue: number }
    >
  ).map(mapInvoiceRow);
  return {
    ...row,
    ...extras,
    templateId: sub.template_id,
    paymentTermDays: sub.payment_term_days,
    validityDays: sub.validity_days,
    quoteValidUntil: sub.quote_valid_until,
    defaultRenewalDate: defaultRenewalDate(sub, today),
    notes: sub.notes,
    closedReason: sub.closed_reason,
    activatedAt: sub.activated_at,
    closedAt: sub.closed_at,
    plan: {
      autoClose: Boolean(plan.auto_close),
      closable: Boolean(plan.closable),
      pausable: Boolean(plan.pausable),
      renewable: Boolean(plan.renewable),
      minQuantity: plan.min_quantity,
      price: plan.price,
    },
    lines,
    totals: { subtotal: priced.subtotal, discountTotal: priced.discountTotal, taxTotal: priced.taxTotal, total: priced.total },
    invoices,
  };
}
