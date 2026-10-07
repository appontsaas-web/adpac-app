// ---------------------------------------------------------------------------
// Single FX table for the whole app. Used BOTH when platform money is
// converted to USD at sync time (Google Ads / Meta / Snapchat / TikTok) AND
// when USD is converted back to a client's display currency (lib/currency.ts).
// Using one table for both directions means a value converted SAR->USD at
// sync and USD->SAR for display round-trips exactly.
//
// Rates are "units of currency per 1 USD". Gulf currencies (and a few others)
// are officially pegged, so those are exact. The rest FLOAT: the numbers
// below are a snapshot (exchangerate-api.com, 6 Oct 2026). Rates are applied
// when data is synced, so changing a floating rate later only affects data
// synced afterwards — history is not restated. Refresh this table every few
// months, then re-sync (Backfill) any client whose account currency floats.
// ---------------------------------------------------------------------------

export const FX_UNITS_PER_USD: Record<string, number> = {
  USD: 1,
  // --- pegged ---
  SAR: 3.75,
  AED: 3.6725,
  QAR: 3.64,
  BHD: 0.376,
  OMR: 0.3845,
  JOD: 0.709,
  // --- Arab world, floating / managed ---
  KWD: 0.309205,
  EGP: 52.43,
  LBP: 89500,
  IQD: 1311.82,
  MAD: 9.97,
  TND: 3.004,
  DZD: 133.88,
  LYD: 6.4037,
  SDG: 453.81,
  YER: 236.59,
  // --- majors / others ---
  EUR: 0.892111,
  GBP: 0.756485,
  CHF: 0.831139,
  CAD: 1.425621,
  AUD: 1.435728,
  NZD: 1.78636,
  SEK: 10.040826,
  NOK: 9.593804,
  DKK: 6.670463,
  TRY: 49.164125,
  ILS: 3.051319,
  INR: 96.380408,
  PKR: 277.095194,
  BDT: 123.144869,
  CNY: 6.714466,
  HKD: 7.847095,
  SGD: 1.279827,
  MYR: 4.086922,
  IDR: 17892.58,
  PHP: 62.641606,
  THB: 33.69142,
  JPY: 157.982128,
  KRW: 1342.774629,
  ZAR: 16.647823,
  NGN: 1330.998026,
  KES: 129.752128,
  BRL: 5.017022,
  MXN: 18.106072,
  RUB: 85.174283,
  PLN: 3.907701,
  CZK: 21.808407,
};

/** Currencies shown without decimals (tiny unit value). */
export const ZERO_DECIMAL_CURRENCIES = new Set(['LBP', 'IQD', 'JPY', 'KRW', 'IDR', 'YER', 'SDG']);

export function isKnownCurrency(code: string | null | undefined): boolean {
  return !!code && code.toUpperCase() in FX_UNITS_PER_USD;
}

/** USD per 1 unit of `code`. Missing/unknown currency -> 1 with a warning (so it never silently mis-converts). */
export function fxRateToUsd(code: string | null | undefined, tag = 'fx'): number {
  if (!code) return 1;
  const units = FX_UNITS_PER_USD[code.toUpperCase()];
  if (units === undefined) {
    console.warn(`${tag}: no FX rate configured for currency "${code}" — treating as USD 1:1. Add it to FX_UNITS_PER_USD in lib/fx.ts.`);
    return 1;
  }
  return 1 / units;
}
