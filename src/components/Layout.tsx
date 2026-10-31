import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  ChevronRight,
  CreditCard,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  Repeat,
  Search,
  Settings,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ActivityEntry, NotificationItem, Role, SearchResults, SessionUser } from '../../shared/types';
import { api, queryString, refreshAll } from '../lib/api';
import { money, timeAgo } from '../lib/format';
import { loadPref, savePref, useDebounced, useUser } from '../lib/hooks';
import { InvoiceStatusBadge, SubscriptionStatusBadge } from './badges';
import { CustomerDrawer } from './CustomerDrawer';
import { InvoiceDrawer } from './InvoiceDrawer';
import { SubscriptionDrawer } from './SubscriptionDrawer';
import { Badge, IconButton, Menu, Skeleton, cx, useToast } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/subscriptions', label: 'Subscriptions', icon: Repeat },
  { to: '/plans', label: 'Plans & Variants', icon: Package },
  { to: '/invoices', label: 'Invoices & Billing', icon: FileText },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/discounts', label: 'Discounts & Rules', icon: Percent },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
        <Repeat className="size-4" aria-hidden />
      </span>
      {!compact && <span className="text-[13px] font-semibold tracking-tight whitespace-nowrap text-slate-900">Brightloop Software</span>}
    </span>
  );
}

function NavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={collapsed ? label : undefined}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex h-8 items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors',
              collapsed ? 'justify-center' : 'px-2.5',
              isActive ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {collapsed ? <span className="sr-only">{label}</span> : label}
        </NavLink>
      ))}
    </nav>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className={cx('no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-150 lg:flex', collapsed ? 'w-14' : 'w-56')}>
      <div className={cx('flex h-12 items-center border-b border-slate-200', collapsed ? 'justify-center' : 'px-3')}>
        <Link to="/" aria-label="Brightloop Software home">
          <Logo compact={collapsed} />
        </Link>
      </div>
      <NavItems collapsed={collapsed} />
      <div className={cx('border-t border-slate-200 p-2', collapsed && 'flex justify-center')}>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cx('flex h-8 items-center gap-2.5 rounded-md text-[13px] text-slate-500 hover:bg-slate-100 hover:text-slate-800', collapsed ? 'w-8 justify-center' : 'w-full px-2.5')}
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
          {!collapsed && 'Compact view'}
        </button>
      </div>
    </aside>
  );
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-900/25" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
            <Logo />
            <Dialog.Close asChild>
              <IconButton label="Close navigation">
                <X className="size-4" />
              </IconButton>
            </Dialog.Close>
          </div>
          <NavItems collapsed={false} onNavigate={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const current = NAV.find((n) => n.to !== '/' && pathname.startsWith(n.to));
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-[13px] sm:flex">
      {current ? (
        <>
          <Link to="/" className="text-slate-500 hover:text-slate-800">
            Dashboard
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-slate-300" aria-hidden />
          <span aria-current="page" className="truncate font-medium text-slate-900">
            {current.label}
          </span>
        </>
      ) : (
        <>
          <span aria-current="page" className="font-medium text-slate-900">
            Dashboard
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-slate-300" aria-hidden />
          <Link to="/subscriptions" className="text-slate-500 hover:text-slate-800">
            Subscriptions
          </Link>
        </>
      )}
    </nav>
  );
}

// Global search

const isMac = /mac|iphone|ipad/i.test(navigator.platform ?? '');

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const q = useDebounced(text.trim(), 150);
  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<SearchResults>(`/search${queryString({ q })}`),
    enabled: open && q.length > 0,
    placeholderData: (previous) => previous,
  });
  const results = useMemo(() => {
    if (!data || !q) return [];
    return [
      ...data.subscriptions.map((s) => ({ key: `s${s.id}`, group: 'Subscriptions', to: `/subscriptions?sub=${s.id}`, title: s.number, detail: s.customerName, badge: <SubscriptionStatusBadge status={s.status} />, mono: true })),
      ...data.customers.map((c) => ({ key: `c${c.id}`, group: 'Customers', to: `/customers?cust=${c.id}`, title: c.name, detail: c.company || c.email, badge: null, mono: false })),
      ...data.invoices.map((i) => ({ key: `i${i.id}`, group: 'Invoices', to: `/invoices?inv=${i.id}`, title: i.number, detail: `${i.customerName} · ${money(i.total)}`, badge: <InvoiceStatusBadge row={{ status: i.status, overdue: false }} />, mono: true })),
    ];
  }, [data, q]);

  useEffect(() => setCursor(0), [results]);
  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-50 bg-slate-900/25" />
        <Dialog.Content aria-describedby={undefined} className="animate-pop-in fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-slate-200 px-3">
            <Search className="size-4 shrink-0 text-slate-400" aria-hidden />
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === 'Enter' && results[cursor]) {
                  go(results[cursor].to);
                }
              }}
              placeholder="Search subscriptions, customers, invoices..."
              aria-label="Search subscriptions, customers, invoices"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-96 overflow-y-auto p-1">
            {!q && <p className="px-3 py-6 text-center text-xs text-slate-500">Type a subscription number, customer, company or invoice number.</p>}
            {q && results.length === 0 && !isFetching && <p className="px-3 py-6 text-center text-xs text-slate-500">Nothing matches “{q}”.</p>}
            {results.map((r, i) => (
              <div key={r.key}>
                {(i === 0 || results[i - 1].group !== r.group) && <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">{r.group}</p>}
                <button
                  type="button"
                  onClick={() => go(r.to)}
                  onMouseEnter={() => setCursor(i)}
                  className={cx('flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left', cursor === i && 'bg-slate-100')}
                >
                  <span className="min-w-0 truncate">
                    <span className={cx('text-[13px] font-medium text-slate-900', r.mono && 'num')}>{r.title}</span>
                    <span className="ml-2 text-xs text-slate-500">{r.detail}</span>
                  </span>
                  {r.badge}
                </button>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Top bar popovers

function PopoverPanel({ trigger, title, children, width = 'w-80' }: { trigger: ReactNode; title: string; children: ReactNode; width?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className={cx('animate-pop-in z-30 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white shadow-sm', width)}>
          <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800">{title}</p>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const DOT_TONE: Record<NotificationItem['tone'], 'rose' | 'amber' | 'sky'> = { rose: 'rose', amber: 'amber', sky: 'sky' };

function Notifications() {
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<NotificationItem[]>('/notifications'), refetchInterval: 60_000 });
  const total = data?.reduce((sum, n) => sum + n.count, 0) ?? 0;
  return (
    <PopoverPanel
      title="Needs attention"
      trigger={
        <button type="button" aria-label={total ? `Notifications, ${total} need attention` : 'Notifications'} title="Notifications" className="relative inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <Bell className="size-4" aria-hidden />
          {total > 0 && <span className="num absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-600 px-0.5 text-[9px] font-semibold text-white">{total > 99 ? '99+' : total}</span>}
        </button>
      }
    >
      {data?.length ? (
        <ul className="p-1">
          {data.map((n) => (
            <li key={n.key}>
              <Popover.Close asChild>
                <Link to={n.to} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-slate-800">{n.title}</span>
                    <span className="block text-xs text-slate-500">{n.detail}</span>
                  </span>
                  <Badge tone={DOT_TONE[n.tone]} className="num">
                    {n.count}
                  </Badge>
                </Link>
              </Popover.Close>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-6 text-center text-xs text-slate-500">Nothing needs attention right now.</p>
      )}
    </PopoverPanel>
  );
}

function ActivityLog() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['activity'], queryFn: () => api.get<ActivityEntry[]>('/activity'), enabled: open });
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton label="Activity log">
          <Activity className="size-4" aria-hidden />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="animate-pop-in z-30 w-96 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white shadow-sm">
          <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800">Activity log</p>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {isLoading && (
              <li className="p-3">
                <Skeleton className="h-4" />
              </li>
            )}
            {data?.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-500">No activity yet.</li>}
            {data?.map((a) => (
              <li key={a.id} className="px-3 py-2">
                <p className="text-[13px] text-slate-800">{a.summary}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {a.actor} · {timeAgo(a.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Support() {
  return (
    <PopoverPanel
      title="Support"
      width="w-72"
      trigger={
        <IconButton label="Support">
          <HelpCircle className="size-4" aria-hidden />
        </IconButton>
      }
    >
      <div className="space-y-2 p-3 text-xs text-slate-600">
        <p>
          Billing runs every day on its own. Use <span className="font-medium text-slate-800">Run billing</span> on Invoices &amp; Billing to run it sooner. Repeating a run never bills twice.
        </p>
        <p>
          Press <kbd className="num rounded border border-slate-200 px-1">{isMac ? '⌘K' : 'Ctrl K'}</kbd> to search from anywhere.
        </p>
        <a className="font-medium text-accent hover:underline" href="mailto:support@brightloop.dev">
          support@brightloop.dev
        </a>
      </div>
    </PopoverPanel>
  );
}

export function useSignOut() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await api.post('/auth/logout');
    client.clear();
    client.setQueryData(['me'], null);
    navigate('/login');
  };
}

function ProfileMenu() {
  const me = useUser();
  const client = useQueryClient();
  const toast = useToast();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const initials = me.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const switchRole = async (role: Exclude<Role, 'customer'>) => {
    if (role === me.role) return;
    try {
      const updated = await api.post<SessionUser>('/auth/view-as', { role });
      client.setQueryData(['me'], updated);
      refreshAll();
      if (role === 'staff' && (window.location.pathname.startsWith('/settings'))) navigate('/settings');
      toast(role === 'staff' ? 'Now viewing as Staff. Admin actions are off until you switch back.' : 'Back to Admin.');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" aria-label="Your profile" className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-white hover:bg-slate-700">
          {initials}
        </button>
      </Menu.Trigger>
      <Menu.Content>
        <div className="w-56 px-2 py-1.5">
          <p className="truncate text-[13px] font-medium text-slate-900">{me.name}</p>
          <p className="truncate text-xs text-slate-500">{me.email}</p>
        </div>
        <div className="px-2 pb-1.5">
          <p className="mb-1 text-[11px] font-medium text-slate-500">Role</p>
          {me.actualRole === 'admin' ? (
            <div role="radiogroup" aria-label="View as role" className="grid grid-cols-2 gap-0.5 rounded-md bg-slate-100 p-0.5">
              {(['admin', 'staff'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  role="radio"
                  aria-checked={me.role === role}
                  onClick={() => switchRole(role)}
                  className={cx('h-6 rounded text-xs font-medium capitalize', me.role === role ? 'bg-white text-slate-900' : 'text-slate-500 hover:text-slate-800')}
                >
                  {role}
                </button>
              ))}
            </div>
          ) : (
            <Badge>Staff</Badge>
          )}
        </div>
        <Menu.Separator />
        <Menu.Item icon={<UserRound className="size-3.5" />} onSelect={() => navigate('/settings')}>
          Profile &amp; settings
        </Menu.Item>
        <Menu.Item icon={<LogOut className="size-3.5" />} onSelect={signOut}>
          Sign out
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function TopBar({ onOpenSearch, onOpenNav }: { onOpenSearch: () => void; onOpenNav: () => void }) {
  return (
    <header className="no-print sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-3 lg:px-4">
      <IconButton label="Open navigation" className="lg:hidden" onClick={onOpenNav}>
        <MenuIcon className="size-4" aria-hidden />
      </IconButton>
      <Breadcrumbs />
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
        <button
          type="button"
          onClick={onOpenSearch}
          className="mr-1 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-left text-[13px] text-slate-400 hover:border-slate-300 sm:max-w-80"
        >
          <Search className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Search subscriptions, customers, invoices...</span>
          <kbd className="num ml-auto hidden shrink-0 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-500 sm:block">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <Notifications />
        <ActivityLog />
        <Support />
        <div className="ml-1">
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

export function PageFallback() {
  return (
    <div className="space-y-3 p-1">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => loadPref('bl.sidebar') === 'compact');
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const me = useUser();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => {
          setCollapsed((c) => !c);
          savePref('bl.sidebar', collapsed ? 'full' : 'compact');
        }}
      />
      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenSearch={() => setSearchOpen(true)} onOpenNav={() => setNavOpen(true)} />
        {me.role !== me.actualRole && (
          <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-1 text-xs text-amber-800">Viewing as Staff. Admin actions are off until you switch back in your profile menu.</div>
        )}
        <main className="mx-auto w-full max-w-[1500px] flex-1 p-3 lg:p-5">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SubscriptionDrawer />
      <InvoiceDrawer />
      <CustomerDrawer />
    </div>
  );
}
