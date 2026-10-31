import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Customer, InvoiceRow, SubscriptionRow } from '../../shared/types';
import { api, refreshAll } from '../lib/api';
import { date, money } from '../lib/format';
import { useDrawer } from '../lib/hooks';
import { InvoiceStatusBadge, SubscriptionBadges } from './badges';
import { Info } from './InvoiceDrawer';
import { SubscriptionForm } from './SubscriptionForm';
import { Badge, Button, Drawer, ErrorState, Field, FormError, IconButton, Input, Modal, Skeleton, Textarea, fieldErrors, isShownOnField, useToast } from './ui';

type CustomerDetail = Customer & { subscriptions: SubscriptionRow[]; invoices: InvoiceRow[]; hasPortalAccess: boolean };

export function CustomerForm({ open, onClose, editing, onCreated }: { open: boolean; onClose: () => void; editing?: Customer | null; onCreated?: (id: number) => void }) {
  const toast = useToast();
  const empty = { name: '', company: '', email: '', phone: '', address: '', taxId: '' };
  const [form, setForm] = useState(empty);
  const save = useMutation({
    mutationFn: () => (editing ? api.patch<Customer>(`/customers/${editing.id}`, form) : api.post<Customer>('/customers', form)),
    onSuccess: (c) => {
      refreshAll();
      toast(editing ? 'Customer updated' : `${c.name} added`);
      onClose();
      if (!editing) onCreated?.(c.id);
    },
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(editing ? { name: editing.name, company: editing.company, email: editing.email, phone: editing.phone, address: editing.address, taxId: editing.taxId } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);
  const errors = fieldErrors(save.error);
  const bind = (key: keyof typeof empty) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Add customer'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="customer-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <form
        id="customer-form"
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" error={errors.name}>{(id) => <Input id={id} {...bind('name')} autoFocus />}</Field>
        <Field label="Company" error={errors.company}>{(id) => <Input id={id} {...bind('company')} />}</Field>
        <Field label="Email" error={errors.email} className="col-span-2">{(id) => <Input id={id} type="email" {...bind('email')} />}</Field>
        <Field label="Phone" error={errors.phone}>{(id) => <Input id={id} {...bind('phone')} />}</Field>
        <Field label="GSTIN" error={errors.taxId}>{(id) => <Input id={id} placeholder="29ABCDE1234F1Z5" {...bind('taxId')} />}</Field>
        <Field label="Billing address" error={errors.address} className="col-span-2">{(id) => <Textarea id={id} {...bind('address')} />}</Field>
        {Boolean(save.error) && !isShownOnField(save.error, errors) && (
          <div className="col-span-2">
            <FormError error={save.error} />
          </div>
        )}
      </form>
    </Modal>
  );
}

export function CustomerDrawer() {
  const { id, close } = useDrawer('cust');
  const toast = useToast();
  const query = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<CustomerDetail>(`/customers/${id}`), enabled: id !== null });
  const customer = query.data;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const invite = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/customers/${id}/invite`),
    onSuccess: ({ status }) => {
      refreshAll();
      if (status === 'failed') toast(`The invite to ${customer?.email} could not be delivered. Its link is in Settings > Email log.`, 'error');
      else toast(status === 'logged' ? 'Invite recorded in the email log. Set SMTP_URL to deliver email.' : `Invite sent to ${customer?.email}`);
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  return (
    <Drawer open={id !== null} onClose={close} label={customer ? `Customer ${customer.name}` : 'Customer'}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-slate-900">{customer?.name ?? '…'}</h2>
            {customer?.hasPortalAccess && <Badge tone="emerald">Portal access</Badge>}
          </div>
          {customer && <p className="mt-0.5 truncate text-xs text-slate-500">{customer.company || customer.email}</p>}
        </div>
        <IconButton label="Close panel" onClick={close}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {query.isLoading && <Skeleton className="h-48" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {customer && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-4">
              <Info label="Email" value={customer.email} className="col-span-2" />
              <Info label="Phone" value={customer.phone} />
              <Info label="GSTIN" value={customer.taxId} mono />
              <Info label="Address" value={customer.address} className="col-span-2" />
              <Info label="Monthly revenue" value={money(customer.monthlyAmount)} mono />
              <Info label="Outstanding" value={money(customer.outstanding)} mono tone={customer.outstanding > 0 ? 'text-amber-700' : undefined} />
            </dl>
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-slate-800">Subscriptions</h3>
              {customer.subscriptions.length === 0 ? (
                <p className="text-xs text-slate-500">No subscriptions yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {customer.subscriptions.map((s) => (
                    <li key={s.id}>
                      <Link to={`/subscriptions?sub=${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-slate-50">
                        <span className="min-w-0 text-[13px]">
                          <span className="num text-slate-900">{s.number}</span>
                          <span className="ml-2 text-slate-600">{s.planName}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <SubscriptionBadges row={s} />
                          <span className="num w-24 text-right text-[13px]">{money(s.recurringAmount)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-slate-800">Recent invoices</h3>
              {customer.invoices.length === 0 ? (
                <p className="text-xs text-slate-500">No invoices yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {customer.invoices.slice(0, 10).map((inv) => (
                    <li key={inv.id}>
                      <Link to={`/invoices?inv=${inv.id}`} className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-slate-50">
                        <span className="text-[13px]">
                          <span className="num text-slate-900">{inv.number}</span>
                          <span className="num ml-2 hidden text-xs text-slate-500 sm:inline">due {date(inv.dueDate)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <InvoiceStatusBadge row={inv} />
                          <span className="num w-24 text-right text-[13px]">{money(inv.total)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      {customer && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            Create Subscription
          </Button>
          <Button icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          {!customer.hasPortalAccess && (
            <Button icon={<Send className="size-3.5" />} loading={invite.isPending} onClick={() => invite.mutate()}>
              Invite to portal
            </Button>
          )}
        </div>
      )}
      <CustomerForm open={editing} onClose={() => setEditing(false)} editing={customer} />
      <SubscriptionForm open={creating} onClose={() => setCreating(false)} presetCustomer={customer ? { id: customer.id, label: `${customer.name}${customer.company ? ` · ${customer.company}` : ''}` } : null} />
    </Drawer>
  );
}
