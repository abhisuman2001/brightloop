import { Router } from 'express';
import { todayISO } from '../../shared/dates';
import { customerSchema } from '../../shared/schemas';
import type { Customer, InvoiceRow } from '../../shared/types';
import { createPasswordToken, requireStaff, user } from '../auth';
import { db } from '../db';
import { conflict, idParam, likePattern, notFound, paging, parse, str } from '../http';
import { logActivity } from '../services/activity';
import { appUrl, button, escapeHtml, layout, sendEmail } from '../services/email';
import { INVOICE_ROW_SELECT, SUB_ROW_SELECT, mapInvoiceRow, mapSubRow } from '../services/subscriptions';

export const customersRouter = Router();
customersRouter.use(requireStaff);

const CUSTOMER_SELECT = `
  SELECT c.id, c.name, c.company, c.email, c.phone, c.address, c.tax_id AS taxId, c.created_at AS createdAt,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id = c.id AND s.status = 'active') AS activeSubscriptions,
    (SELECT COALESCE(SUM(s.monthly_amount), 0) FROM subscriptions s WHERE s.customer_id = c.id AND s.status = 'active' AND s.paused_at IS NULL) AS monthlyAmount,
    (SELECT COALESCE(SUM(i.total - i.amount_paid), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'confirmed') AS outstanding
  FROM customers c`;

customersRouter.get('/', (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const q = str(req.query.q);
  const where = q ? `WHERE c.name LIKE @q ESCAPE '\\' OR c.company LIKE @q ESCAPE '\\' OR c.email LIKE @q ESCAPE '\\'` : '';
  const params = q ? { q: likePattern(q) } : {};
  const { total } = db().prepare(`SELECT COUNT(*) AS total FROM customers c ${where}`).get(params) as { total: number };
  const rows = db()
    .prepare(`${CUSTOMER_SELECT} ${where} ORDER BY c.name LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset }) as Customer[];
  res.json({ rows, total, page, pageSize });
});

customersRouter.post('/', (req, res) => {
  const c = parse(customerSchema, req.body);
  if (db().prepare('SELECT 1 FROM customers WHERE email = ?').get(c.email)) {
    throw conflict('A customer with this email already exists');
  }
  const { lastInsertRowid } = db()
    .prepare('INSERT INTO customers (name, company, email, phone, address, tax_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.name, c.company, c.email, c.phone, c.address, c.taxId, new Date().toISOString());
  logActivity({ id: user(req).id, name: user(req).name }, 'created', 'customer', Number(lastInsertRowid), `Added customer ${c.name}`);
  res.status(201).json(db().prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(lastInsertRowid));
});

customersRouter.get('/:id', (req, res) => {
  const id = idParam(req);
  const today = todayISO();
  const customer = db().prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(id) as Customer | undefined;
  if (!customer) throw notFound('Customer');
  const subscriptions = (db().prepare(`${SUB_ROW_SELECT} WHERE s.customer_id = @id ORDER BY s.id DESC LIMIT 50`).all({ id, today }) as Parameters<typeof mapSubRow>[0][]).map((r) => mapSubRow(r, today));
  const invoices = (db().prepare(`${INVOICE_ROW_SELECT} WHERE i.customer_id = @id ORDER BY i.id DESC LIMIT 50`).all({ id, today }) as Array<Omit<InvoiceRow, 'overdue'> & { overdue: number }>).map(mapInvoiceRow);
  const portal = db().prepare('SELECT active FROM users WHERE customer_id = ?').get(id) as { active: number } | undefined;
  res.json({ ...customer, subscriptions, invoices, hasPortalAccess: Boolean(portal?.active) });
});

customersRouter.patch('/:id', (req, res) => {
  const id = idParam(req);
  const c = parse(customerSchema, req.body);
  const duplicate = db().prepare('SELECT 1 FROM customers WHERE email = ? AND id <> ?').get(c.email, id);
  if (duplicate) throw conflict('Another customer already uses this email');
  const login = db().prepare('SELECT id FROM users WHERE customer_id = ?').get(id) as { id: number } | undefined;
  if (login && db().prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(c.email, login.id)) {
    throw conflict('Another account already uses this email');
  }
  db().transaction(() => {
    const { changes } = db()
      .prepare('UPDATE customers SET name = ?, company = ?, email = ?, phone = ?, address = ?, tax_id = ? WHERE id = ?')
      .run(c.name, c.company, c.email, c.phone, c.address, c.taxId, id);
    if (changes === 0) throw notFound('Customer');
    if (login) db().prepare('UPDATE users SET email = ?, name = ? WHERE id = ?').run(c.email, c.name, login.id);
  })();
  logActivity({ id: user(req).id, name: user(req).name }, 'updated', 'customer', id, `Updated customer ${c.name}`);
  res.json(db().prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(id));
});

/** Gives an existing customer portal access through a link sent to the address on file. */
customersRouter.post('/:id/invite', async (req, res) => {
  const id = idParam(req);
  const customer = db().prepare('SELECT * FROM customers WHERE id = ?').get(id) as { name: string; email: string } | undefined;
  if (!customer) throw notFound('Customer');
  const existing = db().prepare('SELECT id, role, customer_id FROM users WHERE email = ?').get(customer.email) as { id: number; role: string; customer_id: number | null } | undefined;
  if (existing && (existing.role !== 'customer' || existing.customer_id === id)) {
    throw conflict('An account with this email already exists');
  }
  // Someone who signed up with this address gets a link that attaches this record once they open it.
  const userId =
    existing?.id ??
    Number(
      db()
        .prepare(`INSERT INTO users (email, name, role, customer_id, created_at) VALUES (?, ?, 'customer', ?, ?)`)
        .run(customer.email, customer.name, id, new Date().toISOString()).lastInsertRowid,
    );
  const link = `${appUrl()}/reset-password?token=${createPasswordToken(userId, 72, existing ? id : null)}&invite=1`;
  const status = await sendEmail({
    to: customer.email,
    subject: 'Your Brightloop customer portal',
    link,
    html: layout(
      'Access your subscriptions',
      `<p style="font-size:14px">Hello ${escapeHtml(customer.name)}, set a password to see your subscriptions and invoices. This link expires in 72 hours.</p>${button(link, 'Set your password')}`,
    ),
  });
  logActivity({ id: user(req).id, name: user(req).name }, 'invited', 'customer', id, `Invited ${customer.email} to the portal`);
  res.json({ status });
});
