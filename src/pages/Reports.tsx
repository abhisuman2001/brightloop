import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { addDays } from '../../shared/dates';
import type { FinanceReport, Plan } from '../../shared/types';
import { InvoiceStatusBadge } from '../components/badges';
import { BarList, RevenueChart } from '../components/charts';
import { Card, ErrorState, Input, PageHeader, Select, Skeleton, TD, TH, cx } from '../components/ui';
import { api, queryString } from '../lib/api';
import { METHOD_LABEL, date, money, moneyWhole, monthLabel, number, todayLocal } from '../lib/format';
import { useDrawer, useUrlFilters } from '../lib/hooks';

function Stat({ label, value, tone, detail }: { label: string; value: string; tone?: string; detail?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cx('num mt-1 text-xl font-semibold tracking-tight', tone ?? 'text-slate-900')}>{value}</p>
      {detail && <p className="mt-0.5 text-xs text-slate-500">{detail}</p>}
    </Card>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cx('p-3.5', className)}>
      <h2 className="mb-3 text-[13px] font-semibold text-slate-900">{title}</h2>
      {children}
    </Card>
  );
}

const AGING_COLOR: Record<string, string> = { 'Not yet due': '#64748B' };

export default function Reports() {
  const { get, set } = useUrlFilters<'from' | 'to' | 'planId'>();
  const drawer = useDrawer('inv');
  const from = get('from') || addDays(todayLocal(), -365);
  const to = get('to') || todayLocal();
  const planId = get('planId');
  const params = { from, to, planId };
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans') });
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['report', params],
    queryFn: () => api.get<FinanceReport>(`/reports/finance${queryString(params)}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Reports"
        description="Active subscriptions, revenue, payments and overdue invoices in one place."
        actions={
          <a href={`/api/reports/finance.csv${queryString(params)}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
            <Download className="size-3.5" aria-hidden />
            Export CSV
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">
          <span className="mb-1 block font-medium">From</span>
          <Input type="date" className="num w-40" value={from} max={to} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          <span className="mb-1 block font-medium">To</span>
          <Input type="date" className="num w-40" value={to} min={from} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          <span className="mb-1 block font-medium">Plan</span>
          <Select className="w-52" value={planId} onChange={(e) => set({ planId: e.target.value })}>
            <option value="">All plans</option>
            {plans.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {isError && (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      )}
      {isLoading && <Skeleton className="h-96 rounded-lg" />}
      {data && (
        <div className={cx('space-y-4 transition-opacity', isFetching && 'opacity-70')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Active subscriptions" value={number(data.activeSubscriptions)} />
            <Stat label="MRR" value={moneyWhole(data.mrr)} />
            <Stat label="Invoiced in range" value={moneyWhole(data.invoiced)} />
            <Stat label="Collected in range" value={moneyWhole(data.collected)} />
            <Stat label="Still owed" value={moneyWhole(data.outstanding)} detail="All confirmed unpaid" />
            <Stat label="Overdue" value={moneyWhole(data.overdueAmount)} tone="text-rose-700" detail={`${number(data.overdueCount)} invoices`} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="New MRR in range" value={moneyWhole(data.movement.newMrr)} tone="text-emerald-700" detail={`${number(data.movement.newSubscriptions)} subscriptions started`} />
            <Stat label="Churned MRR in range" value={moneyWhole(data.movement.churnedMrr)} tone="text-rose-700" detail={`${number(data.movement.churnedSubscriptions)} subscriptions closed`} />
            <Stat label="Subscription churn" value={data.movement.churnRatePct === null ? '—' : `${data.movement.churnRatePct.toFixed(1)}%`} detail={data.movement.revenueChurnPct === null ? 'No subscriptions in this range' : `${data.movement.revenueChurnPct.toFixed(1)}% of MRR. Closed, out of all in force in the range`} />
            <Stat label="MRR per customer" value={moneyWhole(data.movement.averagePerCustomer)} detail="Active, not paused" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="Invoiced and collected by month" className="xl:col-span-2">
              {data.revenueByMonth.length ? <RevenueChart data={data.revenueByMonth} /> : <p className="py-16 text-center text-xs text-slate-500">No revenue in this range.</p>}
              {data.revenueByMonth.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">View as table</summary>
                  <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr>
                          <th className={TH}>Month</th>
                          <th className={cx(TH, 'text-right')}>Invoiced</th>
                          <th className={cx(TH, 'text-right')}>Collected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.revenueByMonth.map((m) => (
                          <tr key={m.month}>
                            <td className={TD}>{monthLabel(m.month)}</td>
                            <td className={cx(TD, 'num text-right')}>{money(m.invoiced)}</td>
                            <td className={cx(TD, 'num text-right')}>{money(m.collected)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Panel>
            <Panel title="Outstanding by age">
              <BarList
                tone="#E11D48"
                items={data.aging.map((a) => ({
                  label: a.bucket,
                  value: a.amount,
                  display: money(a.amount),
                  detail: `${number(a.count)} inv.`,
                  color: AGING_COLOR[a.bucket],
                }))}
              />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="Recurring revenue by plan">
              <BarList items={data.byPlan.map((p) => ({ label: p.plan, value: p.mrr, display: moneyWhole(p.mrr), detail: `${number(p.active)} active` }))} />
              {data.byPlan.length === 0 && <p className="text-xs text-slate-500">No active subscriptions.</p>}
            </Panel>
            <Panel title="Payments by method">
              <BarList items={data.byMethod.map((m) => ({ label: METHOD_LABEL[m.method], value: m.amount, display: moneyWhole(m.amount), detail: `${number(m.count)} payments` }))} />
              {data.byMethod.length === 0 && <p className="text-xs text-slate-500">No payments in this range.</p>}
            </Panel>
            <Panel title="Longest overdue" className="xl:row-span-1">
              {data.overdueInvoices.length === 0 ? (
                <p className="text-xs text-slate-500">Nothing is overdue.</p>
              ) : (
                <ul className="-mx-1 max-h-64 divide-y divide-slate-100 overflow-y-auto">
                  {data.overdueInvoices.map((inv) => (
                    <li key={inv.id}>
                      <button type="button" onClick={() => drawer.open(inv.id)} className="flex w-full items-center justify-between gap-3 px-1 py-1.5 text-left hover:bg-slate-50">
                        <span className="min-w-0">
                          <span className="num block text-[13px] text-slate-900">{inv.number}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {inv.customerName} · due <span className="num">{date(inv.dueDate)}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <InvoiceStatusBadge row={inv} />
                          <span className="num text-[13px]">{money(inv.balance)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
