import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardSummary } from '../../shared/types';
import { Sparkline } from '../components/charts';
import { SubscriptionTable } from '../components/SubscriptionTable';
import { Badge, Card, ErrorState, PageHeader, Skeleton, cx } from '../components/ui';
import { api } from '../lib/api';
import { moneyWhole, number } from '../lib/format';

function Kpi({ label, value, children, aside, to }: { label: string; value: ReactNode; children?: ReactNode; aside?: ReactNode; to?: string }) {
  const body = (
    <Card className={cx('flex h-full items-start justify-between gap-3 p-3.5', to && 'transition-colors hover:border-slate-300')}>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="num mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-slate-500">{children}</div>
      </div>
      {aside}
    </Card>
  );
  return to ? <Link to={to} className="block rounded-lg">{body}</Link> : body;
}

function KpiBar() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('/dashboard') });
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => refetch()} />
      </Card>
    );
  }
  const change = data.mrrChangePct;
  const up = (change ?? 0) >= 0;
  const net = data.activeNetThisWeek;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Monthly Recurring Revenue" value={moneyWhole(data.mrr)} aside={<Sparkline values={data.mrrTrend} label={`Monthly recurring revenue over 12 months, now ${moneyWhole(data.mrr)}`} />}>
        {change !== null && (
          <>
            <span className={cx('num inline-flex items-center gap-0.5 font-medium', up ? 'text-emerald-700' : 'text-rose-700')}>
              {up ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
              {up ? '+' : ''}
              {change.toFixed(1)}%
            </span>
            vs last month
          </>
        )}
      </Kpi>
      <Kpi label="Active Subscriptions" value={number(data.activeSubscriptions)} to="/subscriptions?status=active">
        <span className={cx('num font-medium', net >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
          {net >= 0 ? '+' : ''}
          {number(net)}
        </span>
        this week
      </Kpi>
      <Kpi label="Overdue Invoices" value={moneyWhole(data.overdueAmount)} to="/invoices?status=overdue">
        {data.overdueCount > 0 ? (
          <Badge tone="rose">
            <AlertTriangle className="size-3" aria-hidden />
            <span className="num">{number(data.overdueCount)}</span> invoices overdue
          </Badge>
        ) : (
          <Badge tone="emerald">Nothing overdue</Badge>
        )}
      </Kpi>
      <Kpi label="Collection Rate" value={data.collectionRate === null ? '—' : `${data.collectionRate.toFixed(1)}%`}>
        Billed amounts collected, due in the last 90 days
      </Kpi>
    </div>
  );
}

export default function Dashboard() {
  return (
    <>
      <PageHeader title="Dashboard" description="Recurring revenue, renewals and billing at a glance." />
      <KpiBar />
      <div className="mt-4">
        <SubscriptionTable />
      </div>
    </>
  );
}
