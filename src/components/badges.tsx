import type { InvoiceRow, InvoiceStatus, SubscriptionRow, SubscriptionStatus } from '../../shared/types';
import { Badge, type Tone } from './ui';

const SUB_TONE: Record<SubscriptionStatus, Tone> = { draft: 'slate', quotation: 'sky', confirmed: 'indigo', active: 'emerald', closed: 'slate' };
export const SUB_LABEL: Record<SubscriptionStatus, string> = { draft: 'Draft', quotation: 'Quotation', confirmed: 'Confirmed', active: 'Active', closed: 'Closed' };

const Dot = ({ className }: { className: string }) => <span aria-hidden className={`size-1.5 rounded-full ${className}`} />;
const DOT: Record<SubscriptionStatus, string> = { draft: 'bg-slate-400', quotation: 'bg-sky-500', confirmed: 'bg-accent', active: 'bg-emerald-500', closed: 'bg-slate-400' };

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  return (
    <Badge tone={SUB_TONE[status]}>
      <Dot className={DOT[status]} />
      {SUB_LABEL[status]}
    </Badge>
  );
}

/** The lifecycle badge plus whatever else needs attention on this subscription. */
export function SubscriptionBadges({ row }: { row: Pick<SubscriptionRow, 'status' | 'paused' | 'overdue' | 'quoteExpired'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <SubscriptionStatusBadge status={row.status} />
      {row.paused && <Badge tone="amber">Paused</Badge>}
      {row.overdue && <Badge tone="rose">Overdue</Badge>}
      {row.quoteExpired && <Badge tone="rose">Expired</Badge>}
    </span>
  );
}

const INV_TONE: Record<InvoiceStatus, Tone> = { draft: 'slate', confirmed: 'sky', paid: 'emerald', cancelled: 'slate' };
const INV_LABEL: Record<InvoiceStatus, string> = { draft: 'Draft', confirmed: 'Confirmed', paid: 'Paid', cancelled: 'Cancelled' };

export function InvoiceStatusBadge({ row }: { row: Pick<InvoiceRow, 'status' | 'overdue'> }) {
  if (row.overdue) return <Badge tone="rose">Overdue</Badge>;
  return <Badge tone={INV_TONE[row.status]}>{INV_LABEL[row.status]}</Badge>;
}
