import { isValidDate, todayISO, type BillingPeriod } from '../../shared/dates';
import type { PaymentMethod, ProductType } from '../../shared/types';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('en-IN');

export const money = (paise: number) => inr.format(paise / 100);
export const moneyWhole = (paise: number) => inrWhole.format(Math.round(paise / 100));
export const moneyCompact = (paise: number) => inrCompact.format(paise / 100);
export const number = (n: number) => count.format(n);

/** Paise to an editable rupees string. */
export const rupees = (paise: number) => (paise / 100).toFixed(2);

/** A typed rupees string to paise, or null if it is not a valid amount. */
export function toPaise(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, '');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const dateFormat = new Intl.DateTimeFormat('en-IN', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
/** Shows an unreadable stored date as it is, since one bad record must never take a whole page down. */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const day = iso.slice(0, 10);
  return isValidDate(day) ? dateFormat.format(new Date(`${day}T00:00:00Z`)) : day;
}

const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const monthLabel = (ym: string) => monthFormat.format(new Date(`${ym}-01T00:00:00Z`));

export function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : date(iso);
}

export const PERIOD_LABEL: Record<BillingPeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
export const PERIOD_UNIT: Record<BillingPeriod, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
export const METHOD_LABEL: Record<PaymentMethod, string> = { bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash', cheque: 'Cheque', upi: 'UPI' };
export const TYPE_LABEL: Record<ProductType, string> = { software: 'Software', addon: 'Add-on', service: 'Service', goods: 'Goods' };

export const percent = (bps: number) => `${(bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
export const todayLocal = todayISO;
