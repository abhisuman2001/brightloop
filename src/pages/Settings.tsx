import { useMutation, useQuery } from '@tanstack/react-query';
import { Link2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PASSWORD_RULES } from '../../shared/schemas';
import type { EmailLogEntry, TeamMember } from '../../shared/types';
import { Badge, Button, Card, EmptyState, ErrorState, Field, FormError, Input, Modal, PageHeader, TD, TH, TableSkeleton, Tabs, cx, fieldErrors, isShownOnField, useToast } from '../components/ui';
import { api, refreshAll } from '../lib/api';
import { date, timeAgo } from '../lib/format';
import { useUrlFilters, useUser } from '../lib/hooks';

export function PasswordCard() {
  const toast = useToast();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrent('');
      setNew('');
      toast('Password changed. Other devices have been signed out.');
    },
  });
  const errors = fieldErrors(change.error);
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-[13px] font-semibold text-slate-900">Change password</h2>
      <form
        className="max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Field label="Current password" error={errors.currentPassword}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
        <Field label="New password" error={errors.newPassword} hint={PASSWORD_RULES}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} required />}</Field>
        {Boolean(change.error) && !isShownOnField(change.error, errors) && <FormError error={change.error} />}
        <Button variant="primary" type="submit" loading={change.isPending}>
          Update password
        </Button>
      </form>
    </Card>
  );
}

function Profile() {
  const me = useUser();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 text-[13px] font-semibold text-slate-900">Your account</h2>
        <dl className="space-y-2 text-[13px]">
          <div>
            <dt className="text-xs text-slate-500">Name</dt>
            <dd>{me.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email</dt>
            <dd>{me.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Role</dt>
            <dd className="capitalize">{me.actualRole}</dd>
          </div>
        </dl>
      </Card>
      <PasswordCard />
    </div>
  );
}

function AddStaff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const add = useMutation({
    mutationFn: () => api.post<{ emailStatus: string }>('/team', { name, email }),
    onSuccess: ({ emailStatus }) => {
      refreshAll();
      toast(emailStatus === 'sent' ? `Invite sent to ${email}` : emailStatus === 'failed' ? `Added, but the invite email failed. Find the link in the email log.` : 'Added. Find the invite link in the email log until SMTP is set up.', emailStatus === 'failed' ? 'error' : 'success');
      onClose();
    },
  });
  useEffect(() => {
    if (!open) return;
    add.reset();
    setName('');
    setEmail('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const errors = fieldErrors(add.error);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add staff member"
      description="They receive a link to set their own password."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="staff-form" loading={add.isPending}>
            Send invite
          </Button>
        </>
      }
    >
      <form
        id="staff-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Name" error={errors.name}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Email" error={errors.email}>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        {Boolean(add.error) && !isShownOnField(add.error, errors) && <FormError error={add.error} />}
      </form>
    </Modal>
  );
}

function Team() {
  const me = useUser();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['team'], queryFn: () => api.get<TeamMember[]>('/team') });
  const toggle = useMutation({
    mutationFn: (m: TeamMember) => api.patch(`/team/${m.id}`, { active: !m.active }),
    onSuccess: () => refreshAll(),
    onError: (err: Error) => toast(err.message, 'error'),
  });
  return (
    <Card>
      <div className="flex items-center justify-between p-2.5">
        <p className="text-xs text-slate-500">Only an admin can add staff. Staff handle day-to-day work and cannot change plans, taxes or discounts.</p>
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
          Add staff
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-t border-slate-200 text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Name</th>
              <th className={TH}>Email</th>
              <th className={TH}>Role</th>
              <th className={TH}>Added</th>
              <th className={TH}>State</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton columns={6} rows={3} />}
            {data?.map((m) => (
              <tr key={m.id}>
                <td className={cx(TD, 'font-medium text-slate-900')}>{m.name}</td>
                <td className={cx(TD, 'text-slate-600')}>{m.email}</td>
                <td className={cx(TD, 'capitalize')}>{m.role}</td>
                <td className={cx(TD, 'num text-slate-600')}>{date(m.createdAt)}</td>
                <td className={TD}>{!m.active ? <Badge tone="rose">Deactivated</Badge> : m.invitePending ? <Badge tone="sky">Invited</Badge> : <Badge tone="emerald">Active</Badge>}</td>
                <td className={cx(TD, 'text-right')}>
                  {m.id !== me.id && (
                    <button type="button" onClick={() => toggle.mutate(m)} className="text-xs text-slate-500 hover:text-slate-900 hover:underline">
                      {m.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
      </div>
      <AddStaff open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

function EmailLog() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['emails'], queryFn: () => api.get<{ rows: EmailLogEntry[]; deliveryConfigured: boolean }>('/emails') });
  return (
    <Card>
      {data && !data.deliveryConfigured && (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Email delivery is not set up, so nothing below has reached anyone. Set SMTP_URL to deliver. Until then, links can be opened from here.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead>
            <tr>
              <th className={TH}>To</th>
              <th className={TH}>Subject</th>
              <th className={TH}>Status</th>
              <th className={TH}>When</th>
              <th className={TH}>Link</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton columns={5} rows={3} />}
            {data?.rows.map((m) => (
              <tr key={m.id}>
                <td className={cx(TD, 'max-w-64 truncate text-slate-700')}>{m.recipient}</td>
                <td className={cx(TD, 'max-w-80 truncate')}>{m.subject}</td>
                <td className={TD} title={m.error ?? undefined}>
                  <Badge tone={m.status === 'sent' ? 'emerald' : m.status === 'failed' ? 'rose' : 'amber'}>{m.status === 'logged' ? 'Not delivered' : m.status === 'sent' ? 'Sent' : 'Failed'}</Badge>
                </td>
                <td className={cx(TD, 'text-xs whitespace-nowrap text-slate-500')}>{timeAgo(m.createdAt)}</td>
                <td className={TD}>
                  {m.link && (
                    <a href={m.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      <Link2 className="size-3" aria-hidden />
                      Open
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data?.rows.length === 0 && <EmptyState title="No emails yet" />}
      </div>
    </Card>
  );
}

type Tab = 'profile' | 'team' | 'emails';

export default function Settings() {
  const me = useUser();
  const { get, set } = useUrlFilters<'tab'>();
  const isAdmin = me.role === 'admin';
  const requested = (get('tab') || 'profile') as Tab;
  const tab = isAdmin ? requested : 'profile';
  return (
    <>
      <PageHeader title="Settings" />
      {isAdmin && (
        <div className="mb-4">
          <Tabs<Tab>
            label="Settings"
            value={tab}
            onChange={(value) => set({ tab: value })}
            tabs={[
              { value: 'profile', label: 'Profile' },
              { value: 'team', label: 'Team' },
              { value: 'emails', label: 'Email log' },
            ]}
          />
        </div>
      )}
      {tab === 'profile' && <Profile />}
      {tab === 'team' && <Team />}
      {tab === 'emails' && <EmailLog />}
    </>
  );
}
