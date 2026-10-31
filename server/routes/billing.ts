import { Router, type Request } from 'express';
import { todayISO } from '../../shared/dates';
import { paymentSchema, reconcileApplySchema, reconcilePreviewSchema } from '../../shared/schemas';
import type { BillingRunResult, BillingStatus, InvoiceDetail, InvoiceLine, InvoiceList, InvoiceRow, InvoiceStatus, Payment, PaymentList } from '../../shared/types';
import { requireAdmin, requireStaff, user } from '../auth';
import { db } from '../db';
import { idParam, isoDateParam, likePattern, money, notFound, paging, parse, str, toCsv } from '../http';
import type { Actor } from '../services/activity';
import { cancelInvoice, confirmAllDrafts, confirmInvoice, recordPayment, runBilling, sendInvoice, voidPayment } from '../services/billing';
import { sellerInfo } from '../services/company';
import { applyMatches, matchStatement, sampleStatement } from '../services/reconcile';
import { remindInvoice } from '../services/reminders';
import { BILLABLE_SQL, INVOICE_ROW_SELECT, mapInvoiceRow } from '../services/subscriptions';

export const billingRouter = Router();
billingRouter.use(requireStaff);

const actorOf = (req: Request): Actor => ({ id: user(req).id, name: user(req).name });

type RawInvoice = Omit<InvoiceRow, 'overdue'> & { overdue: number };

const PAYMENT_SELECT = `
  SELECT p.id, p.invoice_id AS invoiceId, i.number AS invoiceNumber, i.customer_name AS customerName, i.customer_company AS company,
    p.method, p.amount, p.payment_date AS paymentDate, p.note, p.voided_at AS voidedAt, u.name AS recordedBy
  FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.recorded_by`;

export function getInvoiceDetail(id: number, customerId?: number): InvoiceDetail {
  const today = todayISO();
  const raw = db()
    .prepare(`${INVOICE_ROW_SELECT} WHERE i.id = @id ${customerId !== undefined ? 'AND i.customer_id = @customerId' : ''}`)
    .get(customerId !== undefined ? { id, today, customerId } : { id, today }) as RawInvoice | undefined;
  if (!raw) throw notFound('Invoice');
  const extra = db()
    .prepare(
      `SELECT customer_email AS customerEmail, customer_address AS customerAddress, customer_tax_id AS customerTaxId,
         subtotal, discount_total AS discountTotal, tax_total AS taxTotal, tax_breakdown_json AS taxBreakdownJson, last_reminder_at AS lastReminderAt FROM invoices WHERE id = ?`,
    )
    .get(id) as Pick<InvoiceDetail, 'customerEmail' | 'customerAddress' | 'customerTaxId' | 'subtotal' | 'discountTotal' | 'taxTotal' | 'lastReminderAt'> & { taxBreakdownJson: string };
  const lines = db()
    .prepare(
      `SELECT id, product_name AS productName, hsn_code AS hsnCode, variant_label AS variantLabel, quantity, unit_price AS unitPrice, variant_extra AS variantExtra,
         discount_amount AS discountAmount, discount_name AS discountName, tax_amount AS taxAmount, tax_label AS taxLabel, line_total AS lineTotal
       FROM invoice_lines WHERE invoice_id = ? ORDER BY id`,
    )
    .all(id) as InvoiceLine[];
  const payments = db().prepare(`${PAYMENT_SELECT} WHERE p.invoice_id = ? ORDER BY p.payment_date DESC, p.id DESC`).all(id) as Payment[];
  const { taxBreakdownJson, ...rest } = extra;
  return { ...mapInvoiceRow(raw), ...rest, taxBreakdown: JSON.parse(taxBreakdownJson), seller: sellerInfo(), lines, payments };
}

function invoiceFilter(req: Request, today: string) {
  const clauses: string[] = [];
  const params: Record<string, string | number> = { today };
  const q = str(req.query.q);
  if (q) {
    clauses.push(`(i.number LIKE @q ESCAPE '\\' OR i.customer_name LIKE @q ESCAPE '\\' OR i.customer_company LIKE @q ESCAPE '\\' OR s.number LIKE @q ESCAPE '\\')`);
    params.q = likePattern(q);
  }
  const from = isoDateParam(req.query.from);
  const to = isoDateParam(req.query.to);
  if (from) {
    clauses.push('i.issue_date >= @from');
    params.from = from;
  }
  if (to) {
    clauses.push('i.issue_date <= @to');
    params.to = to;
  }
  const base = [...clauses];
  const status = str(req.query.status);
  if (status === 'overdue') clauses.push(`i.status = 'confirmed' AND i.due_date < @today`);
  else if (status === 'outstanding') clauses.push(`i.status = 'confirmed'`);
  else if (status) {
    clauses.push('i.status = @status');
    params.status = status;
  }
  const sql = (list: string[]) => (list.length ? `WHERE ${list.join(' AND ')}` : '');
  return { where: sql(clauses), baseWhere: sql(base), params };
}

const FROM_INVOICES = 'FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id';

billingRouter.get('/invoices', (req, res) => {
  const today = todayISO();
  const { page, pageSize, offset } = paging(req);
  const { where, baseWhere, params } = invoiceFilter(req, today);
  // The money total leaves out cancelled invoices unless they are the list being looked at.
  const counted = params.status === 'cancelled' ? 'i.total' : `CASE WHEN i.status = 'cancelled' THEN 0 ELSE i.total END`;
  const rows = db()
    .prepare(`${INVOICE_ROW_SELECT} ${where} ORDER BY i.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset }) as RawInvoice[];
  const summary = db()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(${counted}), 0) AS total,
         COALESCE(SUM(CASE WHEN i.status = 'confirmed' THEN i.total - i.amount_paid ELSE 0 END), 0) AS balance ${FROM_INVOICES} ${where}`,
    )
    .get(params) as { n: number; total: number; balance: number };
  const baseParams = { ...params };
  delete baseParams.status;
  const counts = db()
    .prepare(`SELECT i.status, COUNT(*) AS n, COALESCE(SUM(i.status = 'confirmed' AND i.due_date < @today), 0) AS late ${FROM_INVOICES} ${baseWhere} GROUP BY i.status`)
    .all(baseParams) as Array<{ status: InvoiceStatus; n: number; late: number }>;
  const statusCounts: InvoiceList['statusCounts'] = { draft: 0, confirmed: 0, paid: 0, cancelled: 0, overdue: 0 };
  for (const c of counts) {
    statusCounts[c.status] = c.n;
    statusCounts.overdue += c.late;
  }
  const body: InvoiceList = { rows: rows.map(mapInvoiceRow), total: summary.n, page, pageSize, statusCounts, summary: { total: summary.total, balance: summary.balance } };
  res.json(body);
});

billingRouter.get('/invoices/export.csv', (req, res) => {
  const today = todayISO();
  const { where, params } = invoiceFilter(req, today);
  const rows = (db().prepare(`${INVOICE_ROW_SELECT} ${where} ORDER BY i.id DESC`).all(params) as RawInvoice[]).map(mapInvoiceRow);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invoices-${today}.csv"`);
  res.send(
    toCsv(
      ['Invoice', 'Subscription', 'Customer', 'Company', 'Period start', 'Period end', 'Issued', 'Due', 'Status', 'Overdue', 'Total', 'Paid', 'Balance'],
      rows.map((r) => [r.number, r.subscriptionNumber, r.customerName, r.company, r.periodStart, r.periodEnd, r.issueDate, r.dueDate, r.status, r.overdue ? 'yes' : 'no', money(r.total), money(r.amountPaid), money(r.balance)]),
    ),
  );
});

billingRouter.post('/invoices/confirm-all', (req, res) => {
  const actor = actorOf(req);
  const ids = confirmAllDrafts(actor);
  res.json({ confirmed: ids.length });
  if (req.body?.send) {
    // Sent after responding: a large batch should not hold the page open. Outcomes land in the email log.
    void (async () => {
      for (const id of ids) await sendInvoice(id, actor).catch((err) => console.error(`Sending invoice ${id} failed:`, err.message));
    })();
  }
});

billingRouter.get('/invoices/:id', (req, res) => {
  res.json(getInvoiceDetail(idParam(req)));
});

billingRouter.post('/invoices/:id/confirm', (req, res) => {
  const id = idParam(req);
  confirmInvoice(id, actorOf(req));
  res.json(getInvoiceDetail(id));
});

billingRouter.post('/invoices/:id/cancel', (req, res) => {
  const id = idParam(req);
  cancelInvoice(id, actorOf(req));
  res.json(getInvoiceDetail(id));
});

billingRouter.post('/invoices/:id/send', async (req, res) => {
  const id = idParam(req);
  const result = await sendInvoice(id, actorOf(req));
  res.json({ ...getInvoiceDetail(id), emailStatus: result.status });
});

billingRouter.post('/invoices/:id/remind', async (req, res) => {
  const id = idParam(req);
  const status = await remindInvoice(id, actorOf(req));
  res.json({ status });
});

// Billing runs

const mapRun = (r: Record<string, never>): BillingRunResult => ({
  id: r.id,
  runDate: r.run_date,
  created: r.created,
  skipped: r.skipped,
  failed: r.failed,
  totalAmount: r.total_amount,
  closed: r.closed,
  activated: r.activated,
  errors: JSON.parse(r.errors_json),
  trigger: r.trigger,
  createdAt: r.created_at,
});

billingRouter.get('/billing/status', (_req, res) => {
  const today = todayISO();
  const { dueNow } = db()
    .prepare(
      `SELECT COUNT(*) AS dueNow FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active' AND s.paused_at IS NULL AND s.next_invoice_date <= ? AND ${BILLABLE_SQL}`,
    )
    .get(today) as { dueNow: number };
  const { draftInvoices } = db().prepare(`SELECT COUNT(*) AS draftInvoices FROM invoices WHERE status = 'draft'`).get() as { draftInvoices: number };
  const last = db().prepare('SELECT * FROM billing_runs ORDER BY id DESC LIMIT 1').get() as Record<string, never> | undefined;
  const body: BillingStatus = { dueNow, draftInvoices, lastRun: last ? mapRun(last) : null };
  res.json(body);
});

billingRouter.post('/billing/run', (req, res) => {
  res.json(runBilling({ actor: actorOf(req), trigger: 'manual' }));
});

// Payments

function paymentFilter(req: Request) {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  const q = str(req.query.q);
  if (q) {
    clauses.push(`(i.number LIKE @q ESCAPE '\\' OR i.customer_name LIKE @q ESCAPE '\\' OR i.customer_company LIKE @q ESCAPE '\\' OR p.note LIKE @q ESCAPE '\\')`);
    params.q = likePattern(q);
  }
  const method = str(req.query.method);
  if (method) {
    clauses.push('p.method = @method');
    params.method = method;
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

billingRouter.get('/payments', (req, res) => {
  const today = todayISO();
  const { page, pageSize, offset } = paging(req);
  const { where, params } = paymentFilter(req);
  const rows = db()
    .prepare(`${PAYMENT_SELECT} ${where} ORDER BY p.payment_date DESC, p.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset }) as Payment[];
  const totals = db()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount ELSE 0 END), 0) AS collected FROM payments p JOIN invoices i ON i.id = p.invoice_id ${where}`)
    .get(params) as { n: number; collected: number };
  const open = db()
    .prepare(
      `SELECT COALESCE(SUM(total - amount_paid), 0) AS outstanding,
         COALESCE(SUM(CASE WHEN due_date < ? THEN total - amount_paid ELSE 0 END), 0) AS overdue FROM invoices WHERE status = 'confirmed'`,
    )
    .get(today) as { outstanding: number; overdue: number };
  const body: PaymentList = { rows, total: totals.n, page, pageSize, summary: { collected: totals.collected, ...open } };
  res.json(body);
});

billingRouter.get('/payments/export.csv', (req, res) => {
  const { where, params } = paymentFilter(req);
  const rows = db().prepare(`${PAYMENT_SELECT} ${where} ORDER BY p.payment_date DESC, p.id DESC`).all(params) as Payment[];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payments-${todayISO()}.csv"`);
  res.send(
    toCsv(
      ['Date', 'Invoice', 'Customer', 'Company', 'Method', 'Amount', 'Note', 'Voided', 'Recorded by'],
      rows.map((r) => [r.paymentDate, r.invoiceNumber, r.customerName, r.company, r.method, money(r.amount), r.note, r.voidedAt ? 'yes' : 'no', r.recordedBy]),
    ),
  );
});

billingRouter.post('/payments', (req, res) => {
  const input = parse(paymentSchema, req.body);
  recordPayment(input, actorOf(req));
  res.status(201).json(getInvoiceDetail(input.invoiceId));
});

// Bank statement matching

billingRouter.post('/payments/reconcile/preview', (req, res) => {
  res.json(matchStatement(parse(reconcilePreviewSchema, req.body).csv));
});

billingRouter.post('/payments/reconcile/apply', (req, res) => {
  res.json(applyMatches(parse(reconcileApplySchema, req.body).items, actorOf(req)));
});

billingRouter.get('/payments/reconcile/sample.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sample-bank-statement.csv"');
  res.send(sampleStatement());
});

billingRouter.post('/payments/:id/void', requireAdmin, (req, res) => {
  voidPayment(idParam(req), actorOf(req));
  res.json({ ok: true });
});
