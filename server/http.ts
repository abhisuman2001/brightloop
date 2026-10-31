import type { Request } from 'express';
import type { ZodType } from 'zod';
import { isValidDate } from '../shared/dates';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const conflict = (message: string) => new HttpError(409, message);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new HttpError(422, Object.values(fields)[0] ?? 'Invalid input', fields);
}

export function idParam(req: Request, name = 'id'): number {
  const id = Number(req.params[name]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function isoDateParam(value: unknown): string | undefined {
  const s = str(value);
  return s && isValidDate(s) ? s : undefined;
}

const MAX_PAGE = 1_000_000;

export function paging(req: Request, maxSize = 100) {
  const requested = Math.floor(Number(req.query.page));
  const page = requested >= 1 && requested <= MAX_PAGE ? requested : 1;
  const pageSize = Math.min(maxSize, Math.max(1, Math.floor(Number(req.query.pageSize)) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Escapes user text for a SQL LIKE pattern (use with ESCAPE '\'). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Neutralises spreadsheet formula injection and quotes a CSV field. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const money = (paise: number) => (paise / 100).toFixed(2);
