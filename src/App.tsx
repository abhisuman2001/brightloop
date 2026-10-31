import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Role } from '../shared/types';
import { AppLayout, PageFallback } from './components/Layout';
import { Button, EmptyState, ErrorState } from './components/ui';
import { useMe } from './lib/hooks';
import { ForgotPassword, Login, ResetPassword, Signup } from './pages/Auth';

const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Subscriptions = lazy(() => import('./pages/Subscriptions'));
const Plans = lazy(() => import('./pages/Plans'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Customers = lazy(() => import('./pages/Customers'));
const Payments = lazy(() => import('./pages/Payments'));
const Discounts = lazy(() => import('./pages/Discounts'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const PrintInvoice = lazy(() => import('./pages/PrintInvoice'));
const portal = () => import('./pages/Portal');
const PortalLayout = lazy(() => portal().then((m) => ({ default: m.PortalLayout })));
const PortalOverviewPage = lazy(() => portal().then((m) => ({ default: m.PortalOverviewPage })));
const PortalSubscriptionPage = lazy(() => portal().then((m) => ({ default: m.PortalSubscriptionPage })));
const PortalInvoicePage = lazy(() => portal().then((m) => ({ default: m.PortalInvoicePage })));
const PortalPlansPage = lazy(() => portal().then((m) => ({ default: m.PortalPlansPage })));
const PortalAccountPage = lazy(() => portal().then((m) => ({ default: m.PortalAccountPage })));

const homeFor = (role: Role) => (role === 'customer' ? '/portal' : '/');

/** Sends anyone to the right place for who they are. The API enforces the same rules on every call. */
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data: me, isLoading, isError, error, refetch } = useMe();
  const location = useLocation();
  if (isLoading) return <PageFallback />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!roles.includes(me.role)) return <Navigate to={homeFor(me.role)} replace />;
  return children;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const from = (useLocation().state as { from?: string } | null)?.from;
  if (isLoading) return <PageFallback />;
  // A link opened while signed out carries on to where it was going. Guard still checks the role.
  if (me) return <Navigate to={from ?? homeFor(me.role)} replace />;
  return children;
}

/** A rendering bug shows a way out instead of a blank page, and clears when the person navigates away. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <EmptyState title="This page ran into a problem" description="Your data is safe. Reload to try again, or go back to the start." action={<Button onClick={() => window.location.assign('/')}>Back to the start</Button>} />;
  }
}

function RouteBoundary({ children }: { children: ReactNode }) {
  return <Boundary key={useLocation().pathname}>{children}</Boundary>;
}

/** The root is the landing page for visitors. Everyone signed in goes on to the app, and any deeper path still asks for a login. */
function Root() {
  const { data: me, isLoading, isError } = useMe();
  const { pathname } = useLocation();
  if (pathname === '/' && !isLoading && !isError && !me) return <Landing />;
  return (
    <Guard roles={TEAM}>
      <AppLayout />
    </Guard>
  );
}

const TEAM: Role[] = ['admin', 'staff'];
const EVERYONE: Role[] = ['admin', 'staff', 'customer'];

export default function App() {
  return (
    <BrowserRouter>
      <RouteBoundary>
        <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
          <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/print/invoices/:id" element={<Guard roles={EVERYONE}><PrintInvoice /></Guard>} />
          <Route path="/portal" element={<Guard roles={['customer']}><PortalLayout /></Guard>}>
            <Route index element={<PortalOverviewPage />} />
            <Route path="subscriptions/:id" element={<PortalSubscriptionPage />} />
            <Route path="invoices/:id" element={<PortalInvoicePage />} />
            <Route path="plans" element={<PortalPlansPage />} />
            <Route path="account" element={<PortalAccountPage />} />
          </Route>
          <Route path="/" element={<Root />}>
            <Route index element={<Dashboard />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="plans" element={<Plans />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="customers" element={<Customers />} />
            <Route path="payments" element={<Payments />} />
            <Route path="discounts" element={<Discounts />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </RouteBoundary>
    </BrowserRouter>
  );
}
