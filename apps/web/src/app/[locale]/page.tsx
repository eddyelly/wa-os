'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getTokens } from '@/lib/api';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Reveal } from '@/components/reveal';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

function Bubble({
  side,
  delay,
  ai,
  children,
}: {
  side: 'in' | 'out';
  delay: number;
  ai?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-pop-in max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug shadow-sm ${
        side === 'in'
          ? 'self-start rounded-bl-md bg-white text-brand-950'
          : 'self-end rounded-br-md bg-brand-100 text-brand-950'
      }`}
    >
      {ai ? (
        <span className="mb-0.5 block text-[9px] font-bold tracking-widest text-violet-700 uppercase">
          AI
        </span>
      ) : null}
      {children}
    </div>
  );
}

function PhoneDemo() {
  const t = useTranslations('landing.demo');
  // Replay the conversation every few seconds so the demo keeps living.
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setCycle((current) => current + 1);
    }, 11_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="animate-float mx-auto w-[290px] rounded-[2.4rem] border-[6px] border-brand-950/80 bg-brand-50 shadow-2xl lg:w-[330px]">
      <div className="flex items-center gap-2.5 rounded-t-[1.9rem] bg-brand-800 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-300 text-xs font-bold text-brand-900">
          NS
        </span>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold text-white">{t('businessName')}</p>
          <p className="text-[10px] text-brand-200">{t('online')}</p>
        </div>
      </div>
      <div key={cycle} className="flex min-h-[330px] flex-col gap-2 px-3 py-4">
        <Bubble side="in" delay={400}>
          {t('msg1')}
        </Bubble>
        <Bubble side="out" delay={1300} ai>
          {t('msg2')}
        </Bubble>
        <Bubble side="in" delay={2300}>
          {t('msg3')}
        </Bubble>
        <Bubble side="out" delay={3300} ai>
          {t('msg4')}
        </Bubble>
        <div
          className="animate-pop-in mt-1 flex items-center gap-1 self-end rounded-full bg-brand-100 px-3 py-2"
          style={{ animationDelay: '4200ms' }}
          aria-hidden
        >
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600" style={{ animationDelay: '150ms' }} />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

function FeatureIcon({ path }: { path: string }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-800">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </span>
  );
}

export default function LandingPage() {
  const t = useTranslations('landing');
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(Boolean(getTokens()));
  }, []);

  const primaryHref = authed ? '/inbox' : '/signup';
  const primaryLabel = authed ? t('openInbox') : t('ctaPrimary');

  const features = [
    { key: 'answers', icon: 'M8 10h8m-8 4h5m-8.7 6.3L3 21l1.3-3.9A8.96 8.96 0 0 1 3 12a9 9 0 1 1 9 9 8.96 8.96 0 0 1-4.7-1.3Z' },
    { key: 'bookings', icon: 'M8 3v3m8-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4' },
    { key: 'handoff', icon: 'M16 11a4 4 0 1 0-8 0m8 0a4 4 0 0 1-8 0m8 0h4m-12 0H4m8 4v6m-4-2.5L12 21l4-2.5' },
    { key: 'language', icon: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Zm1 -3h16M4 15h16M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18' },
  ] as const;

  const verticals = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const;
  const marqueeItems = [...verticals, ...verticals];

  return (
    <main className="bg-white">
      {/* Hero: fills the first viewport on any screen, marquee pinned at its foot */}
      <div className="animate-gradient-pan relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600">
        <div
          aria-hidden
          className="animate-float pointer-events-none absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-brand-400/25 blur-3xl"
        />
        <div
          aria-hidden
          className="animate-float pointer-events-none absolute top-1/3 -right-32 h-[30rem] w-[30rem] rounded-full bg-accent-400/15 blur-3xl"
          style={{ animationDelay: '2s', animationDuration: '9s' }}
        />
        <div
          aria-hidden
          className="animate-float pointer-events-none absolute -bottom-40 left-1/3 h-[26rem] w-[26rem] rounded-full bg-brand-300/15 blur-3xl"
          style={{ animationDelay: '4s', animationDuration: '11s' }}
        />

        <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
          <span className="text-xl font-extrabold tracking-tight text-white">
            {appName}
            <span className="text-accent-400">.</span>
          </span>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher tone="dark" />
            {authed ? null : (
              <Link
                href="/login"
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-white/90 hover:text-white"
              >
                {t('login')}
              </Link>
            )}
            <Link
              href={primaryHref}
              className="hidden rounded-full bg-accent-400 px-4 py-1.5 text-sm font-bold text-brand-950 shadow-md transition-transform hover:scale-105 sm:block"
            >
              {primaryLabel}
            </Link>
          </div>
        </header>

        <section className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-10 md:grid-cols-2 lg:gap-16">
          <div>
            <p className="animate-fade-up inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-accent-200" style={{ animationDelay: '0ms' }}>
              {t('kicker')}
            </p>
            <h1 className="animate-fade-up mt-4 text-4xl leading-tight font-extrabold text-white sm:text-5xl lg:text-6xl" style={{ animationDelay: '120ms' }}>
              {t('heroTitle1')}{' '}
              <span className="relative inline-block text-accent-400">
                {t('heroTitleAccent')}
                <span
                  aria-hidden
                  className="animate-underline absolute -bottom-1.5 left-0 h-1.5 w-full rounded-full bg-accent-400/50"
                />
              </span>{' '}
              {t('heroTitle2')}
            </h1>
            <p className="animate-fade-up mt-5 max-w-md text-base leading-relaxed text-brand-100 lg:max-w-lg lg:text-lg" style={{ animationDelay: '240ms' }}>
              {t('heroSubtitle')}
            </p>
            <div className="animate-fade-up mt-8 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: '360ms' }}>
              <Link
                href={primaryHref}
                className="animate-glow rounded-2xl bg-accent-400 px-7 py-3.5 text-center text-base font-bold text-brand-950 transition-transform hover:scale-[1.03]"
              >
                {primaryLabel}
              </Link>
              <a
                href="#how"
                className="rounded-2xl border border-white/25 bg-white/5 px-7 py-3.5 text-center text-base font-semibold text-white transition-colors hover:bg-white/10"
              >
                {t('ctaSecondary')}
              </a>
            </div>
            <p className="animate-fade-up mt-4 text-xs text-brand-200" style={{ animationDelay: '480ms' }}>
              {t('freeNote')}
            </p>
          </div>
          <div className="animate-fade-up" style={{ animationDelay: '300ms' }}>
            <PhoneDemo />
          </div>
        </section>

        <a
          href="#how"
          aria-label={t('ctaSecondary')}
          className="animate-bounce-soft relative mx-auto mb-4 hidden text-white/70 transition-colors hover:text-white md:block"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </a>

        {/* Verticals marquee pinned to the bottom edge of the hero */}
        <div className="relative border-t border-white/10 bg-brand-950/40 py-3 overflow-hidden">
          <div className="animate-marquee flex w-max items-center gap-8 whitespace-nowrap">
            {marqueeItems.map((key, index) => (
              <span key={`${key}-${index}`} className="flex items-center gap-8 text-sm font-medium text-brand-200">
                {t(`verticals.${key}`)}
                <span aria-hidden className="text-accent-400">
                  {'•'}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <Reveal>
          <h2 className="text-center text-2xl font-extrabold text-brand-950 sm:text-3xl">
            {t('featuresTitle')}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-sm text-brand-600">
            {t('featuresSubtitle')}
          </p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <Reveal key={feature.key} delay={index * 100}>
              <div className="h-full rounded-2xl border border-brand-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
                <FeatureIcon path={feature.icon} />
                <h3 className="mt-3 text-base font-bold text-brand-950">
                  {t(`features.${feature.key}.title`)}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-brand-600">
                  {t(`features.${feature.key}.body`)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-brand-50 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal>
            <h2 className="text-center text-2xl font-extrabold text-brand-950 sm:text-3xl">
              {t('howTitle')}
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {(['step1', 'step2', 'step3'] as const).map((step, index) => (
              <Reveal key={step} delay={index * 120}>
                <div className="relative h-full rounded-2xl bg-white p-5 shadow-sm">
                  <span className="absolute -top-3 left-5 flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white shadow-md">
                    {index + 1}
                  </span>
                  <h3 className="mt-3 text-base font-bold text-brand-950">{t(`how.${step}.title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-brand-600">{t(`how.${step}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <Reveal>
          <div className="grid grid-cols-2 gap-6 rounded-3xl bg-gradient-to-br from-brand-900 to-brand-700 p-8 text-center sm:grid-cols-4">
            {(['stat1', 'stat2', 'stat3', 'stat4'] as const).map((stat) => (
              <div key={stat}>
                <p className="text-3xl font-extrabold text-accent-400">{t(`stats.${stat}.value`)}</p>
                <p className="mt-1 text-xs font-medium text-brand-100">{t(`stats.${stat}.label`)}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <Reveal>
          <div className="rounded-3xl border border-brand-100 bg-brand-50 p-8 text-center sm:p-10">
            <h2 className="text-2xl font-extrabold text-brand-950 sm:text-3xl">{t('finalTitle')}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-brand-600">{t('finalSubtitle')}</p>
            <Link
              href={primaryHref}
              className="mt-6 inline-block rounded-2xl bg-brand-700 px-8 py-3.5 text-base font-bold text-white shadow-lg transition-transform hover:scale-[1.03]"
            >
              {primaryLabel}
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-brand-100 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 text-center">
          <span className="text-lg font-extrabold tracking-tight text-brand-900">
            {appName}
            <span className="text-accent-500">.</span>
          </span>
          <p className="max-w-md text-xs text-brand-500">{t('footerTagline')}</p>
        </div>
      </footer>
    </main>
  );
}
