'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const LOCALE_LABELS: Record<string, string> = { sw: 'SW', en: 'EN' };

/**
 * Compact pill toggle between Swahili and English. Keeps the current page,
 * only the locale segment changes.
 */
export function LanguageSwitcher({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const shell =
    tone === 'dark' ? 'border-white/25 bg-white/10' : 'border-brand-200 bg-brand-50';

  return (
    <div
      role="group"
      aria-label={t('languageSwitcherLabel')}
      className={`flex items-center rounded-full border p-0.5 ${shell}`}
    >
      {routing.locales.map((availableLocale) => {
        const active = availableLocale === locale;
        const activeStyle =
          tone === 'dark' ? 'bg-white text-brand-900' : 'bg-brand-700 text-white';
        const idleStyle =
          tone === 'dark'
            ? 'text-white/80 hover:text-white'
            : 'text-brand-600 hover:text-brand-900';
        return (
          <button
            key={availableLocale}
            onClick={() => {
              router.replace(pathname, { locale: availableLocale });
            }}
            aria-pressed={active}
            className={`rounded-full px-2.5 py-1 text-xs font-bold tracking-wide transition-colors ${
              active ? activeStyle : idleStyle
            }`}
          >
            {LOCALE_LABELS[availableLocale] ?? availableLocale}
          </button>
        );
      })}
    </div>
  );
}
