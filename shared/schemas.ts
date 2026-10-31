import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const optionalDate = isoDate.nullable().optional();
const cents = z.number().int('Amount must be in whole cents').min(0, 'Cannot be negative');
const text = (max: number) => z.string().trim().max(max);

export const PASSWORD_RULES = 'More than 8 characters, with an uppercase letter, a lowercase letter and a special character.';

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length <= 8) problems.push('more than 8 characters');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[^A-Za-z0-9\s]/.test(password)) problems.push('a special character');
  return problems;
}

export const passwordSchema = z
  .string()
  .max(200)
  .superRefine((value, ctx) => {
    const problems = passwordProblems(value);
    if (problems.length) ctx.addIssue({ code: 'custom', message: `Password needs ${problems.join(', ')}.` });
  });

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));

export const signupSchema = z.object({
  name: text(120).min(1, 'Your name is required'),
  company: text(160).optional().default(''),
  email,
  password: passwordSchema,
});
export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(200) });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });
export const viewAsSchema = z.object({ role: z.enum(['admin', 'staff']) });

export const staffCreateSchema = z.object({ name: text(120).min(1, 'Name is required'), email });
export const staffUpdateSchema = z.object({ name: text(120).min(1).optional(), active: z.boolean().optional() });

export const customerSchema = z.object({
  name: text(120).min(1, 'Name is required'),
  company: text(160).default(''),
  email,
  phone: text(40).default(''),
  address: text(400).default(''),
  taxId: text(40).default(''),
});

export const PRODUCT_TYPES = ['software', 'addon', 'service', 'goods'] as const;
export const productSchema = z.object({
  name: text(120).min(1, 'Name is required'),
  type: z.enum(PRODUCT_TYPES),
  salesPrice: cents,
  costPrice: cents,
  notes: text(2000).default(''),
  active: z.boolean().default(true),
  variants: z
    .array(
      z.object({
        id: z.number().int().optional(),
        attribute: text(60).min(1, 'Attribute is required'),
        value: text(60).min(1, 'Value is required'),
        extraPrice: cents,
      }),
    )
    .default([]),
});

export const BILLING_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export const planSchema = z
  .object({
    name: text(120).min(1, 'Name is required'),
    productId: z.number({ error: 'Choose a product' }).int(),
    price: cents,
    billingPeriod: z.enum(BILLING_PERIODS),
    minQuantity: z.number().int().min(1, 'Minimum quantity is at least 1'),
    startDate: optionalDate,
    endDate: optionalDate,
    autoClose: z.boolean().default(false),
    closable: z.boolean().default(true),
    pausable: z.boolean().default(true),
    renewable: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .refine((p) => !p.startDate || !p.endDate || p.endDate >= p.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after the start date',
  });

const lineInput = z.object({
  productId: z.number({ error: 'Choose a product' }).int(),
  variantId: z.number().int().nullable().optional(),
  quantity: z.number().int().min(1, 'Quantity is at least 1').max(1_000_000),
});

export const templateSchema = z.object({
  name: text(120).min(1, 'Name is required'),
  planId: z.number({ error: 'Choose a plan' }).int(),
  validityDays: z.number().int().min(1, 'Valid for at least 1 day').max(365),
  paymentTermDays: z.number().int().min(0).max(180),
  planQuantity: z.number().int().min(1),
  planVariantId: z.number().int().nullable().optional(),
  lines: z.array(lineInput).default([]),
});

export const subscriptionSchema = z
  .object({
    customerId: z.number({ error: 'Choose a customer' }).int(),
    planId: z.number({ error: 'Choose a plan' }).int(),
    templateId: z.number().int().nullable().optional(),
    startDate: isoDate,
    expiryDate: optionalDate,
    paymentTermDays: z.number().int().min(0).max(180),
    validityDays: z.number().int().min(1).max(365).default(30),
    planQuantity: z.number().int().min(1, 'Quantity is at least 1').max(1_000_000),
    planVariantId: z.number().int().nullable().optional(),
    lines: z.array(lineInput).default([]),
    notes: text(2000).default(''),
  })
  .refine((s) => !s.expiryDate || s.expiryDate >= s.startDate, {
    path: ['expiryDate'],
    message: 'Expiry must be on or after the start date',
  });

export const SUBSCRIPTION_STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'closed'] as const;
export const transitionSchema = z.object({
  to: z.enum(SUBSCRIPTION_STATUSES),
  reason: text(300).optional(),
});
export const renewSchema = z.object({ expiryDate: isoDate.optional() });

export const taxSchema = z.object({
  name: text(80).min(1, 'Name is required'),
  rateBps: z.number().int().min(0).max(10_000, 'Rate cannot exceed 100%'),
  productType: z.enum(PRODUCT_TYPES).nullable(),
  active: z.boolean().default(true),
});

export const discountSchema = z
  .object({
    name: text(120).min(1, 'Name is required'),
    kind: z.enum(['percent', 'fixed']),
    value: z.number().int().min(1, 'Value must be greater than zero'),
    minPurchase: cents.default(0),
    minQuantity: z.number().int().min(0).default(0),
    startDate: optionalDate,
    endDate: optionalDate,
    usageLimit: z.number().int().min(1, 'Limit is at least 1').nullable().optional(),
    scope: z.enum(['product', 'subscription']),
    productIds: z.array(z.number().int()).default([]),
    active: z.boolean().default(true),
  })
  .refine((d) => d.kind !== 'percent' || d.value <= 10_000, { path: ['value'], message: 'Percentage cannot exceed 100%' })
  .refine((d) => !d.startDate || !d.endDate || d.endDate >= d.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after the start date',
  })
  .refine((d) => d.scope !== 'product' || d.productIds.length > 0, {
    path: ['productIds'],
    message: 'Choose at least one product',
  });

export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'cheque', 'upi'] as const;
export const paymentSchema = z.object({
  invoiceId: z.number({ error: 'Choose an invoice' }).int(),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().min(1, 'Amount must be greater than zero'),
  paymentDate: isoDate,
  note: text(500).default(''),
});

export const portalAddonSchema = z.object({ productId: z.number().int(), enabled: z.boolean() });
export const portalRequestSchema = z.object({
  planId: z.number().int(),
  quantity: z.number().int().min(1).max(1_000_000),
  variantId: z.number().int().nullable().optional(),
});
export const portalProfileSchema = z.object({
  name: text(120).min(1, 'Name is required'),
  company: text(160).default(''),
  phone: text(40).default(''),
  address: text(400).default(''),
});
