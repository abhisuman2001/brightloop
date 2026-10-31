import type { BillingPeriod } from '../../shared/dates';
import type { PaymentMethod, ProductType } from '../../shared/types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('en-US');

export const money = (cents: number) => usd.format(cents / 100);
export const moneyWhole = (cents: number) => usdWhole.format(Math.round(cents / 100));
export const moneyCompact = (cents: number) => usdCompact.format(cents / 100);
export const number = (n: number) => count.format(n);

/** Cents to an editable dollars string. */
export const dollars = (cents: number) => (cents / 100).toFixed(2);

/** A typed dollars string to cents, or null if it is not a valid amount. */
export function toCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
export const date = (iso: string | null | undefined) => (iso ? dateFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');

const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
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

export const percent = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
export const todayLocal = () => new Date().toISOString().slice(0, 10);
