export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'adpac_locale';

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

export function dirFor(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** BCP-47 tag used for Intl formatting. "-u-nu-latn" forces Western digits 0-9 (confirmed Phase 0 decision). */
export function intlTag(locale: Locale): string {
  return locale === 'ar' ? 'ar-u-nu-latn' : 'en-US';
}
