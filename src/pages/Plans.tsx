import { useMutation, useQuery } from '@tanstack/react-query';
import { Boxes, FileStack, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BILLING_PERIODS, PRODUCT_TYPES } from '../../shared/schemas';
import type { BillingPeriod } from '../../shared/dates';
import type { Plan, Product, ProductType, QuotationTemplate } from '../../shared/types';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, FormError, IconButton, Input, Modal, PageHeader, Select, TD, TH, TableSkeleton, Tabs, Textarea, cx, fieldErrors, isShownOnField, useToast } from '../components/ui';
import { api, refreshAll } from '../lib/api';
import { PERIOD_LABEL, PERIOD_UNIT, TYPE_LABEL, date, rupees, money, number, toPaise } from '../lib/format';
import { useUrlFilters, useUser } from '../lib/hooks';

// Products

interface VariantDraft {
  id?: number;
  attribute: string;
  value: string;
  extraPrice: string;
}

function ProductForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Product | null }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<ProductType>('software');
  const [salesPrice, setSalesPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [active, setActive] = useState(true);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.patch(`/products/${editing.id}`, body) : api.post('/products', body)),
    onSuccess: () => {
      refreshAll();
      toast(editing ? 'Product updated' : 'Product created');
      onClose();
    },
  });

  useEffect(() => {
    if (!open) return;
    save.reset();
    setLocalError(null);
    setName(editing?.name ?? '');
    setType(editing?.type ?? 'software');
    setSalesPrice(editing ? rupees(editing.salesPrice) : '');
    setCostPrice(editing ? rupees(editing.costPrice) : '');
    setNotes(editing?.notes ?? '');
    setHsnCode(editing?.hsnCode ?? '');
    setActive(editing?.active ?? true);
    setVariants(editing?.variants.map((v) => ({ id: v.id, attribute: v.attribute, value: v.value, extraPrice: rupees(v.extraPrice) })) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sales = toPaise(salesPrice);
    const cost = toPaise(costPrice);
    if (sales === null || cost === null) return setLocalError('Enter sales and cost prices as amounts, like 49.00');
    const parsed = variants.map((v) => ({ ...v, extraPrice: toPaise(v.extraPrice) }));
    if (parsed.some((v) => v.extraPrice === null)) return setLocalError('Enter each variant’s extra price as an amount, like 560.00');
    setLocalError(null);
    save.mutate({ name, type, salesPrice: sales, costPrice: cost, notes, hsnCode, active, variants: parsed });
  };
  const errors = fieldErrors(save.error);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `Edit ${editing.name}` : 'New product'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="product-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create product'}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Name" error={errors.name} className="sm:col-span-3">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as ProductType)}>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Sales price (INR)" error={errors.salesPrice} className="sm:col-span-2">{(id) => <Input id={id} inputMode="decimal" className="num" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} />}</Field>
          <Field label="Cost price (INR)" error={errors.costPrice} className="sm:col-span-2">{(id) => <Input id={id} inputMode="decimal" className="num" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />}</Field>
          <Field label="HSN / SAC code" error={errors.hsnCode} hint="Printed on the GST invoice" className="sm:col-span-2">{(id) => <Input id={id} className="num" maxLength={10} value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} />}</Field>
          <Field label="Notes" className="sm:col-span-4">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />}</Field>
        </div>
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-800">Variants</h3>
            <Button variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setVariants((v) => [...v, { attribute: 'Brand', value: '', extraPrice: '' }])}>
              Add variant
            </Button>
          </div>
          {variants.length === 0 && <p className="text-xs text-slate-500">For example Brand: Odoo, which adds 560.00 to the price.</p>}
          <div className="space-y-2">
            {variants.map((variant, index) => {
              const update = (patch: Partial<VariantDraft>) => setVariants((all) => all.map((v, i) => (i === index ? { ...v, ...patch } : v)));
              return (
                <div key={index} className="grid grid-cols-[1fr_1fr_100px_auto] gap-2">
                  <Input aria-label="Attribute" placeholder="Brand" value={variant.attribute} onChange={(e) => update({ attribute: e.target.value })} />
                  <Input aria-label="Value" placeholder="Odoo" value={variant.value} onChange={(e) => update({ value: e.target.value })} />
                  <Input aria-label="Extra price" placeholder="560.00" inputMode="decimal" className="num" value={variant.extraPrice} onChange={(e) => update({ extraPrice: e.target.value })} />
                  <IconButton label="Remove variant" onClick={() => setVariants((all) => all.filter((_, i) => i !== index))}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              );
            })}
          </div>
        </section>
        <Checkbox label="On sale" hint="Turned off, it stays on existing subscriptions but cannot be added to new ones." checked={active} onChange={setActive} />
        {(localError || (save.error && !isShownOnField(save.error, errors))) && <FormError error={localError ? new Error(localError) : save.error} />}
      </form>
    </Modal>
  );
}

function ProductsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products') });
  const [editing, setEditing] = useState<Product | null>(null);
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
            New product
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-t border-slate-200 text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Product</th>
              <th className={TH}>Type</th>
              <th className={TH}>Variants</th>
              <th className={cx(TH, 'text-right')}>Sales price</th>
              <th className={cx(TH, 'text-right')}>Cost price</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton columns={6} rows={5} />}
            {data?.map((p) => (
              <tr key={p.id} className={cx(!p.active && 'opacity-60')}>
                <td className={cx(TD, 'max-w-80')}>
                  <span className="font-medium text-slate-900">{p.name}</span>
                  {!p.active && <Badge className="ml-2">Not on sale</Badge>}
                  {p.notes && <span className="block truncate text-xs text-slate-500">{p.notes}</span>}
                </td>
                <td className={cx(TD, 'text-slate-600')}>{TYPE_LABEL[p.type]}</td>
                <td className={TD}>
                  <span className="flex flex-wrap gap-1">
                    {p.variants.length === 0 && <span className="text-slate-400">—</span>}
                    {p.variants.map((v) => (
                      <Badge key={v.id} tone="indigo">
                        {v.value} +{money(v.extraPrice)}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className={cx(TD, 'num text-right text-slate-900')}>{money(p.salesPrice)}</td>
                <td className={cx(TD, 'num text-right text-slate-600')}>{money(p.costPrice)}</td>
                <td className={cx(TD, 'w-10')}>
                  {isAdmin && (
                    <IconButton
                      label={`Edit ${p.name}`}
                      className="size-7"
                      onClick={() => {
                        setEditing(p);
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
        {data?.length === 0 && <EmptyState icon={<Package className="size-5" />} title="No products yet" description="Add a product, then offer it through a plan." />}
      </div>
      <ProductForm open={open} onClose={() => setOpen(false)} editing={editing} />
    </>
  );
}

// Plans

function PlanForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: Plan | null }) {
  const toast = useToast();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products'), enabled: open });
  const blank = { name: '', productId: '' as number | '', price: '', billingPeriod: 'monthly' as BillingPeriod, minQuantity: '1', startDate: '', endDate: '', autoClose: false, closable: true, pausable: true, renewable: true, active: true };
  const [form, setForm] = useState(blank);
  const [priceError, setPriceError] = useState('');
  const update = (patch: Partial<typeof blank>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.patch(`/plans/${editing.id}`, body) : api.post('/plans', body)),
    onSuccess: () => {
      refreshAll();
      toast(editing ? 'Plan updated' : 'Plan created');
      onClose();
    },
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setPriceError('');
    setForm(
      editing
        ? { name: editing.name, productId: editing.productId, price: rupees(editing.price), billingPeriod: editing.billingPeriod, minQuantity: String(editing.minQuantity), startDate: editing.startDate ?? '', endDate: editing.endDate ?? '', autoClose: editing.autoClose, closable: editing.closable, pausable: editing.pausable, renewable: editing.renewable, active: editing.active }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);
  const errors = fieldErrors(save.error);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = toPaise(form.price);
    if (price === null) return setPriceError('Enter a price, like 49.00');
    setPriceError('');
    save.mutate({ ...form, productId: form.productId || undefined, price, minQuantity: Number(form.minQuantity), startDate: form.startDate || null, endDate: form.endDate || null });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'New plan'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="plan-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="Name" error={errors.name} className="col-span-2">{(id) => <Input id={id} value={form.name} onChange={(e) => update({ name: e.target.value })} autoFocus />}</Field>
        <Field label="Product" error={errors.productId} className="col-span-2">
          {(id) => (
            <Select id={id} value={form.productId} onChange={(e) => update({ productId: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">Choose a product</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Price (INR)" error={priceError || errors.price}>{(id) => <Input id={id} inputMode="decimal" className="num" value={form.price} onChange={(e) => update({ price: e.target.value })} />}</Field>
        <Field label="Bills every">
          {(id) => (
            <Select id={id} value={form.billingPeriod} onChange={(e) => update({ billingPeriod: e.target.value as BillingPeriod })}>
              {BILLING_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_UNIT[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Minimum quantity" error={errors.minQuantity} className="col-span-2">{(id) => <Input id={id} type="number" min={1} className="num" value={form.minQuantity} onChange={(e) => update({ minQuantity: e.target.value })} />}</Field>
        <Field label="Available from" error={errors.startDate}>{(id) => <Input id={id} type="date" value={form.startDate} onChange={(e) => update({ startDate: e.target.value })} />}</Field>
        <Field label="Available until" error={errors.endDate}>{(id) => <Input id={id} type="date" value={form.endDate} onChange={(e) => update({ endDate: e.target.value })} />}</Field>
        <div className="col-span-2 space-y-2 rounded-md border border-slate-200 p-3">
          <Checkbox label="Closes on its own at expiry" hint="Otherwise it stays active, unbilled, until someone renews or closes it." checked={form.autoClose} onChange={(autoClose) => update({ autoClose })} />
          <Checkbox label="Can be closed early" checked={form.closable} onChange={(closable) => update({ closable })} />
          <Checkbox label="Can be paused" checked={form.pausable} onChange={(pausable) => update({ pausable })} />
          <Checkbox label="Can be renewed" checked={form.renewable} onChange={(renewable) => update({ renewable })} />
          <Checkbox label="Available for new subscriptions" checked={form.active} onChange={(active) => update({ active })} />
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

function PlansTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans') });
  const [editing, setEditing] = useState<Plan | null>(null);
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
            New plan
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-t border-slate-200 text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Plan</th>
              <th className={TH}>Billing</th>
              <th className={cx(TH, 'text-right')}>Price</th>
              <th className={cx(TH, 'text-right')}>Min qty</th>
              <th className={TH}>Available</th>
              <th className={TH}>Rules</th>
              <th className={cx(TH, 'text-right')}>Active subs</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton columns={8} rows={6} />}
            {data?.map((p) => (
              <tr key={p.id} className={cx(!p.active && 'opacity-60')}>
                <td className={TD}>
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className="block text-xs text-slate-500">{p.productName}</span>
                </td>
                <td className={cx(TD, 'text-slate-600')}>{PERIOD_LABEL[p.billingPeriod]}</td>
                <td className={cx(TD, 'num text-right text-slate-900')}>{money(p.price)}</td>
                <td className={cx(TD, 'num text-right')}>{p.minQuantity}</td>
                <td className={cx(TD, 'num whitespace-nowrap text-xs text-slate-600')}>{p.startDate || p.endDate ? `${date(p.startDate)} – ${date(p.endDate)}` : 'Always'}</td>
                <td className={TD}>
                  <span className="flex flex-wrap gap-1">
                    {p.autoClose && <Badge tone="sky">Auto-close</Badge>}
                    {p.closable && <Badge>Closable</Badge>}
                    {p.pausable && <Badge>Pausable</Badge>}
                    {p.renewable && <Badge>Renewable</Badge>}
                  </span>
                </td>
                <td className={cx(TD, 'num text-right')}>{number(p.activeSubscriptions)}</td>
                <td className={cx(TD, 'w-10')}>
                  {isAdmin && (
                    <IconButton
                      label={`Edit ${p.name}`}
                      className="size-7"
                      onClick={() => {
                        setEditing(p);
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
        {data?.length === 0 && <EmptyState icon={<Boxes className="size-5" />} title="No plans yet" description="Create a plan to set what a product costs and how often it bills." />}
      </div>
      <PlanForm open={open} onClose={() => setOpen(false)} editing={editing} />
    </>
  );
}

// Quotation templates

function TemplateForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: QuotationTemplate | null }) {
  const toast = useToast();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans'), enabled: open });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products'), enabled: open });
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState<number | ''>('');
  const [planVariantId, setPlanVariantId] = useState<number | ''>('');
  const [planQuantity, setPlanQuantity] = useState('1');
  const [validityDays, setValidityDays] = useState('30');
  const [paymentTermDays, setPaymentTermDays] = useState('30');
  const [lines, setLines] = useState<Array<{ productId: number | ''; quantity: string }>>([]);
  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.patch(`/templates/${editing.id}`, body) : api.post('/templates', body)),
    onSuccess: () => {
      refreshAll();
      toast(editing ? 'Template updated' : 'Template created');
      onClose();
    },
  });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setName(editing?.name ?? '');
    setPlanId(editing?.planId ?? '');
    setPlanVariantId(editing?.planVariantId ?? '');
    setPlanQuantity(String(editing?.planQuantity ?? 1));
    setValidityDays(String(editing?.validityDays ?? 30));
    setPaymentTermDays(String(editing?.paymentTermDays ?? 30));
    setLines(editing?.lines.map((l) => ({ productId: l.productId, quantity: String(l.quantity) })) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);
  const errors = fieldErrors(save.error);
  const plan = plans.data?.find((p) => p.id === planId);
  const planProduct = products.data?.find((p) => p.id === plan?.productId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'New quotation template'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="template-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create template'}
          </Button>
        </>
      }
    >
      <form
        id="template-form"
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            name,
            planId: planId || undefined,
            planVariantId: planVariantId || null,
            planQuantity: Number(planQuantity),
            validityDays: Number(validityDays),
            paymentTermDays: Number(paymentTermDays),
            lines: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, variantId: null, quantity: Number(l.quantity) })),
          });
        }}
      >
        <Field label="Name" error={errors.name} className="col-span-2">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Plan" error={errors.planId} className="col-span-2">
          {(id) => (
            <Select
              id={id}
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value ? Number(e.target.value) : '');
                setPlanVariantId('');
              }}
            >
              <option value="">Choose a plan</option>
              {plans.data?.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.price)}/{PERIOD_UNIT[p.billingPeriod]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Variant">
          {(id) => (
            <Select id={id} value={planVariantId} disabled={!planProduct?.variants.length} onChange={(e) => setPlanVariantId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Standard</option>
              {planProduct?.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.value} (+{money(v.extraPrice)})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Quantity" error={errors.planQuantity}>{(id) => <Input id={id} type="number" min={1} className="num" value={planQuantity} onChange={(e) => setPlanQuantity(e.target.value)} />}</Field>
        <Field label="Valid for (days)" error={errors.validityDays}>{(id) => <Input id={id} type="number" min={1} max={365} className="num" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />}</Field>
        <Field label="Payment terms (days)" error={errors.paymentTermDays}>{(id) => <Input id={id} type="number" min={0} max={180} className="num" value={paymentTermDays} onChange={(e) => setPaymentTermDays(e.target.value)} />}</Field>
        <div className="col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-800">Product lines</h3>
            <Button variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setLines((l) => [...l, { productId: '', quantity: '1' }])}>
              Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_72px_auto] gap-2">
                <Select aria-label="Product" value={line.productId} onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, productId: e.target.value ? Number(e.target.value) : '' } : l)))}>
                  <option value="">Choose a product</option>
                  {products.data?.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Input aria-label="Quantity" type="number" min={1} className="num" value={line.quantity} onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))} />
                <IconButton label="Remove line" onClick={() => setLines((all) => all.filter((_, i) => i !== index))}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
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

function TemplatesTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['templates'], queryFn: () => api.get<QuotationTemplate[]>('/templates') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products') });
  const [editing, setEditing] = useState<QuotationTemplate | null>(null);
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
            New template
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-t border-slate-200 text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Template</th>
              <th className={TH}>Plan</th>
              <th className={TH}>Product lines</th>
              <th className={cx(TH, 'text-right')}>Valid for</th>
              <th className={cx(TH, 'text-right')}>Terms</th>
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
                <td className={cx(TD, 'text-slate-600')}>
                  {t.planName} <span className="num text-slate-400">× {t.planQuantity}</span>
                </td>
                <td className={cx(TD, 'text-slate-600')}>{t.lines.map((l) => products.data?.find((p) => p.id === l.productId)?.name).filter(Boolean).join(', ') || '—'}</td>
                <td className={cx(TD, 'num text-right')}>{t.validityDays} days</td>
                <td className={cx(TD, 'num text-right')}>Net {t.paymentTermDays}</td>
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
        {data?.length === 0 && <EmptyState icon={<FileStack className="size-5" />} title="No templates yet" description="Templates let the team start a quotation with the right plan and lines." />}
      </div>
      <TemplateForm open={open} onClose={() => setOpen(false)} editing={editing} />
    </>
  );
}

type Tab = 'plans' | 'products' | 'templates';

export default function Plans() {
  const me = useUser();
  const isAdmin = me.role === 'admin';
  const { get, set } = useUrlFilters<'tab'>();
  const tab = (get('tab') || 'plans') as Tab;
  return (
    <>
      <PageHeader title="Plans & Variants" description={isAdmin ? 'What you sell, what it costs, how often it bills and what can change.' : 'What you sell and how it bills. Only an admin can change these.'} />
      <Card>
        <div className="px-2.5 pt-1">
          <Tabs<Tab>
            label="Catalog"
            value={tab}
            onChange={(value) => set({ tab: value })}
            tabs={[
              { value: 'plans', label: 'Plans' },
              { value: 'products', label: 'Products & Variants' },
              { value: 'templates', label: 'Quotation Templates' },
            ]}
          />
        </div>
        {tab === 'plans' && <PlansTab isAdmin={isAdmin} />}
        {tab === 'products' && <ProductsTab isAdmin={isAdmin} />}
        {tab === 'templates' && <TemplatesTab isAdmin={isAdmin} />}
      </Card>
    </>
  );
}
