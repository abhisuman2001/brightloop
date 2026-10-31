import type { BillingPeriod } from './dates';

export type Role = 'admin' | 'staff' | 'customer';
export type SubscriptionStatus = 'draft' | 'quotation' | 'confirmed' | 'active' | 'closed';
export type InvoiceStatus = 'draft' | 'confirmed' | 'paid' | 'cancelled';
export type ProductType = 'software' | 'addon' | 'service' | 'goods';
export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'upi';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  /** The role the API enforces. An admin may temporarily drop to staff. */
  role: Role;
  actualRole: Role;
  customerId: number | null;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Customer {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  taxId: string;
  createdAt: string;
  activeSubscriptions: number;
  outstanding: number;
  monthlyAmount: number;
}

export interface Variant {
  id: number;
  productId: number;
  attribute: string;
  value: string;
  extraPrice: number;
}

export interface Product {
  id: number;
  name: string;
  type: ProductType;
  salesPrice: number;
  costPrice: number;
  notes: string;
  hsnCode: string;
  active: boolean;
  variants: Variant[];
}

export interface Plan {
  id: number;
  name: string;
  productId: number;
  productName: string;
  price: number;
  billingPeriod: BillingPeriod;
  minQuantity: number;
  startDate: string | null;
  endDate: string | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  active: boolean;
  activeSubscriptions: number;
}

export interface PublicPlan {
  id: number;
  name: string;
  productName: string;
  notes: string;
  price: number;
  billingPeriod: BillingPeriod;
  minQuantity: number;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
}

export interface TemplateLine {
  productId: number;
  variantId: number | null;
  quantity: number;
}

export interface QuotationTemplate {
  id: number;
  name: string;
  planId: number;
  planName: string;
  validityDays: number;
  paymentTermDays: number;
  planQuantity: number;
  planVariantId: number | null;
  lines: TemplateLine[];
}

/** Under GST a sale inside the seller's state carries CGST and SGST, and one to another state carries IGST. */
export type TaxSupply = 'any' | 'intra' | 'inter';

export interface SellerInfo {
  name: string;
  address: string;
  gstin: string;
  upiId: string;
}

export interface TaxRule {
  id: number;
  name: string;
  rateBps: number;
  productType: ProductType | null;
  supply: TaxSupply;
  active: boolean;
}

export interface Discount {
  id: number;
  name: string;
  kind: 'percent' | 'fixed';
  value: number;
  minPurchase: number;
  minQuantity: number;
  startDate: string | null;
  endDate: string | null;
  usageLimit: number | null;
  usedCount: number;
  scope: 'product' | 'subscription';
  productIds: number[];
  active: boolean;
}

export interface SubscriptionRow {
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  company: string;
  planId: number;
  planName: string;
  variantLabel: string | null;
  billingPeriod: BillingPeriod;
  startDate: string;
  expiryDate: string | null;
  nextInvoiceDate: string | null;
  status: SubscriptionStatus;
  paused: boolean;
  pausable: boolean;
  overdue: boolean;
  quoteExpired: boolean;
  recurringAmount: number;
}

export interface SubscriptionList extends Paged<SubscriptionRow> {
  summary: { activeCount: number; recurringSubtotal: number };
  statusCounts: Record<SubscriptionStatus, number>;
}

export interface SubscriptionLine {
  id: number;
  productId: number;
  productName: string;
  productType: ProductType;
  variantId: number | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  variantExtra: number;
  isPlanLine: boolean;
  gross: number;
  discount: number;
  discountName: string | null;
  net: number;
  tax: number;
  taxLabel: string | null;
  total: number;
}

export interface SubscriptionDetail extends SubscriptionRow {
  customerEmail: string;
  templateName: string | null;
  templateId: number | null;
  paymentTermDays: number;
  validityDays: number;
  quoteValidUntil: string | null;
  defaultRenewalDate: string | null;
  notes: string;
  closedReason: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  plan: Pick<Plan, 'autoClose' | 'closable' | 'pausable' | 'renewable' | 'minQuantity' | 'price'>;
  lines: SubscriptionLine[];
  totals: { subtotal: number; discountTotal: number; taxTotal: number; total: number };
  invoices: InvoiceRow[];
}

export interface InvoiceRow {
  id: number;
  number: string;
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  company: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  overdue: boolean;
  total: number;
  amountPaid: number;
  balance: number;
  sentAt: string | null;
}

export interface InvoiceLine {
  id: number;
  productName: string;
  hsnCode: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  variantExtra: number;
  discountAmount: number;
  discountName: string | null;
  taxAmount: number;
  taxLabel: string | null;
  lineTotal: number;
}

export interface Payment {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  customerName: string;
  company: string;
  method: PaymentMethod;
  amount: number;
  paymentDate: string;
  note: string;
  voidedAt: string | null;
  recordedBy: string | null;
}

export interface InvoiceDetail extends InvoiceRow {
  customerEmail: string;
  customerAddress: string;
  customerTaxId: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  taxBreakdown: Array<{ name: string; amount: number }>;
  seller: SellerInfo;
  lastReminderAt: string | null;
  lines: InvoiceLine[];
  payments: Payment[];
}

export interface ReconcileRow {
  line: number;
  paymentDate: string | null;
  description: string;
  reference: string;
  amount: number;
  method: PaymentMethod;
  match: 'invoice' | 'amount' | 'duplicate' | 'none';
  invoiceId: number | null;
  invoiceNumber: string | null;
  customerName: string | null;
  problem: string | null;
}

export interface ReconcileResult {
  rows: ReconcileRow[];
  summary: { credits: number; matched: number; duplicates: number; unmatched: number; matchedAmount: number };
}

export interface InvoiceList extends Paged<InvoiceRow> {
  statusCounts: Record<InvoiceStatus | 'overdue', number>;
  summary: { total: number; balance: number };
}

export interface PaymentList extends Paged<Payment> {
  summary: { collected: number; outstanding: number; overdue: number };
}

export interface DashboardSummary {
  mrr: number;
  mrrChangePct: number | null;
  mrrTrend: number[];
  activeSubscriptions: number;
  activeNetThisWeek: number;
  overdueAmount: number;
  overdueCount: number;
  collectionRate: number | null;
}

export interface FinanceReport {
  activeSubscriptions: number;
  mrr: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  revenueByMonth: Array<{ month: string; invoiced: number; collected: number }>;
  aging: Array<{ bucket: string; amount: number; count: number }>;
  byMethod: Array<{ method: PaymentMethod; amount: number; count: number }>;
  byPlan: Array<{ planId: number; plan: string; active: number; mrr: number }>;
  overdueInvoices: InvoiceRow[];
  movement: {
    startingMrr: number;
    newMrr: number;
    churnedMrr: number;
    newSubscriptions: number;
    churnedSubscriptions: number;
    /** Share of the subscriptions and of the MRR in force at any point in the range that closed during it. Null with nothing to measure against. */
    churnRatePct: number | null;
    revenueChurnPct: number | null;
    averagePerCustomer: number;
  };
}

export interface BillingRunResult {
  id: number;
  runDate: string;
  created: number;
  skipped: number;
  failed: number;
  totalAmount: number;
  closed: number;
  activated: number;
  errors: Array<{ subscriptionId: number; number: string; message: string }>;
  trigger: string;
  createdAt: string;
}

export interface BillingStatus {
  dueNow: number;
  draftInvoices: number;
  lastRun: BillingRunResult | null;
}

export interface SearchResults {
  subscriptions: Array<{ id: number; number: string; customerName: string; status: SubscriptionStatus }>;
  customers: Array<{ id: number; name: string; company: string; email: string }>;
  invoices: Array<{ id: number; number: string; customerName: string; status: InvoiceStatus; total: number; overdue: number }>;
}

export interface NotificationItem {
  key: string;
  title: string;
  detail: string;
  count: number;
  to: string;
  tone: 'rose' | 'amber' | 'sky';
}

export interface ActivityEntry {
  id: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: number | null;
  summary: string;
  createdAt: string;
}

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  invitePending: boolean;
}

export interface EmailLogEntry {
  id: number;
  recipient: string;
  subject: string;
  status: 'sent' | 'logged' | 'failed';
  error: string | null;
  link: string | null;
  createdAt: string;
}

export interface PortalOverview {
  customer: { name: string; company: string; email: string; phone: string; address: string };
  activeSubscriptions: number;
  monthlyAmount: number;
  outstanding: number;
  overdue: number;
  subscriptions: SubscriptionRow[];
  invoices: InvoiceRow[];
}

export interface PortalSubscription extends SubscriptionDetail {
  addons: Array<{ productId: number; name: string; price: number; enabled: boolean; notes: string }>;
}

export interface PortalPlan {
  id: number;
  name: string;
  productName: string;
  price: number;
  billingPeriod: BillingPeriod;
  minQuantity: number;
  notes: string;
  variants: Variant[];
}
