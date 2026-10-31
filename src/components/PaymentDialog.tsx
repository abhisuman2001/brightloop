import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PAYMENT_METHODS } from '../../shared/schemas';
import type { InvoiceDetail, InvoiceList, InvoiceRow, PaymentMethod } from '../../shared/types';
import { api, queryString, refreshAll } from '../lib/api';
import { METHOD_LABEL, date, dollars, money, toCents, todayLocal } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, Field, FormError, Input, Modal, SearchInput, Select, Textarea, cx, fieldErrors, useToast } from './ui';

/** Records a payment. Opens either on a known invoice or with a picker of outstanding invoices. */
export function PaymentDialog({ open, onClose, invoice }: { open: boolean; onClose: () => void; invoice?: Pick<InvoiceRow, 'id' | 'number' | 'balance' | 'customerName'> | null }) {
  const toast = useToast();
  const [picked, setPicked] = useState<InvoiceRow | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const target = invoice ?? picked;
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setSearch('');
    setMethod('bank_transfer');
    setPaymentDate(todayLocal());
    setNote('');
    setAmountError('');
    setAmount(invoice ? dollars(invoice.balance) : '');
  }, [open, invoice]);

  const outstanding = useQuery({
    queryKey: ['invoices', 'outstanding', q],
    queryFn: () => api.get<InvoiceList>(`/invoices${queryString({ status: 'outstanding', q, pageSize: 6 })}`),
    enabled: open && !invoice && !picked,
  });

  const save = useMutation({
    mutationFn: (body: object) => api.post<InvoiceDetail>('/payments', body),
    onSuccess: (updated) => {
      refreshAll();
      toast(updated.status === 'paid' ? `${updated.number} is paid in full` : `Payment recorded. ${money(updated.balance)} still owed on ${updated.number}`);
      onClose();
    },
  });
  useEffect(() => {
    if (open) save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    const cents = toCents(amount);
    if (!cents) return setAmountError('Enter an amount greater than zero');
    setAmountError('');
    save.mutate({ invoiceId: target.id, method, amount: cents, paymentDate, note });
  };
  const errors = fieldErrors(save.error);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register payment"
      description={target ? `${target.number} · ${target.customerName} · ${money(target.balance)} outstanding` : 'Choose the invoice this payment is for'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="payment-form" disabled={!target} loading={save.isPending}>
            Record payment
          </Button>
        </>
      }
    >
      {!target && (
        <div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search invoice or customer" />
          <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
            {outstanding.data?.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(row);
                    setAmount(dollars(row.balance));
                  }}
                  className="flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="num block text-[13px] text-slate-900">{row.number}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {row.customerName} · due {date(row.dueDate)}
                    </span>
                  </span>
                  <span className={cx('num shrink-0 text-[13px]', row.overdue ? 'text-rose-700' : 'text-slate-900')}>{money(row.balance)}</span>
                </button>
              </li>
            ))}
            {outstanding.data?.rows.length === 0 && <li className="px-2.5 py-4 text-center text-xs text-slate-500">No outstanding invoices match.</li>}
          </ul>
        </div>
      )}
      {target && (
        <form id="payment-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="Amount (USD)" error={amountError || errors.amount}>
            {(id) => <Input id={id} inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}
          </Field>
          <Field label="Payment date" error={errors.paymentDate}>
            {(id) => <Input id={id} type="date" max={todayLocal()} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />}
          </Field>
          <Field label="Method" className="col-span-2">
            {(id) => (
              <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Note" className="col-span-2">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Bank reference, cheque number..." />}
          </Field>
          {Boolean(save.error) && !errors.amount && !errors.paymentDate && (
            <div className="col-span-2">
              <FormError error={save.error} />
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
