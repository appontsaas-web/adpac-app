import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './config';
import { translate, type MessageKey } from './messages';

/** Current UI locale from the adpac_locale cookie (works for login/portal too, where there's no staff session). */
export function getLocale(): Locale {
  const v = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Server-component translator: const t = getT(); t('common.clients'). */
export function getT(locale: Locale = getLocale()) {
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
