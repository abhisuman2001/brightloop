import { isValidDate, todayISO } from '../../shared/dates';
import type { ReconcileResult, ReconcileRow } from '../../shared/types';
import { db } from '../db';
import { HttpError } from '../http';
import { logActivity, type Actor } from './activity';
import { recordPayment } from './billing';

/** Splits CSV text into rows, honouring quoted fields. Banks routinely quote amounts like "1,23,456.00". */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const clean = text.replace(/^﻿/, '');
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Reads the forms Indian bank exports use, always day first: 31/10/2026, 31-10-26, 31-Oct-2026, or ISO. */
export function parseBankDate(text: string): string | null {
  const value = text.trim().split(/\s+/)[0] ?? '';
  if (isValidDate(value)) return value;
  const match = value.match(/^(\d{1,2})[/\-.]([a-zA-Z]{3}|\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (!match) return null;
  const month = /\d/.test(match[2]) ? Number(match[2]) : MONTHS.indexOf(match[2].toLowerCase()) + 1;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const iso = `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]|Rs\.?|INR|Cr\.?$/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const COLUMN_NAMES = {
  date: /^(txn |transaction |value |tran )?date$/i,
  description: /description|narration|particulars|remarks|details/i,
  credit: /credit|deposit|\bcr\b|money in/i,
  debit: /debit|withdrawal|\bdr\b|money out/i,
  amount: /^amount/i,
  reference: /ref|utr|chq|cheque/i,
};

function findColumns(header: string[]) {
  const find = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));
  const columns = { date: find(COLUMN_NAMES.date), description: find(COLUMN_NAMES.description), credit: find(COLUMN_NAMES.credit), debit: find(COLUMN_NAMES.debit), amount: find(COLUMN_NAMES.amount), reference: find(COLUMN_NAMES.reference) };
  if (columns.date < 0 || (columns.credit < 0 && columns.amount < 0)) return null;
  return columns;
}

interface OpenInvoice {
  id: number;
  number: string;
  customer_name: string;
  customer_company: string;
  status: string;
  issue_date: string;
  remaining: number;
}

const paymentMethodFor = (description: string) => (/\bupi\b/i.test(description) ? 'upi' : /\bchq\b|cheque/i.test(description) ? 'cheque' : 'bank_transfer');

/**
 * Works out which invoice each credit in a statement pays. It writes nothing: staff review the
 * result and choose what to record. The invoice number wins when it appears in the narration, and
 * an amount alone only counts when exactly one open invoice could be meant.
 */
export function matchStatement(csv: string): ReconcileResult {
  const table = parseCsv(csv);
  const headerAt = table.findIndex((row) => findColumns(row));
  if (headerAt < 0) throw new HttpError(422, 'Could not find Date and Credit or Amount columns in that file');
  const columns = findColumns(table[headerAt])!;

  const open = db()
    .prepare(`SELECT id, number, customer_name, customer_company, status, issue_date, total - amount_paid AS remaining FROM invoices WHERE status = 'confirmed'`)
    .all() as OpenInvoice[];
  const byNumber = new Map(open.map((i) => [i.number, i]));
  const findAny = db().prepare('SELECT id, number, customer_name, customer_company, status, issue_date, total - amount_paid AS remaining FROM invoices WHERE number = ?');
  const seenReference = db().prepare(`SELECT 1 FROM payments WHERE voided_at IS NULL AND note LIKE ? ESCAPE '\\'`);

  const rows: ReconcileRow[] = [];
  table.slice(headerAt + 1).forEach((cells, index) => {
    const cell = (column: number) => (column >= 0 ? (cells[column] ?? '') : '');
    const amount = parseAmount(cell(columns.credit >= 0 ? columns.credit : columns.amount));
    if (amount === null || amount === 0) return; // Debits, balances and footer lines.
    const description = cell(columns.description);
    const reference = cell(columns.reference);
    const paymentDate = parseBankDate(cell(columns.date));
    const row: ReconcileRow = { line: headerAt + index + 2, paymentDate, description, reference, amount, method: paymentMethodFor(description), match: 'none', invoiceId: null, invoiceNumber: null, customerName: null, problem: null };
    rows.push(row);
    const assign = (invoice: OpenInvoice, match: ReconcileRow['match']) => {
      row.match = match;
      row.invoiceId = invoice.id;
      row.invoiceNumber = invoice.number;
      row.customerName = invoice.customer_name;
    };

    if (!paymentDate) {
      row.problem = 'The date could not be read';
      return;
    }
    if (paymentDate > todayISO()) {
      row.problem = 'The date is in the future';
      return;
    }
    if (reference && seenReference.get(`%ref ${reference.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)) {
      row.match = 'duplicate';
      row.problem = 'This bank reference has already been recorded';
      return;
    }

    const named = description.match(/INV[-\s]?(\d+)/i);
    if (named) {
      const number = `INV-${named[1].padStart(5, '0')}`;
      const invoice = byNumber.get(number);
      if (!invoice) {
        const other = findAny.get(number) as OpenInvoice | undefined;
        row.invoiceNumber = number;
        row.problem = !other ? `${number} does not exist` : other.status === 'paid' ? `${number} is already paid` : other.status === 'draft' ? `${number} is still a draft, so confirm it first` : `${number} is cancelled`;
        if (other?.status === 'paid') row.match = 'duplicate';
        return;
      }
      if (amount > invoice.remaining) {
        row.invoiceNumber = number;
        row.problem = `More than the balance owed on ${number}`;
        return;
      }
      if (paymentDate < invoice.issue_date) {
        row.invoiceNumber = number;
        row.problem = `Dated before ${number} was issued`;
        return;
      }
      assign(invoice, 'invoice');
      invoice.remaining -= amount;
      return;
    }

    const sameAmount = open.filter((i) => i.remaining === amount && i.issue_date <= paymentDate);
    const lower = description.toLowerCase();
    const sameName = sameAmount.filter((i) => (i.customer_name && lower.includes(i.customer_name.toLowerCase())) || (i.customer_company && lower.includes(i.customer_company.toLowerCase())));
    const candidates = sameName.length ? sameName : sameAmount;
    if (candidates.length === 1) {
      assign(candidates[0], 'amount');
      candidates[0].remaining -= amount;
    } else {
      row.problem = candidates.length > 1 ? `${candidates.length} open invoices are for this amount. Add the invoice number to choose one` : 'No open invoice matches';
    }
  });

  return {
    rows,
    summary: {
      credits: rows.length,
      matched: rows.filter((r) => r.match === 'invoice' || r.match === 'amount').length,
      duplicates: rows.filter((r) => r.match === 'duplicate').length,
      unmatched: rows.filter((r) => r.match === 'none').length,
      matchedAmount: rows.reduce((sum, r) => (r.match === 'invoice' || r.match === 'amount' ? sum + r.amount : sum), 0),
    },
  };
}

export interface ReconcileItem {
  invoiceId: number;
  amount: number;
  paymentDate: string;
  method: string;
  reference: string;
  description: string;
}

/** Records the reviewed matches. Each stands alone, so one that went stale cannot stop the others. */
export function applyMatches(items: ReconcileItem[], actor: Actor) {
  let recorded = 0;
  let amount = 0;
  const failed: Array<{ invoiceId: number; message: string }> = [];
  for (const item of items) {
    const note = [item.reference ? `Bank ref ${item.reference}` : '', item.description].filter(Boolean).join(' · ').slice(0, 500);
    try {
      recordPayment({ invoiceId: item.invoiceId, method: item.method, amount: item.amount, paymentDate: item.paymentDate, note }, actor, undefined, true);
      recorded++;
      amount += item.amount;
    } catch (err) {
      failed.push({ invoiceId: item.invoiceId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (recorded) logActivity(actor, 'payment', 'billing', null, `Recorded ${recorded} payments from a bank statement, ₹${(amount / 100).toFixed(2)} in total`);
  return { recorded, failed };
}

/** A small statement built from real open invoices, so the import can be tried right away. */
export function sampleStatement(): string {
  const today = todayISO();
  const open = db()
    .prepare(`SELECT number, customer_company, total - amount_paid AS balance FROM invoices WHERE status = 'confirmed' ORDER BY due_date LIMIT 4`)
    .all() as Array<{ number: string; customer_company: string; balance: number }>;
  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const lines = ['Txn Date,Narration,Ref No,Debit,Credit,Balance'];
  open.forEach((invoice, i) => {
    const via = i % 2 === 0 ? 'UPI' : 'NEFT';
    lines.push(`${today},"${via}/${invoice.customer_company}/${invoice.number}",${via}${100200300 + i},,${rupees(invoice.balance)},`);
  });
  lines.push(`${today},"NEFT/Unknown Traders/advance",NEFT900800700,,1234.56,`);
  lines.push(`${today},"Office rent",CHQ445566,50000.00,,`);
  return `${lines.join('\r\n')}\r\n`;
}
