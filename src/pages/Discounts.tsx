import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Percent, Plus, Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PRODUCT_TYPES } from '../../shared/schemas';
import type { Discount, Product, ProductType, TaxRule, TaxSupply } from '../../shared/types';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, PageHeader, Select, TD, TH, TableSkeleton, Tabs, cx, fieldErrors, isShownOnField, useToast } from '../components/ui';
import { api, refreshAll } from '../lib/api';
import { TYPE_LABEL, date, rupees, money, number, percent, toPaise, todayLocal } from '../lib/format';
import { useUrlFilters, useUser } from '../lib/hooks';

function discountState(d: Discount): { label: string; tone: 'emerald' | 'slate' | 'rose' | 'sky' } {
  const today = todayLocal();
  if (!d.active) return { label: 'Off', tone: 'slate' };
  if (d.endDate && d.endDate < today) return { label: 'Expired', tone: 'rose' };
  if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return { label: 'Used up', tone: 'rose' };
  if (d.startDate && d.startDate > today) return { label: 'Scheduled', tone: 'sky' };
  return { label: 'Live', tone: 'emerald' };
}

function DiscountForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Discount | null }) {
  const toast = useToast();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products'), enabled: open });
  const blank = { name: '', kind: 'percent' as Discount['kind'], value: '', minPurchase: '', minQuantity: '', startDate: '', endDate: '', usageLimit: '', scope: 'subscription' as Discount['scope'], productIds: [] as number[], active: true };
  const [form, setForm] = useState(blank);
  const [localError, setLocalError] = useState('');
  const update = (patch: Partial<typeof blank>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.patch(`/discounts/${editing.id}`, body) : api.post('/discounts', body)),
    onSuccess: () => {
      refreshAll();
      toast(editing ? 'Discount updated' : 'Discount created. It applies to the next invoice that qualifies.');
      onClose();
    },
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setLocalError('');
    setForm(
      editing
        ? {
            name: editing.name,
            kind: editing.kind,
            value: editing.kind === 'percent' ? String(editing.value / 100) : rupees(editing.value),
            minPurchase: editing.minPurchase ? rupees(editing.minPurchase) : '',
            minQuantity: editing.minQuantity ? String(editing.minQuantity) : '',
            startDate: editing.startDate ?? '',
            endDate: editing.endDate ?? '',
            usageLimit: editing.usageLimit === null ? '' : String(editing.usageLimit),
            scope: editing.scope,
            productIds: editing.productIds,
            active: editing.active,
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = form.kind === 'percent' ? Math.round(Number(form.value) * 100) : toPaise(form.value);
    const minPurchase = form.minPurchase ? toPaise(form.minPurchase) : 0;
    if (!value || Number.isNaN(value)) return setLocalError(form.kind === 'percent' ? 'Enter a percentage, like 10' : 'Enter an amount, like 25.00');
    if (minPurchase === null) return setLocalError('Enter the minimum purchase as an amount, like 100.00');
    setLocalError('');
    save.mutate({
      ...form,
      value,
      minPurchase,
      minQuantity: Number(form.minQuantity) || 0,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
    });
  };
  const errors = fieldErrors(save.error);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'New discount rule'}
      description="Applies on its own to the next qualifying invoice, and stops when it expires or runs out."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="discount-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form id="discount-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="Name" error={errors.name} className="col-span-2">{(id) => <Input id={id} value={form.name} onChange={(e) => update({ name: e.target.value })} autoFocus />}</Field>
        <Field label="Type">
          {(id) => (
            <Select id={id} value={form.kind} onChange={(e) => update({ kind: e.target.value as Discount['kind'] })}>
              <option value="percent">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </Select>
          )}
        </Field>
        <Field label={form.kind === 'percent' ? 'Percentage (%)' : 'Amount (INR)'} error={errors.value}>{(id) => <Input id={id} inputMode="decimal" className="num" value={form.value} onChange={(e) => update({ value: e.target.value })} />}</Field>
        <Field label="Minimum purchase (INR)" error={errors.minPurchase}>{(id) => <Input id={id} inputMode="decimal" className="num" placeholder="None" value={form.minPurchase} onChange={(e) => update({ minPurchase: e.target.value })} />}</Field>
        <Field label="Minimum quantity" error={errors.minQuantity}>{(id) => <Input id={id} type="number" min={0} className="num" placeholder="None" value={form.minQuantity} onChange={(e) => update({ minQuantity: e.target.value })} />}</Field>
        <Field label="Starts" error={errors.startDate}>{(id) => <Input id={id} type="date" value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />}</Field>
        <Field label="Ends" error={errors.endDate}>{(id) => <Input id={id} type="date" value={form.endDate} onChange={(e) => update({ endDate: e.target.value })} />}</Field>
        <Field label="Usage limit" error={errors.usageLimit} hint="Each invoice using it counts once" className="col-span-2">{(id) => <Input id={id} type="number" min={1} className="num" placeholder="Unlimited" value={form.usageLimit} onChange={(e) => update({ usageLimit: e.target.value })} />}</Field>
        <Field label="Applies to" className="col-span-2">
          {(id) => (
            <Select id={id} value={form.scope} onChange={(e) => update({ scope: e.target.value as Discount['scope'] })}>
              <option value="subscription">Whole subscriptions</option>
              <option value="product">Specific products</option>
            </Select>
          )}
        </Field>
        {form.scope === 'product' && (
          <fieldset className="col-span-2 rounded-md border border-slate-200 p-2.5">
            <legend className="px-1 text-xs font-medium text-slate-600">Products</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {products.data?.map((p) => (
                <Checkbox key={p.id} label={p.name} checked={form.productIds.includes(p.id)} onChange={(on) => update({ productIds: on ? [...form.productIds, p.id] : form.productIds.filter((x) => x !== p.id) })} />
              ))}
            </div>
            {errors.productIds && <p className="mt-1 text-xs text-rose-700">{errors.productIds}</p>}
          </fieldset>
        )}
        <div className="col-span-2">
          <Checkbox label="Rule is on" checked={form.active} onChange={(active) => update({ active })} />
        </div>
        {(localError || (save.error && !isShownOnField(save.error, errors))) && (
          <div className="col-span-2">
            <FormError error={localError ? new Error(localError) : save.error} />
          </div>
        )}
      </form>
    </Modal>
  );
}

function DiscountsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['discounts'], queryFn: () => api.get<Discount[]>('/discounts') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products') });
  const [editing, setEditing] = useState<Discount | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      {isAdmin && (
        <div className="flex justify-end p-2.5">
          <Button
            variant="primary"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            New rule
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-t border-slate-200 text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Rule</th>
              <th className={cx(TH, 'text-right')}>Value</th>
              <th className={TH}>Conditions</th>
              <th className={TH}>Applies to</th>
              <th className={TH}>Dates</th>
              <th className={cx(TH, 'text-right')}>Used</th>
              <th className={TH}>State</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton columns={8} rows={4} />}
            {data?.map((d) => {
              const state = discountState(d);
              const conditions = [d.minQuantity > 0 && `${number(d.minQuantity)}+ qty`, d.minPurchase > 0 && `${money(d.minPurchase)}+ purchase`].filter(Boolean).join(', ');
              return (
                <tr key={d.id}>
                  <td className={cx(TD, 'font-medium text-slate-900')}>{d.name}</td>
                  <td className={cx(TD, 'num text-right text-slate-900')}>{d.kind === 'percent' ? percent(d.value) : money(d.value)}</td>
                  <td className={cx(TD, 'text-slate-600')}>{conditions || 'None'}</td>
                  <td className={cx(TD, 'max-w-52 truncate text-slate-600')}>{d.scope === 'subscription' ? 'Whole subscription' : d.productIds.map((id) => products.data?.find((p) => p.id === id)?.name).filter(Boolean).join(', ')}</td>
                  <td className={cx(TD, 'num text-xs whitespace-nowrap text-slate-600')}>{d.startDate || d.endDate ? `${date(d.startDate)} – ${date(d.endDate)}` : 'Always'}</td>
                  <td className={cx(TD, 'num text-right')}>
                    {number(d.usedCount)}
                    {d.usageLimit !== null && <span className="text-slate-400"> / {number(d.usageLimit)}</span>}
                  </td>
                  <td className={TD}>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </td>
                  <td className={cx(TD, 'w-10')}>
                    {isAdmin && (
                      <IconButton
                        label={`Edit ${d.name}`}
                        className="size-7"
                        onClick={() => {
                          setEditing(d);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </IconButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data?.length === 0 && <EmptyState icon={<Percent className="size-5" />} title="No discount rules yet" />}
      </div>
      <DiscountForm open={open} onClose={() => setOpen(false)} editing={editing} />
    </>
  );
}

function TaxForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: TaxRule | null }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [productType, setProductType] = useState<ProductType | ''>('');
  const [supply, setSupply] = useState<TaxSupply>('any');
  const [active, setActive] = useState(true);
  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.patch(`/taxes/${editing.id}`, body) : api.post('/taxes', body)),
    onSuccess: () => {
      refreshAll();
      toast(editing ? 'Tax rule updated. Future invoices use the new rate.' : 'Tax rule created');
      onClose();
    },
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setName(editing?.name ?? '');
    setRate(editing ? String(editing.rateBps / 100) : '');
    setProductType(editing?.productType ?? '');
    setSupply(editing?.supply ?? 'any');
    setActive(editing?.active ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);
  const errors = fieldErrors(save.error);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'New tax rule'}
      description="Applied automatically to new invoices. Invoices already issued keep the tax they were issued with."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="tax-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form
        id="tax-form"
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name, rateBps: Math.round(Number(rate) * 100), productType: productType || null, supply, active });
        }}
      >
        <Field label="Name" error={errors.name} className="col-span-2">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Rate (%)" error={errors.rateBps}>{(id) => <Input id={id} inputMode="decimal" className="num" required value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
        <Field label="Applies to">
          {(id) => (
            <Select id={id} value={productType} onChange={(e) => setProductType(e.target.value as ProductType | '')}>
              <option value="">All products</option>
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="GST supply" className="col-span-2" hint="CGST and SGST apply inside your state, IGST to a customer whose GSTIN is from another state.">
          {(id) => (
            <Select id={id} value={supply} onChange={(e) => setSupply(e.target.value as TaxSupply)}>
              {(Object.keys(SUPPLY_LABEL) as TaxSupply[]).map((s) => (
                <option key={s} value={s}>
                  {SUPPLY_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="col-span-2">
          <Checkbox label="Rule is on" checked={active} onChange={setActive} />
        </div>
        {Boolean(save.error) && !isShownOnField(save.error, errors) && (
          <div className="col-span-2">
            <FormError error={save.error} />
          </div>
        )}
      </form>
    </Modal>
  );
}

const SUPPLY_LABEL: Record<TaxSupply, string> = { any: 'Every sale', intra: 'Same state (CGST, SGST)', inter: 'Other state (IGST)' };

function TaxesTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['taxes'], queryFn: () => api.get<TaxRule[]>('/taxes') });
  const [editing, setEditing] = useState<TaxRule | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      {isAdmin && (
        <div className="flex justify-end p-2.5">
          <Button
            variant="primary"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            New tax rule
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-t border-slate-200 text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Rule</th>
              <th className={cx(TH, 'text-right')}>Rate</th>
              <th className={TH}>Applies to</th>
              <th className={TH}>GST supply</th>
              <th className={TH}>State</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton columns={6} rows={3} />}
            {data?.map((t) => (
              <tr key={t.id}>
                <td className={cx(TD, 'font-medium text-slate-900')}>{t.name}</td>
                <td className={cx(TD, 'num text-right text-slate-900')}>{percent(t.rateBps)}</td>
                <td className={cx(TD, 'text-slate-600')}>{t.productType ? TYPE_LABEL[t.productType] : 'All products'}</td>
                <td className={cx(TD, 'text-slate-600')}>{SUPPLY_LABEL[t.supply]}</td>
                <td className={TD}>
                  <Badge tone={t.active ? 'emerald' : 'slate'}>{t.active ? 'On' : 'Off'}</Badge>
                </td>
                <td className={cx(TD, 'w-10')}>
                  {isAdmin && (
                    <IconButton
                      label={`Edit ${t.name}`}
                      className="size-7"
                      onClick={() => {
                        setEditing(t);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </IconButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data?.length === 0 && <EmptyState icon={<Receipt className="size-5" />} title="No tax rules yet" description="Invoices carry no tax until you add a rule." />}
      </div>
      <TaxForm open={open} onClose={() => setOpen(false)} editing={editing} />
    </>
  );
}

type Tab = 'discounts' | 'taxes';

export default function Discounts() {
  const me = useUser();
  const isAdmin = me.role === 'admin';
  const { get, set } = useUrlFilters<'tab'>();
  const tab = (get('tab') || 'discounts') as Tab;
  return (
    <>
      <PageHeader title="Discounts & Rules" description={isAdmin ? 'Discounts and taxes apply to invoices on their own, so nobody has to remember them.' : 'Discounts and taxes apply on their own. Only an admin can change them.'} />
      <Card>
        <div className="px-2.5 pt-1">
          <Tabs<Tab>
            label="Rules"
            value={tab}
            onChange={(value) => set({ tab: value })}
            tabs={[
              { value: 'discounts', label: 'Discount Rules' },
              { value: 'taxes', label: 'Tax Rules' },
            ]}
          />
        </div>
        {tab === 'discounts' ? <DiscountsTab isAdmin={isAdmin} /> : <TaxesTab isAdmin={isAdmin} />}
      </Card>
    </>
  );
}
