import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayISO } from '../shared/dates';
import { db } from '../server/db';
import { PASSWORD, freshApp, seedCatalog } from './helpers';

let ctx: Awaited<ReturnType<typeof freshApp>>;
let cat: ReturnType<typeof seedCatalog>;

beforeEach(async () => {
  ctx = await freshApp();
  cat = seedCatalog();
});

const signup = (email: string, password = PASSWORD) => request(ctx.app).post('/api/auth/signup').send({ name: 'New', email, password });
const lastLink = () => (db().prepare('SELECT link FROM email_log ORDER BY id DESC LIMIT 1').get() as { link: string }).link;
const newSub = (customerId = cat.customer) => ({
  customerId,
  planId: cat.plan,
  startDate: todayISO(),
  paymentTermDays: 30,
  planQuantity: 2,
  lines: [],
});

async function liveSub(agent = ctx.staff, customerId = cat.customer) {
  const { body } = await agent.post('/api/subscriptions').send(newSub(customerId)).expect(201);
  await agent.post(`/api/subscriptions/${body.id}/transition`).send({ to: 'quotation' }).expect(200);
  await agent.post(`/api/subscriptions/${body.id}/transition`).send({ to: 'confirmed' }).expect(200);
  await agent.post(`/api/subscriptions/${body.id}/transition`).send({ to: 'active' }).expect(200);
  return body.id as number;
}

describe('accounts', () => {
  it('allows each email only once, regardless of case', async () => {
    await signup('Someone@Example.com').expect(201);
    const res = await signup('someone@example.COM').expect(409);
    expect(res.body.fields.email).toMatch(/already exists/);
  });

  it('enforces the password rules on signup', async () => {
    for (const bad of ['Short#1', 'alllowercase#1', 'ALLUPPERCASE#1', 'NoSpecialChar1', 'Exact12!']) {
      await signup('x@example.com', bad).expect(422);
    }
    await signup('x@example.com', 'Exactly9!a').expect(201);
  });

  it('never stores the password in plain text', async () => {
    await signup('plain@example.com').expect(201);
    const row = db().prepare('SELECT password_hash FROM users WHERE email = ?').get('plain@example.com') as { password_hash: string };
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const a = await request(ctx.app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'wrong' }).expect(401);
    const b = await request(ctx.app).post('/api/auth/login').send({ email: 'ghost@test.dev', password: 'wrong' }).expect(401);
    expect(a.body).toEqual(b.body);
  });

  it('resets a password through a single-use emailed link and ends old sessions', async () => {
    const before = await ctx.login('staff@test.dev');
    await request(ctx.app).post('/api/auth/forgot-password').send({ email: 'staff@test.dev' }).expect(200);
    const token = new URL(lastLink()).searchParams.get('token')!;
    await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'weak' }).expect(422);
    await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'Brand#New1pass' }).expect(200);
    await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'Other#New1pass' }).expect(400);
    await before.get('/api/subscriptions').expect(401);
    await ctx.login('staff@test.dev', 'Brand#New1pass');
  });

  it('does not reveal whether an email has an account when resetting', async () => {
    const known = await request(ctx.app).post('/api/auth/forgot-password').send({ email: 'staff@test.dev' }).expect(200);
    const count = (db().prepare('SELECT COUNT(*) AS n FROM email_log').get() as { n: number }).n;
    const unknown = await request(ctx.app).post('/api/auth/forgot-password').send({ email: 'ghost@test.dev' }).expect(200);
    expect(unknown.body).toEqual(known.body);
    expect((db().prepare('SELECT COUNT(*) AS n FROM email_log').get() as { n: number }).n).toBe(count);
  });

  it('rejects an expired reset link', async () => {
    await request(ctx.app).post('/api/auth/forgot-password').send({ email: 'staff@test.dev' }).expect(200);
    const token = new URL(lastLink()).searchParams.get('token')!;
    db().prepare(`UPDATE password_tokens SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
    await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'Brand#New1pass' }).expect(400);
  });

  it('blocks cross-site writes', async () => {
    await ctx.admin.post('/api/auth/logout').set('Origin', 'https://evil.example').expect(403);
  });
});

describe('roles', () => {
  it('rejects anonymous requests', async () => {
    for (const path of ['/api/subscriptions', '/api/invoices', '/api/dashboard', '/api/portal/overview', '/api/team']) {
      await request(ctx.app).get(path).expect(401);
    }
  });

  it('lets only the admin add staff, and they arrive by invite link', async () => {
    await ctx.staff.post('/api/team').send({ name: 'N', email: 'n@test.dev' }).expect(403);
    const res = await ctx.admin.post('/api/team').send({ name: 'N', email: 'n@test.dev' }).expect(201);
    expect(res.body.member.invitePending).toBe(true);
    const token = new URL(lastLink()).searchParams.get('token')!;
    await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'Brand#New1pass' }).expect(200);
    await ctx.login('n@test.dev', 'Brand#New1pass');
  });

  it('never lets signup create anything but a customer', async () => {
    const res = await request(ctx.app).post('/api/auth/signup').send({ name: 'E', email: 'e@test.dev', password: PASSWORD, role: 'admin' }).expect(201);
    expect(res.body.role).toBe('customer');
  });

  it('lets only the admin create discounts, plans, products and taxes', async () => {
    const discount = { name: 'D', kind: 'percent', value: 500, scope: 'subscription' };
    await ctx.staff.post('/api/discounts').send(discount).expect(403);
    await ctx.staff.post('/api/products').send({ name: 'P', type: 'software', salesPrice: 1, costPrice: 1 }).expect(403);
    await ctx.staff.post('/api/plans').send({ name: 'P', productId: cat.product, price: 1, billingPeriod: 'monthly', minQuantity: 1 }).expect(403);
    await ctx.staff.post('/api/taxes').send({ name: 'T', rateBps: 100, productType: null }).expect(403);
    await ctx.admin.post('/api/discounts').send(discount).expect(201);
    await ctx.staff.get('/api/discounts').expect(200);
  });

  it('keeps customers out of the staff API', async () => {
    await signup('c@test.dev').expect(201);
    const customer = await ctx.login('c@test.dev');
    for (const path of ['/api/subscriptions', '/api/invoices', '/api/customers', '/api/payments', '/api/dashboard', '/api/search?q=a', '/api/reports/finance']) {
      await customer.get(path).expect(403);
    }
    await customer.post('/api/billing/run').expect(403);
  });

  it('lets an admin drop to staff with real effect, but nobody can climb back up who was not admin', async () => {
    await ctx.admin.post('/api/auth/view-as').send({ role: 'staff' }).expect(200);
    await ctx.admin.get('/api/team').expect(403);
    await ctx.admin.post('/api/auth/view-as').send({ role: 'admin' }).expect(200);
    await ctx.admin.get('/api/team').expect(200);
    await ctx.staff.post('/api/auth/view-as').send({ role: 'admin' }).expect(403);
  });
});

describe('customer portal', () => {
  async function customerWithSub() {
    await signup('owner@test.dev').expect(201);
    const owner = await ctx.login('owner@test.dev');
    const { customer_id: customerId } = db().prepare('SELECT customer_id FROM users WHERE email = ?').get('owner@test.dev') as { customer_id: number };
    const subId = await liveSub(ctx.staff, customerId);
    await signup('other@test.dev').expect(201);
    const other = await ctx.login('other@test.dev');
    return { owner, other, subId };
  }

  it('shows customers only their own records', async () => {
    const { owner, other, subId } = await customerWithSub();
    const invoice = await ctx.staff.post(`/api/subscriptions/${subId}/invoice`).expect(201);
    const { invoiceId } = invoice.body;
    await ctx.staff.post(`/api/invoices/${invoiceId}/confirm`).expect(200);

    const mine = await owner.get('/api/portal/overview').expect(200);
    expect(mine.body.subscriptions).toHaveLength(1);
    expect(mine.body.invoices).toHaveLength(1);
    await owner.get(`/api/portal/invoices/${invoiceId}`).expect(200);

    const theirs = await other.get('/api/portal/overview').expect(200);
    expect(theirs.body.subscriptions).toHaveLength(0);
    expect(theirs.body.invoices).toHaveLength(0);
    await other.get(`/api/portal/subscriptions/${subId}`).expect(404);
    await other.get(`/api/portal/invoices/${invoiceId}`).expect(404);
    await other.post(`/api/portal/subscriptions/${subId}/cancel`).expect(404);
    await other.post(`/api/portal/subscriptions/${subId}/pause`).expect(404);
    await other.post(`/api/portal/subscriptions/${subId}/addons`).send({ productId: cat.addon, enabled: true }).expect(404);
  });

  it('hides draft invoices from the customer', async () => {
    const { owner, subId } = await customerWithSub();
    const { invoiceId } = (await ctx.staff.post(`/api/subscriptions/${subId}/invoice`).expect(201)).body;
    await owner.get(`/api/portal/invoices/${invoiceId}`).expect(404);
    expect((await owner.get('/api/portal/overview')).body.invoices).toHaveLength(0);
  });

  it('hides internal drafts and staff notes from the customer', async () => {
    await signup('notes@test.dev').expect(201);
    const customer = await ctx.login('notes@test.dev');
    const { customer_id: customerId } = db().prepare('SELECT customer_id FROM users WHERE email = ?').get('notes@test.dev') as { customer_id: number };
    const { body: draft } = await ctx.staff.post('/api/subscriptions').send({ ...newSub(customerId), notes: 'Margin is thin, do not discount' }).expect(201);
    expect((await customer.get('/api/portal/overview').expect(200)).body.subscriptions).toHaveLength(0);
    await customer.get(`/api/portal/subscriptions/${draft.id}`).expect(404);
    await customer.post(`/api/portal/subscriptions/${draft.id}/accept`).expect(404);
    await ctx.staff.post(`/api/subscriptions/${draft.id}/transition`).send({ to: 'quotation' }).expect(200);
    const visible = await customer.get(`/api/portal/subscriptions/${draft.id}`).expect(200);
    expect(JSON.stringify(visible.body)).not.toContain('Margin is thin');
  });

  it('switches add-ons on and off, which the next invoice reflects', async () => {
    const { owner, subId } = await customerWithSub();
    const on = await owner.post(`/api/portal/subscriptions/${subId}/addons`).send({ productId: cat.addon, enabled: true }).expect(200);
    expect(on.body.addons[0].enabled).toBe(true);
    expect(on.body.totals.subtotal).toBe(2 * 10000 + 5000);
    await owner.post(`/api/portal/subscriptions/${subId}/addons`).send({ productId: cat.addon, enabled: true }).expect(200);
    const twice = await owner.get(`/api/portal/subscriptions/${subId}`).expect(200);
    expect(twice.body.lines).toHaveLength(2);
    const off = await owner.post(`/api/portal/subscriptions/${subId}/addons`).send({ productId: cat.addon, enabled: false }).expect(200);
    expect(off.body.totals.subtotal).toBe(2 * 10000);
  });

  it('refuses a non add-on product through the add-on switch', async () => {
    const { owner, subId } = await customerWithSub();
    await owner.post(`/api/portal/subscriptions/${subId}/addons`).send({ productId: cat.product, enabled: true }).expect(404);
  });

  it('runs signup through to a billed subscription without staff', async () => {
    await signup('self@test.dev').expect(201);
    const self = await ctx.login('self@test.dev');
    const quote = await self.post('/api/portal/subscriptions').send({ planId: cat.plan, quantity: 2 }).expect(201);
    expect(quote.body.status).toBe('quotation');
    const accepted = await self.post(`/api/portal/subscriptions/${quote.body.id}/accept`).expect(200);
    expect(accepted.body.status).toBe('active');
    // The invoice exists as a draft for staff to confirm, so the customer does not see it yet.
    expect(accepted.body.invoices).toHaveLength(0);
    expect((await ctx.staff.get(`/api/subscriptions/${quote.body.id}`).expect(200)).body.invoices).toHaveLength(1);
    await self.post('/api/portal/subscriptions').send({ planId: cat.plan, quantity: 1 }).expect(422);
  });

  it('does not let a customer link themselves to an existing customer by email', async () => {
    await signup('dana@acme.test').expect(201);
    const row = db().prepare('SELECT customer_id FROM users WHERE email = ?').get('dana@acme.test') as { customer_id: number };
    expect(row.customer_id).not.toBe(cat.customer);
  });
});

describe('invoices and subscriptions over the API', () => {
  it('walks an invoice from draft through confirmed to paid, and lists it as overdue in between', async () => {
    const subId = await liveSub();
    const { invoiceId } = (await ctx.staff.post(`/api/subscriptions/${subId}/invoice`).expect(201)).body;
    await ctx.staff.post(`/api/invoices/${invoiceId}/send`).expect(409);
    await ctx.staff.post(`/api/invoices/${invoiceId}/confirm`).expect(200);
    const sent = await ctx.staff.post(`/api/invoices/${invoiceId}/send`).expect(200);
    expect(sent.body.sentAt).toBeTruthy();

    db().prepare('UPDATE invoices SET due_date = ? WHERE id = ?').run(addDays(todayISO(), -3), invoiceId);
    const overdue = await ctx.staff.get('/api/invoices?status=overdue').expect(200);
    expect(overdue.body.rows.map((r: { id: number }) => r.id)).toEqual([invoiceId]);
    const subs = await ctx.staff.get('/api/subscriptions?overdue=1').expect(200);
    expect(subs.body.rows[0].overdue).toBe(true);

    const total = overdue.body.rows[0].total;
    const paid = await ctx.staff.post('/api/payments').send({ invoiceId, method: 'card', amount: total, paymentDate: todayISO() }).expect(201);
    expect(paid.body.status).toBe('paid');
    expect(paid.body.balance).toBe(0);
    expect((await ctx.staff.get('/api/invoices?status=overdue')).body.total).toBe(0);
  });

  it('validates input with field errors', async () => {
    const res = await ctx.staff.post('/api/subscriptions').send({ ...newSub(), planQuantity: 0 }).expect(422);
    expect(res.body.fields.planQuantity).toBeTruthy();
  });

  it('treats search text as literal, not as SQL or wildcards', async () => {
    await liveSub();
    expect((await ctx.staff.get(`/api/subscriptions?q=${encodeURIComponent("' OR 1=1 --")}`).expect(200)).body.total).toBe(0);
    expect((await ctx.staff.get('/api/subscriptions?q=%25').expect(200)).body.total).toBe(0);
    expect((await ctx.staff.get('/api/subscriptions?q=SUB-').expect(200)).body.total).toBe(1);
  });

  it('exports CSV that a spreadsheet cannot execute', async () => {
    db().prepare(`UPDATE customers SET name = '=HYPERLINK("evil")' WHERE id = ?`).run(cat.customer);
    await liveSub();
    const res = await ctx.staff.get('/api/subscriptions/export.csv').expect(200);
    expect(res.text).toContain(`"'=HYPERLINK(""evil"")"`);
  });

  it('keeps the plan billing frequency fixed while subscriptions use it', async () => {
    await liveSub();
    await ctx.admin.patch(`/api/plans/${cat.plan}`).send({ name: 'Monthly', productId: cat.product, price: 10000, billingPeriod: 'yearly', minQuantity: 1 }).expect(409);
  });

  it('reports the headline numbers from the same data', async () => {
    const subId = await liveSub();
    const { invoiceId } = (await ctx.staff.post(`/api/subscriptions/${subId}/invoice`).expect(201)).body;
    await ctx.staff.post(`/api/invoices/${invoiceId}/confirm`).expect(200);
    const dash = (await ctx.staff.get('/api/dashboard').expect(200)).body;
    expect(dash.mrr).toBe(20000);
    expect(dash.activeSubscriptions).toBe(1);
    expect(dash.mrrTrend).toHaveLength(12);
    const report = (await ctx.staff.get('/api/reports/finance').expect(200)).body;
    expect(report.outstanding).toBe(22000);
    expect(report.invoiced).toBe(22000);
    expect(report.byPlan[0].active).toBe(1);
  });
});
