import { describe, expect, it } from 'vitest';
import { addPeriods, firstBillingDateOnOrAfter, nextBillingDate, toMonthly } from '../shared/dates';
import { allocate, priceLines, type PricingDiscount, type PricingLine } from '../shared/pricing';
import { passwordProblems } from '../shared/schemas';

const line = (over: Partial<PricingLine> = {}): PricingLine => ({ key: 1, productId: 1, productType: 'software', quantity: 1, unitPrice: 100_00, variantExtra: 0, ...over });
const discount = (over: Partial<PricingDiscount> = {}): PricingDiscount => ({
  id: 1,
  name: 'Rule',
  kind: 'percent',
  value: 10_00,
  minPurchase: 0,
  minQuantity: 0,
  startDate: null,
  endDate: null,
  usageLimit: null,
  usedCount: 0,
  scope: 'subscription',
  productIds: [],
  active: true,
  ...over,
});
const DATE = '2026-06-15';

describe('billing dates', () => {
  it('keeps the anchor day across short months', () => {
    expect(addPeriods('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(addPeriods('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(addPeriods('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
    expect(addPeriods('2024-02-29', 'yearly', 4)).toBe('2028-02-29');
  });

  it('finds the next billing date strictly after a date', () => {
    expect(nextBillingDate('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
    expect(nextBillingDate('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-03-31');
    expect(nextBillingDate('2026-01-01', 'weekly', '2026-01-01')).toBe('2026-01-08');
    expect(nextBillingDate('2026-01-01', 'daily', '2026-01-05')).toBe('2026-01-06');
    expect(nextBillingDate('2026-03-01', 'yearly', '2026-02-01')).toBe('2026-03-01');
  });

  it('treats a schedule date as on-or-after itself', () => {
    expect(firstBillingDateOnOrAfter('2026-01-15', 'monthly', '2026-03-15')).toBe('2026-03-15');
    expect(firstBillingDateOnOrAfter('2026-01-15', 'monthly', '2026-03-16')).toBe('2026-04-15');
  });

  it('normalises to a monthly amount', () => {
    expect(toMonthly(1200_00, 'yearly')).toBe(100_00);
    expect(toMonthly(10_00, 'monthly')).toBe(10_00);
    expect(toMonthly(12_00, 'weekly')).toBe(52_00);
  });
});

describe('allocate', () => {
  it('always adds back to exactly the amount', () => {
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(100);
    expect(allocate(1, [1, 1])).toHaveLength(2);
    expect(allocate(50, [0, 0])).toEqual([0, 0]);
  });
});

describe('priceLines', () => {
  it('adds the variant price: the Odoo brand adds 560', () => {
    const priced = priceLines([line({ variantExtra: 560_00, quantity: 2 })], [], [], DATE);
    expect(priced.subtotal).toBe(2 * 660_00);
  });

  it('charges tax on the discounted amount, by product type', () => {
    const priced = priceLines(
      [line({ key: 'a', productType: 'software' }), line({ key: 'b', productType: 'service', productId: 2 })],
      [
        { id: 1, name: 'General', rateBps: 800, productType: null },
        { id: 2, name: 'Levy', rateBps: 200, productType: 'service' },
      ],
      [discount({ value: 50_00 })],
      DATE,
    );
    expect(priced.discountTotal).toBe(100_00);
    expect(priced.lines[0].tax).toBe(4_00);
    expect(priced.lines[1].tax).toBe(5_00);
    expect(priced.lines[1].taxLabel).toBe('General + Levy');
    expect(priced.total).toBe(109_00);
  });

  it('honours minimum quantity and minimum purchase', () => {
    const rule = discount({ minQuantity: 10 });
    expect(priceLines([line({ quantity: 9 })], [], [rule], DATE).discountTotal).toBe(0);
    expect(priceLines([line({ quantity: 10 })], [], [rule], DATE).discountTotal).toBe(100_00);
    expect(priceLines([line()], [], [discount({ minPurchase: 100_01 })], DATE).discountTotal).toBe(0);
  });

  it('stops a discount when it expires or runs out', () => {
    expect(priceLines([line()], [], [discount({ endDate: '2026-06-14' })], DATE).discountTotal).toBe(0);
    expect(priceLines([line()], [], [discount({ startDate: '2026-06-16' })], DATE).discountTotal).toBe(0);
    expect(priceLines([line()], [], [discount({ usageLimit: 3, usedCount: 3 })], DATE).discountTotal).toBe(0);
    expect(priceLines([line()], [], [discount({ endDate: DATE, usageLimit: 3, usedCount: 2 })], DATE).discountTotal).toBe(10_00);
  });

  it('applies product rules only to those products', () => {
    const priced = priceLines(
      [line({ key: 'a', productId: 1 }), line({ key: 'b', productId: 2 })],
      [],
      [discount({ scope: 'product', productIds: [2], value: 50_00 })],
      DATE,
    );
    expect(priced.lines[0].discount).toBe(0);
    expect(priced.lines[1].discount).toBe(50_00);
  });

  it('gives the best single rule of each scope, never stacking rules of the same scope', () => {
    const priced = priceLines([line()], [], [discount({ id: 1, value: 10_00 }), discount({ id: 2, value: 25_00, name: 'Best' })], DATE);
    expect(priced.discountTotal).toBe(25_00);
    expect(priced.appliedDiscountIds).toEqual([2]);
  });

  it('never discounts below zero', () => {
    const priced = priceLines([line({ unitPrice: 5_00 })], [], [discount({ kind: 'fixed', value: 100_00 })], DATE);
    expect(priced.discountTotal).toBe(5_00);
    expect(priced.total).toBe(0);
  });

  it('keeps line totals equal to the document total under rounding', () => {
    const lines = [33_33, 33_33, 33_34].map((unitPrice, key) => line({ key, unitPrice, productId: key }));
    const priced = priceLines(lines, [{ id: 1, name: 'T', rateBps: 825, productType: null }], [discount({ kind: 'fixed', value: 10_01 })], DATE);
    expect(priced.lines.reduce((sum, l) => sum + l.total, 0)).toBe(priced.total);
    expect(priced.lines.reduce((sum, l) => sum + l.discount, 0)).toBe(10_01);
  });
});

describe('password policy', () => {
  it('requires more than eight characters', () => {
    expect(passwordProblems('Abcdefg!')).toContain('more than 8 characters');
    expect(passwordProblems('Abcdefgh!')).toEqual([]);
  });
  it('requires upper, lower and special characters', () => {
    expect(passwordProblems('abcdefgh!')).toContain('an uppercase letter');
    expect(passwordProblems('ABCDEFGH!')).toContain('a lowercase letter');
    expect(passwordProblems('Abcdefghi')).toContain('a special character');
  });
});
