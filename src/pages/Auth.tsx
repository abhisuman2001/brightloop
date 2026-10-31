import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, MailCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { passwordProblems } from '../../shared/schemas';
import type { SessionUser } from '../../shared/types';
import { Logo } from '../components/Layout';
import { Button, Card, Field, FormError, Input, cx, fieldErrors, isShownOnField } from '../components/ui';
import { api } from '../lib/api';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex justify-center">
          <Link to="/" aria-label="Brightloop home">
            <Logo />
          </Link>
        </div>
        <Card className="p-5">
          <h1 className="text-base font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 mb-1 text-[13px] text-slate-500">{subtitle}</p>}
          <div className="mt-4">{children}</div>
        </Card>
        {footer && <p className="mt-4 text-center text-[13px] text-slate-500">{footer}</p>}
      </div>
    </main>
  );
}

const RULES: Array<{ label: string; problem: string }> = [
  { label: 'More than 8 characters', problem: 'more than 8 characters' },
  { label: 'An uppercase letter', problem: 'an uppercase letter' },
  { label: 'A lowercase letter', problem: 'a lowercase letter' },
  { label: 'A special character', problem: 'a special character' },
];

function PasswordChecklist({ password }: { password: string }) {
  const problems = passwordProblems(password);
  return (
    <ul className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
      {RULES.map((rule) => {
        const met = !problems.includes(rule.problem);
        return (
          <li key={rule.label} className={cx('flex items-center gap-1', met ? 'text-emerald-700' : 'text-slate-500')}>
            {met ? <Check className="size-3" aria-hidden /> : <Circle className="size-2.5" aria-hidden />}
            <span>{rule.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function useSessionStart() {
  const client = useQueryClient();
  return (user: SessionUser) => {
    // Nothing from a previous session may show to whoever signs in next. GuestOnly then moves them on.
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    client.setQueryData(['me'], user);
  };
}

export function Login() {
  const start = useSessionStart();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: () => api.post<SessionUser>('/auth/login', { email, password }), onSuccess: start });
  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          New to Brightloop?{' '}
          <Link to="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <div className="text-right">
          <Link to="/forgot-password" className="text-xs text-slate-500 hover:text-slate-800 hover:underline">
            Forgot password?
          </Link>
        </div>
        <FormError error={login.error} />
        <Button variant="primary" type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function Signup() {
  const start = useSessionStart();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signup = useMutation({ mutationFn: () => api.post<SessionUser>('/auth/signup', { name, company, email, password }), onSuccess: start });
  const errors = fieldErrors(signup.error);
  return (
    <AuthShell
      title="Create your account"
      subtitle="See and manage your subscriptions and invoices."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate();
        }}
      >
        <Field label="Your name" error={errors.name}>{(id) => <Input id={id} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />}</Field>
        <Field label="Company (optional)">{(id) => <Input id={id} autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />}</Field>
        <Field label="Email" error={errors.email}>{(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password" error={errors.password}>
          {(id) => (
            <>
              <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <PasswordChecklist password={password} />
            </>
          )}
        </Field>
        {Boolean(signup.error) && !isShownOnField(signup.error, errors) && <FormError error={signup.error} />}
        <Button variant="primary" type="submit" className="w-full" loading={signup.isPending} disabled={passwordProblems(password).length > 0}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const forgot = useMutation({ mutationFn: () => api.post('/auth/forgot-password', { email }) });
  if (forgot.isSuccess) {
    return (
      <AuthShell
        title="Check your email"
        footer={
          <Link to="/login" className="font-medium text-accent hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="flex items-start gap-2.5 text-[13px] text-slate-600">
          <MailCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <p>If an account exists for {email}, a reset link is on its way. It works once and expires in one hour.</p>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email a reset link to your registered address."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          forgot.mutate();
        }}
      >
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}</Field>
        <FormError error={forgot.error} />
        <Button variant="primary" type="submit" className="w-full" loading={forgot.isPending}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const isInvite = params.get('invite') === '1';
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api.post('/auth/reset-password', { token, password }),
    onSuccess: () => {
      // The reset ended every session for this account, whoever's browser this is.
      client.setQueryData(['me'], null);
      navigate('/login', { replace: true });
    },
  });
  const errors = fieldErrors(reset.error);
  if (!token) {
    return (
      <AuthShell title="This link is not valid" footer={<Link to="/forgot-password" className="font-medium text-accent hover:underline">Request a new link</Link>}>
        <p className="text-[13px] text-slate-600">The reset link is incomplete. Request a new one.</p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={isInvite ? 'Set your password' : 'Choose a new password'} subtitle="You will sign in with it next.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate();
        }}
      >
        <Field label="New password" error={errors.password}>
          {(id) => (
            <>
              <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              <PasswordChecklist password={password} />
            </>
          )}
        </Field>
        {Boolean(reset.error) && !isShownOnField(reset.error, errors) && <FormError error={reset.error} />}
        <Button variant="primary" type="submit" className="w-full" loading={reset.isPending} disabled={passwordProblems(password).length > 0}>
          Save password
        </Button>
      </form>
    </AuthShell>
  );
}
