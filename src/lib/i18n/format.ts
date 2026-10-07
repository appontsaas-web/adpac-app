import { intlTag, type Locale } from './config';
import { usdCentsToDisplayAmount } from '../currency';

/** Money: takes USD cents (how everything is stored) and renders it in the client's display currency. */
export function formatMoney(usdCents: number, locale: Locale = 'en', currency?: string | null): string {
  const code = (currency || 'USD').toUpperCase();
  const amount = usdCentsToDisplayAmount(usdCents, code);
  try {
    return new Intl.NumberFormat(intlTag(locale), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

export function formatNumber(n: number, locale: Locale = 'en', maxFractionDigits = 0): string {
  return new Intl.NumberFormat(intlTag(locale), { maximumFractionDigits: maxFractionDigits }).format(n);
}

export function formatPercent(fraction: number, locale: Locale = 'en', digits = 2): string {
  return new Intl.NumberFormat(intlTag(locale), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fraction);
}

export function formatDate(d: Date | string, locale: Locale = 'en'): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat(intlTag(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}
