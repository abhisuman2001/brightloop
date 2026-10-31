import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Download, Eye, FileText, Filter, Layers, MoreHorizontal, Pause, Play, Plus, Repeat, X, XCircle } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { BILLING_PERIODS, SUBSCRIPTION_STATUSES } from '../../shared/schemas';
import type { SubscriptionList, SubscriptionRow } from '../../shared/types';
import { api, queryString, refreshAll } from '../lib/api';
import { PERIOD_LABEL, date, money, number } from '../lib/format';
import { useSearchFilter, useDrawer, useUrlFilters } from '../lib/hooks';
import { SUB_LABEL, SubscriptionBadges } from './badges';
import { SubscriptionForm } from './SubscriptionForm';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Menu, Pagination, SearchInput, TD, TH, TableSkeleton, cx, useToast } from './ui';

type FilterKey = 'q' | 'status' | 'billing' | 'overdue' | 'expiring' | 'group' | 'sort' | 'dir';
const GROUPS = { status: 'Lifecycle status', billing: 'Billing frequency', plan: 'Plan' } as const;
type GroupKey = keyof typeof GROUPS;
const PAGE_SIZE = 25;
const COLUMNS = 8;

function SortHeader({ label, sortKey, sort, dir, onSort, align }: { label: string; sortKey: string; sort: string; dir: string; onSort: (key: string) => void; align?: 'right' }) {
  const active = sort === sortKey;
  return (
    <th className={cx(TH, align === 'right' && 'text-right')} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => onSort(sortKey)} className={cx('inline-flex items-center gap-1 uppercase hover:text-slate-800', active && 'text-slate-800')}>
        {label}
        {active && (dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </th>
  );
}

function groupLabel(row: SubscriptionRow, group: GroupKey): string {
  if (group === 'status') return SUB_LABEL[row.status];
  if (group === 'billing') return PERIOD_LABEL[row.billingPeriod];
  return row.planName;
}

export function SubscriptionTable() {
  const { get, set, page } = useUrlFilters<FilterKey>();
  const drawer = useDrawer('sub');
  const invoiceDrawer = useDrawer('inv');
  const toast = useToast();
  const { text, setText, q } = useSearchFilter(get('q'), (value) => set({ q: value }));
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<SubscriptionRow | null>(null);

  const status = get('status');
  const billing = get('billing');
  const overdue = get('overdue') === '1';
  const expiring = get('expiring');
  const group = (get('group') || '') as GroupKey | '';
  const sort = get('sort');
  const dir = get('dir') || 'desc';

  // Grouping sorts by the group first, so a group's rows sit together across pages.
  const params = { q, status, billing, overdue: overdue ? 1 : null, expiring: expiring || null, sort: group || sort, dir: group ? 'asc' : sort ? dir : null, then: group ? sort : null, thenDir: group && sort ? dir : null };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['subscriptions', params, page],
    queryFn: () => api.get<SubscriptionList>(`/subscriptions${queryString({ ...params, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const rowAction = useMutation({
    mutationFn: ({ id, path, body }: { id: number; path: string; body?: object; done: string }) => api.post(`/subscriptions/${id}/${path}`, body ?? {}),
    onSuccess: (_d, { done }) => {
      refreshAll();
      toast(done);
      setCancelling(null);
    },
    onError: (err: Error) => {
      if (!cancelling) toast(err.message, 'error');
    },
  });

  useEffect(() => {
    rowAction.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelling]);

  const generate = useMutation({
    mutationFn: (id: number) => api.post<{ invoiceId: number }>(`/subscriptions/${id}/invoice`),
    onSuccess: ({ invoiceId }) => {
      refreshAll();
      toast('Draft invoice created');
      invoiceDrawer.open(invoiceId);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const toggleSort = (key: string) => {
    if (sort === key) set({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else set({ sort: key, dir: 'desc' });
  };

  const exportUrl = `/api/subscriptions/export.csv${queryString({ q, status, billing, overdue: overdue ? 1 : null, expiring: expiring || null })}`;
  const hasFilters = Boolean(q || status || billing || overdue || expiring);
  const activeFilterCount = Number(Boolean(status)) + Number(Boolean(billing)) + Number(overdue) + Number(Boolean(expiring));

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <SearchInput value={text} onChange={setText} placeholder="Search number, customer or plan" className="min-w-52 flex-1 sm:max-w-80" />
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button icon={<Filter className="size-3.5" />}>
              Filter
              {activeFilterCount > 0 && <span className="num rounded bg-accent-soft px-1 text-[11px] text-accent">{activeFilterCount}</span>}
            </Button>
          </Menu.Trigger>
          <Menu.Content align="start">
            <p className="px-2 py-1 text-[11px] font-medium text-slate-400 uppercase">Status</p>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <Menu.Item key={s} icon={<Check className={cx('size-3.5', status !== s && 'invisible')} />} onSelect={() => set({ status: status === s ? null : s })}>
                {SUB_LABEL[s]}
                <span className="num ml-auto text-xs text-slate-400">{data ? number(data.statusCounts[s]) : ''}</span>
              </Menu.Item>
            ))}
            <Menu.Item icon={<Check className={cx('size-3.5', !overdue && 'invisible')} />} onSelect={() => set({ overdue: overdue ? null : '1' })}>
              Overdue
            </Menu.Item>
            <Menu.Separator />
            <p className="px-2 py-1 text-[11px] font-medium text-slate-400 uppercase">Billing cycle</p>
            {BILLING_PERIODS.map((p) => (
              <Menu.Item key={p} icon={<Check className={cx('size-3.5', billing !== p && 'invisible')} />} onSelect={() => set({ billing: billing === p ? null : p })}>
                {PERIOD_LABEL[p]}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button icon={<Layers className="size-3.5" />}>Group by{group && `: ${GROUPS[group]}`}</Button>
          </Menu.Trigger>
          <Menu.Content align="start">
            <Menu.Item icon={<Check className={cx('size-3.5', group && 'invisible')} />} onSelect={() => set({ group: null })}>
              No grouping
            </Menu.Item>
            {(Object.keys(GROUPS) as GroupKey[]).map((key) => (
              <Menu.Item key={key} icon={<Check className={cx('size-3.5', group !== key && 'invisible')} />} onSelect={() => set({ group: key })}>
                {GROUPS[key]}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
        <div className="ml-auto flex items-center gap-2">
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button icon={<Download className="size-3.5" />}>Export</Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item icon={<Download className="size-3.5" />} onSelect={() => window.location.assign(exportUrl)}>
                {hasFilters ? 'Export filtered view (CSV)' : 'Export all (CSV)'}
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            Create Subscription
          </Button>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5">
          {status && <FilterChip label={`Status: ${SUB_LABEL[status as keyof typeof SUB_LABEL] ?? status}`} onClear={() => set({ status: null })} />}
          {overdue && <FilterChip label="Overdue" onClear={() => set({ overdue: null })} />}
          {expiring && <FilterChip label={`Expiring in ${expiring} days`} onClear={() => set({ expiring: null })} />}
          {billing && <FilterChip label={`Billing: ${PERIOD_LABEL[billing as keyof typeof PERIOD_LABEL] ?? billing}`} onClear={() => set({ billing: null })} />}
        </div>
      )}

      <div className={cx('overflow-x-auto transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        <table className="w-full min-w-[1080px] border-t border-slate-200 text-[13px]">
          <thead>
            <tr>
              <SortHeader label="Subscription" sortKey="number" sort={sort} dir={dir} onSort={toggleSort} />
              <SortHeader label="Customer" sortKey="customer" sort={sort} dir={dir} onSort={toggleSort} />
              <th className={TH}>Plan</th>
              <th className={TH}>Billing</th>
              <SortHeader label="Start / Next invoice" sortKey="next" sort={sort} dir={dir} onSort={toggleSort} />
              <th className={TH}>Status</th>
              <SortHeader label="Recurring" sortKey="amount" sort={sort} dir={dir} onSort={toggleSort} align="right" />
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton columns={COLUMNS} />}
            {data?.rows.map((row, i) => {
              const showGroup = group && (i === 0 || groupLabel(data.rows[i - 1], group) !== groupLabel(row, group));
              return (
                <Fragment key={row.id}>
                  {showGroup && (
                    <tr>
                      <td colSpan={COLUMNS} className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                        {groupLabel(row, group)}
                      </td>
                    </tr>
                  )}
                  <tr
                    tabIndex={0}
                    aria-label={`Open ${row.number}`}
                    onClick={() => drawer.open(row.id)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        drawer.open(row.id);
                      }
                    }}
                    className="cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50"
                  >
                    <td className={cx(TD, 'num whitespace-nowrap text-slate-900')}>{row.number}</td>
                    <td className={cx(TD, 'max-w-56')}>
                      <span className="block truncate font-medium text-slate-900">{row.customerName}</span>
                      <span className="block truncate text-xs text-slate-500">{row.company}</span>
                    </td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-800">
                        {row.planName}
                        {row.variantLabel && <Badge tone="indigo">{row.variantLabel} Variant</Badge>}
                      </span>
                    </td>
                    <td className={cx(TD, 'text-slate-600')}>{PERIOD_LABEL[row.billingPeriod]}</td>
                    <td className={cx(TD, 'whitespace-nowrap')}>
                      <span className="num block text-slate-600">{date(row.startDate)}</span>
                      <span className="num block text-xs text-slate-500">{row.nextInvoiceDate ? date(row.nextInvoiceDate) : '—'}</span>
                    </td>
                    <td className={TD}>
                      <SubscriptionBadges row={row} />
                    </td>
                    <td className={cx(TD, 'num text-right whitespace-nowrap text-slate-900')}>{money(row.recurringAmount)}</td>
                    <td className={cx(TD, 'w-10 pr-2')} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Menu.Root>
                        <Menu.Trigger asChild>
                          <IconButton label={`Actions for ${row.number}`} className="size-7">
                            <MoreHorizontal className="size-4" />
                          </IconButton>
                        </Menu.Trigger>
                        <Menu.Content>
                          <Menu.Item icon={<Eye className="size-3.5" />} onSelect={() => drawer.open(row.id)}>
                            View
                          </Menu.Item>
                          <Menu.Item icon={<FileText className="size-3.5" />} disabled={row.status !== 'active' || row.paused} onSelect={() => generate.mutate(row.id)}>
                            Generate Invoice
                          </Menu.Item>
                          {row.paused ? (
                            <Menu.Item icon={<Play className="size-3.5" />} onSelect={() => rowAction.mutate({ id: row.id, path: 'resume', done: `${row.number} resumed` })}>
                              Resume
                            </Menu.Item>
                          ) : (
                            <Menu.Item icon={<Pause className="size-3.5" />} disabled={row.status !== 'active' || !row.pausable} onSelect={() => rowAction.mutate({ id: row.id, path: 'pause', done: `${row.number} paused` })}>
                              Pause
                            </Menu.Item>
                          )}
                          <Menu.Separator />
                          <Menu.Item icon={<XCircle className="size-3.5" />} danger disabled={row.status === 'closed'} onSelect={() => setCancelling(row)}>
                            Cancel
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Root>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data?.rows.length === 0 && (
          <EmptyState
            icon={<Repeat className="size-5" />}
            title={hasFilters ? 'No subscriptions match these filters' : 'No subscriptions yet'}
            description={hasFilters ? 'Try a broader search or clear a filter.' : 'Create the first one, or start from a quotation template.'}
            action={
              hasFilters ? (
                <Button
                  onClick={() => {
                    setText('');
                    set({ q: null, status: null, billing: null, overdue: null, expiring: null });
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create Subscription
                </Button>
              )
            }
          />
        )}
      </div>

      {data && data.total > 0 && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => set({ page: p })}>
          <span>
            Active <span className="num text-slate-700">{number(data.summary.activeCount)}</span>
          </span>
          <span>
            Recurring subtotal <span className="num text-slate-700">{money(data.summary.recurringSubtotal)}</span> per cycle, before tax
          </span>
        </Pagination>
      )}

      <SubscriptionForm open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => {
          setCancelling(null);
          rowAction.reset();
        }}
        title={`Cancel ${cancelling?.number ?? ''}?`}
        description="Billing stops immediately and this cannot be reopened. Invoices already issued stay as they are."
        confirmLabel="Cancel subscription"
        danger
        loading={rowAction.isPending}
        error={rowAction.error}
        onConfirm={() => cancelling && rowAction.mutate({ id: cancelling.id, path: 'transition', body: { to: 'closed', reason: 'Cancelled by staff' }, done: `${cancelling.number} cancelled` })}
      />
    </Card>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-slate-50 pr-1 pl-2 text-xs text-slate-700">
      {label}
      <button type="button" aria-label={`Remove filter ${label}`} onClick={onClear} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
        <X className="size-3" />
      </button>
    </span>
  );
}
