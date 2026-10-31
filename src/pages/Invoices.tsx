import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { CheckCheck, CheckCircle2, Download, FileText, Play } from 'lucide-react';
import { useState } from 'react';
import type { BillingRunResult, BillingStatus, InvoiceList, InvoiceStatus } from '../../shared/types';
import { InvoiceStatusBadge } from '../components/badges';
import { Button, Card, ConfirmDialog, Checkbox, EmptyState, ErrorState, Modal, PageHeader, Pagination, SearchInput, TD, TH, TableSkeleton, Tabs, cx, useToast } from '../components/ui';
import { api, queryString, refreshAll } from '../lib/api';
import { date, money, number, timeAgo } from '../lib/format';
import { useSearchFilter, useDrawer, useUrlFilters } from '../lib/hooks';

const PAGE_SIZE = 25;
type Tab = '' | InvoiceStatus | 'overdue';

function BillingPanel() {
  const toast = useToast();
  const status = useQuery({ queryKey: ['billing-status'], queryFn: () => api.get<BillingStatus>('/billing/status') });
  const [result, setResult] = useState<BillingRunResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sendToo, setSendToo] = useState(false);

  const run = useMutation({
    mutationFn: () => api.post<BillingRunResult>('/billing/run'),
    onSuccess: (r) => {
      refreshAll();
      setResult(r);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const confirmAll = useMutation({
    mutationFn: () => api.post<{ confirmed: number }>('/invoices/confirm-all', { send: sendToo }),
    onSuccess: ({ confirmed }) => {
      refreshAll();
      setConfirming(false);
      toast(`${number(confirmed)} invoices confirmed${sendToo ? '. Sending in the background; outcomes are in the email log.' : ''}`);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const data = status.data;
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
        <div>
          <dt className="text-slate-500">Due to bill now</dt>
          <dd className="num text-base font-semibold text-slate-900">{data ? number(data.dueNow) : '–'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Drafts to confirm</dt>
          <dd className="num text-base font-semibold text-slate-900">{data ? number(data.draftInvoices) : '–'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last run</dt>
          <dd className="mt-0.5 text-[13px] text-slate-800">
            {data?.lastRun ? (
              <>
                {timeAgo(data.lastRun.createdAt)}, <span className="num">{number(data.lastRun.created)}</span> invoices
                {data.lastRun.failed > 0 && <span className="font-medium text-rose-700"> · {data.lastRun.failed} failed</span>}
              </>
            ) : (
              'Not yet run'
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button icon={<CheckCheck className="size-3.5" />} disabled={!data?.draftInvoices} onClick={() => setConfirming(true)}>
          Confirm all drafts
        </Button>
        <Button variant="primary" icon={<Play className="size-3.5" />} loading={run.isPending} onClick={() => run.mutate()}>
          Run billing
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Confirm ${data ? number(data.draftInvoices) : ''} draft invoices?`}
        description="They become payable and start counting towards overdue from their due dates."
        confirmLabel="Confirm all"
        loading={confirmAll.isPending}
        onConfirm={() => confirmAll.mutate()}
      >
        <Checkbox label="Also email each invoice to its customer" checked={sendToo} onChange={setSendToo} />
      </ConfirmDialog>

      <Modal open={result !== null} onClose={() => setResult(null)} title="Billing run finished" footer={<Button variant="primary" onClick={() => setResult(null)}>Done</Button>}>
        {result && (
          <div className="space-y-3 text-[13px]">
            <p className="flex items-center gap-2 text-slate-800">
              <CheckCircle2 className={cx('size-4', result.failed ? 'text-amber-600' : 'text-emerald-600')} aria-hidden />
              {result.created === 0 && result.failed === 0 ? 'Everything due has already been billed. Nothing was created.' : `Created ${number(result.created)} draft invoices worth ${money(result.totalAmount)}.`}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              {[
                ['Activated', result.activated],
                ['Already billed', result.skipped],
                ['Closed', result.closed],
                ['Failed', result.failed],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="num text-slate-900">{number(value as number)}</dd>
                </div>
              ))}
            </dl>
            {result.errors.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                <p className="mb-1 font-medium">These could not be billed and will be tried again next run:</p>
                <ul className="space-y-0.5">
                  {result.errors.slice(0, 10).map((e) => (
                    <li key={e.subscriptionId}>
                      <span className="num">{e.number}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default function Invoices() {
  const { get, set, page } = useUrlFilters<'q' | 'status' | 'from' | 'to'>();
  const drawer = useDrawer('inv');
  const { text, setText, q } = useSearchFilter(get('q'), (value) => set({ q: value }));
  const status = get('status') as Tab;
  const from = get('from');
  const to = get('to');

  const params = { q, status, from, to };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['invoices', params, page],
    queryFn: () => api.get<InvoiceList>(`/invoices${queryString({ ...params, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const counts = data?.statusCounts;
  const all = counts ? counts.draft + counts.confirmed + counts.paid + counts.cancelled : undefined;

  return (
    <>
      <PageHeader title="Invoices & Billing" description="Generated from subscriptions. Billing runs on its own every day, and repeating a run never bills twice." />
      <BillingPanel />
      <Card>
        <div className="px-2.5 pt-1">
          <Tabs<Tab>
            label="Invoice status"
            value={status}
            onChange={(value) => set({ status: value || null })}
            tabs={[
              { value: '', label: 'All', count: all },
              { value: 'draft', label: 'Draft', count: counts?.draft },
              { value: 'confirmed', label: 'Confirmed', count: counts?.confirmed },
              { value: 'overdue', label: 'Overdue', count: counts?.overdue },
              { value: 'paid', label: 'Paid', count: counts?.paid },
              { value: 'cancelled', label: 'Cancelled', count: counts?.cancelled },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <SearchInput value={text} onChange={setText} placeholder="Search invoice, customer or subscription" className="min-w-52 flex-1 sm:max-w-80" />
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Issued from
            <input type="date" value={from} onChange={(e) => set({ from: e.target.value })} className="num h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            to
            <input type="date" value={to} onChange={(e) => set({ to: e.target.value })} className="num h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" />
          </label>
          <a href={`/api/invoices/export.csv${queryString(params)}`} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
            <Download className="size-3.5" aria-hidden />
            Export CSV
          </a>
        </div>
        <div className={cx('overflow-x-auto', isFetching && !isLoading && 'opacity-70')}>
          <table className="w-full min-w-[900px] border-t border-slate-200 text-[13px]">
            <thead>
              <tr>
                <th className={TH}>Invoice</th>
                <th className={TH}>Customer</th>
                <th className={TH}>Subscription</th>
                <th className={TH}>Issued</th>
                <th className={TH}>Due</th>
                <th className={TH}>Status</th>
                <th className={cx(TH, 'text-right')}>Total</th>
                <th className={cx(TH, 'text-right')}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton columns={8} />}
              {data?.rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  aria-label={`Open ${row.number}`}
                  onClick={() => drawer.open(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') drawer.open(row.id);
                  }}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className={cx(TD, 'num text-slate-900')}>{row.number}</td>
                  <td className={cx(TD, 'max-w-56')}>
                    <span className="block truncate font-medium text-slate-900">{row.customerName}</span>
                    <span className="block truncate text-xs text-slate-500">{row.company}</span>
                  </td>
                  <td className={cx(TD, 'num text-slate-600')}>{row.subscriptionNumber}</td>
                  <td className={cx(TD, 'num whitespace-nowrap text-slate-600')}>{date(row.issueDate)}</td>
                  <td className={cx(TD, 'num whitespace-nowrap', row.overdue ? 'text-rose-700' : 'text-slate-600')}>{date(row.dueDate)}</td>
                  <td className={TD}>
                    <InvoiceStatusBadge row={row} />
                  </td>
                  <td className={cx(TD, 'num text-right text-slate-900')}>{money(row.total)}</td>
                  <td className={cx(TD, 'num text-right', row.balance > 0 ? 'text-slate-900' : 'text-slate-400')}>{money(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isError && <ErrorState error={error} onRetry={() => refetch()} />}
          {data?.rows.length === 0 && <EmptyState icon={<FileText className="size-5" />} title="No invoices here" description="Invoices appear when a billing run reaches a subscription's billing date." />}
        </div>
        {data && data.total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => set({ page: p })}>
            <span>
              Total <span className="num text-slate-700">{money(data.summary.total)}</span>
            </span>
            <span>
              Outstanding <span className="num text-slate-700">{money(data.summary.balance)}</span>
            </span>
          </Pagination>
        )}
      </Card>
    </>
  );
}
