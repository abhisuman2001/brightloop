import { Router, type Request } from 'express';
import { changePasswordSchema, forgotSchema, loginSchema, resetSchema, signupSchema, viewAsSchema } from '../../shared/schemas';
import type { SessionUser } from '../../shared/types';
import { SESSION_COOKIE, createPasswordToken, createSession, hashPassword, setSessionCookie, sha256, user, verifyPassword } from '../auth';
import { db } from '../db';
import { HttpError, conflict, parse } from '../http';
import { logActivity } from '../services/activity';
import { appUrl, button, escapeHtml, layout, sendEmail } from '../services/email';

export const authRouter = Router();

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string | null;
  role: SessionUser['role'];
  customer_id: number | null;
  active: number;
}

const toSessionUser = (u: UserRow): SessionUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  actualRole: u.role,
  customerId: u.customer_id,
});

authRouter.post('/signup', async (req, res) => {
  const input = parse(signupSchema, req.body);
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  const created = db().transaction(() => {
    if (db().prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) {
      throw new HttpError(409, 'An account with this email already exists', { email: 'An account with this email already exists' });
    }
    // Always a new customer record. Linking to an existing one by email alone would hand its
    // invoices to anyone who typed that address; staff use "Invite to portal" for that instead.
    const customer = db()
      .prepare('INSERT INTO customers (name, company, email, created_at) VALUES (?, ?, ?, ?)')
      .run(input.name, input.company, input.email, now);
    const { lastInsertRowid } = db()
      .prepare(`INSERT INTO users (email, name, password_hash, role, customer_id, created_at) VALUES (?, ?, ?, 'customer', ?, ?)`)
      .run(input.email, input.name, passwordHash, customer.lastInsertRowid, now);
    return db().prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid) as UserRow;
  })();
  const { token, expires } = createSession(created.id);
  setSessionCookie(res, token, expires);
  res.status(201).json(toSessionUser(created));
});

authRouter.post('/login', async (req, res) => {
  const input = parse(loginSchema, req.body);
  const row = db().prepare('SELECT * FROM users WHERE email = ?').get(input.email) as UserRow | undefined;
  const valid = await verifyPassword(input.password, row?.password_hash ?? null);
  if (!row || !valid) throw new HttpError(401, 'Incorrect email or password');
  if (!row.active) throw new HttpError(403, 'This account has been deactivated');
  const { token, expires } = createSession(row.id);
  setSessionCookie(res, token, expires);
  res.json(toSessionUser(row));
});

authRouter.post('/logout', (req, res) => {
  if (req.sessionHash) db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', (req, res) => {
  res.json(req.user ?? null);
});

authRouter.post('/forgot-password', async (req, res) => {
  const { email } = parse(forgotSchema, req.body);
  const row = db().prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email) as UserRow | undefined;
  if (row) {
    const link = `${appUrl()}/reset-password?token=${createPasswordToken(row.id, 1)}`;
    await sendEmail({
      to: row.email,
      subject: 'Reset your Brightloop password',
      link,
      html: layout(
        'Reset your password',
        `<p style="font-size:14px">Hello ${escapeHtml(row.name)}, use this link to choose a new password. It works once and expires in one hour.</p>${button(link, 'Reset password')}
         <p style="font-size:13px;color:#64748b">If you did not ask for this you can ignore this email.</p>`,
      ),
    });
  }
  // The same answer either way, so this form cannot be used to find out who has an account.
  res.json({ ok: true });
});

function consumeToken(req: Request) {
  const { token, password } = parse(resetSchema, req.body);
  const row = db()
    .prepare('SELECT user_id, expires_at, used_at FROM password_tokens WHERE token_hash = ?')
    .get(sha256(token)) as { user_id: number; expires_at: string; used_at: string | null } | undefined;
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) {
    throw new HttpError(400, 'This link is invalid or has expired. Request a new one.');
  }
  return { tokenHash: sha256(token), userId: row.user_id, password };
}

authRouter.post('/reset-password', async (req, res) => {
  const { tokenHash, userId, password } = consumeToken(req);
  const passwordHash = await hashPassword(password);
  db().transaction(() => {
    const claimed = db().prepare('UPDATE password_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(new Date().toISOString(), tokenHash);
    if (claimed.changes === 0) throw conflict('This link has already been used');
    db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    // Anyone who was signed in with the old password is signed out.
    db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  })();
  res.json({ ok: true });
});

authRouter.post('/change-password', async (req, res) => {
  const me = user(req);
  const input = parse(changePasswordSchema, req.body);
  const row = db().prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as { password_hash: string | null };
  if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
    throw new HttpError(422, 'Your current password is incorrect', { currentPassword: 'Incorrect password' });
  }
  const passwordHash = await hashPassword(input.newPassword);
  db().transaction(() => {
    db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, me.id);
    db().prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(me.id, req.sessionHash);
  })();
  res.json({ ok: true });
});

/** Lets an admin work as staff in this session. It can only reduce access, which the API enforces. */
authRouter.post('/view-as', (req, res) => {
  const me = user(req);
  if (me.actualRole !== 'admin') throw new HttpError(403, 'Only an admin can switch views');
  const { role } = parse(viewAsSchema, req.body);
  db().prepare('UPDATE sessions SET view_as_role = ? WHERE token_hash = ?').run(role === 'staff' ? 'staff' : null, req.sessionHash);
  logActivity({ id: me.id, name: me.name }, 'view_as', 'user', me.id, `Switched to ${role} view`);
  res.json({ ...me, role });
});
