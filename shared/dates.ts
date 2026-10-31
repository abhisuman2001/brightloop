// Calendar dates are plain 'YYYY-MM-DD' strings throughout the system, so billing
// never shifts a day because of a server or browser timezone.
export type BillingPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

const DAY_MS = 86_400_000;

const parse = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
};
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date);
  return format(Date.UTC(y, m - 1, d) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

function addMonths(date: string, months: number): string {
  const { y, m, d } = parse(date);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return format(Date.UTC(year, month, Math.min(d, lastDay)));
}

/**
 * The n-th billing date counted from the anchor. Always computed from the anchor rather
 * than the previous date so a subscription started on Jan 31 bills Feb 28 then Mar 31.
 */
export function addPeriods(anchor: string, period: BillingPeriod, n: number): string {
  switch (period) {
    case 'daily':
      return addDays(anchor, n);
    case 'weekly':
      return addDays(anchor, n * 7);
    case 'monthly':
      return addMonths(anchor, n);
    case 'yearly':
      return addMonths(anchor, n * 12);
  }
}

/** First billing date on the anchor's schedule strictly after `date`. */
export function nextBillingDate(anchor: string, period: BillingPeriod, date: string): string {
  if (date < anchor) return anchor;
  const span = daysBetween(anchor, date);
  const approxDays = { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[period];
  let n = Math.floor(span / approxDays);
  while (addPeriods(anchor, period, n) <= date) n++;
  return addPeriods(anchor, period, n);
}

/** First billing date on the anchor's schedule on or after `date`. */
export function firstBillingDateOnOrAfter(anchor: string, period: BillingPeriod, date: string): string {
  return nextBillingDate(anchor, period, addDays(date, -1));
}

/** Converts one billing period's amount into its monthly equivalent, for MRR. */
export function toMonthly(amount: number, period: BillingPeriod): number {
  const factor = { daily: 365 / 12, weekly: 52 / 12, monthly: 1, yearly: 1 / 12 }[period];
  return Math.round(amount * factor);
}
