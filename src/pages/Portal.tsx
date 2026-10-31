import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, LogOut, Pause, Play, Plus, Printer, RefreshCw, Repeat, Smartphone, XCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import type { InvoiceDetail, PortalOverview, PortalPlan, PortalSubscription } from '../../shared/types';
import { InvoiceStatusBadge, SubscriptionBadges } from '../components/badges';
import { Info, InvoiceLinesTable, InvoiceTotals } from '../components/InvoiceDrawer';
import { Logo, useSignOut } from '../components/Layout';
import { PipelineTracker, RenewDialog, SubscriptionTotals } from '../components/SubscriptionDrawer';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, PageHeader, Select, Skeleton, TD, TH, Textarea, cx, fieldErrors, isShownOnField, useToast } from '../components/ui';
import { PasswordCard } from './Settings';
import { api, refreshAll } from '../lib/api';
import { PERIOD_LABEL, PERIOD_UNIT, date, money, moneyWhole } from '../lib/format';
import { useUser } from '../lib/hooks';

const LINKS = [
  { to: '/portal', label: 'Overview', end: true },
  { to: '/portal/plans', label: 'Plans' },
  { to: '/portal/account', label: 'Account' },
];

export function PortalLayout() {
  const me = useUser();
  const signOut = useSignOut();
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-4 px-3">
          <Link to="/portal" aria-label="Brightloop home">
            <span className="hidden sm:block">
              <Logo />
            </span>
            <span className="sm:hidden">
              <Logo compact />
            </span>
          </Link>
          <nav aria-label="Portal" className="flex min-w-0 items-center gap-1">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => cx('rounded-md px-2 py-1 text-[13px] font-medium', isActive ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-slate-100')}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="hidden truncate text-xs text-slate-500 md:block">{me.email}</span>
            <IconButton label="Sign out" onClick={signOut}>
              <LogOut className="size-4" />
            </IconButton>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-3 lg:p-5">
        <Outlet />
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cx('num mt-1 text-xl font-semibold tracking-tight', tone ?? 'text-slate-900')}>{value}</p>
    </Card>
  );
}

export function PortalOverviewPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['portal', 'overview'], queryFn: () => api.get<PortalOverview>('/portal/overview') });
  if (isLoading) return <Skeleton className="h-96 rounded-lg" />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <>
      <PageHeader
        title={`Welcome, ${data.customer.name.split(' ')[0]}`}
        description={data.customer.company || undefined}
        actions={
          <Link to="/portal/plans" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[13px] font-medium text-white hover:bg-accent-hover">
            <Plus className="size-3.5" aria-hidden />
            New subscription
          </Link>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Monthly cost, before tax" value={moneyWhole(data.monthlyAmount)} />
        <Stat label="Amount due" value={money(data.outstanding)} />
        <Stat label="Overdue" value={money(data.overdue)} tone={data.overdue > 0 ? 'text-rose-700' : undefined} />
      </div>

      <Card className="mb-4">
        <h2 className="border-b border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-900">Your subscriptions</h2>
        {data.subscriptions.length === 0 ? (
          <EmptyState
            icon={<Repeat className="size-5" />}
            title="No subscriptions yet"
            description="Choose a plan to get a quotation you can accept right away."
            action={
              <Link to="/portal/plans" className="inline-flex h-8 items-center rounded-md bg-accent px-2.5 text-[13px] font-medium text-white hover:bg-accent-hover">
                Browse plans
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.subscriptions.map((s) => (
              <li key={s.id}>
                <Link to={`/portal/subscriptions/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-slate-900">
                      {s.planName}
                      {s.variantLabel && <span className="font-normal text-slate-500"> • {s.variantLabel} Variant</span>}
                    </span>
                    <span className="num block text-xs text-slate-500">
                      {s.number}
                      {s.nextInvoiceDate && ` · next invoice ${date(s.nextInvoiceDate)}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <SubscriptionBadges row={s} />
                    <span className="num text-right text-[13px] text-slate-900">
                      {money(s.recurringAmount)}
                      <span className="text-xs text-slate-500">/{PERIOD_UNIT[s.billingPeriod]}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="border-b border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-900">Invoices</h2>
        {data.invoices.length === 0 ? (
          <EmptyState icon={<FileText className="size-5" />} title="No invoices yet" description="They appear here as soon as they are issued." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Invoice</th>
                  <th className={TH}>Issued</th>
                  <th className={TH}>Due</th>
                  <th className={TH}>Status</th>
                  <th className={cx(TH, 'text-right')}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id} tabIndex={0} aria-label={`Open ${inv.number}`} onClick={() => navigate(`/portal/invoices/${inv.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/portal/invoices/${inv.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className={cx(TD, 'num text-slate-900')}>{inv.number}</td>
                    <td className={cx(TD, 'num text-slate-600')}>{date(inv.issueDate)}</td>
                    <td className={cx(TD, 'num', inv.overdue ? 'text-rose-700' : 'text-slate-600')}>{date(inv.dueDate)}</td>
                    <td className={TD}>
                      <InvoiceStatusBadge row={inv} />
                    </td>
                    <td className={cx(TD, 'num text-right text-slate-900')}>{money(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

const BackLink = () => (
  <Link to="/portal" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
    <ArrowLeft className="size-3" aria-hidden />
    Back to overview
  </Link>
);

export function PortalSubscriptionPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data: sub, isLoading, isError, error } = useQuery({ queryKey: ['portal', 'subscription', id], queryFn: () => api.get<PortalSubscription>(`/portal/subscriptions/${id}`) });
  const [dialog, setDialog] = useState<'cancel' | 'renew' | null>(null);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object; done: string }) => api.post<PortalSubscription>(`/portal/subscriptions/${id}/${path}`, body ?? {}),
    onSuccess: (_d, { done }) => {
      refreshAll();
      toast(done);
      setDialog(null);
    },
    onError: (err: Error) => {
      if (!dialog) toast(err.message, 'error');
    },
  });

  useEffect(() => {
    act.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  if (isLoading) return <Skeleton className="h-96 rounded-lg" />;
  if (isError || !sub) return <ErrorState error={error} />;
  const live = sub.status === 'active';
  const open = sub.status !== 'closed';
  return (
    <>
      <BackLink />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">
            {sub.planName}
            {sub.variantLabel && <span className="font-normal text-slate-500"> • {sub.variantLabel} Variant</span>}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="num">{sub.number}</span>
            <SubscriptionBadges row={sub} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sub.status === 'quotation' && (
            <Button variant="primary" disabled={sub.quoteExpired} loading={act.isPending} onClick={() => act.mutate({ path: 'accept', done: 'Quotation accepted. Thank you.' })}>
              Accept quotation
            </Button>
          )}
          {live && !sub.paused && sub.plan.pausable && (
            <Button icon={<Pause className="size-3.5" />} loading={act.isPending} onClick={() => act.mutate({ path: 'pause', done: 'Paused. You will not be billed until you resume.' })}>
              Pause
            </Button>
          )}
          {sub.paused && (
            <Button variant="primary" icon={<Play className="size-3.5" />} loading={act.isPending} onClick={() => act.mutate({ path: 'resume', done: 'Resumed' })}>
              Resume
            </Button>
          )}
          {live && sub.plan.renewable && sub.expiryDate && (
            <Button icon={<RefreshCw className="size-3.5" />} onClick={() => setDialog('renew')}>
              Renew
            </Button>
          )}
          {open && (sub.status !== 'active' || sub.plan.closable) && (
            <Button variant="danger" icon={<XCircle className="size-3.5" />} onClick={() => setDialog('cancel')}>
              {sub.status === 'quotation' ? 'Decline' : 'Cancel'}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <Card className="p-4">
          <PipelineTracker status={sub.status} activated={Boolean(sub.activatedAt)} />
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4">
            <Info label="Billing" value={PERIOD_LABEL[sub.billingPeriod]} />
            <Info label="Start date" value={date(sub.startDate)} mono />
            <Info label="Expiry date" value={sub.expiryDate ? date(sub.expiryDate) : 'None'} mono={Boolean(sub.expiryDate)} />
            {sub.status === 'quotation' ? <Info label="Quote valid until" value={date(sub.quoteValidUntil)} mono tone={sub.quoteExpired ? 'text-rose-700' : undefined} /> : <Info label="Next invoice" value={date(sub.nextInvoiceDate)} mono />}
          </dl>
        </Card>

        <Card>
          <h2 className="border-b border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-900">What you are paying for</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Item</th>
                  <th className={cx(TH, 'text-right')}>Qty</th>
                  <th className={cx(TH, 'text-right')}>Unit price</th>
                  <th className={cx(TH, 'text-right')}>Discount</th>
                  <th className={cx(TH, 'text-right')}>Tax</th>
                  <th className={cx(TH, 'text-right')}>Total</th>
                </tr>
              </thead>
              <tbody>
                {sub.lines.map((l) => (
                  <tr key={l.id}>
                    <td className={TD}>
                      <span className="text-slate-900">{l.isPlanLine ? `${sub.planName} plan` : l.productName}</span>
                      {l.variantLabel && <span className="block text-xs text-slate-500">{l.variantLabel}</span>}
                    </td>
                    <td className={cx(TD, 'num text-right')}>{l.quantity}</td>
                    <td className={cx(TD, 'num text-right')}>{money(l.unitPrice + l.variantExtra)}</td>
                    <td className={cx(TD, 'text-right')}>
                      <span className="num">{l.discount ? `-${money(l.discount)}` : '—'}</span>
                      {l.discountName && <span className="block text-xs text-slate-500">{l.discountName}</span>}
                    </td>
                    <td className={cx(TD, 'num text-right')}>{money(l.tax)}</td>
                    <td className={cx(TD, 'num text-right text-slate-900')}>{money(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3">
            <SubscriptionTotals sub={sub} />
          </div>
        </Card>

        {open && sub.addons.length > 0 && (
          <Card>
            <h2 className="border-b border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-900">Add-ons</h2>
            <p className="px-3 pt-2 text-xs text-slate-500">Changes apply from your next invoice.</p>
            <ul className="divide-y divide-slate-100">
              {sub.addons.map((addon) => (
                <li key={addon.productId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-slate-900">{addon.name}</span>
                    <span className="block text-xs text-slate-500">
                      <span className="num">{money(addon.price)}</span> per {PERIOD_UNIT[sub.billingPeriod]}
                      {addon.notes && ` · ${addon.notes}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={addon.enabled}
                    aria-label={`${addon.name} add-on`}
                    disabled={act.isPending}
                    onClick={() => act.mutate({ path: 'addons', body: { productId: addon.productId, enabled: !addon.enabled }, done: `${addon.name} ${addon.enabled ? 'removed' : 'added'}` })}
                    className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60', addon.enabled ? 'bg-accent' : 'bg-slate-300')}
                  >
                    <span className={cx('absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform', addon.enabled && 'translate-x-4')} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <RenewDialog open={dialog === 'renew'} onClose={() => setDialog(null)} sub={sub} loading={act.isPending} error={dialog ? act.error : null} onRenew={(expiryDate) => act.mutate({ path: 'renew', body: { expiryDate }, done: 'Renewed. Thank you.' })} />
      <ConfirmDialog
        open={dialog === 'cancel'}
        onClose={() => {
          setDialog(null);
          act.reset();
        }}
        title={sub.status === 'quotation' ? 'Decline this quotation?' : 'Cancel this subscription?'}
        description={sub.status === 'quotation' ? 'It will be closed. You can always request a new one.' : 'Billing stops immediately and this cannot be undone. Invoices already issued still need to be paid.'}
        confirmLabel={sub.status === 'quotation' ? 'Decline' : 'Cancel subscription'}
        danger
        loading={act.isPending}
        error={dialog ? act.error : null}
        onConfirm={() => act.mutate({ path: 'cancel', done: 'Closed' })}
      />
    </>
  );
}

export function PortalInvoicePage() {
  const { id } = useParams();
  const { data: invoice, isLoading, isError, error } = useQuery({ queryKey: ['portal', 'invoice', id], queryFn: () => api.get<InvoiceDetail>(`/portal/invoices/${id}`) });
  if (isLoading) return <Skeleton className="h-96 rounded-lg" />;
  if (isError || !invoice) return <ErrorState error={error} />;
  return (
    <>
      <BackLink />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="num text-lg font-semibold tracking-tight text-slate-900">{invoice.number}</h1>
          <p className="mt-1">
            <InvoiceStatusBadge row={invoice} />
          </p>
        </div>
        <a href={`/print/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
          <Printer className="size-3.5" aria-hidden />
          Print
        </a>
      </div>
      <Card className="space-y-4 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4">
          <Info label="Issued" value={date(invoice.issueDate)} mono />
          <Info label="Due" value={date(invoice.dueDate)} mono tone={invoice.overdue ? 'text-rose-700' : undefined} />
          <Info label="Period" value={`${date(invoice.periodStart)} – ${date(invoice.periodEnd)}`} mono className="col-span-2" />
        </dl>
        <InvoiceLinesTable invoice={invoice} />
        <InvoiceTotals invoice={invoice} />
      </Card>
      {invoice.status === 'confirmed' && invoice.balance > 0 && invoice.seller.upiId && <PayByUpi invoice={invoice} />}
    </>
  );
}

/** A UPI QR with the amount and invoice number filled in. That number comes back in the bank narration, so the statement import matches it. */
function PayByUpi({ invoice }: { invoice: InvoiceDetail }) {
  const [qr, setQr] = useState('');
  const params = new URLSearchParams({ pa: invoice.seller.upiId, pn: invoice.seller.name, am: (invoice.balance / 100).toFixed(2), cu: 'INR', tn: invoice.number });
  const link = `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
  useEffect(() => {
    let current = true;
    void QRCode.toDataURL(link, { width: 176, margin: 1 }).then((url) => {
      if (current) setQr(url);
    });
    return () => {
      current = false;
    };
  }, [link]);
  return (
    <Card className="mt-4 flex flex-wrap items-center gap-4 p-4">
      {qr && <img src={qr} alt={`UPI QR code to pay ${money(invoice.balance)}`} width={176} height={176} className="rounded-md border border-slate-200" />}
      <div className="min-w-52 flex-1">
        <h2 className="text-[13px] font-semibold text-slate-900">Pay {money(invoice.balance)} by UPI</h2>
        <p className="mt-1 text-xs text-slate-500">Scan with any UPI app, or tap the button on your phone. The amount and invoice number are filled in for you. It shows as paid here once our team matches it to the bank statement.</p>
        <a href={link} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[13px] font-medium text-white hover:bg-accent-hover">
          <Smartphone className="size-3.5" aria-hidden />
          Open UPI app
        </a>
      </div>
    </Card>
  );
}

export function PortalPlansPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['portal', 'plans'], queryFn: () => api.get<PortalPlan[]>('/portal/plans') });
  const [choosing, setChoosing] = useState<PortalPlan | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [variantId, setVariantId] = useState<number | ''>('');
  const request = useMutation({
    mutationFn: () => api.post<PortalSubscription>('/portal/subscriptions', { planId: choosing?.id, quantity: Number(quantity), variantId: variantId || null }),
    onSuccess: (sub) => {
      refreshAll();
      toast('Quotation ready. Review and accept it to start.');
      navigate(`/portal/subscriptions/${sub.id}`);
    },
  });
  useEffect(() => {
    if (!choosing) return;
    request.reset();
    setQuantity(String(choosing.minQuantity));
    setVariantId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing]);
  if (isLoading) return <Skeleton className="h-64 rounded-lg" />;
  if (isError) return <ErrorState error={error} />;
  const variant = choosing?.variants.find((v) => v.id === variantId);
  const preview = choosing ? (choosing.price + (variant?.extraPrice ?? 0)) * (Number(quantity) || 0) : 0;
  const errors = fieldErrors(request.error);
  return (
    <>
      <PageHeader title="Plans" description="Pick a plan to get a quotation. Nothing is billed until you accept it." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((plan) => (
          <Card key={plan.id} className="flex flex-col p-4">
            <h2 className="text-[13px] font-semibold text-slate-900">{plan.name}</h2>
            <p className="text-xs text-slate-500">{plan.productName}</p>
            <p className="num mt-2 text-xl font-semibold tracking-tight text-slate-900">
              {money(plan.price)}
              <span className="text-xs font-normal text-slate-500"> /{PERIOD_UNIT[plan.billingPeriod]}</span>
            </p>
            <p className="mt-1 mb-3 flex-1 text-xs text-slate-500">
              {plan.minQuantity > 1 ? `Minimum ${plan.minQuantity} units. ` : ''}
              {plan.notes}
            </p>
            <Button onClick={() => setChoosing(plan)}>Choose</Button>
          </Card>
        ))}
      </div>
      {data?.length === 0 && (
        <Card>
          <EmptyState title="No plans are on sale right now" />
        </Card>
      )}
      <Modal
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        title={choosing ? `Get a quotation for ${choosing.name}` : ''}
        footer={
          <>
            <Button onClick={() => setChoosing(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="request-form" loading={request.isPending}>
              Get quotation
            </Button>
          </>
        }
      >
        <form
          id="request-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate();
          }}
        >
          <Field label="Quantity" error={errors.quantity ?? errors.planQuantity} hint={choosing ? `Minimum ${choosing.minQuantity}` : undefined}>
            {(id) => <Input id={id} type="number" min={choosing?.minQuantity ?? 1} className="num" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
          </Field>
          {choosing && choosing.variants.length > 0 && (
            <Field label="Variant">
              {(id) => (
                <Select id={id} value={variantId} onChange={(e) => setVariantId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Standard</option>
                  {choosing.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.value} (+{money(v.extraPrice)})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {choosing && (
            <p className="text-xs text-slate-500">
              About <span className="num font-medium text-slate-800">{money(preview)}</span> per {PERIOD_UNIT[choosing.billingPeriod]} before tax and any discounts. Your quotation shows the exact amount.
            </p>
          )}
          {Boolean(request.error) && !isShownOnField(request.error, errors) && <FormError error={request.error} />}
        </form>
      </Modal>
    </>
  );
}

export function PortalAccountPage() {
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['portal', 'overview'], queryFn: () => api.get<PortalOverview>('/portal/overview') });
  const [form, setForm] = useState({ name: '', company: '', phone: '', address: '' });
  useEffect(() => {
    if (data) setForm({ name: data.customer.name, company: data.customer.company, phone: data.customer.phone, address: data.customer.address });
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.patch('/portal/profile', form),
    onSuccess: () => {
      refreshAll();
      toast('Details saved');
    },
  });
  const errors = fieldErrors(save.error);
  const bind = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })) });
  return (
    <>
      <PageHeader title="Account" description={data?.customer.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-[13px] font-semibold text-slate-900">Billing details</h2>
          <form
            className="max-w-sm space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Name" error={errors.name}>{(id) => <Input id={id} {...bind('name')} />}</Field>
            <Field label="Company">{(id) => <Input id={id} {...bind('company')} />}</Field>
            <Field label="Phone">{(id) => <Input id={id} {...bind('phone')} />}</Field>
            <Field label="Billing address">{(id) => <Textarea id={id} {...bind('address')} />}</Field>
            {Boolean(save.error) && !isShownOnField(save.error, errors) && <FormError error={save.error} />}
            <Button variant="primary" type="submit" loading={save.isPending}>
              Save details
            </Button>
          </form>
        </Card>
        <PasswordCard />
      </div>
    </>
  );
}
