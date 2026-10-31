import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard, Download, Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PAYMENT_METHODS } from '../../shared/schemas';
import type { Payment, PaymentList } from '../../shared/types';
import { PaymentDialog } from '../components/PaymentDialog';
import { ReconcileDialog } from '../components/ReconcileDialog';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Select, TD, TH, TableSkeleton, cx, useToast } from '../components/ui';
import { api, queryString, refreshAll } from '../lib/api';
import { METHOD_LABEL, date, money, moneyWhole } from '../lib/format';
import { useSearchFilter, useUrlFilters, useUser } from '../lib/hooks';

const PAGE_SIZE = 25;

export default function Payments() {
  const me = useUser();
  const toast = useToast();
  const { get, set, page } = useUrlFilters<'q' | 'method'>();
  const { text, setText, q } = useSearchFilter(get('q'), (value) => set({ q: value }));
  const method = get('method');
  const [recording, setRecording] = useState(false);
  const [matching, setMatching] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['payments', q, method, page],
    queryFn: () => api.get<PaymentList>(`/payments${queryString({ q, method, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const voidPayment = useMutation({
    mutationFn: (id: number) => api.post(`/payments/${id}/void`),
    onSuccess: () => {
      refreshAll();
      setVoiding(null);
      toast('Payment voided and invoice reopened');
    },
  });

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received against invoices, and what is still to come in."
        actions={
          <>
            <Button icon={<Upload className="size-3.5" />} onClick={() => setMatching(true)}>
              Match bank statement
            </Button>
            <a href={`/api/payments/export.csv${queryString({ q, method })}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
              <Download className="size-3.5" aria-hidden />
              Export CSV
            </a>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setRecording(true)}>
              Register Payment
            </Button>
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-3.5">
          <p className="text-xs font-medium text-slate-500">Collected{q || method ? ' (filtered)' : ''}</p>
          <p className="num mt-1 text-xl font-semibold text-slate-900">{data ? moneyWhole(data.summary.collected) : '–'}</p>
        </Card>
        <Link to="/invoices?status=confirmed" className="block rounded-lg">
          <Card className="p-3.5 hover:border-slate-300">
            <p className="text-xs font-medium text-slate-500">Outstanding</p>
            <p className="num mt-1 text-xl font-semibold text-slate-900">{data ? moneyWhole(data.summary.outstanding) : '–'}</p>
          </Card>
        </Link>
        <Link to="/invoices?status=overdue" className="block rounded-lg">
          <Card className="p-3.5 hover:border-slate-300">
            <p className="text-xs font-medium text-slate-500">Of which overdue</p>
            <p className="num mt-1 text-xl font-semibold text-rose-700">{data ? moneyWhole(data.summary.overdue) : '–'}</p>
          </Card>
        </Link>
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 p-2.5">
          <SearchInput value={text} onChange={setText} placeholder="Search invoice, customer or note" className="min-w-52 flex-1 sm:max-w-80" />
          <Select aria-label="Payment method" className="w-40" value={method} onChange={(e) => set({ method: e.target.value })}>
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </Select>
        </div>
        <div className={cx('overflow-x-auto', isFetching && !isLoading && 'opacity-70')}>
          <table className="w-full min-w-[820px] border-t border-slate-200 text-[13px]">
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Invoice</th>
                <th className={TH}>Customer</th>
                <th className={TH}>Method</th>
                <th className={TH}>Note</th>
                <th className={cx(TH, 'text-right')}>Amount</th>
                {me.role === 'admin' && (
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton columns={6} />}
              {data?.rows.map((p) => (
                <tr key={p.id} className={cx(p.voidedAt && 'text-slate-400')}>
                  <td className={cx(TD, 'num whitespace-nowrap')}>{date(p.paymentDate)}</td>
                  <td className={TD}>
                    <Link to={`/invoices?inv=${p.invoiceId}`} className="num text-accent hover:underline">
                      {p.invoiceNumber}
                    </Link>
                  </td>
                  <td className={cx(TD, 'max-w-56')}>
                    <span className="block truncate font-medium">{p.customerName}</span>
                    <span className="block truncate text-xs text-slate-500">{p.company}</span>
                  </td>
                  <td className={TD}>{METHOD_LABEL[p.method]}</td>
                  <td className={cx(TD, 'max-w-56 truncate text-slate-500')}>{p.note || '—'}</td>
                  <td className={cx(TD, 'num text-right')}>
                    {p.voidedAt ? <Badge tone="rose" className="mr-2">Void</Badge> : null}
                    <span className={cx(p.voidedAt ? 'line-through' : 'text-slate-900')}>{money(p.amount)}</span>
                  </td>
                  {me.role === 'admin' && (
                    <td className={cx(TD, 'w-16 text-right')}>
                      {!p.voidedAt && (
                        <button type="button" onClick={() => setVoiding(p)} className="text-xs text-slate-500 hover:text-rose-700 hover:underline">
                          Void
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {isError && <ErrorState error={error} onRetry={() => refetch()} />}
          {data?.rows.length === 0 && <EmptyState icon={<CreditCard className="size-5" />} title="No payments found" description="Recorded payments appear here with their method, date and note." />}
        </div>
        {data && data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => set({ page: p })} />}
      </Card>
      <PaymentDialog open={recording} onClose={() => setRecording(false)} />
      <ReconcileDialog open={matching} onClose={() => setMatching(false)} />
      <ConfirmDialog
        open={voiding !== null}
        onClose={() => {
          setVoiding(null);
          voidPayment.reset();
        }}
        title="Void this payment?"
        description={`${voiding ? money(voiding.amount) : ''} against ${voiding?.invoiceNumber ?? ''} stops counting as received and the invoice goes back to outstanding. The record is kept.`}
        confirmLabel="Void payment"
        danger
        loading={voidPayment.isPending}
        error={voidPayment.error}
        onConfirm={() => voiding && voidPayment.mutate(voiding.id)}
      />
    </>
  );
}
