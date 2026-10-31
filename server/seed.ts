import fs from 'node:fs';
import { addDays, todayISO } from '../shared/dates';
import { hashPassword } from './auth';
import { db, initDb } from './db';
import { confirmInvoice, recordPayment, runBilling } from './services/billing';
import { createSubscription, repriceAll, transition, type SubscriptionInput } from './services/subscriptions';

// Builds a realistic local dataset by running a year of real billing through the real services,
// so every number in the app is what the system itself computed. Development only.

const DEMO_PASSWORD = 'Brightloop#2026';
const SUBSCRIPTION_COUNT = Number(process.env.SEED_SUBSCRIPTIONS ?? 2500);
const CUSTOMER_COUNT = Math.ceil(SUBSCRIPTION_COUNT / 2.5);
const HISTORY_DAYS = 400;

let state = 20260331;
function random(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

const FIRST = ['Aarav', 'Ananya', 'Maya', 'Liam', 'Noah', 'Priya', 'Sofia', 'Ethan', 'Isha', 'Rohan', 'Elena', 'Marcus', 'Nina', 'Omar', 'Grace', 'Kabir', 'Leah', 'Tomas', 'Zara', 'Hugo', 'Meera', 'Daniel', 'Aisha', 'Felix'];
const LAST = ['Sharma', 'Patel', 'Nguyen', 'Garcia', 'Kim', 'Okafor', 'Rossi', 'Larsen', 'Mehta', 'Costa', 'Silva', 'Chen', 'Haddad', 'Novak', 'Iyer', 'Brooks', 'Reyes', 'Fischer', 'Tanaka', 'Bose'];
const NAME_A = ['Northwind', 'Lumen', 'Harbor', 'Cedar', 'Vertex', 'Bluepeak', 'Ironwood', 'Solstice', 'Meridian', 'Kestrel', 'Oakline', 'Quanta', 'Riverbend', 'Atlas', 'Copperfield', 'Beacon', 'Stonebridge', 'Fernhill', 'Orchard', 'Pinecrest'];
const NAME_B = ['Retail', 'Logistics', 'Studio', 'Foods', 'Health', 'Labs', 'Partners', 'Works', 'Systems', 'Traders', 'Dental', 'Motors', 'Media', 'Supply', 'Clinic', 'Consulting'];
const CITIES = ['Bengaluru', 'Mumbai', 'Austin', 'Berlin', 'Toronto', 'Singapore', 'Lisbon', 'Dublin', 'Pune', 'Denver'];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('The seeder is for development only.');
  const file = process.env.DATABASE_PATH ?? './data/brightloop.db';
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
  initDb(file);
  const today = todayISO();
  const started = Date.now();
  const hash = await hashPassword(DEMO_PASSWORD);
  const now = new Date().toISOString();

  const insertUser = db().prepare(`INSERT INTO users (email, name, password_hash, role, customer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  insertUser.run('admin@brightloop.dev', 'Avery Morgan', hash, 'admin', null, now);
  const staffId = Number(insertUser.run('staff@brightloop.dev', 'Sam Rivera', hash, 'staff', null, now).lastInsertRowid);
  const actor = { id: staffId, name: 'Sam Rivera' };

  const insertTax = db().prepare('INSERT INTO tax_rules (name, rate_bps, product_type) VALUES (?, ?, ?)');
  insertTax.run('Sales Tax 8%', 800, null);
  insertTax.run('Services Levy 2%', 200, 'service');

  const insertProduct = db().prepare('INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES (?, ?, ?, ?, ?)');
  const product = (name: string, type: string, price: number, cost: number, notes: string) => Number(insertProduct.run(name, type, price, cost, notes).lastInsertRowid);
  const cloud = product('Brightloop Cloud', 'software', 39_00, 8_00, 'Core subscription software, priced per seat.');
  const erp = product('Brightloop ERP', 'software', 99_00, 22_00, 'Finance and operations suite for larger teams.');
  const support = product('Priority Support', 'addon', 49_00, 15_00, 'Four-hour response on business days.');
  const analytics = product('Advanced Analytics', 'addon', 29_00, 6_00, 'Custom reports and scheduled exports.');
  const storage = product('Extra Storage 1 TB', 'addon', 9_00, 3_00, 'Additional document storage.');
  const onboarding = product('Managed Onboarding', 'service', 150_00, 70_00, 'Hands-on setup with a Brightloop specialist.');
  const insertVariant = db().prepare('INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, ?, ?, ?)');
  const variant = (productId: number, attribute: string, value: string, extra: number) => Number(insertVariant.run(productId, attribute, value, extra).lastInsertRowid);
  const odoo = variant(cloud, 'Brand', 'Odoo', 560_00);
  const whiteLabel = variant(cloud, 'Brand', 'White Label', 12_00);
  const erpOdoo = variant(erp, 'Brand', 'Odoo', 560_00);

  const insertPlan = db().prepare(
    `INSERT INTO plans (name, product_id, price, billing_period, min_quantity, start_date, end_date, auto_close, closable, pausable, renewable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const plan = (name: string, productId: number, price: number, period: string, min: number, autoClose: number, closable: number, pausable: number, renewable: number) =>
    ({ id: Number(insertPlan.run(name, productId, price, period, min, null, null, autoClose, closable, pausable, renewable).lastInsertRowid), period, min, price });
  const starter = plan('Starter', cloud, 19_00, 'monthly', 1, 0, 1, 1, 1);
  const growth = plan('Growth', cloud, 39_00, 'monthly', 3, 0, 1, 1, 1);
  const scaleUp = plan('Scale-Up', erp, 99_00, 'monthly', 5, 0, 1, 0, 1);
  const annual = plan('Enterprise Annual', erp, 890_00, 'yearly', 10, 1, 0, 0, 1);
  const weekly = plan('Field Team Weekly', cloud, 9_00, 'weekly', 2, 0, 1, 1, 0);
  const daily = plan('Event Pass Daily', cloud, 5_00, 'daily', 1, 1, 1, 0, 0);
  const annualLite = plan('Growth Annual', cloud, 290_00, 'yearly', 3, 0, 1, 0, 1);

  const insertTemplate = db().prepare(
    `INSERT INTO quotation_templates (name, plan_id, validity_days, payment_term_days, plan_quantity, plan_variant_id, lines_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertTemplate.run('Enterprise rollout', annual.id, 30, 45, 25, erpOdoo, JSON.stringify([{ productId: support, variantId: null, quantity: 1 }, { productId: onboarding, variantId: null, quantity: 1 }]));
  insertTemplate.run('Scale-Up standard', scaleUp.id, 21, 30, 10, null, JSON.stringify([{ productId: analytics, variantId: null, quantity: 1 }]));
  insertTemplate.run('Small business starter', growth.id, 14, 15, 3, null, '[]');

  const insertDiscount = db().prepare(
    `INSERT INTO discounts (name, kind, value, min_purchase, min_quantity, start_date, end_date, usage_limit, scope, product_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertDiscount.run('Volume 10+ seats', 'percent', 10_00, 0, 10, null, null, null, 'subscription', '[]');
  insertDiscount.run('Enterprise 50+ seats', 'percent', 15_00, 0, 50, null, null, null, 'subscription', '[]');
  insertDiscount.run('ERP launch offer', 'fixed', 150_00, 1_500_00, 0, addDays(today, -60), addDays(today, 30), 400, 'product', JSON.stringify([erp]));
  insertDiscount.run('Support bundle', 'percent', 20_00, 0, 0, addDays(today, -200), addDays(today, -90), 300, 'product', JSON.stringify([support]));

  const insertCustomer = db().prepare('INSERT INTO customers (name, company, email, phone, address, tax_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const customers: number[] = [];
  db().transaction(() => {
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const company = `${pick(NAME_A)} ${pick(NAME_B)}`;
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${i}@${company.toLowerCase().replace(/\s+/g, '')}.example`;
      const created = addDays(today, -between(1, HISTORY_DAYS));
      const row = insertCustomer.run(name, company, email, `+1 555 01${String(between(0, 99)).padStart(2, '0')}`, `${between(10, 900)} Market Street, ${pick(CITIES)}`, i % 3 === 0 ? `TX${100000 + i}` : '', `${created}T09:00:00.000Z`);
      customers.push(Number(row.lastInsertRowid));
    }
  })();

  const demoCustomer = customers[0];
  db().prepare(`UPDATE customers SET name = 'Casey Lane', company = 'Northwind Retail', email = 'customer@brightloop.dev' WHERE id = ?`).run(demoCustomer);
  insertUser.run('customer@brightloop.dev', 'Casey Lane', hash, 'customer', demoCustomer, now);

  // Plan mix weighted toward small monthly customers, as the brief describes.
  const mix = [starter, starter, starter, starter, growth, growth, growth, scaleUp, annual, annualLite, annualLite, weekly];
  const historyStart = addDays(today, -HISTORY_DAYS);
  const pending: Array<{ start: string; input: SubscriptionInput; target: 'active' | 'closed' }> = [];
  const drafts: Array<{ input: SubscriptionInput; target: 'draft' | 'quotation' | 'confirmed' }> = [];

  for (let i = 0; i < SUBSCRIPTION_COUNT; i++) {
    const p = i < 4 ? pick([growth, scaleUp, annualLite]) : i % 400 === 7 ? daily : pick(mix);
    const customerId = i < 4 ? demoCustomer : pick(customers);
    const roll = random();
    const isOpenStage = i >= 4 && roll > 0.93;
    const skew = random() ** 0.8;
    const start = isOpenStage ? addDays(today, between(-2, 25)) : addDays(historyStart, Math.floor(skew * (HISTORY_DAYS - 3)));
    const isDaily = p === daily;
    const hasTerm = isDaily || p === annual || p === annualLite || random() < 0.3;
    const expiry = hasTerm ? addDays(start, isDaily ? between(5, 20) : p.period === 'yearly' ? 365 : between(180, 540)) : null;
    const seatsUpper = p === scaleUp ? 20 : p === annual ? 40 : p === starter ? 3 : 8;
    const quantity = between(p.min, Math.max(p.min, seatsUpper));
    const lines: SubscriptionInput['lines'] = [];
    if (random() < 0.3) lines.push({ productId: pick([support, analytics, storage]), variantId: null, quantity: 1 });
    if (random() < 0.08) lines.push({ productId: onboarding, variantId: null, quantity: 1 });
    const productOfPlan = p === scaleUp || p === annual ? 'erp' : 'cloud';
    const variantRoll = random();
    const planVariantId = variantRoll < 0.03 ? (productOfPlan === 'erp' ? erpOdoo : odoo) : variantRoll < 0.12 && productOfPlan === 'cloud' ? whiteLabel : null;
    const input: SubscriptionInput = {
      customerId,
      planId: p.id,
      templateId: null,
      startDate: start,
      expiryDate: expiry,
      paymentTermDays: pick([15, 30, 30, 30, 45]),
      validityDays: pick([14, 21, 30]),
      planQuantity: quantity,
      planVariantId,
      lines,
      notes: '',
    };
    if (isOpenStage) {
      drafts.push({ input, target: roll > 0.98 ? 'draft' : roll > 0.955 ? 'quotation' : 'confirmed' });
    } else {
      pending.push({ start, input, target: random() < 0.09 ? 'closed' : 'active' });
    }
  }

  pending.sort((a, b) => a.start.localeCompare(b.start));
  console.log(`Simulating ${HISTORY_DAYS} days of billing for ${pending.length} subscriptions...`);

  const closeLater: Array<{ id: number; day: string }> = [];
  let cursor = 0;
  db().transaction(() => {
    for (let offset = HISTORY_DAYS; offset >= 1; offset--) {
      const day = addDays(today, -offset);
      while (cursor < pending.length && pending[cursor].start <= day) {
        const { input, target } = pending[cursor++];
        const id = createSubscription(input, actor, day, true);
        transition(id, 'quotation', actor, { today: day, silent: true });
        transition(id, 'confirmed', actor, { today: day, silent: true });
        if (target === 'closed') closeLater.push({ id, day: addDays(day, between(40, 300)) });
      }
      runBilling({ today: day, trigger: 'scheduled', light: true });
      for (const item of closeLater) {
        if (item.day === day) {
          transition(item.id, 'closed', { ...actor, isAdmin: true }, { reason: pick(['Moved to a competitor', 'Budget cut', 'Business closed', 'Project finished']), today: day, at: `${day}T12:00:00.000Z`, silent: true });
        }
      }
    }
    for (const { input, target } of drafts) {
      const id = createSubscription(input, actor, today, true);
      if (target !== 'draft') transition(id, 'quotation', actor, { today, silent: true });
      if (target === 'confirmed') transition(id, 'confirmed', actor, { today, silent: true });
    }
    db().prepare(`DELETE FROM billing_runs WHERE created = 0 AND activated = 0 AND closed = 0`).run();

    const invoices = db().prepare(`SELECT id, total, issue_date, due_date FROM invoices WHERE status = 'draft' ORDER BY id`).all() as Array<{ id: number; total: number; issue_date: string; due_date: string }>;
    const methods = ['bank_transfer', 'bank_transfer', 'bank_transfer', 'card', 'card', 'upi', 'cheque', 'cash'];
    const yesterday = addDays(today, -1);
    for (const inv of invoices) {
      // The last few days of invoices stay draft, so billing day has work on screen.
      if (inv.issue_date >= addDays(today, -2)) continue;
      confirmInvoice(inv.id, actor, true);
      db().prepare('UPDATE invoices SET sent_at = ? WHERE id = ?').run(`${inv.issue_date}T10:00:00.000Z`, inv.id);
      const late = daysDiff(inv.due_date, today);
      const payChance = late > 60 ? 0.9995 : late > 0 ? 0.985 : 0.75;
      if (random() > payChance) continue;
      const span = daysDiff(inv.issue_date, inv.due_date);
      const paidOn = addDays(inv.issue_date, random() < 0.92 ? between(0, span) : between(span, span + 10));
      if (paidOn > yesterday) continue;
      const partial = random() < 0.03 && inv.total > 500_00;
      recordPayment(
        { invoiceId: inv.id, method: pick(methods), amount: partial ? Math.round(inv.total / 2) : inv.total, paymentDate: paidOn, note: partial ? 'Part payment, balance promised next week' : '' },
        actor,
        today,
        true,
      );
    }
  })();

  // Some live pauses, so the state is represented on screen.
  db().prepare(
    `UPDATE subscriptions SET paused_at = ? WHERE id IN (
       SELECT s.id FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active' AND p.pausable = 1 AND s.id % 37 = 0)`,
  ).run(now);
  runBilling({ today, trigger: 'scheduled', actor: { id: null, name: 'Automation' } });
  repriceAll(today);

  const counts = db()
    .prepare(`SELECT (SELECT COUNT(*) FROM subscriptions) AS subs, (SELECT COUNT(*) FROM invoices) AS invoices, (SELECT COUNT(*) FROM payments) AS payments, (SELECT COUNT(*) FROM customers) AS customers`)
    .get() as Record<string, number>;
  console.log(`Seeded ${counts.customers} customers, ${counts.subs} subscriptions, ${counts.invoices} invoices, ${counts.payments} payments in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  console.log(`\nSign in with password ${DEMO_PASSWORD}:\n  admin@brightloop.dev\n  staff@brightloop.dev\n  customer@brightloop.dev`);
}

function daysDiff(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
