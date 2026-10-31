import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayISO } from '../shared/dates';
import { db } from '../server/db';
import { SYSTEM_ACTOR } from '../server/services/activity';
import { billNextPeriod, cancelInvoice, confirmInvoice, recordPayment, runBilling, voidPayment } from '../server/services/billing';
import { createSubscription, getSubscriptionEntity, pause, renew, resume, transition, updateSubscription, type SubscriptionInput } from '../server/services/subscriptions';
import { freshApp, seedCatalog } from './helpers';

const actor = { id: null, name: 'Test', isAdmin: false };
let cat: ReturnType<typeof seedCatalog>;

beforeEach(async () => {
  await freshApp();
  cat = seedCatalog();
});

const input = (over: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
  customerId: cat.customer,
  planId: cat.plan,
  templateId: null,
  startDate: '2026-01-15',
  expiryDate: null,
  paymentTermDays: 30,
  validityDays: 30,
  planQuantity: 2,
  planVariantId: null,
  lines: [],
  notes: '',
  ...over,
});

function activeSub(over: Partial<SubscriptionInput> = {}, today = '2026-01-15') {
  const id = createSubscription(input(over), actor, today);
  transition(id, 'quotation', actor, { today });
  transition(id, 'confirmed', actor, { today });
  transition(id, 'active', actor, { today });
  return id;
}

const invoicesOf = (id: number) =>
  db().prepare('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY period_start, id').all(id) as Array<Record<string, never>>;

describe('billing day', () => {
  it('creates an invoice from the subscription with lines, tax and totals filled in', () => {
    const id = activeSub({ planVariantId: cat.variant });
    expect(runBilling({ today: '2026-01-15' }).created).toBe(1);
    const [invoice] = invoicesOf(id);
    expect(invoice.status).toBe('draft');
    expect(invoice.customer_name).toBe('Dana');
    expect(invoice.subtotal).toBe(2 * (10000 + 56000));
    expect(invoice.tax_total).toBe(13200);
    expect(invoice.total).toBe(145200);
    expect(invoice.period_end).toBe('2026-02-14');
    expect(invoice.due_date).toBe('2026-02-14');
    const lines = db().prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(invoice.id) as Array<Record<string, never>>;
    expect(lines).toHaveLength(1);
    expect(lines[0].variant_label).toBe('Brand: Odoo');
  });

  it('does not bill twice when the run repeats', () => {
    const id = activeSub();
    expect(runBilling({ today: '2026-01-15' }).created).toBe(1);
    expect(runBilling({ today: '2026-01-15' }).created).toBe(0);
    expect(invoicesOf(id)).toHaveLength(1);
  });

  it('refuses a second live invoice for a period at the database level', () => {
    const id = activeSub();
    runBilling({ today: '2026-01-15' });
    const [inv] = invoicesOf(id);
    expect(() =>
      db()
        .prepare(
          `INSERT INTO invoices (number, subscription_id, customer_id, customer_name, customer_company, customer_email, customer_address, customer_tax_id,
             period_start, period_end, issue_date, due_date, subtotal, discount_total, tax_total, total, created_at)
           VALUES ('DUP', ?, ?, '', '', '', '', '', ?, ?, ?, ?, 0, 0, 0, 0, '')`,
        )
        .run(id, cat.customer, inv.period_start, inv.period_end, inv.issue_date, inv.due_date),
    ).toThrow(/UNIQUE/);
  });

  it('catches up every missed period instead of skipping', () => {
    const id = activeSub();
    expect(runBilling({ today: '2026-04-20' }).created).toBe(4);
    expect(invoicesOf(id).map((i) => i.period_start)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
    expect(getSubscriptionEntity(id).next_invoice_date).toBe('2026-05-15');
  });

  it('does not bill past the expiry date', () => {
    const id = activeSub({ expiryDate: '2026-02-20' });
    runBilling({ today: '2026-06-01' });
    expect(invoicesOf(id).map((i) => i.period_start)).toEqual(['2026-01-15', '2026-02-15']);
    expect(invoicesOf(id)[1].period_end).toBe('2026-02-20');
  });

  it('skips drafts, quotations and closed subscriptions', () => {
    createSubscription(input(), actor, '2026-01-15');
    const closed = activeSub();
    transition(closed, 'closed', actor, { today: '2026-01-15' });
    expect(runBilling({ today: '2026-03-01' }).created).toBe(0);
  });

  it('activates a confirmed subscription on its start date', () => {
    const id = createSubscription(input({ startDate: '2026-03-01' }), actor, '2026-01-15');
    transition(id, 'quotation', actor, { today: '2026-01-15' });
    transition(id, 'confirmed', actor, { today: '2026-01-15' });
    expect(runBilling({ today: '2026-02-28' }).activated).toBe(0);
    const run = runBilling({ today: '2026-03-01' });
    expect(run.activated).toBe(1);
    expect(run.created).toBe(1);
  });

  it('isolates a broken subscription so the rest still bill', () => {
    const broken = activeSub();
    const fine = activeSub();
    db().prepare('DELETE FROM subscription_lines WHERE subscription_id = ?').run(broken);
    const run = runBilling({ today: '2026-01-15' });
    expect(run.created).toBe(1);
    expect(run.failed).toBe(1);
    expect(run.errors[0].subscriptionId).toBe(broken);
    expect(invoicesOf(fine)).toHaveLength(1);
    expect(getSubscriptionEntity(broken).next_invoice_date).toBe('2026-01-15');
  });

  it('closes plans set to close on their own, and only those', () => {
    db().prepare('UPDATE plans SET auto_close = 1').run();
    const id = activeSub({ expiryDate: '2026-02-01' });
    expect(runBilling({ today: '2026-02-01' }).closed).toBe(0);
    expect(runBilling({ today: '2026-02-02' }).closed).toBe(1);
    expect(getSubscriptionEntity(id).status).toBe('closed');
  });

  it('leaves other plans active past expiry but stops billing them', () => {
    const id = activeSub({ expiryDate: '2026-02-01' });
    runBilling({ today: '2026-05-01' });
    expect(getSubscriptionEntity(id).status).toBe('active');
    expect(invoicesOf(id)).toHaveLength(1);
  });
});

describe('cancelling an invoice', () => {
  it('reopens the period so it is billed again rather than skipped', () => {
    const id = activeSub();
    runBilling({ today: '2026-03-20' });
    const invoices = invoicesOf(id);
    expect(invoices).toHaveLength(3);
    cancelInvoice(invoices[1].id, actor, '2026-03-20');
    const run = runBilling({ today: '2026-03-20' });
    expect(run.created).toBe(1);
    expect(run.skipped).toBe(1);
    const live = invoicesOf(id).filter((i) => i.status !== 'cancelled');
    expect(live.map((i) => i.period_start)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(getSubscriptionEntity(id).next_invoice_date).toBe('2026-04-15');
  });

  it('refuses when money has been received', () => {
    const id = activeSub();
    runBilling({ today: '2026-01-15' });
    const [inv] = invoicesOf(id);
    confirmInvoice(inv.id, actor);
    recordPayment({ invoiceId: inv.id, method: 'card', amount: 100, paymentDate: '2026-01-16', note: '' }, actor, '2026-01-20');
    expect(() => cancelInvoice(inv.id, actor)).toThrow(/payments recorded/);
  });
});

describe('discounts on invoices', () => {
  const addRule = (over: Record<string, unknown> = {}) => {
    const rule = { name: 'Volume', kind: 'percent', value: 1000, min_quantity: 5, usage_limit: null, end_date: null, ...over };
    return Number(
      db()
        .prepare(`INSERT INTO discounts (name, kind, value, min_quantity, usage_limit, end_date, scope) VALUES (@name, @kind, @value, @min_quantity, @usage_limit, @end_date, 'subscription')`)
        .run(rule).lastInsertRowid,
    );
  };

  it('appears on the next invoice on its own', () => {
    addRule();
    const id = activeSub({ planQuantity: 5 });
    runBilling({ today: '2026-01-15' });
    expect(invoicesOf(id)[0].discount_total).toBe(5000);
  });

  it('stops when it expires', () => {
    addRule({ end_date: '2026-02-14' });
    const id = activeSub({ planQuantity: 5 });
    runBilling({ today: '2026-02-20' });
    expect(invoicesOf(id).map((i) => i.discount_total)).toEqual([5000, 0]);
  });

  it('stops when it runs out, even partway through one run', () => {
    const rule = addRule({ usage_limit: 2 });
    const subs = [activeSub({ planQuantity: 5 }), activeSub({ planQuantity: 5 }), activeSub({ planQuantity: 5 })];
    runBilling({ today: '2026-01-15' });
    expect(subs.map((s) => invoicesOf(s)[0].discount_total)).toEqual([5000, 5000, 0]);
    expect((db().prepare('SELECT used_count FROM discounts WHERE id = ?').get(rule) as { used_count: number }).used_count).toBe(2);
  });

  it('gives the usage back when an invoice is cancelled', () => {
    const rule = addRule({ usage_limit: 1 });
    const id = activeSub({ planQuantity: 5 });
    runBilling({ today: '2026-01-15' });
    cancelInvoice(invoicesOf(id)[0].id, actor);
    expect((db().prepare('SELECT used_count FROM discounts WHERE id = ?').get(rule) as { used_count: number }).used_count).toBe(0);
  });
});

describe('payments', () => {
  function confirmedInvoice() {
    const id = activeSub();
    runBilling({ today: '2026-01-15' });
    const [inv] = invoicesOf(id);
    confirmInvoice(inv.id, actor);
    return inv.id as number;
  }
  const statusOf = (id: number) => (db().prepare('SELECT status, amount_paid FROM invoices WHERE id = ?').get(id) as { status: string; amount_paid: number });

  it('moves to paid only when fully covered, across partial payments', () => {
    const id = confirmedInvoice();
    recordPayment({ invoiceId: id, method: 'cash', amount: 10000, paymentDate: '2026-01-20', note: '' }, actor, '2026-01-20');
    expect(statusOf(id)).toEqual({ status: 'confirmed', amount_paid: 10000 });
    recordPayment({ invoiceId: id, method: 'card', amount: 12000, paymentDate: '2026-01-21', note: 'rest' }, actor, '2026-01-21');
    expect(statusOf(id)).toEqual({ status: 'paid', amount_paid: 22000 });
  });

  it('rejects overpayment, draft invoices and future dates', () => {
    const id = confirmedInvoice();
    expect(() => recordPayment({ invoiceId: id, method: 'cash', amount: 22001, paymentDate: '2026-01-20', note: '' }, actor, '2026-01-20')).toThrow(/more than/);
    expect(() => recordPayment({ invoiceId: id, method: 'cash', amount: 1, paymentDate: '2026-01-21', note: '' }, actor, '2026-01-20')).toThrow(/future/);
    db().prepare(`UPDATE invoices SET status = 'draft' WHERE id = ?`).run(id);
    expect(() => recordPayment({ invoiceId: id, method: 'cash', amount: 1, paymentDate: '2026-01-20', note: '' }, actor, '2026-01-20')).toThrow(/Confirm/);
  });

  it('reopens an invoice when a payment is voided', () => {
    const id = confirmedInvoice();
    const payment = recordPayment({ invoiceId: id, method: 'cash', amount: 22000, paymentDate: '2026-01-20', note: '' }, actor, '2026-01-20');
    voidPayment(payment, actor);
    expect(statusOf(id)).toEqual({ status: 'confirmed', amount_paid: 0 });
    expect(() => voidPayment(payment, actor)).toThrow(/already void/);
  });
});

describe('lifecycle rules set per plan', () => {
  it('moves only forward through the pipeline', () => {
    const id = createSubscription(input(), actor, '2026-01-15');
    expect(() => transition(id, 'active', actor, { today: '2026-01-15' })).toThrow(/cannot move/);
    expect(() => transition(id, 'confirmed', actor, { today: '2026-01-15' })).toThrow(/cannot move/);
    transition(id, 'quotation', actor, { today: '2026-01-15' });
    expect(() => transition(id, 'draft', actor, { today: '2026-01-15' })).toThrow(/cannot move/);
  });

  it('blocks confirming an expired quotation', () => {
    const id = createSubscription(input({ validityDays: 5 }), actor, '2026-01-15');
    transition(id, 'quotation', actor, { today: '2026-01-15' });
    expect(() => transition(id, 'confirmed', actor, { today: '2026-01-21' })).toThrow(/expired/);
  });

  it('lets an edit revive an expired quotation', () => {
    const id = createSubscription(input({ validityDays: 5 }), actor, '2026-01-15');
    transition(id, 'quotation', actor, { today: '2026-01-15' });
    updateSubscription(id, input({ validityDays: 5 }), actor, '2026-01-21');
    expect(getSubscriptionEntity(id).quote_valid_until).toBe('2026-01-26');
    transition(id, 'confirmed', actor, { today: '2026-01-21' });
  });

  it('enforces minimum quantity and availability dates', () => {
    expect(() => createSubscription(input({ planQuantity: 1 }), actor, '2026-01-15')).toThrow(/minimum quantity/);
    db().prepare(`UPDATE plans SET end_date = '2026-01-01'`).run();
    expect(() => createSubscription(input(), actor, '2026-01-15')).toThrow(/stopped being available/);
  });

  it('respects a plan that cannot be closed early', () => {
    db().prepare('UPDATE plans SET closable = 0').run();
    const id = activeSub({ expiryDate: '2026-12-31' });
    expect(() => transition(id, 'closed', actor, { today: '2026-02-01' })).toThrow(/cannot be closed early/);
    transition(id, 'closed', { ...actor, isAdmin: true }, { today: '2026-02-01' });
    expect(getSubscriptionEntity(id).status).toBe('closed');
  });

  it('allows closing a non-closable plan once its term is over', () => {
    db().prepare('UPDATE plans SET closable = 0').run();
    const id = activeSub({ expiryDate: '2026-02-01' });
    transition(id, 'closed', actor, { today: '2026-02-02' });
    expect(getSubscriptionEntity(id).status).toBe('closed');
  });

  it('respects a plan that cannot be paused or renewed', () => {
    db().prepare('UPDATE plans SET pausable = 0, renewable = 0').run();
    const id = activeSub({ expiryDate: '2026-12-31' });
    expect(() => pause(id, actor)).toThrow(/does not allow pausing/);
    expect(() => renew(id, actor)).toThrow(/does not allow renewal/);
  });

  it('does not bill while paused, and does not back-bill after resuming', () => {
    const id = activeSub();
    const today = todayISO();
    db().prepare('UPDATE subscriptions SET next_invoice_date = ?, start_date = ? WHERE id = ?').run(addDays(today, -40), addDays(today, -40), id);
    pause(id, actor);
    expect(runBilling({ today }).created).toBe(0);
    resume(id, actor, today);
    expect(runBilling({ today }).created).toBe(0);
    expect(getSubscriptionEntity(id).next_invoice_date! >= today).toBe(true);
  });

  it('extends the term by its original length on renewal', () => {
    const id = activeSub({ startDate: '2026-01-15', expiryDate: '2026-02-14' });
    expect(renew(id, actor, undefined, '2026-02-01')).toBe('2026-03-16');
  });
});

describe('create invoice now', () => {
  it('bills the next period once and never duplicates a billing run', () => {
    const id = activeSub();
    billNextPeriod(id, actor, '2026-01-10');
    expect(runBilling({ today: '2026-01-15' }).created).toBe(0);
    billNextPeriod(id, actor, '2026-01-16');
    expect(invoicesOf(id).map((i) => i.period_start)).toEqual(['2026-01-15', '2026-02-15']);
    expect(runBilling({ today: '2026-02-15' }).created).toBe(0);
  });

  it('refuses paused or inactive subscriptions', () => {
    const id = activeSub();
    pause(id, actor);
    expect(() => billNextPeriod(id, actor)).toThrow(/paused/);
    expect(() => billNextPeriod(createSubscription(input(), SYSTEM_ACTOR, '2026-01-15'), actor)).toThrow(/Only an active/);
  });
});
