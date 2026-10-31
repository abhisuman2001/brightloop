import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addDays, type BillingPeriod } from '../../shared/dates';
import { priceLines, type PricingDiscount, type PricingLine } from '../../shared/pricing';
import type { Customer, Discount, Paged, Plan, Product, QuotationTemplate, SubscriptionDetail, TaxRule } from '../../shared/types';
import { api, queryString, refreshAll } from '../lib/api';
import { PERIOD_LABEL, PERIOD_UNIT, money, todayLocal, date } from '../lib/format';
import { useDebounced, useDrawer } from '../lib/hooks';
import { Button, Field, FormError, IconButton, Input, Modal, Select, Textarea, cx, fieldErrors, isShownOnField, useToast } from './ui';

interface LineDraft {
  productId: number | '';
  variantId: number | '';
  quantity: string;
}

function CustomerPicker({ value, label, onChange, error }: { value: number | ''; label: string; onChange: (id: number, label: string) => void; error?: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const q = useDebounced(text, 150);
  const { data } = useQuery({
    queryKey: ['customers', 'picker', q],
    queryFn: () => api.get<Paged<Customer>>(`/customers${queryString({ q, pageSize: 8 })}`),
    enabled: open,
  });
  return (
    <Field label="Customer" error={error}>
      {(id) => (
        <div className="relative">
          <Input
            id={id}
            role="combobox"
            aria-expanded={open}
            autoComplete="off"
            placeholder="Search customers..."
            value={open ? text : label}
            onFocus={() => {
              setOpen(true);
              setText('');
            }}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onChange={(e) => setText(e.target.value)}
          />
          {open && (
            <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-sm">
              {data?.rows.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(c.id, `${c.name}${c.company ? ` · ${c.company}` : ''}`);
                      setOpen(false);
                    }}
                    className={cx('block w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-slate-100', c.id === value && 'bg-slate-50')}
                  >
                    {c.name} <span className="text-xs text-slate-500">{c.company || c.email}</span>
                  </button>
                </li>
              ))}
              {data?.rows.length === 0 && <li className="px-2 py-1 text-xs text-slate-500">No customers match.</li>}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

interface FormProps {
  open: boolean;
  onClose: () => void;
  editing?: SubscriptionDetail | null;
  presetCustomer?: { id: number; label: string } | null;
}

const toPricingDiscount = (d: Discount): PricingDiscount => d;

export function SubscriptionForm({ open, onClose, editing, presetCustomer }: FormProps) {
  const toast = useToast();
  const drawer = useDrawer('sub');
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<Product[]>('/products'), enabled: open });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans'), enabled: open });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<QuotationTemplate[]>('/templates'), enabled: open });
  const discounts = useQuery({ queryKey: ['discounts'], queryFn: () => api.get<Discount[]>('/discounts'), enabled: open });

  const [templateId, setTemplateId] = useState<number | ''>('');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [customerLabel, setCustomerLabel] = useState('');
  const [planId, setPlanId] = useState<number | ''>('');
  const [planVariantId, setPlanVariantId] = useState<number | ''>('');
  const [planQuantity, setPlanQuantity] = useState('1');
  const [startDate, setStartDate] = useState(todayLocal());
  const [expiryDate, setExpiryDate] = useState('');
  const [paymentTermDays, setPaymentTermDays] = useState('30');
  const [validityDays, setValidityDays] = useState('30');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);

  const taxes = useQuery({ queryKey: ['taxes', customerId], queryFn: () => api.get<TaxRule[]>(`/taxes${queryString({ customerId })}`), enabled: open, placeholderData: keepPreviousData });

  const save = useMutation({
    mutationFn: (body: object) => (editing ? api.put<SubscriptionDetail>(`/subscriptions/${editing.id}`, body) : api.post<SubscriptionDetail>('/subscriptions', body)),
    onSuccess: (sub) => {
      refreshAll();
      toast(editing ? `${sub.number} updated` : `${sub.number} created as a draft`);
      onClose();
      if (!editing) drawer.open(sub.id);
    },
  });

  useEffect(() => {
    if (!open) return;
    save.reset();
    if (editing) {
      const planLine = editing.lines.find((l) => l.isPlanLine);
      setTemplateId(editing.templateId ?? '');
      setCustomerId(editing.customerId);
      setCustomerLabel(`${editing.customerName}${editing.company ? ` · ${editing.company}` : ''}`);
      setPlanId(editing.planId);
      setPlanVariantId(planLine?.variantId ?? '');
      setPlanQuantity(String(planLine?.quantity ?? 1));
      setStartDate(editing.startDate);
      setExpiryDate(editing.expiryDate ?? '');
      setPaymentTermDays(String(editing.paymentTermDays));
      setValidityDays(String(editing.validityDays));
      setNotes(editing.notes);
      setLines(editing.lines.filter((l) => !l.isPlanLine).map((l) => ({ productId: l.productId, variantId: l.variantId ?? '', quantity: String(l.quantity) })));
    } else {
      setTemplateId('');
      setCustomerId(presetCustomer?.id ?? '');
      setCustomerLabel(presetCustomer?.label ?? '');
      setPlanId('');
      setPlanVariantId('');
      setPlanQuantity('1');
      setStartDate(todayLocal());
      setExpiryDate('');
      setPaymentTermDays('30');
      setValidityDays('30');
      setNotes('');
      setLines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const applyTemplate = (id: number | '') => {
    setTemplateId(id);
    const template = templates.data?.find((t) => t.id === id);
    if (!template) return;
    setPlanId(template.planId);
    setPlanVariantId(template.planVariantId ?? '');
    setPlanQuantity(String(template.planQuantity));
    setPaymentTermDays(String(template.paymentTermDays));
    setValidityDays(String(template.validityDays));
    setLines(template.lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? '', quantity: String(l.quantity) })));
  };

  const plan = plans.data?.find((p) => p.id === planId);
  const productOf = (id: number | '') => products.data?.find((p) => p.id === id);
  const planProduct = plan ? productOf(plan.productId) : undefined;
  const locked = editing?.status === 'active';

  // Live preview using the same pricing code the server bills with.
  const preview = useMemo(() => {
    if (!plan || !planProduct) return null;
    const planVariant = planProduct.variants.find((v) => v.id === planVariantId);
    const pricing: PricingLine[] = [
      { key: 'plan', productId: plan.productId, productType: planProduct.type, quantity: Number(planQuantity) || 0, unitPrice: plan.price, variantExtra: planVariant?.extraPrice ?? 0 },
    ];
    lines.forEach((l, i) => {
      const product = productOf(l.productId);
      if (!product) return;
      const variant = product.variants.find((v) => v.id === l.variantId);
      pricing.push({ key: i, productId: product.id, productType: product.type, quantity: Number(l.quantity) || 0, unitPrice: product.salesPrice, variantExtra: variant?.extraPrice ?? 0 });
    });
    return priceLines(pricing, (taxes.data ?? []).filter((t) => t.active), (discounts.data ?? []).map(toPricingDiscount), startDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, planProduct, planVariantId, planQuantity, lines, taxes.data, discounts.data, startDate, products.data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({
      customerId: customerId || undefined,
      planId: planId || undefined,
      templateId: templateId || null,
      startDate,
      expiryDate: expiryDate || null,
      paymentTermDays: Number(paymentTermDays),
      validityDays: Number(validityDays),
      planQuantity: Number(planQuantity),
      planVariantId: planVariantId || null,
      lines: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, variantId: l.variantId || null, quantity: Number(l.quantity) })),
      notes,
    });
  };

  const errors = fieldErrors(save.error);
  const period: BillingPeriod | undefined = plan?.billingPeriod;
  const sellable = products.data?.filter((p) => p.active || lines.some((l) => l.productId === p.id)) ?? [];
  const available = plans.data?.filter((p) => (p.active || p.id === editing?.planId)) ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `Edit ${editing.number}` : 'Create subscription'}
      description={editing ? (locked ? 'Line changes apply from the next invoice.' : undefined) : 'Start from a quotation template, or fill it in yourself.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="subscription-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Create draft'}
          </Button>
        </>
      }
    >
      <form id="subscription-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!editing && (
            <Field label="Quotation template" className="sm:col-span-2">
              {(id) => (
                <Select id={id} value={templateId} onChange={(e) => applyTemplate(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">No template</option>
                  {templates.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.planName} · valid {t.validityDays} days
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {locked ? (
            <Field label="Customer">{(id) => <Input id={id} value={customerLabel} disabled />}</Field>
          ) : (
            <CustomerPicker
              value={customerId}
              label={customerLabel}
              error={errors.customerId}
              onChange={(id, label) => {
                setCustomerId(id);
                setCustomerLabel(label);
              }}
            />
          )}
          <Field label="Plan" error={errors.planId}>
            {(id) => (
              <Select
                id={id}
                value={planId}
                disabled={locked}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : '';
                  setPlanId(next);
                  setPlanVariantId('');
                  const chosen = plans.data?.find((p) => p.id === next);
                  if (chosen && Number(planQuantity) < chosen.minQuantity) setPlanQuantity(String(chosen.minQuantity));
                }}
              >
                <option value="">Choose a plan</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {money(p.price)}/{PERIOD_UNIT[p.billingPeriod]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Variant" hint={planProduct && planProduct.variants.length === 0 ? `${planProduct.name} has no variants` : undefined}>
            {(id) => (
              <Select id={id} value={planVariantId} disabled={!planProduct?.variants.length} onChange={(e) => setPlanVariantId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Standard</option>
                {planProduct?.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.attribute}: {v.value} (+{money(v.extraPrice)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Quantity" error={errors.planQuantity} hint={plan ? `Minimum ${plan.minQuantity}` : undefined}>
            {(id) => <Input id={id} type="number" min={plan?.minQuantity ?? 1} className="num" value={planQuantity} onChange={(e) => setPlanQuantity(e.target.value)} />}
          </Field>
          <Field label="Start date" error={errors.startDate}>
            {(id) => <Input id={id} type="date" value={startDate} disabled={locked} onChange={(e) => setStartDate(e.target.value)} required />}
          </Field>
          <Field label="Expiry date" error={errors.expiryDate} hint="Leave empty to keep billing until closed">
            {(id) => <Input id={id} type="date" min={startDate} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />}
          </Field>
          <Field label="Payment terms (days)" error={errors.paymentTermDays}>
            {(id) => (
              <Select id={id} value={paymentTermDays} onChange={(e) => setPaymentTermDays(e.target.value)}>
                {[...new Set([0, 7, 15, 30, 45, 60, 90, Number(paymentTermDays)])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'Due on receipt' : `Net ${d}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Quotation valid for (days)" error={errors.validityDays} hint={`Until ${date(addDays(todayLocal(), Math.min(Math.max(Number(validityDays) || 0, 0), 365)))} if sent today`}>
            {(id) => <Input id={id} type="number" min={1} max={365} className="num" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />}
          </Field>
        </div>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-800">Additional product lines</h3>
            <Button variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setLines((l) => [...l, { productId: '', variantId: '', quantity: '1' }])}>
              Add line
            </Button>
          </div>
          {lines.length === 0 && <p className="text-xs text-slate-500">Add-ons or extra products billed with the plan.</p>}
          <div className="space-y-2">
            {lines.map((line, index) => {
              const product = productOf(line.productId);
              const update = (patch: Partial<LineDraft>) => setLines((all) => all.map((l, i) => (i === index ? { ...l, ...patch } : l)));
              return (
                <div key={index} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_80px_auto]">
                  <Select aria-label="Product" value={line.productId} onChange={(e) => update({ productId: e.target.value ? Number(e.target.value) : '', variantId: '' })}>
                    <option value="">Choose a product</option>
                    {sellable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {money(p.salesPrice)}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label="Variant" className="order-3 col-span-2 sm:order-none sm:col-span-1" value={line.variantId} disabled={!product?.variants.length} onChange={(e) => update({ variantId: e.target.value ? Number(e.target.value) : '' })}>
                    <option value="">Standard</option>
                    {product?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.value} (+{money(v.extraPrice)})
                      </option>
                    ))}
                  </Select>
                  <Input aria-label="Quantity" type="number" min={1} className="num order-4 col-span-1 sm:order-none" value={line.quantity} onChange={(e) => update({ quantity: e.target.value })} />
                  <IconButton label="Remove line" onClick={() => setLines((all) => all.filter((_, i) => i !== index))}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              );
            })}
          </div>
        </section>

        <Field label="Internal notes">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />}</Field>

        {preview && period && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="mb-1 text-xs font-semibold text-slate-800">{PERIOD_LABEL[period]} invoice preview</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="num text-slate-900">{money(preview.subtotal)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Discount</dt>
                <dd className="num text-slate-900">{preview.discountTotal ? `-${money(preview.discountTotal)}` : money(0)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Tax</dt>
                <dd className="num text-slate-900">{money(preview.taxTotal)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Total</dt>
                <dd className="num font-semibold text-slate-900">{money(preview.total)}</dd>
              </div>
            </dl>
          </div>
        )}
        {Boolean(save.error) && !isShownOnField(save.error, errors) && <FormError error={save.error} />}
      </form>
    </Modal>
  );
}
