import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useState } from 'react';
import type { Customer, Paged } from '../../shared/types';
import { CustomerForm } from '../components/CustomerDrawer';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, TD, TH, TableSkeleton, cx } from '../components/ui';
import { api, queryString } from '../lib/api';
import { money } from '../lib/format';
import { useSearchFilter, useDrawer, useUrlFilters } from '../lib/hooks';

const PAGE_SIZE = 25;

export default function Customers() {
  const { get, set, page } = useUrlFilters<'q'>();
  const drawer = useDrawer('cust');
  const { text, setText, q } = useSearchFilter(get('q'), (value) => set({ q: value }));
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['customers', q, page],
    queryFn: () => api.get<Paged<Customer>>(`/customers${queryString({ q, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Who you bill, what they pay monthly and what they still owe."
        actions={
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            Add customer
          </Button>
        }
      />
      <Card>
        <div className="p-2.5">
          <SearchInput value={text} onChange={setText} placeholder="Search name, company or email" className="sm:max-w-80" />
        </div>
        <div className={cx('overflow-x-auto', isFetching && !isLoading && 'opacity-70')}>
          <table className="w-full min-w-[760px] border-t border-slate-200 text-[13px]">
            <thead>
              <tr>
                <th className={TH}>Customer</th>
                <th className={TH}>Email</th>
                <th className={cx(TH, 'text-right')}>Active subs</th>
                <th className={cx(TH, 'text-right')}>Monthly</th>
                <th className={cx(TH, 'text-right')}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton columns={5} />}
              {data?.rows.map((c) => (
                <tr key={c.id} tabIndex={0} aria-label={`Open ${c.name}`} onClick={() => drawer.open(c.id)} onKeyDown={(e) => e.key === 'Enter' && drawer.open(c.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className={cx(TD, 'max-w-64')}>
                    <span className="block truncate font-medium text-slate-900">{c.name}</span>
                    <span className="block truncate text-xs text-slate-500">{c.company}</span>
                  </td>
                  <td className={cx(TD, 'max-w-72 truncate text-slate-600')}>{c.email}</td>
                  <td className={cx(TD, 'num text-right')}>{c.activeSubscriptions}</td>
                  <td className={cx(TD, 'num text-right text-slate-900')}>{money(c.monthlyAmount)}</td>
                  <td className={cx(TD, 'num text-right', c.outstanding > 0 ? 'text-amber-700' : 'text-slate-400')}>{money(c.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isError && <ErrorState error={error} onRetry={() => refetch()} />}
          {data?.rows.length === 0 && <EmptyState icon={<Users className="size-5" />} title={q ? 'No customers match' : 'No customers yet'} description={q ? 'Try a different search.' : 'Customers appear here when they sign up or you add them.'} />}
        </div>
        {data && data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => set({ page: p })} />}
      </Card>
      <CustomerForm open={creating} onClose={() => setCreating(false)} onCreated={drawer.open} />
    </>
  );
}
