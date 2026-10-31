import { Router, type Request } from 'express';
import { todayISO } from '../../shared/dates';
import { renewSchema, subscriptionSchema, transitionSchema } from '../../shared/schemas';
import type { SubscriptionList, SubscriptionStatus } from '../../shared/types';
import { requireStaff, user } from '../auth';
import { db } from '../db';
import { conflict, idParam, likePattern, money, paging, parse, str, toCsv } from '../http';
import type { Actor } from '../services/activity';
import { logActivity } from '../services/activity';
import { billNextPeriod } from '../services/billing';
import { appUrl, button, escapeHtml, layout, sendEmail } from '../services/email';
import { SUB_ROW_SELECT, createSubscription, getSubscriptionDetail, mapSubRow, pause, renew, resume, transition, updateSubscription } from '../services/subscriptions';

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireStaff);

const actorOf = (req: Request): Actor => {
  const me = user(req);
  return { id: me.id, name: me.name, isAdmin: me.role === 'admin' };
};

const COUNT_FROM = `FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN plans pl ON pl.id = s.plan_id`;

function buildFilter(req: Request, today: string) {
  const clauses: string[] = [];
  const params: Record<string, string | number> = { today };
  const q = str(req.query.q);
  if (q) {
    clauses.push(`(s.number LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\' OR c.company LIKE @q ESCAPE '\\' OR pl.name LIKE @q ESCAPE '\\')`);
    params.q = likePattern(q);
  }
  const billing = str(req.query.billing);
  if (billing) {
    clauses.push('pl.billing_period = @billing');
    params.billing = billing;
  }
  const planId = Number(req.query.planId);
  if (planId) {
    clauses.push('s.plan_id = @planId');
    params.planId = planId;
  }
  if (req.query.overdue === '1') {
    clauses.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id = s.id AND i.status = 'confirmed' AND i.due_date < @today)`);
  }
  if (req.query.paused === '1') clauses.push('s.paused_at IS NOT NULL');
  const base = clauses.join(' AND ');
  const status = str(req.query.status);
  const withStatus = status ? [base, 's.status = @status'].filter(Boolean).join(' AND ') : base;
  if (status) params.status = status;
  return { base, where: withStatus, params };
}

const whereSql = (clause: string) => (clause ? `WHERE ${clause}` : '');

const SORTS: Record<string, string> = {
  number: 's.id',
  customer: 'c.name',
  next: 's.next_invoice_date',
  start: 's.start_date',
  amount: 's.recurring_amount',
  status: 's.status',
  billing: 'pl.billing_period',
  plan: 'pl.name',
};

subscriptionsRouter.get('/', (req, res) => {
  const today = todayISO();
  const { page, pageSize, offset } = paging(req);
  const { base, where, params } = buildFilter(req, today);
  const sortKey = SORTS[str(req.query.sort) ?? ''] ?? 's.id';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = db()
    .prepare(`${SUB_ROW_SELECT} ${whereSql(where)} ORDER BY ${sortKey} ${dir}, s.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset }) as Parameters<typeof mapSubRow>[0][];
  const summary = db()
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(s.status = 'active'), 0) AS activeCount,
         COALESCE(SUM(CASE WHEN s.status = 'active' AND s.paused_at IS NULL THEN s.recurring_amount ELSE 0 END), 0) AS recurringSubtotal
       ${COUNT_FROM} ${whereSql(where)}`,
    )
    .get(params) as { total: number; activeCount: number; recurringSubtotal: number };
  const baseParams = { ...params };
  delete baseParams.status;
  const counts = db()
    .prepare(`SELECT s.status, COUNT(*) AS n ${COUNT_FROM} ${whereSql(base)} GROUP BY s.status`)
    .all(baseParams) as Array<{ status: SubscriptionStatus; n: number }>;
  const statusCounts: SubscriptionList['statusCounts'] = { draft: 0, quotation: 0, confirmed: 0, active: 0, closed: 0 };
  for (const c of counts) statusCounts[c.status] = c.n;
  const body: SubscriptionList = {
    rows: rows.map((r) => mapSubRow(r, today)),
    total: summary.total,
    page,
    pageSize,
    summary: { activeCount: summary.activeCount, recurringSubtotal: summary.recurringSubtotal },
    statusCounts,
  };
  res.json(body);
});

subscriptionsRouter.get('/export.csv', (req, res) => {
  const today = todayISO();
  const { where, params } = buildFilter(req, today);
  const rows = (db().prepare(`${SUB_ROW_SELECT} ${whereSql(where)} ORDER BY s.id DESC`).all(params) as Parameters<typeof mapSubRow>[0][]).map((r) => mapSubRow(r, today));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="subscriptions-${today}.csv"`);
  res.send(
    toCsv(
      ['Subscription', 'Customer', 'Company', 'Plan', 'Variant', 'Billing', 'Start', 'Expiry', 'Next invoice', 'Status', 'Paused', 'Overdue', 'Recurring amount'],
      rows.map((r) => [r.number, r.customerName, r.company, r.planName, r.variantLabel, r.billingPeriod, r.startDate, r.expiryDate, r.nextInvoiceDate, r.status, r.paused ? 'yes' : 'no', r.overdue ? 'yes' : 'no', money(r.recurringAmount)]),
    ),
  );
});

subscriptionsRouter.post('/', (req, res) => {
  const input = parse(subscriptionSchema, req.body);
  const id = createSubscription(input, actorOf(req));
  res.status(201).json(getSubscriptionDetail(id));
});

subscriptionsRouter.get('/:id', (req, res) => {
  res.json(getSubscriptionDetail(idParam(req)));
});

subscriptionsRouter.put('/:id', (req, res) => {
  const id = idParam(req);
  updateSubscription(id, parse(subscriptionSchema, req.body), actorOf(req));
  res.json(getSubscriptionDetail(id));
});

subscriptionsRouter.post('/:id/transition', (req, res) => {
  const id = idParam(req);
  const { to, reason } = parse(transitionSchema, req.body);
  transition(id, to, actorOf(req), { reason });
  res.json(getSubscriptionDetail(id));
});

subscriptionsRouter.post('/:id/pause', (req, res) => {
  const id = idParam(req);
  pause(id, actorOf(req));
  res.json(getSubscriptionDetail(id));
});

subscriptionsRouter.post('/:id/resume', (req, res) => {
  const id = idParam(req);
  resume(id, actorOf(req));
  res.json(getSubscriptionDetail(id));
});

subscriptionsRouter.post('/:id/renew', (req, res) => {
  const id = idParam(req);
  renew(id, actorOf(req), parse(renewSchema, req.body ?? {}).expiryDate);
  res.json(getSubscriptionDetail(id));
});

subscriptionsRouter.post('/:id/invoice', (req, res) => {
  const invoiceId = billNextPeriod(idParam(req), actorOf(req));
  res.status(201).json({ invoiceId });
});

subscriptionsRouter.post('/:id/email', async (req, res) => {
  const id = idParam(req);
  const detail = getSubscriptionDetail(id);
  if (detail.status === 'draft') throw conflict('Move this draft to Quotation before sending it');
  const link = `${appUrl()}/portal/subscriptions/${id}`;
  const status = await sendEmail({
    to: detail.customerEmail,
    subject: `${detail.status === 'quotation' ? 'Quotation' : 'Subscription'} ${detail.number} from Brightloop Software`,
    link,
    html: layout(
      `${detail.status === 'quotation' ? 'Your quotation' : 'Your subscription'} ${detail.number}`,
      `<p style="font-size:14px">Hello ${escapeHtml(detail.customerName)},</p>
       <p style="font-size:14px">${escapeHtml(detail.planName)}: <b>$${money(detail.totals.total)}</b> per ${detail.billingPeriod.replace('ly', '').replace('dai', 'day')} including tax.${detail.quoteValidUntil && detail.status === 'quotation' ? ` This offer is valid until ${detail.quoteValidUntil}.` : ''}</p>
       ${button(link, 'View details')}`,
    ),
  });
  logActivity(actorOf(req), 'sent', 'subscription', id, `Emailed ${detail.number} to ${detail.customerEmail}`);
  res.json({ status });
});
