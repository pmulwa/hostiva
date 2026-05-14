import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const D = (v: number | string | Decimal | null | undefined): Decimal => {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return new Decimal(v as any);
};

export const fmtMoney = (v: number | string | Decimal, currency = 'USD'): string => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(D(v).toNumber());
  } catch {
    return `${currency} ${D(v).toFixed(2)}`;
  }
};

export const fmtNumber = (v: number | string | Decimal, decimals = 2): string => {
  return D(v).toFixed(decimals);
};

export const toDbAmount = (v: Decimal | number | string): number => {
  return Number(D(v).toFixed(2));
};
