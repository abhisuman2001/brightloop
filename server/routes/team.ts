import { Router } from 'express';
import { staffCreateSchema, staffUpdateSchema } from '../../shared/schemas';
import type { EmailLogEntry, TeamMember } from '../../shared/types';
import { createPasswordToken, requireAdmin, user } from '../auth';
import { db } from '../db';
import { conflict, idParam, notFound, parse } from '../http';
import { logActivity } from '../services/activity';
import { appUrl, button, emailDeliveryConfigured, escapeHtml, layout, sendEmail } from '../services/email';

export const teamRouter = Router();
teamRouter.use(requireAdmin);

const listTeam = (): TeamMember[] =>
  (
    db()
      .prepare(
        `SELECT id, name, email, role, active, created_at AS createdAt, password_hash IS NULL AS invitePending
         FROM users WHERE role IN ('admin','staff') ORDER BY role, name`,
      )
      .all() as Array<Omit<TeamMember, 'active' | 'invitePending'> & { active: number; invitePending: number }>
  ).map((m) => ({ ...m, active: Boolean(m.active), invitePending: Boolean(m.invitePending) }));

teamRouter.get('/team', (_req, res) => res.json(listTeam()));

teamRouter.post('/team', async (req, res) => {
  const input = parse(staffCreateSchema, req.body);
  if (db().prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) {
    throw conflict('An account with this email already exists');
  }
  const { lastInsertRowid } = db()
    .prepare(`INSERT INTO users (email, name, role, created_at) VALUES (?, ?, 'staff', ?)`)
    .run(input.email, input.name, new Date().toISOString());
  const id = Number(lastInsertRowid);
  const link = `${appUrl()}/reset-password?token=${createPasswordToken(id, 72)}&invite=1`;
  const emailStatus = await sendEmail({
    to: input.email,
    subject: 'You have been added to Brightloop',
    link,
    html: layout(
      'Welcome to the Brightloop team',
      `<p style="font-size:14px">Hello ${escapeHtml(input.name)}, set a password to get started. This link expires in 72 hours.</p>${button(link, 'Set your password')}`,
    ),
  });
  logActivity({ id: user(req).id, name: user(req).name }, 'created', 'user', id, `Added staff member ${input.email}`);
  res.status(201).json({ member: listTeam().find((m) => m.id === id), emailStatus });
});

teamRouter.patch('/team/:id', (req, res) => {
  const id = idParam(req);
  const input = parse(staffUpdateSchema, req.body);
  const target = db().prepare(`SELECT role, name, email, active FROM users WHERE id = ? AND role IN ('admin','staff')`).get(id) as
    | { role: string; name: string; email: string; active: number }
    | undefined;
  if (!target) throw notFound('Team member');
  if (input.active === false && id === user(req).id) throw conflict('You cannot deactivate your own account');
  if (input.active === false && target.role === 'admin') {
    const { n } = db().prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).get() as { n: number };
    if (n <= 1) throw conflict('At least one active admin is required');
  }
  db().transaction(() => {
    db().prepare('UPDATE users SET name = ?, active = ? WHERE id = ?').run(input.name ?? target.name, input.active === undefined ? target.active : Number(input.active), id);
    if (input.active === false) db().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  })();
  logActivity({ id: user(req).id, name: user(req).name }, 'updated', 'user', id, `Updated team member ${target.email}`);
  res.json(listTeam().find((m) => m.id === id));
});

teamRouter.get('/emails', (_req, res) => {
  const rows = db().prepare('SELECT id, recipient, subject, status, error, link, created_at AS createdAt FROM email_log ORDER BY id DESC LIMIT 100').all() as EmailLogEntry[];
  res.json({ rows, deliveryConfigured: emailDeliveryConfigured() });
});
