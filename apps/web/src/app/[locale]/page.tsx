import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations('home');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <nav aria-label={t('languageSwitcherLabel')} className="mb-8 flex gap-2">
        {routing.locales.map((availableLocale) => (
          <Link
            key={availableLocale}
            href="/"
            locale={availableLocale}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
              availableLocale === locale
                ? 'bg-brand-700 text-white'
                : 'bg-white text-brand-800 hover:bg-brand-100'
            }`}
          >
            {availableLocale === 'sw' ? 'Kiswahili' : 'English'}
          </Link>
        ))}
      </nav>

      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold tracking-wide text-brand-800 uppercase">
          {appName}
        </span>
        <h1 className="mt-4 text-3xl font-bold text-brand-900">{t('title')}</h1>
        <p className="mt-3 text-base leading-relaxed text-brand-800">{t('tagline')}</p>
        <p className="mt-6 rounded-lg bg-brand-50 p-4 text-sm text-brand-700">{t('comingSoon')}</p>
      </div>
    </main>
  );
}
