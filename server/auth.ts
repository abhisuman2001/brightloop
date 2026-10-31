import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Role, SessionUser } from '../shared/types';
import { db } from './db';
import { HttpError } from './http';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionHash?: string;
    }
  }
}

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = 'bl_session';
const SESSION_DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Burn the same time for unknown accounts so response timing does not reveal which emails exist.
  const [, saltHex, keyHex] = (stored ?? `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`).split('$');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex')) && stored !== null;
}

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function createSession(userId: number): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db()
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, expires.toISOString(), new Date().toISOString());
  return { token, expires };
}

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && !process.env.ALLOW_INSECURE_COOKIES,
    expires,
    path: '/',
  });
}

export function createPasswordToken(userId: number, hours: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db().prepare('UPDATE password_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(new Date().toISOString(), userId);
  db()
    .prepare('INSERT INTO password_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, new Date(Date.now() + hours * 3_600_000).toISOString());
  return token;
}

interface SessionRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  customer_id: number | null;
  view_as_role: Role | null;
  active: number;
  expires_at: string;
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token) {
    const hash = sha256(token);
    const row = db()
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.customer_id, u.active, s.view_as_role, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(hash) as SessionRow | undefined;
    if (row && row.active && row.expires_at > new Date().toISOString()) {
      req.sessionHash = hash;
      req.user = {
        id: row.id,
        name: row.name,
        email: row.email,
        // view_as_role can only ever lower an admin's access; other roles ignore it.
        role: row.role === 'admin' && row.view_as_role === 'staff' ? 'staff' : row.role,
        actualRole: row.role,
        customerId: row.customer_id,
      };
    }
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Please sign in');
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'You do not have access to this');
    next();
  };
}

export const requireStaff = requireRole('admin', 'staff');
export const requireAdmin = requireRole('admin');
export const requireCustomer = requireRole('customer');

export function user(req: Request): SessionUser {
  if (!req.user) throw new HttpError(401, 'Please sign in');
  return req.user;
}
