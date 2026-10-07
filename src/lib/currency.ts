// Display-currency helpers. All stored money in AdPac is USD cents (platform
// amounts are converted to USD at sync time using lib/fx.ts). This module
// converts USD cents BACK to a client's own currency for display only, using
// the SAME table, so values round-trip exactly.
import { FX_UNITS_PER_USD, ZERO_DECIMAL_CURRENCIES, isKnownCurrency } from './fx';

export const DISPLAY_CURRENCIES = Object.keys(FX_UNITS_PER_USD);
export { ZERO_DECIMAL_CURRENCIES };

export function isDisplayCurrency(code: string | null | undefined): code is string {
  return isKnownCurrency(code);
}

/** USD cents -> amount in `currency` (major units). Unknown/empty currency = USD. */
export function usdCentsToDisplayAmount(usdCents: number, currency?: string | null): number {
  const code = (currency || 'USD').toUpperCase();
  const units = FX_UNITS_PER_USD[code] ?? 1;
  return (usdCents / 100) * units;
}

/** Amount typed in `currency` (major units) -> USD cents for storage. */
export function displayAmountToUsdCents(amount: number, currency?: string | null): number {
  const code = (currency || 'USD').toUpperCase();
  const units = FX_UNITS_PER_USD[code] ?? 1;
  return Math.round((amount / units) * 100);
}
