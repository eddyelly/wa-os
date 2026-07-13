import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { routing } from '@/i18n/routing';
import '../globals.css';

// Inter is self-hosted (src/fonts) rather than fetched from Google Fonts, so
// builds never depend on network reachability. One variable file covers all
// weights from 100 to 900.
const inter = localFont({
  src: '../../fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

export const metadata: Metadata = {
  title: appName,
  description: 'AI answers your customers, books appointments, and sends reminders.',
};

export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen bg-brand-50 font-sans text-brand-950 antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
