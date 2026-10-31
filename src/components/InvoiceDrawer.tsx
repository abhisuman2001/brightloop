import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, BellRing, Check, CreditCard, Mail, Printer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InvoiceDetail } from '../../shared/types';
import { api, refreshAll } from '../lib/api';
import { METHOD_LABEL, date, money } from '../lib/format';
import { useDrawer, useUser } from '../lib/hooks';
import { InvoiceStatusBadge } from './badges';
import { PaymentDialog } from './PaymentDialog';
import { Button, ConfirmDialog, Drawer, ErrorState, IconButton, Skeleton, TD, TH, cx, useToast } from './ui';

const STEPS = ['Draft', 'Confirmed', 'Paid'] as const;

function InvoicePipeline({ invoice }: { invoice: InvoiceDetail }) {
  if (invoice.status === 'cancelled') return <p className="text-xs font-medium text-slate-500">This invoice was cancelled. Its period is billed again on the next run.</p>;
  const current = invoice.status === 'draft' ? 0 : invoice.status === 'confirmed' ? 1 : 2;
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-1" aria-current={i === current ? 'step' : undefined}>
          {i > 0 && <span aria-hidden className={cx('h-px w-6 sm:w-10', i <= current ? 'bg-accent' : 'bg-slate-200')} />}
          <span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-medium', i < current ? 'border-accent-soft bg-accent-soft text-accent' : i === current ? 'border-accent bg-accent text-white' : 'border-slate-200 text-slate-500')}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function InvoiceLinesTable({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr>
            <th className={TH}>Product</th>
            <th className={cx(TH, 'text-right')}>Qty</th>
            <th className={cx(TH, 'text-right')}>Unit price</th>
            <th className={cx(TH, 'text-right')}>Discount</th>
            <th className={cx(TH, 'text-right')}>Tax</th>
            <th className={cx(TH, 'text-right')}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td className={TD}>
                <span className="text-slate-900">{line.productName}</span>
                {line.hsnCode && <span className="num block text-xs text-slate-500">HSN/SAC {line.hsnCode}</span>}
                {line.variantLabel && <span className="block text-xs text-slate-500">{line.variantLabel}</span>}
              </td>
              <td className={cx(TD, 'num text-right')}>{line.quantity}</td>
              <td className={cx(TD, 'num text-right')}>{money(line.unitPrice + line.variantExtra)}</td>
              <td className={cx(TD, 'text-right')}>
                <span className="num">{line.discountAmount ? `-${money(line.discountAmount)}` : '—'}</span>
                {line.discountName && <span className="block text-xs text-slate-500">{line.discountName}</span>}
              </td>
              <td className={cx(TD, 'text-right')}>
                <span className="num">{money(line.taxAmount)}</span>
                {line.taxLabel && <span className="block text-xs text-slate-500">{line.taxLabel}</span>}
              </td>
              <td className={cx(TD, 'num text-right text-slate-900')}>{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InvoiceTotals({ invoice }: { invoice: Pick<InvoiceDetail, 'subtotal' | 'discountTotal' | 'taxTotal' | 'taxBreakdown' | 'total' | 'amountPaid' | 'balance' | 'status'> }) {
  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className={cx('flex justify-between gap-8 py-0.5', strong && 'font-semibold text-slate-900')}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
  return (
    <dl className="ml-auto w-full max-w-64 text-[13px]">
      <Row label="Subtotal" value={money(invoice.subtotal)} />
      {invoice.discountTotal > 0 && <Row label="Discount" value={`-${money(invoice.discountTotal)}`} />}
      {invoice.taxBreakdown.length > 0 ? invoice.taxBreakdown.map((t) => <Row key={t.name} label={t.name} value={money(t.amount)} />) : <Row label="Tax" value={money(invoice.taxTotal)} />}
      <Row label="Total" value={money(invoice.total)} strong />
      {invoice.amountPaid > 0 && <Row label="Paid" value={`-${money(invoice.amountPaid)}`} />}
      {invoice.status !== 'cancelled' && invoice.amountPaid > 0 && <Row label="Balance due" value={money(invoice.balance)} strong />}
    </dl>
  );
}

export function InvoiceDrawer() {
  const { id, close } = useDrawer('inv');
  const me = useUser();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const query = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    enabled: id !== null,
  });
  const invoice = query.data;

  useEffect(() => {
    setPaying(false);
    setCancelling(false);
  }, [id]);

  const act = useMutation({
    mutationFn: ({ path }: { path: string; done: string }) => api.post<InvoiceDetail & { emailStatus?: string }>(`/invoices/${id}/${path}`),
    onSuccess: (result, { done }) => {
      refreshAll();
      toast(result.emailStatus === 'logged' ? 'Recorded as sent. Set SMTP_URL to deliver email; see Settings > Email log.' : done);
      setCancelling(false);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const remind = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/invoices/${id}/remind`),
    onSuccess: ({ status }) => {
      refreshAll();
      toast(status === 'logged' ? 'Reminder recorded in the email log. Set SMTP_URL to deliver email.' : status === 'failed' ? 'The reminder could not be delivered.' : `Reminder sent to ${invoice?.customerEmail}`, status === 'failed' ? 'error' : 'success');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Drawer open={id !== null} onClose={close} label={invoice ? `Invoice ${invoice.number}` : 'Invoice'}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="num text-[15px] font-semibold text-slate-900">{invoice?.number ?? '…'}</h2>
            {invoice && <InvoiceStatusBadge row={invoice} />}
          </div>
          {invoice && <p className="mt-0.5 truncate text-xs text-slate-500">{invoice.customerName}{invoice.company && ` · ${invoice.company}`}</p>}
        </div>
        <IconButton label="Close" onClick={close}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {query.isLoading && <Skeleton className="h-48" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {invoice && (
          <>
            <InvoicePipeline invoice={invoice} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4">
              <Info label="Issued" value={date(invoice.issueDate)} mono />
              <Info label="Due" value={date(invoice.dueDate)} mono tone={invoice.overdue ? 'text-rose-700' : undefined} />
              <Info label="Period" value={`${date(invoice.periodStart)} – ${date(invoice.periodEnd)}`} mono className="col-span-2" />
              <div>
                <dt className="text-xs text-slate-500">Subscription</dt>
                <dd>
                  <Link className="num text-accent hover:underline" to={`/subscriptions?sub=${invoice.subscriptionId}`}>
                    {invoice.subscriptionNumber}
                  </Link>
                </dd>
              </div>
              <Info label="Bill to" value={[invoice.customerEmail, invoice.customerAddress].filter(Boolean).join(' · ')} className="col-span-2" />
              <Info label="Sent" value={invoice.sentAt ? date(invoice.sentAt) : 'Not sent'} mono={Boolean(invoice.sentAt)} />
              {invoice.lastReminderAt && <Info label="Last reminder" value={date(invoice.lastReminderAt)} mono />}
            </dl>
            <InvoiceLinesTable invoice={invoice} />
            <InvoiceTotals invoice={invoice} />
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-slate-800">Payments</h3>
              {invoice.payments.length === 0 ? (
                <p className="text-xs text-slate-500">No payments recorded.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {invoice.payments.map((p) => (
                    <li key={p.id} className={cx('flex items-center justify-between gap-3 px-2.5 py-1.5', p.voidedAt && 'opacity-50')}>
                      <span className="min-w-0 text-[13px]">
                        <span className="num">{date(p.paymentDate)}</span>
                        <span className="ml-2 text-slate-600">{METHOD_LABEL[p.method]}</span>
                        {p.voidedAt && <span className="ml-2 text-xs text-rose-700">Void</span>}
                        {p.note && <span className="block truncate text-xs text-slate-500">{p.note}</span>}
                      </span>
                      <span className="num shrink-0 text-[13px]">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {invoice && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          {invoice.status === 'draft' && (
            <Button variant="primary" icon={<Check className="size-3.5" />} loading={act.isPending} onClick={() => act.mutate({ path: 'confirm', done: `${invoice.number} confirmed` })}>
              Confirm
            </Button>
          )}
          {invoice.status === 'confirmed' && (
            <Button variant="primary" icon={<CreditCard className="size-3.5" />} onClick={() => setPaying(true)}>
              Register Payment
            </Button>
          )}
          <Button icon={<Mail className="size-3.5" />} disabled={invoice.status === 'draft' || invoice.status === 'cancelled'} title={invoice.status === 'draft' ? 'Confirm this invoice first' : undefined} loading={act.isPending} onClick={() => act.mutate({ path: 'send', done: `${invoice.number} sent to ${invoice.customerEmail}` })}>
            {invoice.sentAt ? 'Send again' : 'Send'}
          </Button>
          {invoice.status === 'confirmed' && (
            <Button icon={<BellRing className="size-3.5" />} loading={remind.isPending} onClick={() => remind.mutate()}>
              Send reminder
            </Button>
          )}
          <a href={`/print/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
            <Printer className="size-3.5" aria-hidden />
            Print
          </a>
          <div className="flex-1" />
          {(invoice.status === 'draft' || invoice.status === 'confirmed') && (
            <Button variant="danger" icon={<Ban className="size-3.5" />} disabled={invoice.amountPaid > 0} title={invoice.amountPaid > 0 ? (me.role === 'admin' ? 'Void its payments first' : 'This invoice has payments recorded') : undefined} onClick={() => setCancelling(true)}>
              Cancel
            </Button>
          )}
        </div>
      )}

      <PaymentDialog open={paying} onClose={() => setPaying(false)} invoice={invoice} />
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel ${invoice?.number ?? 'invoice'}?`}
        description="Any discount use is given back. The billing period reopens, so the next billing run creates a fresh invoice for it."
        confirmLabel="Cancel invoice"
        danger
        loading={act.isPending}
        onConfirm={() => act.mutate({ path: 'cancel', done: 'Invoice cancelled' })}
      />
    </Drawer>
  );
}

export function Info({ label, value, mono, tone, className }: { label: string; value: string; mono?: boolean; tone?: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cx('text-slate-900', mono && 'num', tone)}>{value || '—'}</dd>
    </div>
  );
}
