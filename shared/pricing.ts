// All money is integer cents; percentages are basis points (1250 = 12.5%).
export interface PricingLine {
  key: string | number;
  productId: number;
  productType: string;
  quantity: number;
  unitPrice: number;
  variantExtra: number;
}

export interface PricingTax {
  id: number;
  name: string;
  rateBps: number;
  /** null applies the rule to every product type. */
  productType: string | null;
}

export interface PricingDiscount {
  id: number;
  name: string;
  kind: 'percent' | 'fixed';
  /** Basis points for percent, cents for fixed. */
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

export interface PricedLine {
  key: string | number;
  gross: number;
  discount: number;
  discountName: string | null;
  net: number;
  tax: number;
  taxLabel: string | null;
  total: number;
}

export interface PricedDocument {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  appliedDiscountIds: number[];
}

/** Whether a rule can be used on this date. Thresholds are checked separately. */
export function isDiscountLive(discount: PricingDiscount, date: string): boolean {
  if (!discount.active) return false;
  if (discount.startDate && date < discount.startDate) return false;
  if (discount.endDate && date > discount.endDate) return false;
  if (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) return false;
  return true;
}

/** Splits `amount` across weights so the shares always add back to exactly `amount`. */
export function allocate(amount: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / totalWeight);
  const shares = exact.map(Math.floor);
  let remainder = amount - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((value, i) => ({ i, frac: value - shares[i] })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    shares[i]++;
    remainder--;
  }
  return shares;
}

function discountAmount(discount: PricingDiscount, base: number): number {
  const raw = discount.kind === 'percent' ? Math.round((base * discount.value) / 10_000) : discount.value;
  return Math.min(raw, base);
}

function meetsThresholds(discount: PricingDiscount, gross: number, quantity: number): boolean {
  return gross >= discount.minPurchase && quantity >= discount.minQuantity;
}

/**
 * Prices a set of lines. A line gets at most one product rule (the best for the customer),
 * then the single best whole-subscription rule applies to what is left. Tax is charged on
 * the discounted amount. The same function prices previews and real invoices, so what the
 * team sees on a subscription is what the invoice will say.
 */
export function priceLines(
  lines: PricingLine[],
  taxes: PricingTax[],
  discounts: PricingDiscount[],
  date: string,
): PricedDocument {
  const gross = lines.map((l) => (l.unitPrice + l.variantExtra) * l.quantity);
  const lineDiscount = lines.map(() => 0);
  const lineDiscountNames: string[][] = lines.map(() => []);
  const applied = new Set<number>();
  const live = discounts.filter((d) => isDiscountLive(d, date));

  const best: Array<{ amount: number; discount: PricingDiscount } | null> = lines.map(() => null);
  for (const discount of live.filter((d) => d.scope === 'product')) {
    const matching = lines.map((l) => discount.productIds.includes(l.productId));
    const matchedGross = gross.reduce((sum, g, i) => (matching[i] ? sum + g : sum), 0);
    const matchedQty = lines.reduce((sum, l, i) => (matching[i] ? sum + l.quantity : sum), 0);
    if (matchedGross === 0 || !meetsThresholds(discount, matchedGross, matchedQty)) continue;
    const shares = allocate(
      discountAmount(discount, matchedGross),
      gross.map((g, i) => (matching[i] ? g : 0)),
    );
    shares.forEach((amount, i) => {
      if (amount > 0 && (!best[i] || amount > best[i]!.amount)) best[i] = { amount, discount };
    });
  }
  best.forEach((choice, i) => {
    if (!choice) return;
    lineDiscount[i] = choice.amount;
    lineDiscountNames[i].push(choice.discount.name);
    applied.add(choice.discount.id);
  });

  const totalGross = gross.reduce((a, b) => a + b, 0);
  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);
  const afterProduct = gross.map((g, i) => g - lineDiscount[i]);
  const remaining = afterProduct.reduce((a, b) => a + b, 0);
  let wholeBest: { amount: number; discount: PricingDiscount } | null = null;
  for (const discount of live.filter((d) => d.scope === 'subscription')) {
    if (!meetsThresholds(discount, totalGross, totalQty)) continue;
    const amount = discountAmount(discount, remaining);
    if (amount > 0 && (!wholeBest || amount > wholeBest.amount)) wholeBest = { amount, discount };
  }
  if (wholeBest) {
    const { discount } = wholeBest;
    allocate(wholeBest.amount, afterProduct).forEach((amount, i) => {
      if (amount <= 0) return;
      lineDiscount[i] += amount;
      lineDiscountNames[i].push(discount.name);
    });
    applied.add(discount.id);
  }

  const priced = lines.map((line, i): PricedLine => {
    const net = gross[i] - lineDiscount[i];
    const rules = taxes.filter((t) => t.productType === null || t.productType === line.productType);
    const tax = rules.reduce((sum, t) => sum + Math.round((net * t.rateBps) / 10_000), 0);
    return {
      key: line.key,
      gross: gross[i],
      discount: lineDiscount[i],
      discountName: lineDiscountNames[i].join(' + ') || null,
      net,
      tax,
      taxLabel: rules.map((t) => t.name).join(' + ') || null,
      total: net + tax,
    };
  });

  const discountTotal = lineDiscount.reduce((a, b) => a + b, 0);
  const taxTotal = priced.reduce((sum, l) => sum + l.tax, 0);
  return {
    lines: priced,
    subtotal: totalGross,
    discountTotal,
    taxTotal,
    total: totalGross - discountTotal + taxTotal,
    appliedDiscountIds: [...applied],
  };
}
