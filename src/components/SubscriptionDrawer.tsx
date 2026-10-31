import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CreditCard, FileText, Mail, MoreHorizontal, Pause, Pencil, Play, RefreshCw, Send, X, XCircle, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays } from '../../shared/dates';
import type { SubscriptionDetail, SubscriptionStatus } from '../../shared/types';
import { api, refreshAll } from '../lib/api';
import { PERIOD_LABEL, PERIOD_UNIT, date, money, todayLocal } from '../lib/format';
import { useDrawer, useUser } from '../lib/hooks';
import { InvoiceStatusBadge, SUB_LABEL, SubscriptionBadges } from './badges';
import { Info } from './InvoiceDrawer';
import { PaymentDialog } from './PaymentDialog';
import { SubscriptionForm } from './SubscriptionForm';
import { Button, ConfirmDialog, Drawer, ErrorState, Field, IconButton, Input, Menu, Modal, Skeleton, TD, TH, cx, useToast } from './ui';

const STAGES: SubscriptionStatus[] = ['draft', 'quotation', 'confirmed', 'active', 'closed'];

export function PipelineTracker({ status, activated = true }: { status: SubscriptionStatus; activated?: boolean }) {
  const current = STAGES.indexOf(status);
  return (
    <ol aria-label="Subscription status" className="flex w-full items-start">
      {STAGES.map((stage, i) => {
        // A quotation that was declined never went through Confirmed or Active.
        const done = i < current && (status !== 'closed' || activated);
        const isCurrent = i === current;
        return (
          <li key={stage} aria-current={isCurrent ? 'step' : undefined} className="relative flex flex-1 flex-col items-center gap-1">
            {i > 0 && <span aria-hidden className={cx('absolute top-2.5 right-1/2 h-px w-full', i <= current ? 'bg-accent' : 'bg-slate-200')} />}
            <span
              className={cx(
                'relative z-10 flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold',
                isCurrent ? 'border-accent bg-accent text-white' : done ? 'border-accent bg-white text-accent' : 'border-slate-300 bg-white text-slate-400',
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : i + 1}
            </span>
            <span className={cx('text-[11px] font-medium', isCurrent ? 'text-slate-900' : done ? 'text-slate-600' : 'text-slate-400')}>{SUB_LABEL[stage]}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function LinesTable({ sub }: { sub: SubscriptionDetail }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr>
            <th className={TH}>Product</th>
            <th className={cx(TH, 'text-right')}>Quantity</th>
            <th className={cx(TH, 'text-right')}>Unit price</th>
            <th className={TH}>Variant add-on</th>
            <th className={TH}>Discount rule</th>
            <th className={cx(TH, 'text-right')}>Tax</th>
            <th className={cx(TH, 'text-right')}>Total</th>
          </tr>
        </thead>
        <tbody>
          {sub.lines.map((line) => (
            <tr key={line.id}>
              <td className={TD}>
                <span className="text-slate-900">{line.isPlanLine ? `${sub.planName} plan` : line.productName}</span>
                {line.isPlanLine && <span className="block text-xs text-slate-500">{line.productName}</span>}
              </td>
              <td className={cx(TD, 'num text-right')}>{line.quantity}</td>
              <td className={cx(TD, 'num text-right')}>{money(line.unitPrice)}</td>
              <td className={TD}>{line.variantLabel ? <span>{line.variantLabel} <span className="num text-slate-500">+{money(line.variantExtra)}</span></span> : <span className="text-slate-400">—</span>}</td>
              <td className={TD}>
                {line.discountName ? (
                  <span>
                    {line.discountName} <span className="num text-slate-500">-{money(line.discount)}</span>
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className={cx(TD, 'text-right')}>
                <span className="num">{money(line.tax)}</span>
                {line.taxLabel && <span className="block text-xs text-slate-500">{line.taxLabel}</span>}
              </td>
              <td className={cx(TD, 'num text-right text-slate-900')}>{money(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SubscriptionTotals({ sub }: { sub: SubscriptionDetail }) {
  return (
    <dl className="ml-auto w-full max-w-64 text-[13px]">
      <div className="flex justify-between py-0.5">
        <dt className="text-slate-500">Subtotal</dt>
        <dd className="num">{money(sub.totals.subtotal)}</dd>
      </div>
      {sub.totals.discountTotal > 0 && (
        <div className="flex justify-between py-0.5">
          <dt className="text-slate-500">Discount</dt>
          <dd className="num">-{money(sub.totals.discountTotal)}</dd>
        </div>
      )}
      <div className="flex justify-between py-0.5">
        <dt className="text-slate-500">Tax</dt>
        <dd className="num">{money(sub.totals.taxTotal)}</dd>
      </div>
      <div className="flex justify-between py-0.5 font-semibold text-slate-900">
        <dt>Total per {PERIOD_UNIT[sub.billingPeriod]}</dt>
        <dd className="num">{money(sub.totals.total)}</dd>
      </div>
    </dl>
  );
}

export function RenewDialog({ open, onClose, sub, onRenew, loading, error }: { open: boolean; onClose: () => void; sub: SubscriptionDetail | undefined; onRenew: (expiry: string) => void; loading: boolean; error?: unknown }) {
  const [expiry, setExpiry] = useState('');
  useEffect(() => {
    if (open) setExpiry(sub?.defaultRenewalDate ?? '');
  }, [open, sub]);
  const earliest = sub?.expiryDate ? addDays(sub.expiryDate > todayLocal() ? sub.expiryDate : todayLocal(), 1) : undefined;
  return (
    <ConfirmDialog open={open} onClose={onClose} title={`Renew ${sub?.number ?? ''}`} description={`Current expiry is ${date(sub?.expiryDate)}. Billing continues through the new date.`} confirmLabel="Renew" loading={loading} error={error} onConfirm={() => onRenew(expiry)}>
      <Field label="New expiry date">{(id) => <Input id={id} type="date" min={earliest} value={expiry} onChange={(e) => setExpiry(e.target.value)} />}</Field>
    </ConfirmDialog>
  );
}

interface ActionVars {
  path: string;
  body?: object;
  done: string;
}

export function SubscriptionDrawer() {
  const { id, close } = useDrawer('sub');
  const invoiceDrawer = useDrawer('inv');
  const me = useUser();
  const toast = useToast();
  const query = useQuery({ queryKey: ['subscription', id], queryFn: () => api.get<SubscriptionDetail>(`/subscriptions/${id}`), enabled: id !== null });
  const sub = query.data;
  const [dialog, setDialog] = useState<'edit' | 'payment' | 'close' | 'renew' | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setDialog(null);
    setReason('');
  }, [id]);

  const act = useMutation({
    mutationFn: ({ path, body }: ActionVars) => api.post<SubscriptionDetail>(`/subscriptions/${id}/${path}`, body ?? {}),
    onSuccess: (_result, { done }) => {
      refreshAll();
      toast(done);
      setDialog(null);
    },
    onError: (err: Error) => {
      if (dialog !== 'close' && dialog !== 'renew') toast(err.message, 'error');
    },
  });

  // An earlier failure must not show up in the next dialog, or on another subscription.
  useEffect(() => {
    act.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, id]);

  const createInvoice = useMutation({
    mutationFn: () => api.post<{ invoiceId: number }>(`/subscriptions/${id}/invoice`),
    onSuccess: ({ invoiceId }) => {
      refreshAll();
      toast('Draft invoice created');
      invoiceDrawer.open(invoiceId);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const sendEmail = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/subscriptions/${id}/email`),
    onSuccess: ({ status }) => {
      refreshAll();
      toast(status === 'logged' ? 'Recorded in the email log. Set SMTP_URL to deliver email.' : status === 'failed' ? 'The email could not be delivered.' : `Sent to ${sub?.customerEmail}`, status === 'failed' ? 'error' : 'success');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const nextUnpaid = sub?.invoices.filter((i) => i.status === 'confirmed').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const isActive = sub?.status === 'active';
  const pipelineAction: { label: string; to: SubscriptionStatus; icon: React.ReactNode } | null =
    sub?.status === 'draft'
      ? { label: 'Move to Quotation', to: 'quotation', icon: <Send className="size-3.5" /> }
      : sub?.status === 'quotation'
        ? { label: 'Confirm Order', to: 'confirmed', icon: <Check className="size-3.5" /> }
        : sub?.status === 'confirmed'
          ? { label: 'Activate', to: 'active', icon: <Zap className="size-3.5" /> }
          : null;
  const canClose = sub && sub.status !== 'closed';
  const closeBlocked = Boolean(isActive && sub && !sub.plan.closable && me.role !== 'admin' && (!sub.expiryDate || sub.expiryDate >= todayLocal()));

  return (
    <Drawer open={id !== null} onClose={close} label={sub ? `Subscription ${sub.number}` : 'Subscription'}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="num text-[15px] font-semibold text-slate-900">{sub?.number ?? '…'}</h2>
            {sub && <SubscriptionBadges row={sub} />}
          </div>
          {sub && (
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {sub.customerName}
              {sub.company && ` · ${sub.company}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {sub && canClose && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <IconButton label="More actions">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item icon={<Pencil className="size-3.5" />} onSelect={() => setDialog('edit')}>
                  Edit
                </Menu.Item>
                {isActive && !sub.paused && (
                  <Menu.Item icon={<Pause className="size-3.5" />} disabled={!sub.plan.pausable} onSelect={() => act.mutate({ path: 'pause', done: `${sub.number} paused` })}>
                    Pause{!sub.plan.pausable && ' (not allowed by plan)'}
                  </Menu.Item>
                )}
                {sub.paused && (
                  <Menu.Item icon={<Play className="size-3.5" />} onSelect={() => act.mutate({ path: 'resume', done: `${sub.number} resumed` })}>
                    Resume
                  </Menu.Item>
                )}
                {isActive && (
                  <Menu.Item icon={<RefreshCw className="size-3.5" />} disabled={!sub.plan.renewable || !sub.expiryDate} onSelect={() => setDialog('renew')}>
                    Renew{!sub.plan.renewable && ' (not allowed by plan)'}
                  </Menu.Item>
                )}
                <Menu.Separator />
                <Menu.Item icon={<XCircle className="size-3.5" />} danger disabled={closeBlocked} onSelect={() => setDialog('close')}>
                  {isActive ? 'Cancel subscription' : 'Close'}
                  {closeBlocked && ' (admin only)'}
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
          <IconButton label="Close panel" onClick={close}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {query.isLoading && <Skeleton className="h-64" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {sub && (
          <>
            <PipelineTracker status={sub.status} activated={Boolean(sub.activatedAt)} />
            {sub.quoteExpired && (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">This quotation expired on {date(sub.quoteValidUntil)}. Edit its validity, or create a new one, before confirming.</p>
            )}
            {sub.closedReason && <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">Closed {date(sub.closedAt)}: {sub.closedReason}</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4">
              <Info label="Customer" value={sub.customerName} />
              <Info label="Plan" value={sub.variantLabel ? `${sub.planName} • ${sub.variantLabel} Variant` : sub.planName} />
              <Info label="Billing" value={PERIOD_LABEL[sub.billingPeriod]} />
              <Info label="Payment terms" value={sub.paymentTermDays === 0 ? 'Due on receipt' : `Net ${sub.paymentTermDays}`} />
              <Info label="Start date" value={date(sub.startDate)} mono />
              <Info label="Expiry date" value={sub.expiryDate ? date(sub.expiryDate) : 'None'} mono={Boolean(sub.expiryDate)} />
              <Info label="Next invoice" value={sub.nextInvoiceDate ? date(sub.nextInvoiceDate) : '—'} mono />
              {sub.status === 'quotation' ? <Info label="Quote valid until" value={date(sub.quoteValidUntil)} mono /> : <Info label="Template" value={sub.templateName ?? 'None'} />}
            </dl>
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-slate-800">Line items</h3>
              <LinesTable sub={sub} />
              <div className="mt-2">
                <SubscriptionTotals sub={sub} />
              </div>
            </section>
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-slate-800">Invoices</h3>
              {sub.invoices.length === 0 ? (
                <p className="text-xs text-slate-500">No invoices yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {sub.invoices.slice(0, 8).map((inv) => (
                    <li key={inv.id}>
                      <Link to={`/invoices?inv=${inv.id}`} className="flex items-center justify-between gap-3 px-2.5 py-1.5 hover:bg-slate-50">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="num text-[13px] text-slate-900">{inv.number}</span>
                          <span className="num hidden text-xs text-slate-500 sm:inline">{date(inv.periodStart)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <InvoiceStatusBadge row={inv} />
                          <span className="num w-24 text-right text-[13px]">{money(inv.total)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {sub.notes && (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-slate-800">Notes</h3>
                <p className="text-[13px] whitespace-pre-wrap text-slate-600">{sub.notes}</p>
              </section>
            )}
          </>
        )}
      </div>

      {sub && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          {pipelineAction && (
            <Button variant="primary" icon={pipelineAction.icon} loading={act.isPending} onClick={() => act.mutate({ path: 'transition', body: { to: pipelineAction.to }, done: `${sub.number} moved to ${SUB_LABEL[pipelineAction.to]}` })}>
              {pipelineAction.label}
            </Button>
          )}
          <Button icon={<FileText className="size-3.5" />} disabled={!isActive || sub.paused} title={!isActive ? 'Only an active subscription can be invoiced' : sub.paused ? 'Resume it first' : undefined} loading={createInvoice.isPending} onClick={() => createInvoice.mutate()}>
            Create Invoice
          </Button>
          <Button icon={<CreditCard className="size-3.5" />} disabled={!nextUnpaid} title={!nextUnpaid ? 'No confirmed invoice is waiting for payment' : undefined} onClick={() => setDialog('payment')}>
            Register Payment
          </Button>
          <Button icon={<Mail className="size-3.5" />} disabled={sub.status === 'draft' || sub.status === 'closed'} title={sub.status === 'draft' ? 'Move it to Quotation first' : undefined} loading={sendEmail.isPending} onClick={() => sendEmail.mutate()}>
            Send via Email
          </Button>
        </div>
      )}

      <SubscriptionForm open={dialog === 'edit'} onClose={() => setDialog(null)} editing={sub} />
      <PaymentDialog open={dialog === 'payment'} onClose={() => setDialog(null)} invoice={nextUnpaid} />
      <RenewDialog open={dialog === 'renew'} onClose={() => setDialog(null)} sub={sub} loading={act.isPending} error={act.error} onRenew={(expiryDate) => act.mutate({ path: 'renew', body: { expiryDate }, done: `${sub?.number} renewed` })} />
      <Modal
        open={dialog === 'close'}
        onClose={() => setDialog(null)}
        title={`${isActive ? 'Cancel' : 'Close'} ${sub?.number ?? ''}?`}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Keep as is</Button>
            <Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ path: 'transition', body: { to: 'closed', reason: reason || undefined }, done: `${sub?.number} closed` })}>
              {isActive ? 'Cancel subscription' : 'Close'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-slate-600">Billing stops immediately and this cannot be reopened. Invoices already issued stay as they are.</p>
        <Field label="Reason">{(fid) => <Input id={fid} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Why is this closing?" />}</Field>
        {Boolean(act.error) && <p className="mt-2 text-xs text-rose-700">{(act.error as Error).message}</p>}
      </Modal>
    </Drawer>
  );
}
