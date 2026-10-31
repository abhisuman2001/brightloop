import { Router, type Request } from 'express';
import { todayISO } from '../../shared/dates';
import { portalAddonSchema, portalProfileSchema, portalRequestSchema, renewSchema } from '../../shared/schemas';
import type { InvoiceRow, PortalOverview, PortalPlan, PortalSubscription, Variant } from '../../shared/types';
import { requireCustomer, user } from '../auth';
import { db } from '../db';
import { HttpError, conflict, idParam, notFound, parse } from '../http';
import { logActivity, type Actor } from '../services/activity';
import { billSubscription } from '../services/billing';
import {
  SUB_ROW_SELECT,
  createSubscription,
  getPlan,
  getSubscriptionDetail,
  getSubscriptionEntity,
  mapSubRow,
  pause,
  refreshAmounts,
  renew,
  resume,
  transition,
  INVOICE_ROW_SELECT,
  mapInvoiceRow,
} from '../services/subscriptions';
import { getInvoiceDetail } from './billing';

export const portalRouter = Router();
portalRouter.use(requireCustomer);

const customerIdOf = (req: Request): number => {
  const id = user(req).customerId;
  if (!id) throw new HttpError(403, 'This account is not linked to a customer');
  return id;
};
const actorOf = (req: Request): Actor => ({ id: user(req).id, name: user(req).name });

/** Every subscription action goes through this, so one customer can never touch another's records. */
function ownedSubscription(req: Request) {
  const sub = getSubscriptionEntity(idParam(req));
  // A draft is still internal: it reaches the customer once it becomes a quotation.
  if (sub.customer_id !== customerIdOf(req) || sub.status === 'draft') throw notFound('Subscription');
  return sub;
}

function portalDetail(id: number): PortalSubscription {
  const detail = getSubscriptionDetail(id);
  const addons = db().prepare(`SELECT id, name, sales_price AS price, notes FROM products WHERE type = 'addon' AND active = 1 ORDER BY name`).all() as Array<{
    id: number;
    name: string;
    price: number;
    notes: string;
  }>;
  return {
    ...detail,
    // Staff notes and unconfirmed invoices are internal.
    notes: '',
    invoices: detail.invoices.filter((i) => i.status !== 'draft'),
    addons: addons.map((a) => ({
      productId: a.id,
      name: a.name,
      price: a.price,
      notes: a.notes,
      enabled: detail.lines.some((l) => l.productId === a.id && !l.isPlanLine),
    })),
  };
}

portalRouter.get('/overview', (req, res) => {
  const id = customerIdOf(req);
  const today = todayISO();
  const customer = db().prepare('SELECT name, company, email, phone, address FROM customers WHERE id = ?').get(id) as PortalOverview['customer'];
  const subscriptions = (db().prepare(`${SUB_ROW_SELECT} WHERE s.customer_id = @id AND s.status <> 'draft' ORDER BY s.status = 'closed', s.id DESC`).all({ id, today }) as Parameters<typeof mapSubRow>[0][]).map((r) =>
    mapSubRow(r, today),
  );
  const invoices = (
    db().prepare(`${INVOICE_ROW_SELECT} WHERE i.customer_id = @id AND i.status <> 'draft' ORDER BY i.id DESC LIMIT 100`).all({ id, today }) as Array<Omit<InvoiceRow, 'overdue'> & { overdue: number }>
  ).map(mapInvoiceRow);
  const totals = db()
    .prepare(
      `SELECT COALESCE(SUM(total - amount_paid), 0) AS outstanding, COALESCE(SUM(CASE WHEN due_date < ? THEN total - amount_paid ELSE 0 END), 0) AS overdue
       FROM invoices WHERE customer_id = ? AND status = 'confirmed'`,
    )
    .get(today, id) as { outstanding: number; overdue: number };
  const monthly = db()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN paused_at IS NULL THEN monthly_amount ELSE 0 END), 0) AS amount FROM subscriptions WHERE customer_id = ? AND status = 'active'`)
    .get(id) as { n: number; amount: number };
  const body: PortalOverview = { customer, activeSubscriptions: monthly.n, monthlyAmount: monthly.amount, ...totals, subscriptions, invoices };
  res.json(body);
});

portalRouter.patch('/profile', (req, res) => {
  const input = parse(portalProfileSchema, req.body);
  const id = customerIdOf(req);
  db().transaction(() => {
    db().prepare('UPDATE customers SET name = ?, company = ?, phone = ?, address = ? WHERE id = ?').run(input.name, input.company, input.phone, input.address, id);
    db().prepare('UPDATE users SET name = ? WHERE id = ?').run(input.name, user(req).id);
  })();
  res.json({ ok: true });
});

portalRouter.get('/plans', (_req, res) => {
  const today = todayISO();
  const plans = db()
    .prepare(
      `SELECT pl.id, pl.name, pr.name AS productName, pl.product_id AS productId, pr.notes, pl.price, pl.billing_period AS billingPeriod, pl.min_quantity AS minQuantity
       FROM plans pl JOIN products pr ON pr.id = pl.product_id
       WHERE pl.active = 1 AND pr.active = 1 AND (pl.start_date IS NULL OR pl.start_date <= @today) AND (pl.end_date IS NULL OR pl.end_date >= @today)
       ORDER BY pl.price`,
    )
    .all({ today }) as Array<Omit<PortalPlan, 'variants'> & { productId: number }>;
  const variants = db().prepare('SELECT id, product_id AS productId, attribute, value, extra_price AS extraPrice FROM product_variants WHERE active = 1').all() as Variant[];
  res.json(plans.map(({ productId, ...p }): PortalPlan => ({ ...p, variants: variants.filter((v) => v.productId === productId) })));
});

portalRouter.post('/subscriptions', (req, res) => {
  const input = parse(portalRequestSchema, req.body);
  const actor = actorOf(req);
  const today = todayISO();
  const id = createSubscription(
    {
      customerId: customerIdOf(req),
      planId: input.planId,
      startDate: today,
      expiryDate: null,
      paymentTermDays: 30,
      validityDays: 30,
      planQuantity: input.quantity,
      planVariantId: input.variantId ?? null,
      lines: [],
      notes: 'Requested through the customer portal',
    },
    actor,
    today,
  );
  transition(id, 'quotation', actor);
  res.status(201).json(portalDetail(id));
});

portalRouter.get('/subscriptions/:id', (req, res) => {
  res.json(portalDetail(ownedSubscription(req).id));
});

/** Accepting a quotation confirms it and, when it has already started, activates and bills it. */
portalRouter.post('/subscriptions/:id/accept', (req, res) => {
  const sub = ownedSubscription(req);
  if (sub.status !== 'quotation') throw conflict('Only a quotation can be accepted');
  const actor = actorOf(req);
  const today = todayISO();
  transition(sub.id, 'confirmed', actor);
  if (sub.start_date <= today) {
    transition(sub.id, 'active', actor);
    billSubscription(sub.id, today);
  }
  res.json(portalDetail(sub.id));
});

portalRouter.post('/subscriptions/:id/addons', (req, res) => {
  const sub = ownedSubscription(req);
  if (sub.status === 'closed') throw conflict('This subscription is closed');
  const { productId, enabled } = parse(portalAddonSchema, req.body);
  const product = db().prepare(`SELECT id, name, sales_price FROM products WHERE id = ? AND type = 'addon' AND active = 1`).get(productId) as
    | { id: number; name: string; sales_price: number }
    | undefined;
  if (!product) throw notFound('Add-on');
  db().transaction(() => {
    const existing = db().prepare('SELECT id FROM subscription_lines WHERE subscription_id = ? AND product_id = ? AND is_plan_line = 0').get(sub.id, productId) as { id: number } | undefined;
    if (enabled && !existing) {
      db().prepare('INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price) VALUES (?, ?, 1, ?)').run(sub.id, productId, product.sales_price);
    } else if (!enabled && existing) {
      db().prepare('DELETE FROM subscription_lines WHERE id = ?').run(existing.id);
    }
    refreshAmounts(sub.id, getPlan(sub.plan_id).billing_period, todayISO());
  })();
  logActivity(actorOf(req), 'addon', 'subscription', sub.id, `${enabled ? 'Added' : 'Removed'} ${product.name} on ${sub.number}`);
  res.json(portalDetail(sub.id));
});

portalRouter.post('/subscriptions/:id/pause', (req, res) => {
  const sub = ownedSubscription(req);
  pause(sub.id, actorOf(req));
  res.json(portalDetail(sub.id));
});

portalRouter.post('/subscriptions/:id/resume', (req, res) => {
  const sub = ownedSubscription(req);
  resume(sub.id, actorOf(req));
  res.json(portalDetail(sub.id));
});

portalRouter.post('/subscriptions/:id/renew', (req, res) => {
  const sub = ownedSubscription(req);
  renew(sub.id, actorOf(req), parse(renewSchema, req.body ?? {}).expiryDate);
  res.json(portalDetail(sub.id));
});

portalRouter.post('/subscriptions/:id/cancel', (req, res) => {
  const sub = ownedSubscription(req);
  transition(sub.id, 'closed', actorOf(req), { reason: 'Cancelled by customer' });
  res.json(portalDetail(sub.id));
});

portalRouter.get('/invoices/:id', (req, res) => {
  const detail = getInvoiceDetail(idParam(req), customerIdOf(req));
  if (detail.status === 'draft') throw notFound('Invoice');
  // Who recorded a payment and the team's notes on it are internal.
  res.json({ ...detail, payments: detail.payments.map((p) => ({ ...p, note: '', recordedBy: '' })) });
});
