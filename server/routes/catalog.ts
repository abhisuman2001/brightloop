import { Router, type Request } from 'express';
import { discountSchema, planSchema, productSchema, taxSchema, templateSchema } from '../../shared/schemas';
import { todayISO } from '../../shared/dates';
import { taxesForSale } from '../../shared/pricing';
import type { Discount, Plan, Product, QuotationTemplate, TaxRule, Variant } from '../../shared/types';
import { requireAdmin, requireStaff, user } from '../auth';
import { db } from '../db';
import { HttpError, conflict, idParam, notFound, parse } from '../http';
import { logActivity, type Actor } from '../services/activity';
import { sellerInfo } from '../services/company';
import { repriceAll } from '../services/subscriptions';

export const catalogRouter = Router();
catalogRouter.use(requireStaff);

const actorOf = (req: Request): Actor => ({ id: user(req).id, name: user(req).name });

// Products and variants

function listProducts(): Product[] {
  const products = db().prepare('SELECT id, name, type, sales_price AS salesPrice, cost_price AS costPrice, notes, hsn_code AS hsnCode, active FROM products ORDER BY name').all() as Array<
    Omit<Product, 'active' | 'variants'> & { active: number }
  >;
  const variants = db()
    .prepare('SELECT id, product_id AS productId, attribute, value, extra_price AS extraPrice FROM product_variants WHERE active = 1 ORDER BY id')
    .all() as Variant[];
  return products.map((p) => ({ ...p, active: Boolean(p.active), variants: variants.filter((v) => v.productId === p.id) }));
}

function saveVariants(productId: number, variants: Array<{ id?: number; attribute: string; value: string; extraPrice: number }>) {
  const keep = new Set<number>();
  for (const v of variants) {
    if (v.id) {
      const updated = db()
        .prepare('UPDATE product_variants SET attribute = ?, value = ?, extra_price = ?, active = 1 WHERE id = ? AND product_id = ?')
        .run(v.attribute, v.value, v.extraPrice, v.id, productId);
      if (updated.changes === 0) throw notFound('Variant');
      keep.add(v.id);
    } else {
      const { lastInsertRowid } = db()
        .prepare('INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, ?, ?, ?)')
        .run(productId, v.attribute, v.value, v.extraPrice);
      keep.add(Number(lastInsertRowid));
    }
  }
  // Soft delete: existing subscription lines may still reference a removed variant.
  const current = db().prepare('SELECT id FROM product_variants WHERE product_id = ? AND active = 1').all(productId) as Array<{ id: number }>;
  for (const { id } of current) {
    if (!keep.has(id)) db().prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(id);
  }
}

catalogRouter.get('/products', (_req, res) => res.json(listProducts()));

catalogRouter.post('/products', requireAdmin, (req, res) => {
  const input = parse(productSchema, req.body);
  const id = db().transaction(() => {
    const { lastInsertRowid } = db()
      .prepare('INSERT INTO products (name, type, sales_price, cost_price, notes, hsn_code, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.name, input.type, input.salesPrice, input.costPrice, input.notes, input.hsnCode, Number(input.active));
    saveVariants(Number(lastInsertRowid), input.variants);
    return Number(lastInsertRowid);
  })();
  logActivity(actorOf(req), 'created', 'product', id, `Created product ${input.name}`);
  res.status(201).json(listProducts().find((p) => p.id === id));
});

catalogRouter.patch('/products/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const input = parse(productSchema, req.body);
  db().transaction(() => {
    const { changes } = db()
      .prepare('UPDATE products SET name = ?, type = ?, sales_price = ?, cost_price = ?, notes = ?, hsn_code = ?, active = ? WHERE id = ?')
      .run(input.name, input.type, input.salesPrice, input.costPrice, input.notes, input.hsnCode, Number(input.active), id);
    if (changes === 0) throw notFound('Product');
    saveVariants(id, input.variants);
  })();
  logActivity(actorOf(req), 'updated', 'product', id, `Updated product ${input.name}`);
  res.json(listProducts().find((p) => p.id === id));
});

// Plans

function listPlans(): Plan[] {
  const rows = db()
    .prepare(
      `SELECT pl.id, pl.name, pl.product_id AS productId, pr.name AS productName, pl.price, pl.billing_period AS billingPeriod,
         pl.min_quantity AS minQuantity, pl.start_date AS startDate, pl.end_date AS endDate, pl.auto_close AS autoClose,
         pl.closable, pl.pausable, pl.renewable, pl.active,
         (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = pl.id AND s.status = 'active') AS activeSubscriptions
       FROM plans pl JOIN products pr ON pr.id = pl.product_id ORDER BY pl.active DESC, pl.name`,
    )
    .all() as Array<Record<string, number & string>>;
  return rows.map((r) => ({
    ...(r as unknown as Plan),
    autoClose: Boolean(r.autoClose),
    closable: Boolean(r.closable),
    pausable: Boolean(r.pausable),
    renewable: Boolean(r.renewable),
    active: Boolean(r.active),
  }));
}

catalogRouter.get('/plans', (_req, res) => res.json(listPlans()));

catalogRouter.post('/plans', requireAdmin, (req, res) => {
  const p = parse(planSchema, req.body);
  if (!db().prepare('SELECT 1 FROM products WHERE id = ?').get(p.productId)) throw notFound('Product');
  const { lastInsertRowid } = db()
    .prepare(
      `INSERT INTO plans (name, product_id, price, billing_period, min_quantity, start_date, end_date, auto_close, closable, pausable, renewable, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.name, p.productId, p.price, p.billingPeriod, p.minQuantity, p.startDate ?? null, p.endDate ?? null, Number(p.autoClose), Number(p.closable), Number(p.pausable), Number(p.renewable), Number(p.active));
  logActivity(actorOf(req), 'created', 'plan', Number(lastInsertRowid), `Created plan ${p.name}`);
  res.status(201).json(listPlans().find((x) => x.id === Number(lastInsertRowid)));
});

catalogRouter.patch('/plans/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const p = parse(planSchema, req.body);
  const inUse = db().prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = ? AND status <> 'closed'`).get(id) as { n: number };
  const current = db().prepare('SELECT billing_period, product_id FROM plans WHERE id = ?').get(id) as { billing_period: string; product_id: number } | undefined;
  if (!current) throw notFound('Plan');
  if (inUse.n > 0 && (current.billing_period !== p.billingPeriod || current.product_id !== p.productId)) {
    throw conflict(`${inUse.n} open subscriptions use this plan, so its product and billing frequency cannot change. Create a new plan instead.`);
  }
  db()
    .prepare(
      `UPDATE plans SET name = ?, product_id = ?, price = ?, billing_period = ?, min_quantity = ?, start_date = ?, end_date = ?, auto_close = ?, closable = ?, pausable = ?, renewable = ?, active = ? WHERE id = ?`,
    )
    .run(p.name, p.productId, p.price, p.billingPeriod, p.minQuantity, p.startDate ?? null, p.endDate ?? null, Number(p.autoClose), Number(p.closable), Number(p.pausable), Number(p.renewable), Number(p.active), id);
  logActivity(actorOf(req), 'updated', 'plan', id, `Updated plan ${p.name}`);
  res.json(listPlans().find((x) => x.id === id));
});

// Quotation templates

function listTemplates(): QuotationTemplate[] {
  const rows = db()
    .prepare(
      `SELECT t.id, t.name, t.plan_id AS planId, p.name AS planName, t.validity_days AS validityDays, t.payment_term_days AS paymentTermDays,
         t.plan_quantity AS planQuantity, t.plan_variant_id AS planVariantId, t.lines_json AS linesJson
       FROM quotation_templates t JOIN plans p ON p.id = t.plan_id ORDER BY t.name`,
    )
    .all() as Array<Omit<QuotationTemplate, 'lines'> & { linesJson: string }>;
  return rows.map(({ linesJson, ...t }) => ({ ...t, lines: JSON.parse(linesJson) }));
}

catalogRouter.get('/templates', (_req, res) => res.json(listTemplates()));

/** A broken template would otherwise only fail later, when a rep starts a quote from it. */
function assertTemplateUsable(t: { planId: number; planQuantity: number; lines: Array<{ productId: number }> }) {
  const plan = db().prepare('SELECT name, min_quantity FROM plans WHERE id = ?').get(t.planId) as { name: string; min_quantity: number } | undefined;
  if (!plan) throw new HttpError(422, 'Choose a plan', { planId: 'Choose a plan' });
  if (t.planQuantity < plan.min_quantity) throw new HttpError(422, `${plan.name} requires a minimum quantity of ${plan.min_quantity}`, { planQuantity: `Minimum quantity is ${plan.min_quantity}` });
  for (const line of t.lines) {
    if (!db().prepare('SELECT 1 FROM products WHERE id = ?').get(line.productId)) throw new HttpError(422, 'A selected product no longer exists');
  }
}

catalogRouter.post('/templates', requireAdmin, (req, res) => {
  const t = parse(templateSchema, req.body);
  assertTemplateUsable(t);
  const { lastInsertRowid } = db()
    .prepare('INSERT INTO quotation_templates (name, plan_id, validity_days, payment_term_days, plan_quantity, plan_variant_id, lines_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.name, t.planId, t.validityDays, t.paymentTermDays, t.planQuantity, t.planVariantId ?? null, JSON.stringify(t.lines));
  logActivity(actorOf(req), 'created', 'template', Number(lastInsertRowid), `Created quotation template ${t.name}`);
  res.status(201).json(listTemplates().find((x) => x.id === Number(lastInsertRowid)));
});

catalogRouter.patch('/templates/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const t = parse(templateSchema, req.body);
  assertTemplateUsable(t);
  const { changes } = db()
    .prepare('UPDATE quotation_templates SET name = ?, plan_id = ?, validity_days = ?, payment_term_days = ?, plan_quantity = ?, plan_variant_id = ?, lines_json = ? WHERE id = ?')
    .run(t.name, t.planId, t.validityDays, t.paymentTermDays, t.planQuantity, t.planVariantId ?? null, JSON.stringify(t.lines), id);
  if (changes === 0) throw notFound('Template');
  logActivity(actorOf(req), 'updated', 'template', id, `Updated quotation template ${t.name}`);
  res.json(listTemplates().find((x) => x.id === id));
});

// Tax rules

const listTaxes = () =>
  (db().prepare('SELECT id, name, rate_bps AS rateBps, product_type AS productType, supply, active FROM tax_rules ORDER BY name').all() as Array<Omit<TaxRule, 'active'> & { active: number }>).map((t) => ({
    ...t,
    active: Boolean(t.active),
  }));

catalogRouter.get('/taxes', (req, res) => {
  // With a customer, only the rules for a sale to them, which keeps previews equal to the real invoice.
  const customerId = Number(req.query.customerId);
  if (!customerId) return void res.json(listTaxes());
  const customer = db().prepare('SELECT tax_id FROM customers WHERE id = ?').get(customerId) as { tax_id: string } | undefined;
  res.json(taxesForSale(listTaxes(), sellerInfo().gstin, customer?.tax_id));
});

catalogRouter.post('/taxes', requireAdmin, (req, res) => {
  const t = parse(taxSchema, req.body);
  const { lastInsertRowid } = db().prepare('INSERT INTO tax_rules (name, rate_bps, product_type, supply, active) VALUES (?, ?, ?, ?, ?)').run(t.name, t.rateBps, t.productType, t.supply, Number(t.active));
  logActivity(actorOf(req), 'created', 'tax', Number(lastInsertRowid), `Created tax rule ${t.name}`);
  repriceAll(todayISO());
  res.status(201).json(listTaxes().find((x) => x.id === Number(lastInsertRowid)));
});

catalogRouter.patch('/taxes/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const t = parse(taxSchema, req.body);
  const { changes } = db().prepare('UPDATE tax_rules SET name = ?, rate_bps = ?, product_type = ?, supply = ?, active = ? WHERE id = ?').run(t.name, t.rateBps, t.productType, t.supply, Number(t.active), id);
  if (changes === 0) throw notFound('Tax rule');
  logActivity(actorOf(req), 'updated', 'tax', id, `Updated tax rule ${t.name}`);
  repriceAll(todayISO());
  res.json(listTaxes().find((x) => x.id === id));
});

// Discount rules: staff may read them, only the admin may create or change them.

function listDiscounts(): Discount[] {
  const rows = db()
    .prepare(
      `SELECT id, name, kind, value, min_purchase AS minPurchase, min_quantity AS minQuantity, start_date AS startDate, end_date AS endDate,
         usage_limit AS usageLimit, used_count AS usedCount, scope, product_ids_json AS productIdsJson, active FROM discounts ORDER BY active DESC, name`,
    )
    .all() as Array<Omit<Discount, 'productIds' | 'active'> & { productIdsJson: string; active: number }>;
  return rows.map(({ productIdsJson, ...d }) => ({ ...d, productIds: JSON.parse(productIdsJson), active: Boolean(d.active) }));
}

catalogRouter.get('/discounts', (_req, res) => res.json(listDiscounts()));

catalogRouter.post('/discounts', requireAdmin, (req, res) => {
  const d = parse(discountSchema, req.body);
  const { lastInsertRowid } = db()
    .prepare(
      `INSERT INTO discounts (name, kind, value, min_purchase, min_quantity, start_date, end_date, usage_limit, scope, product_ids_json, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(d.name, d.kind, d.value, d.minPurchase, d.minQuantity, d.startDate ?? null, d.endDate ?? null, d.usageLimit ?? null, d.scope, JSON.stringify(d.scope === 'product' ? d.productIds : []), Number(d.active));
  logActivity(actorOf(req), 'created', 'discount', Number(lastInsertRowid), `Created discount ${d.name}`);
  repriceAll(todayISO());
  res.status(201).json(listDiscounts().find((x) => x.id === Number(lastInsertRowid)));
});

catalogRouter.patch('/discounts/:id', requireAdmin, (req, res) => {
  const id = idParam(req);
  const d = parse(discountSchema, req.body);
  const { changes } = db()
    .prepare(
      `UPDATE discounts SET name = ?, kind = ?, value = ?, min_purchase = ?, min_quantity = ?, start_date = ?, end_date = ?, usage_limit = ?, scope = ?, product_ids_json = ?, active = ? WHERE id = ?`,
    )
    .run(d.name, d.kind, d.value, d.minPurchase, d.minQuantity, d.startDate ?? null, d.endDate ?? null, d.usageLimit ?? null, d.scope, JSON.stringify(d.scope === 'product' ? d.productIds : []), Number(d.active), id);
  if (changes === 0) throw notFound('Discount');
  logActivity(actorOf(req), 'updated', 'discount', id, `Updated discount ${d.name}`);
  repriceAll(todayISO());
  res.json(listDiscounts().find((x) => x.id === id));
});
