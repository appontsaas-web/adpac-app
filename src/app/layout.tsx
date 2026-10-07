import type { Metadata } from 'next';
import { Noto_Sans_Arabic } from 'next/font/google';
import './globals.css';
import { getLocale } from '@/lib/i18n/server';
import { dirFor } from '@/lib/i18n/config';
import { LocaleProvider } from '@/lib/i18n/LocaleProvider';

export const metadata: Metadata = {
  title: 'AdPac — Google Ads AI Management',
  description: 'AI-assisted Google Ads management, phase 1.',
};

const arabicFont = Noto_Sans_Arabic({ subsets: ['arabic'], display: 'swap', variable: '--font-arabic' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  return (
    <html lang={locale} dir={dirFor(locale)} className={arabicFont.variable}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
