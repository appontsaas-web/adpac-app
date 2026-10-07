// Display-currency helpers. All stored money in AdPac is USD cents (platform
// amounts are converted to USD at sync time — see FX_RATE_TO_USD in
// lib/googleAds.ts). This module converts USD cents BACK to a client's own
// currency for display only, using the same fixed/pegged rates, so a value
// converted SAR->USD at sync and USD->SAR here round-trips exactly.
//
// Only hard-pegged currencies are listed: a floating rate would silently go
// stale. Add a currency here only if it is pegged (or you accept a
// manually-maintained rate).

/** units of USD per 1 unit of the currency. */
export const FX_RATE_TO_USD: Record<string, number> = {
  USD: 1,
  SAR: 1 / 3.75, // pegged
  AED: 1 / 3.6725, // pegged
  QAR: 1 / 3.64, // pegged
  BHD: 1 / 0.376, // pegged
  OMR: 1 / 0.3845, // pegged
  JOD: 1 / 0.709, // pegged
};

export const DISPLAY_CURRENCIES = Object.keys(FX_RATE_TO_USD);

export function isDisplayCurrency(code: string | null | undefined): code is string {
  return !!code && code.toUpperCase() in FX_RATE_TO_USD;
}

/** USD cents -> amount in `currency` (major units, e.g. riyals). Unknown/empty currency = USD. */
export function usdCentsToDisplayAmount(usdCents: number, currency?: string | null): number {
  const code = (currency || 'USD').toUpperCase();
  const rate = FX_RATE_TO_USD[code] ?? 1;
  return usdCents / 100 / rate;
}
