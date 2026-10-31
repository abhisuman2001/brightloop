import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, isValidDate, todayISO } from '../shared/dates';
import { priceLines, taxesForSale } from '../shared/pricing';
import { db } from '../server/db';
import { billNextPeriod, confirmInvoice, runBilling } from '../server/services/billing';
import { matchStatement, parseBankDate, parseCsv } from '../server/services/reconcile';
import { runReminders } from '../server/services/reminders';
import { createSubscription, getSubscriptionEntity, renew, transition, type SubscriptionInput } from '../server/services/subscriptions';
import { PASSWORD, freshApp, seedCatalog } from './helpers';

const actor = { id: null, name: 'Test', isAdmin: false };
let ctx: Awaited<ReturnType<typeof freshApp>>;
let cat: ReturnType<typeof seedCatalog>;

beforeEach(async () => {
  ctx = await freshApp();
  cat = seedCatalog();
});

function activeSub(over: Partial<SubscriptionInput> = {}, today = '2026-01-15') {
  const input: SubscriptionInput = { customerId: cat.customer, planId: cat.plan, templateId: null, startDate: '2026-01-15', expiryDate: null, paymentTermDays: 30, validityDays: 30, planQuantity: 2, planVariantId: null, lines: [], notes: '', ...over };
  const id = createSubscription(input, actor, today);
  transition(id, 'quotation', actor, { today });
  transition(id, 'confirmed', actor, { today });
  transition(id, 'active', actor, { today });
  return id;
}

const invoicesOf = (id: number) => db().prepare('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY period_start').all(id) as Array<Record<string, never>>;

describe('billing at the end of a term', () => {
  it('does not charge a full period for one day on the expiry date', () => {
    const id = activeSub({ expiryDate: '2026-03-15' });
    runBilling({ today: '2026-04-01' });
    expect(invoicesOf(id).map((i) => i.period_start)).toEqual(['2026-01-15', '2026-02-15']);
  });

  it('still bills a subscription that starts and ends on the same day', () => {
    const id = activeSub({ expiryDate: '2026-01-15' });
    runBilling({ today: '2026-01-15' });
    expect(invoicesOf(id)).toHaveLength(1);
  });

  it('still bills the last day of a daily plan', () => {
    db().prepare(`UPDATE plans SET billing_period = 'daily'`).run();
    const id = activeSub({ expiryDate: '2026-01-17' });
    runBilling({ today: '2026-02-01' });
    expect(invoicesOf(id).map((i) => i.period_start)).toEqual(['2026-01-15', '2026-01-16', '2026-01-17']);
  });

  it('agrees between the due list and the billing run', () => {
    activeSub({ expiryDate: '2026-02-15' });
    runBilling({ today: '2026-01-15' });
    expect(runBilling({ today: '2026-03-01' }).created).toBe(0);
    expect(() => billNextPeriod(db().prepare('SELECT id FROM subscriptions').pluck().get() as number, actor, '2026-03-01')).toThrow(/has been invoiced/);
  });
});

describe('renewing', () => {
  it('adds the original term every time rather than a growing one', () => {
    const id = activeSub({ expiryDate: '2026-02-14' });
    expect(renew(id, actor, undefined, '2026-02-01')).toBe('2026-03-16');
    expect(renew(id, actor, undefined, '2026-02-01')).toBe('2026-04-15');
    expect(renew(id, actor, undefined, '2026-02-01')).toBe('2026-05-15');
  });

  it('does not back-bill the months after a lapsed expiry', () => {
    const id = activeSub({ expiryDate: '2026-02-14' });
    runBilling({ today: '2026-06-01' });
    expect(invoicesOf(id)).toHaveLength(1);
    renew(id, actor, undefined, '2026-06-01');
    expect(getSubscriptionEntity(id).next_invoice_date).toBe('2026-06-15');
    runBilling({ today: '2026-06-15' });
    expect(invoicesOf(id).map((i) => i.period_start)).toEqual(['2026-01-15', '2026-06-15']);
  });

  it('keeps unbilled periods when renewed before it lapses', () => {
    const id = activeSub({ expiryDate: '2026-03-15' });
    runBilling({ today: '2026-03-01' });
    renew(id, actor, undefined, '2026-03-01');
    runBilling({ today: '2026-03-15' });
    expect(invoicesOf(id).map((i) => i.period_start)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('refuses a date in the past or too far ahead', () => {
    const id = activeSub({ expiryDate: '2026-02-14' });
    expect(() => renew(id, actor, '2026-02-20', '2026-03-01')).toThrow(/in the future/);
    expect(() => renew(id, actor, '2999-12-31', '2026-02-01')).toThrow(/at most/);
  });
});

describe('impossible dates', () => {
  it('knows a real date from a bad one', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-31', '2026-13-45', '2026-00-00', '2999-99-99', 'soon', '']) expect(isValidDate(bad)).toBe(false);
  });

  it('is refused by the API', async () => {
    const res = await ctx.admin.post('/api/subscriptions').send({ customerId: cat.customer, planId: cat.plan, startDate: '2026-13-45', paymentTermDays: 30, planQuantity: 2 }).expect(422);
    expect(res.body.fields.startDate).toMatch(/valid date/);
  });
});

describe('bad references get a clear error, never a 500', () => {
  it.each([
    ['a missing template on a subscription', () => ctx.admin.post('/api/subscriptions').send({ customerId: cat.customer, planId: cat.plan, templateId: 999, startDate: todayISO(), paymentTermDays: 30, planQuantity: 2 })],
    ['a missing plan on a template', () => ctx.admin.post('/api/templates').send({ name: 'x', planId: 999, validityDays: 1, paymentTermDays: 1, planQuantity: 1 })],
    ['a template below the minimum quantity', () => ctx.admin.post('/api/templates').send({ name: 'x', planId: cat.plan, validityDays: 1, paymentTermDays: 1, planQuantity: 1 })],
  ])('%s', async (_name, send) => {
    await send().expect(422);
  });

  it('treats a nonsense page number as page one', async () => {
    const res = await ctx.admin.get('/api/invoices?page=1e300').expect(200);
    expect(res.body.page).toBe(1);
  });
});

describe('a product taken off sale', () => {
  it('cannot be bought, but stays on the subscriptions that have it', async () => {
    const existing = activeSub({ startDate: todayISO(), lines: [{ productId: cat.addon, variantId: null, quantity: 1 }] }, todayISO());
    const body = { customerId: cat.customer, planId: cat.plan, startDate: todayISO(), paymentTermDays: 30, planQuantity: 2, lines: [{ productId: cat.addon, quantity: 1 }] };
    db().prepare('UPDATE products SET active = 0 WHERE id = ?').run(cat.addon);
    await ctx.admin.put(`/api/subscriptions/${existing}`).send(body).expect(200);
    await ctx.admin.post('/api/subscriptions').send(body).expect(422);
    db().prepare('UPDATE products SET active = 0 WHERE id = ?').run(cat.product);
    await ctx.admin.post('/api/subscriptions').send({ ...body, lines: [] }).expect(422);
  });
});

describe('payment rules', () => {
  it('refuses a date before the invoice was issued, and impossible dates', async () => {
    const id = activeSub({ startDate: todayISO() }, todayISO());
    runBilling({ today: todayISO() });
    const [invoice] = invoicesOf(id);
    confirmInvoice(invoice.id, actor);
    await ctx.staff.post('/api/payments').send({ invoiceId: invoice.id, method: 'card', amount: 100, paymentDate: addDays(todayISO(), -5) }).expect(422);
    await ctx.staff.post('/api/payments').send({ invoiceId: invoice.id, method: 'card', amount: 100, paymentDate: '2020-99-99' }).expect(422);
  });

  it('applies filters to the export, and leaves cancelled invoices out of the total', async () => {
    const id = activeSub({ startDate: todayISO() }, todayISO());
    runBilling({ today: todayISO() });
    const [invoice] = invoicesOf(id);
    confirmInvoice(invoice.id, actor);
    await ctx.staff.post('/api/payments').send({ invoiceId: invoice.id, method: 'card', amount: 100, paymentDate: todayISO() }).expect(201);
    const all = await ctx.staff.get('/api/payments/export.csv').expect(200);
    const none = await ctx.staff.get('/api/payments/export.csv?method=cash').expect(200);
    expect(all.text.trim().split('\r\n')).toHaveLength(2);
    expect(none.text.trim().split('\r\n')).toHaveLength(1);

    const other = activeSub({ startDate: todayISO() }, todayISO());
    runBilling({ today: todayISO() });
    await ctx.staff.post(`/api/invoices/${invoicesOf(other)[0].id}/cancel`).expect(200);
    const list = await ctx.staff.get('/api/invoices').expect(200);
    expect(list.body.summary.total).toBe(invoice.total);
  });
});

describe('portal privacy', () => {
  it('does not show customers who recorded a payment or the team note', async () => {
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/signup').send({ name: 'Pat', email: 'pat@shop.test', password: PASSWORD }).expect(201);
    const customerId = (db().prepare(`SELECT id FROM customers WHERE email = 'pat@shop.test'`).get() as { id: number }).id;
    const id = activeSub({ customerId, startDate: todayISO() }, todayISO());
    runBilling({ today: todayISO() });
    const [invoice] = invoicesOf(id);
    confirmInvoice(invoice.id, actor);
    await ctx.staff.post('/api/payments').send({ invoiceId: invoice.id, method: 'card', amount: 100, paymentDate: todayISO(), note: 'Customer sounded unhappy' }).expect(201);
    const { body } = await agent.get(`/api/portal/invoices/${invoice.id}`).expect(200);
    expect(body.payments[0].amount).toBe(100);
    expect(body.payments[0].note).toBe('');
    expect(body.payments[0].recordedBy).toBe('');
  });
});

describe('claiming an existing customer record', () => {
  it('links only once the person opens the emailed link', async () => {
    const email = 'dana@acme.test';
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/signup').send({ name: 'Dana', email, password: PASSWORD }).expect(201);
    const before = await agent.get('/api/auth/me');
    expect(before.body.customerId).not.toBe(cat.customer);

    await ctx.staff.post(`/api/customers/${cat.customer}/invite`).expect(200);
    const row = db().prepare('SELECT customer_id FROM users WHERE email = ?').get(email) as { customer_id: number };
    expect(row.customer_id).not.toBe(cat.customer);

    const { link } = db().prepare('SELECT link FROM email_log ORDER BY id DESC LIMIT 1').get() as { link: string };
    const token = new URL(link).searchParams.get('token');
    await request(ctx.app).post('/api/auth/reset-password').send({ token, password: 'Another#Pass1' }).expect(200);
    expect((db().prepare('SELECT customer_id FROM users WHERE email = ?').get(email) as { customer_id: number }).customer_id).toBe(cat.customer);
    await ctx.staff.post(`/api/customers/${cat.customer}/invite`).expect(409);
  });
});

describe('GST', () => {
  const taxes = [
    { id: 1, name: 'CGST 9%', rateBps: 900, productType: null, supply: 'intra' as const },
    { id: 2, name: 'SGST 9%', rateBps: 900, productType: null, supply: 'intra' as const },
    { id: 3, name: 'IGST 18%', rateBps: 1800, productType: null, supply: 'inter' as const },
  ];
  const SELLER = '29AABCB1234C1Z5';
  const names = (buyer: string) => taxesForSale(taxes, SELLER, buyer).map((t) => t.name);

  it('picks CGST and SGST in the same state, IGST in another, and in-state without a GSTIN', () => {
    expect(names('29ABCDE1234F1Z5')).toEqual(['CGST 9%', 'SGST 9%']);
    expect(names('27ABCDE1234F1Z5')).toEqual(['IGST 18%']);
    expect(names('')).toEqual(['CGST 9%', 'SGST 9%']);
    expect(names('not-a-gstin')).toEqual(['CGST 9%', 'SGST 9%']);
  });

  it('adds up the same either way, and reports each component', () => {
    const line = [{ key: 1, productId: 1, productType: 'software', quantity: 3, unitPrice: 99999, variantExtra: 0 }];
    const intra = priceLines(line, taxesForSale(taxes, SELLER, ''), [], '2026-01-01');
    const inter = priceLines(line, taxesForSale(taxes, SELLER, '27ABCDE1234F1Z5'), [], '2026-01-01');
    expect(intra.taxBreakdown.map((t) => t.name)).toEqual(['CGST 9%', 'SGST 9%']);
    expect(inter.taxBreakdown.map((t) => t.name)).toEqual(['IGST 18%']);
    expect(intra.taxBreakdown.reduce((sum, t) => sum + t.amount, 0)).toBe(intra.taxTotal);
    expect(Math.abs(intra.taxTotal - inter.taxTotal)).toBeLessThanOrEqual(1);
  });

  it('puts the breakdown, HSN code and seller on the real invoice', async () => {
    db().exec(`DELETE FROM tax_rules; INSERT INTO tax_rules (name, rate_bps, product_type, supply) VALUES ('CGST 9%', 900, NULL, 'intra'), ('SGST 9%', 900, NULL, 'intra'), ('IGST 18%', 1800, NULL, 'inter');`);
    db().prepare(`UPDATE products SET hsn_code = '998314' WHERE id = ?`).run(cat.product);
    db().prepare(`UPDATE customers SET tax_id = '27ABCDE1234F1Z5' WHERE id = ?`).run(cat.customer);
    const id = activeSub({ startDate: todayISO() }, todayISO());
    runBilling({ today: todayISO() });
    const { body } = await ctx.staff.get(`/api/invoices/${invoicesOf(id)[0].id}`).expect(200);
    expect(body.taxBreakdown).toEqual([{ name: 'IGST 18%', amount: 3600 }]);
    expect(body.lines[0].hsnCode).toBe('998314');
    expect(body.seller.gstin).toMatch(/^29/);
    const preview = await ctx.staff.get(`/api/subscriptions/${id}`).expect(200);
    expect(preview.body.totals.taxTotal).toBe(3600);
    const rules = await ctx.staff.get(`/api/taxes?customerId=${cat.customer}`).expect(200);
    expect(rules.body.map((t: { name: string }) => t.name)).toEqual(['IGST 18%']);
  });
});

describe('public pricing', () => {
  it('needs no login and lists only what is on sale, without costs', async () => {
    const hidden = db().prepare(`INSERT INTO plans (name, product_id, price, billing_period, active) VALUES ('Retired', ?, 100, 'monthly', 0)`).run(cat.product).lastInsertRowid;
    const future = db().prepare(`INSERT INTO plans (name, product_id, price, billing_period, start_date) VALUES ('Soon', ?, 100, 'monthly', '2999-01-01')`).run(cat.product).lastInsertRowid;
    const { body } = await request(ctx.app).get('/api/public/plans').expect(200);
    const ids = body.map((p: { id: number }) => p.id);
    expect(ids).toContain(cat.plan);
    expect(ids).not.toContain(Number(hidden));
    expect(ids).not.toContain(Number(future));
    expect(body[0].closable).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/cost/i);
  });
});

describe('reports', () => {
  it('shows new and churned MRR and the churn rate', async () => {
    const today = todayISO();
    const stays = activeSub({ startDate: addDays(today, -60) }, addDays(today, -60));
    const leaves = activeSub({ startDate: addDays(today, -60) }, addDays(today, -60));
    db().prepare('UPDATE subscriptions SET activated_at = ? WHERE id IN (?, ?)').run(`${addDays(today, -60)}T00:00:00.000Z`, stays, leaves);
    transition(leaves, 'closed', actor, { today });
    const fresh = activeSub({ startDate: today }, today);
    const { body } = await ctx.admin.get(`/api/reports/finance?from=${addDays(today, -30)}&to=${today}`).expect(200);
    expect(body.movement).toMatchObject({ newSubscriptions: 1, churnedSubscriptions: 1, startingMrr: 40000, newMrr: 20000, churnedMrr: 20000, averagePerCustomer: 40000 });
    expect(body.movement.churnRatePct).toBeCloseTo(100 / 3);
    expect(body.movement.revenueChurnPct).toBeCloseTo(100 / 3);
    expect(fresh).toBeGreaterThan(0);
  });
});

describe('bank statement matching', () => {
  const liveInvoice = (over: Partial<SubscriptionInput> = {}) => {
    const today = todayISO();
    const id = activeSub({ startDate: today, ...over }, today);
    runBilling({ today });
    const invoice = invoicesOf(id).at(-1)!;
    confirmInvoice(invoice.id, actor);
    return { id: invoice.id as number, number: invoice.number as string, total: invoice.total as number };
  };
  const csv = (...rows: string[]) => ['Txn Date,Narration,Ref No,Debit,Credit,Balance', ...rows].join('\r\n');
  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const today = () => todayISO();

  it('reads quoted CSV and the date forms banks use', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n\r\n1,2,3\n')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
    expect(parseBankDate('31/10/2026')).toBe('2026-10-31');
    expect(parseBankDate('01-02-26')).toBe('2026-02-01');
    expect(parseBankDate('31-Oct-2026 10:15')).toBe('2026-10-31');
    expect(parseBankDate('2026-10-31')).toBe('2026-10-31');
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankDate('yesterday')).toBeNull();
  });

  it('refuses a file with no usable columns', () => {
    expect(() => matchStatement('foo,bar\n1,2')).toThrow(/columns/);
  });

  it('matches by invoice number first, and ignores debits', () => {
    const invoice = liveInvoice();
    const { rows, summary } = matchStatement(csv(`${today()},"UPI/ACME/${invoice.number}",UTR1,,"${rupees(invoice.total)}",`, `${today()},Office rent,CHQ1,500.00,,`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ match: 'invoice', invoiceId: invoice.id, method: 'upi', amount: invoice.total });
    expect(summary).toMatchObject({ matched: 1, matchedAmount: invoice.total });
  });

  it('matches by amount only when one open invoice fits', () => {
    const invoice = liveInvoice();
    const row = `${today()},NEFT from a customer,UTR2,,${rupees(invoice.total)},`;
    expect(matchStatement(csv(row)).rows[0]).toMatchObject({ match: 'amount', invoiceId: invoice.id });
    liveInvoice();
    const again = matchStatement(csv(row)).rows[0];
    expect(again.match).toBe('none');
    expect(again.problem).toMatch(/2 open invoices/);
  });

  it('does not spend one invoice twice in the same file', () => {
    const invoice = liveInvoice();
    const row = `${today()},"NEFT ${invoice.number}",,,${rupees(invoice.total)},`;
    const { rows } = matchStatement(csv(row, row));
    expect(rows.map((r) => r.match)).toEqual(['invoice', 'none']);
    expect(rows[1].problem).toMatch(/More than the balance/);
  });

  it('explains what it will not match', () => {
    const invoice = liveInvoice();
    const row = (narration: string, amount: string, date = today()) => `${date},"${narration}",,,${amount},`;
    const { rows } = matchStatement(
      csv(row('NEFT INV-99999', '10.00'), row(`NEFT ${invoice.number}`, rupees(invoice.total + 100)), row('mystery', '1.23'), row(`NEFT ${invoice.number}`, '1.00', '31/02/2026'), row(`NEFT ${invoice.number}`, '1.00', addDays(today(), 1)), row(`NEFT ${invoice.number}`, '1.00', addDays(today(), -9))),
    );
    expect(rows.map((r) => r.problem)).toEqual([
      'INV-99999 does not exist',
      `More than the balance owed on ${invoice.number}`,
      'No open invoice matches',
      'The date could not be read',
      'The date is in the future',
      `Dated before ${invoice.number} was issued`,
    ]);
  });

  it('records reviewed matches and then flags the same reference as a duplicate', async () => {
    const invoice = liveInvoice();
    const statement = csv(`${today()},"UPI ${invoice.number}",UTR77,,${rupees(invoice.total)},`);
    const { body: preview } = await ctx.staff.post('/api/payments/reconcile/preview').send({ csv: statement }).expect(200);
    const [row] = preview.rows;
    const { body: applied } = await ctx.staff
      .post('/api/payments/reconcile/apply')
      .send({ items: [{ invoiceId: row.invoiceId, amount: row.amount, paymentDate: row.paymentDate, method: row.method, reference: row.reference, description: row.description }] })
      .expect(200);
    expect(applied).toEqual({ recorded: 1, failed: [] });
    const paid = await ctx.staff.get(`/api/invoices/${invoice.id}`).expect(200);
    expect(paid.body.status).toBe('paid');
    expect(paid.body.payments[0].note).toContain('Bank ref UTR77');
    expect(matchStatement(statement).rows[0].match).toBe('duplicate');
  });

  it('reports a stale match without stopping the others', async () => {
    const a = liveInvoice();
    const b = liveInvoice();
    const item = (invoiceId: number, amount: number) => ({ invoiceId, amount, paymentDate: today(), method: 'upi' });
    const { body } = await ctx.staff.post('/api/payments/reconcile/apply').send({ items: [item(a.id, a.total + 1), item(b.id, b.total)] }).expect(200);
    expect(body.recorded).toBe(1);
    expect(body.failed[0].invoiceId).toBe(a.id);
  });

  it('is for staff only, and its sample statement matches', async () => {
    const invoice = liveInvoice();
    const customer = request.agent(ctx.app);
    await customer.post('/api/auth/signup').send({ name: 'Pat', email: 'pat@shop.test', password: PASSWORD }).expect(201);
    await customer.post('/api/payments/reconcile/preview').send({ csv: 'x' }).expect(403);
    const sample = await ctx.staff.get('/api/payments/reconcile/sample.csv').expect(200);
    const { rows } = matchStatement(sample.text);
    expect(rows.find((r) => r.invoiceId === invoice.id)?.match).toBe('invoice');
    expect(rows.some((r) => r.match === 'none')).toBe(true);
  });
});

describe('reminders', () => {
  const sent = (like: string) => (db().prepare('SELECT COUNT(*) AS n FROM email_log WHERE subject LIKE ?').get(like) as { n: number }).n;

  it('chases overdue invoices on set days, once each', async () => {
    const id = activeSub();
    runBilling({ today: '2026-01-15' });
    const [invoice] = invoicesOf(id);
    confirmInvoice(invoice.id, actor);
    const due = invoice.due_date as string;
    expect((await runReminders(due)).overdue).toBe(0);
    expect((await runReminders(addDays(due, 1))).overdue).toBe(1);
    expect((await runReminders(addDays(due, 1))).overdue).toBe(0);
    expect((await runReminders(addDays(due, 2))).overdue).toBe(0);
    expect((await runReminders(addDays(due, 7))).overdue).toBe(1);
    expect(sent('Payment reminder%')).toBe(2);
  });

  it('does not chase a paid or cancelled invoice', async () => {
    const id = activeSub();
    runBilling({ today: '2026-01-15' });
    const [invoice] = invoicesOf(id);
    db().prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoice.id);
    expect((await runReminders(addDays(invoice.due_date, 1))).overdue).toBe(0);
  });

  it('warns before a renewable subscription ends, and not for other plans', async () => {
    activeSub({ expiryDate: '2026-06-30' });
    expect((await runReminders('2026-06-16')).renewals).toBe(1);
    expect((await runReminders('2026-06-16')).renewals).toBe(0);
    expect((await runReminders('2026-06-17')).renewals).toBe(0);
    expect((await runReminders('2026-06-29')).renewals).toBe(1);
    db().prepare('UPDATE plans SET renewable = 0').run();
    expect((await runReminders('2026-06-23')).renewals).toBe(0);
  });

  it('can be sent by hand from an invoice, for confirmed ones only', async () => {
    const today = todayISO();
    const id = activeSub({ startDate: today }, today);
    runBilling({ today });
    const [invoice] = invoicesOf(id);
    await ctx.staff.post(`/api/invoices/${invoice.id}/remind`).expect(409);
    confirmInvoice(invoice.id, actor);
    await ctx.staff.post(`/api/invoices/${invoice.id}/remind`).expect(200);
    const { body } = await ctx.staff.get(`/api/invoices/${invoice.id}`).expect(200);
    expect(body.lastReminderAt).toBeTruthy();
    await ctx.staff.post('/api/invoices/999999/remind').expect(404);
  });
});
