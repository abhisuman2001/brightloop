import { Router } from 'express';
import { addDays, todayISO } from '../../shared/dates';
import type { ActivityEntry, DashboardSummary, FinanceReport, InvoiceRow, NotificationItem, SearchResults } from '../../shared/types';
import { requireStaff } from '../auth';
import { db } from '../db';
import { isoDateParam, likePattern, money, str, toCsv } from '../http';
import { INVOICE_ROW_SELECT, mapInvoiceRow } from '../services/subscriptions';

export const insightsRouter = Router();
insightsRouter.use(requireStaff);

function monthsBack(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return date.toISOString().slice(0, 7);
  });
}

function endOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

insightsRouter.get('/dashboard', (_req, res) => {
  const today = todayISO();
  const active = db()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN paused_at IS NULL THEN monthly_amount ELSE 0 END), 0) AS mrr FROM subscriptions WHERE status = 'active'`)
    .get() as { n: number; mrr: number };
  // History comes from when each subscription started and ended, valued at its current amount.
  const historical = db().prepare(
    `SELECT COALESCE(SUM(monthly_amount), 0) AS mrr FROM subscriptions
     WHERE activated_at <= @at AND (closed_at IS NULL OR closed_at > @at)`,
  );
  const months = monthsBack(today, 12);
  const trend = months.map((month, i) =>
    i === months.length - 1 ? active.mrr : (historical.get({ at: `${endOfMonth(month)}T23:59:59.999Z` }) as { mrr: number }).mrr,
  );
  const previous = trend[trend.length - 2];
  const weekAgo = `${addDays(today, -7)}T23:59:59.999Z`;
  const week = db()
    .prepare(`SELECT COALESCE(SUM(activated_at > @at), 0) - COALESCE(SUM(closed_at > @at AND activated_at IS NOT NULL), 0) AS net FROM subscriptions`)
    .get({ at: weekAgo }) as { net: number };
  const overdue = db()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total - amount_paid), 0) AS amount FROM invoices WHERE status = 'confirmed' AND due_date < ?`)
    .get(today) as { n: number; amount: number };
  const collection = db()
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS billed, COALESCE(SUM(amount_paid), 0) AS paid FROM invoices
       WHERE status IN ('confirmed','paid') AND due_date BETWEEN ? AND ?`,
    )
    .get(addDays(today, -90), today) as { billed: number; paid: number };
  const body: DashboardSummary = {
    mrr: active.mrr,
    mrrChangePct: previous > 0 ? ((active.mrr - previous) / previous) * 100 : null,
    mrrTrend: trend,
    activeSubscriptions: active.n,
    activeNetThisWeek: week.net,
    overdueAmount: overdue.amount,
    overdueCount: overdue.n,
    collectionRate: collection.billed > 0 ? (collection.paid / collection.billed) * 100 : null,
  };
  res.json(body);
});

function buildReport(from: string, to: string, planId: number | null): FinanceReport {
  const today = todayISO();
  const planClause = planId ? 'AND s.plan_id = @planId' : '';
  const INV_JOIN = 'FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id';
  const active = db()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN s.paused_at IS NULL THEN s.monthly_amount ELSE 0 END), 0) AS mrr
       FROM subscriptions s WHERE s.status = 'active' ${planClause}`,
    )
    .get(planId ? { planId } : {}) as { n: number; mrr: number };
  const { invoiced } = db()
    .prepare(`SELECT COALESCE(SUM(i.total), 0) AS invoiced ${INV_JOIN} WHERE i.status IN ('confirmed','paid') AND i.issue_date BETWEEN @from AND @to ${planClause}`)
    .get({ from, to, ...(planId ? { planId } : {}) }) as { invoiced: number };
  const { collected } = db()
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS collected FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN subscriptions s ON s.id = i.subscription_id
       WHERE p.voided_at IS NULL AND p.payment_date BETWEEN @from AND @to ${planClause}`,
    )
    .get({ from, to, ...(planId ? { planId } : {}) }) as { collected: number };
  const open = db()
    .prepare(
      `SELECT COALESCE(SUM(i.total - i.amount_paid), 0) AS outstanding,
         COALESCE(SUM(CASE WHEN i.due_date < @today THEN i.total - i.amount_paid ELSE 0 END), 0) AS overdueAmount,
         COALESCE(SUM(i.due_date < @today), 0) AS overdueCount
       ${INV_JOIN} WHERE i.status = 'confirmed' ${planClause}`,
    )
    .get({ today, ...(planId ? { planId } : {}) }) as { outstanding: number; overdueAmount: number; overdueCount: number };

  const invoicedByMonth = db()
    .prepare(
      `SELECT substr(i.issue_date, 1, 7) AS month, SUM(i.total) AS amount ${INV_JOIN}
       WHERE i.status IN ('confirmed','paid') AND i.issue_date BETWEEN @from AND @to ${planClause} GROUP BY month`,
    )
    .all({ from, to, ...(planId ? { planId } : {}) }) as Array<{ month: string; amount: number }>;
  const collectedByMonth = db()
    .prepare(
      `SELECT substr(p.payment_date, 1, 7) AS month, SUM(p.amount) AS amount FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN subscriptions s ON s.id = i.subscription_id
       WHERE p.voided_at IS NULL AND p.payment_date BETWEEN @from AND @to ${planClause} GROUP BY month`,
    )
    .all({ from, to, ...(planId ? { planId } : {}) }) as Array<{ month: string; amount: number }>;
  const allMonths = new Set([...invoicedByMonth.map((r) => r.month), ...collectedByMonth.map((r) => r.month)]);
  const revenueByMonth = [...allMonths].sort().map((month) => ({
    month,
    invoiced: invoicedByMonth.find((r) => r.month === month)?.amount ?? 0,
    collected: collectedByMonth.find((r) => r.month === month)?.amount ?? 0,
  }));

  const agingRows = db()
    .prepare(
      `SELECT CASE
           WHEN i.due_date >= @today THEN 'Not yet due'
           WHEN julianday(@today) - julianday(i.due_date) <= 30 THEN '1-30 days'
           WHEN julianday(@today) - julianday(i.due_date) <= 60 THEN '31-60 days'
           WHEN julianday(@today) - julianday(i.due_date) <= 90 THEN '61-90 days'
           ELSE '90+ days' END AS bucket,
         SUM(i.total - i.amount_paid) AS amount, COUNT(*) AS count
       ${INV_JOIN} WHERE i.status = 'confirmed' ${planClause} GROUP BY bucket`,
    )
    .all({ today, ...(planId ? { planId } : {}) }) as FinanceReport['aging'];
  const aging = ['Not yet due', '1-30 days', '31-60 days', '61-90 days', '90+ days'].map(
    (bucket) => agingRows.find((r) => r.bucket === bucket) ?? { bucket, amount: 0, count: 0 },
  );

  const byMethod = db()
    .prepare(
      `SELECT p.method, SUM(p.amount) AS amount, COUNT(*) AS count FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN subscriptions s ON s.id = i.subscription_id
       WHERE p.voided_at IS NULL AND p.payment_date BETWEEN @from AND @to ${planClause} GROUP BY p.method ORDER BY amount DESC`,
    )
    .all({ from, to, ...(planId ? { planId } : {}) }) as FinanceReport['byMethod'];
  const byPlan = db()
    .prepare(
      `SELECT pl.id AS planId, pl.name AS plan, COUNT(s.id) AS active, COALESCE(SUM(CASE WHEN s.paused_at IS NULL THEN s.monthly_amount ELSE 0 END), 0) AS mrr
       FROM plans pl JOIN subscriptions s ON s.plan_id = pl.id AND s.status = 'active' ${planId ? 'WHERE pl.id = @planId' : ''}
       GROUP BY pl.id ORDER BY mrr DESC`,
    )
    .all(planId ? { planId } : {}) as FinanceReport['byPlan'];
  const overdueInvoices = (
    db()
      .prepare(`${INVOICE_ROW_SELECT} WHERE i.status = 'confirmed' AND i.due_date < @today ${planClause} ORDER BY i.due_date ASC LIMIT 25`)
      .all({ today, ...(planId ? { planId } : {}) }) as Array<Omit<InvoiceRow, 'overdue'> & { overdue: number }>
  ).map(mapInvoiceRow);

  // Valued at each subscription's current amount, like the dashboard trend.
  const rangeEnd = `${to}T23:59:59.999Z`;
  const planOnly = planId ? { planId } : {};
  const starting = db()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(s.monthly_amount), 0) AS mrr FROM subscriptions s WHERE s.activated_at < @from AND (s.closed_at IS NULL OR s.closed_at >= @from) ${planClause}`)
    .get({ from, ...planOnly }) as { n: number; mrr: number };
  const added = db()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(s.monthly_amount), 0) AS mrr FROM subscriptions s WHERE s.activated_at >= @from AND s.activated_at <= @rangeEnd ${planClause}`)
    .get({ from, rangeEnd, ...planOnly }) as { n: number; mrr: number };
  const churned = db()
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(s.monthly_amount), 0) AS mrr FROM subscriptions s WHERE s.activated_at IS NOT NULL AND s.closed_at >= @from AND s.closed_at <= @rangeEnd ${planClause}`)
    .get({ from, rangeEnd, ...planOnly }) as { n: number; mrr: number };
  const { customers } = db()
    .prepare(`SELECT COUNT(DISTINCT s.customer_id) AS customers FROM subscriptions s WHERE s.status = 'active' AND s.paused_at IS NULL ${planClause}`)
    .get(planOnly) as { customers: number };

  return {
    activeSubscriptions: active.n,
    mrr: active.mrr,
    movement: {
      startingMrr: starting.mrr,
      newMrr: added.mrr,
      churnedMrr: churned.mrr,
      newSubscriptions: added.n,
      churnedSubscriptions: churned.n,
      churnRatePct: starting.n + added.n > 0 ? (churned.n / (starting.n + added.n)) * 100 : null,
      revenueChurnPct: starting.mrr + added.mrr > 0 ? (churned.mrr / (starting.mrr + added.mrr)) * 100 : null,
      averagePerCustomer: customers > 0 ? Math.round(active.mrr / customers) : 0,
    },
    invoiced,
    collected,
    ...open,
    revenueByMonth,
    aging,
    byMethod,
    byPlan,
    overdueInvoices,
  };
}

function reportRange(query: Record<string, unknown>) {
  const today = todayISO();
  return {
    from: isoDateParam(query.from) ?? `${monthsBack(today, 12)[0]}-01`,
    to: isoDateParam(query.to) ?? today,
    planId: Number(query.planId) || null,
  };
}

insightsRouter.get('/reports/finance', (req, res) => {
  const { from, to, planId } = reportRange(req.query);
  res.json(buildReport(from, to, planId));
});

insightsRouter.get('/reports/finance.csv', (req, res) => {
  const { from, to, planId } = reportRange(req.query);
  const r = buildReport(from, to, planId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="finance-${from}-to-${to}.csv"`);
  res.send(toCsv(['Month', 'Invoiced', 'Collected'], r.revenueByMonth.map((m) => [m.month, money(m.invoiced), money(m.collected)])));
});

insightsRouter.get('/search', (req, res) => {
  const q = str(req.query.q)?.trim();
  const empty: SearchResults = { subscriptions: [], customers: [], invoices: [] };
  if (!q) return void res.json(empty);
  const like = likePattern(q);
  const body: SearchResults = {
    subscriptions: db()
      .prepare(
        `SELECT s.id, s.number, c.name AS customerName, s.status FROM subscriptions s JOIN customers c ON c.id = s.customer_id
         WHERE s.number LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\' OR c.company LIKE @q ESCAPE '\\' ORDER BY s.id DESC LIMIT 5`,
      )
      .all({ q: like }) as SearchResults['subscriptions'],
    customers: db()
      .prepare(`SELECT id, name, company, email FROM customers WHERE name LIKE @q ESCAPE '\\' OR company LIKE @q ESCAPE '\\' OR email LIKE @q ESCAPE '\\' ORDER BY name LIMIT 5`)
      .all({ q: like }) as SearchResults['customers'],
    invoices: db()
      .prepare(
        `SELECT id, number, customer_name AS customerName, status, total, status = 'confirmed' AND due_date < @today AS overdue FROM invoices
         WHERE number LIKE @q ESCAPE '\\' OR customer_name LIKE @q ESCAPE '\\' OR customer_company LIKE @q ESCAPE '\\' ORDER BY id DESC LIMIT 5`,
      )
      .all({ q: like, today: todayISO() }) as SearchResults['invoices'],
  };
  res.json(body);
});

insightsRouter.get('/notifications', (_req, res) => {
  const today = todayISO();
  const count = (sql: string, ...args: string[]) => (db().prepare(sql).get(...args) as { n: number }).n;
  const items: NotificationItem[] = [];
  const overdue = count(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'confirmed' AND due_date < ?`, today);
  if (overdue) items.push({ key: 'overdue', title: 'Overdue invoices', detail: 'Past their due date and still unpaid', count: overdue, to: '/invoices?status=overdue', tone: 'rose' });
  const failed = db().prepare('SELECT failed FROM billing_runs ORDER BY id DESC LIMIT 1').get() as { failed: number } | undefined;
  if (failed?.failed) items.push({ key: 'failed', title: 'Billing failures', detail: 'The last run could not bill these subscriptions', count: failed.failed, to: '/invoices', tone: 'rose' });
  const renewals = count(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND expiry_date BETWEEN ? AND ?`, today, addDays(today, 14));
  if (renewals) items.push({ key: 'renewals', title: 'Renewals due', detail: 'Expiring in the next 14 days', count: renewals, to: '/subscriptions?expiring=14', tone: 'amber' });
  const quotes = count(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'quotation' AND quote_valid_until BETWEEN ? AND ?`, today, addDays(today, 7));
  if (quotes) items.push({ key: 'quotes', title: 'Quotations expiring', detail: 'Valid for 7 days or fewer', count: quotes, to: '/subscriptions?status=quotation', tone: 'amber' });
  const drafts = count(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'`);
  if (drafts) items.push({ key: 'drafts', title: 'Draft invoices', detail: 'Waiting to be confirmed', count: drafts, to: '/invoices?status=draft', tone: 'sky' });
  res.json(items);
});

insightsRouter.get('/activity', (_req, res) => {
  const rows = db()
    .prepare('SELECT id, actor, action, entity_type AS entityType, entity_id AS entityId, summary, created_at AS createdAt FROM activity_log ORDER BY id DESC LIMIT 60')
    .all() as ActivityEntry[];
  res.json(rows);
});
