'use client';

import { createContext, useContext, useMemo } from 'react';
import type { Locale } from './config';
import { translate, type MessageKey } from './messages';
import { trString } from './arStrings';
import { formatMoney, formatNumber, formatPercent, formatDate, formatMonth } from './format';

interface Ctx {
  locale: Locale;
  /** Display currency for money on this screen (a client's own currency, or null = USD). */
  currency: string | null;
}

const LocaleContext = createContext<Ctx>({ locale: 'en', currency: null });

/** Wrap a tree to set locale (root layout) and/or override the display currency (per-client pages). */
export function LocaleProvider({
  locale,
  currency = null,
  children,
}: {
  locale: Locale;
  currency?: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, currency }), [locale, currency]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Client-component hook: const { t, money, num } = useI18n(). `money` takes USD cents. */
export function useI18n() {
  const { locale, currency } = useContext(LocaleContext);
  return useMemo(
    () => ({
      locale,
      currency,
      dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const),
      tr: (en: string, vars?: Record<string, string | number>) => trString(locale, en, vars),
      t: (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
      money: (usdCents: number) => formatMoney(usdCents, locale, currency),
      /** Always USD — for AdPac's own billing (invoices, tokens), which is priced in USD regardless of the client's display currency. */
      moneyUsd: (usdCents: number) => formatMoney(usdCents, locale, 'USD'),
      num: (n: number, maxFractionDigits = 0) => formatNumber(n, locale, maxFractionDigits),
      pct: (fraction: number, digits = 2) => formatPercent(fraction, locale, digits),
      date: (d: Date | string) => formatDate(d, locale),
      month: (d: Date | string, style: 'short' | 'long' = 'long') => formatMonth(d, locale, style),
    }),
    [locale, currency]
  );
}
