'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getTokens } from '@/lib/api';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Reveal } from '@/components/reveal';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

function TypingBubble({ delay }: { delay: number }) {
  return (
    <div
      aria-hidden
      style={{ animationDelay: `${delay}ms` }}
      className="animate-fade-in-out flex w-fit items-center gap-1 self-end rounded-2xl rounded-br-md bg-brand-100 px-3.5 py-2.5 shadow-sm [grid-area:1/1]"
    >
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600" style={{ animationDelay: '150ms' }} />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function Bubble({
  side,
  delay,
  ai,
  stacked,
  children,
}: {
  side: 'in' | 'out';
  delay: number;
  ai?: boolean;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-pop-in max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug shadow-sm ${
        side === 'in'
          ? 'self-start rounded-bl-md bg-white text-brand-950'
          : 'self-end rounded-br-md bg-brand-100 text-brand-950'
      } ${stacked ? 'w-fit justify-self-end [grid-area:1/1]' : ''}`}
    >
      {ai ? (
        <span className="mb-0.5 block text-[9px] font-bold tracking-widest text-violet-700 uppercase">
          AI
        </span>
      ) : null}
      {children}
      {side === 'out' ? (
        <span className="mt-0.5 flex justify-end text-[9px] text-sky-600" aria-hidden>
          {'✓✓'}
        </span>
      ) : null}
    </div>
  );
}

/** Typing dots dissolve exactly where the AI reply then pops in. */
function AiTurn({ typingDelay, replyDelay, children }: { typingDelay: number; replyDelay: number; children: ReactNode }) {
  return (
    <div className="grid">
      <TypingBubble delay={typingDelay} />
      <Bubble side="out" delay={replyDelay} ai stacked>
        {children}
      </Bubble>
    </div>
  );
}

/** An inbound "photo" message: a stylized product thumbnail (inline SVG, no
 *  network asset) above a short caption, shown inside an inbound bubble. */
function PhotoMessage({ caption }: { caption: string }) {
  return (
    <div className="w-40">
      <div
        aria-hidden
        className="mb-1 flex aspect-square w-full items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-brand-100"
      >
        <svg viewBox="0 0 64 64" className="h-3/4 w-3/4" aria-hidden>
          <rect x="16" y="7" width="32" height="8" rx="2" className="fill-amber-300" />
          <rect x="12" y="15" width="40" height="42" rx="7" className="fill-amber-200" />
          <rect x="21" y="29" width="22" height="16" rx="3" className="fill-white/80" />
        </svg>
      </div>
      <span>{caption}</span>
    </div>
  );
}

/** The selling scene's closing chip: mirrors the booking chip's treatment,
 *  in the amber accent, with an order/bag icon and a done badge. */
function OrderChip({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="animate-pop-in mx-auto mt-1.5 flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 shadow-sm"
      style={{ animationDelay: '7400ms' }}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0" />
        </svg>
      </span>
      <div className="leading-tight">
        <p className="text-[11px] font-bold text-brand-950">{title}</p>
        <p className="text-[10px] text-brand-600">{body}</p>
      </div>
      <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700" aria-hidden>
        {'✓'}
      </span>
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
    }, 13_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="relative mx-auto w-[300px] rounded-[3rem] border border-white/20 bg-brand-950 p-2 shadow-2xl lg:w-[340px]">
      {/* Notch */}
      <div className="absolute top-4 left-1/2 z-10 h-6 w-28 -translate-x-1/2 rounded-full bg-brand-950" aria-hidden />
      <div className="overflow-hidden rounded-[2.5rem] bg-brand-50">
        {/* Status bar + chat header */}
        <div className="bg-brand-800 px-5 pt-3 pb-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold text-white/90">
            <span>9:41</span>
            <span className="flex items-center gap-1" aria-hidden>
              <svg viewBox="0 0 16 12" className="h-2.5 w-3.5 fill-current">
                <rect x="0" y="8" width="3" height="4" rx="0.5" />
                <rect x="4.5" y="5" width="3" height="7" rx="0.5" />
                <rect x="9" y="2" width="3" height="10" rx="0.5" />
              </svg>
              <svg viewBox="0 0 24 12" className="h-3 w-6" aria-hidden>
                <rect x="0.5" y="0.5" width="19" height="11" rx="3" fill="none" stroke="currentColor" />
                <rect x="2.5" y="2.5" width="13" height="7" rx="1.5" fill="currentColor" />
                <rect x="21" y="4" width="2.5" height="4" rx="1" fill="currentColor" />
              </svg>
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-300 text-xs font-bold text-brand-900">
              NS
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-semibold text-white">{t('businessName')}</p>
              <p className="text-[10px] text-brand-200">{t('online')}</p>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4.5 w-4.5 text-white/80" aria-hidden>
              <path strokeLinecap="round" d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c1 .3 2 .5 3 .6a2 2 0 0 1 1.6 2Z" />
            </svg>
          </div>
        </div>

        {/* Conversation */}
        <div key={cycle} className="flex min-h-[350px] flex-col gap-2 px-3 py-4">
          {cycle % 2 === 1 ? (
            <>
              <Bubble side="in" delay={500}>
                <PhotoMessage caption={t('sellMsg1')} />
              </Bubble>
              <AiTurn typingDelay={1200} replyDelay={2550}>
                {t('sellMsg2')}
              </AiTurn>
              <Bubble side="in" delay={4000}>
                {t('sellMsg3')}
              </Bubble>
              <AiTurn typingDelay={4800} replyDelay={6150}>
                {t('sellMsg4')}
              </AiTurn>
              <OrderChip title={t('orderChipTitle')} body={t('orderChipBody')} />
            </>
          ) : (
            <>
              <Bubble side="in" delay={500}>
                {t('msg1')}
              </Bubble>
              <AiTurn typingDelay={1200} replyDelay={2550}>
                {t('msg2')}
              </AiTurn>
              <Bubble side="in" delay={4000}>
                {t('msg3')}
              </Bubble>
              <AiTurn typingDelay={4800} replyDelay={6150}>
                {t('msg4')}
              </AiTurn>
              <div
                className="animate-pop-in mx-auto mt-1.5 flex items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 shadow-sm"
                style={{ animationDelay: '7400ms' }}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-brand-800">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v3m8-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
                  </svg>
                </span>
                <div className="leading-tight">
                  <p className="text-[11px] font-bold text-brand-950">{t('bookingChipTitle')}</p>
                  <p className="text-[10px] text-brand-600">{t('bookingChipBody')}</p>
                </div>
                <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700" aria-hidden>
                  {'✓'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Composer */}
        <div className="flex items-center gap-2 border-t border-brand-100 bg-white px-3 py-2.5">
          <span className="flex-1 rounded-full bg-brand-50 px-4 py-2 text-[12px] text-brand-400">
            {t('inputPlaceholder')}
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-white" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 14-7-4 7 4 7-14-7Z" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

function FloatingCard({
  className = '',
  popDelay,
  floatDuration,
  children,
}: {
  className?: string;
  popDelay: number;
  floatDuration: string;
  children: ReactNode;
}) {
  return (
    <div style={{ animationDelay: `${popDelay}ms` }} className={`animate-pop-in absolute ${className}`}>
      <div
        className="animate-float flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-xl"
        style={{ animationDuration: floatDuration, animationDelay: `${popDelay}ms` }}
      >
        {children}
      </div>
    </div>
  );
}

function CardIcon({ path, tone }: { path: string; tone: 'green' | 'amber' | 'violet' }) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    violet: 'bg-violet-100 text-violet-700',
  }[tone];
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tones}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </span>
  );
}

/** The phone plus the floating feature cards orbiting it. */
function HeroShowcase() {
  const t = useTranslations('landing.cards');
  return (
    <div className="relative mx-auto w-fit">
      <PhoneDemo />
      <FloatingCard
        popDelay={1200}
        floatDuration="7s"
        className="top-16 -right-6 hidden max-w-56 md:block xl:-right-28"
      >
        <CardIcon tone="green" path="M8 3v3m8-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4" />
        <div className="leading-tight">
          <p className="text-[13px] font-bold text-brand-950">{t('booking.title')}</p>
          <p className="mt-0.5 text-[11px] text-brand-600">{t('booking.body')}</p>
        </div>
      </FloatingCard>
      <FloatingCard
        popDelay={2000}
        floatDuration="9s"
        className="bottom-24 -left-6 hidden max-w-56 md:block xl:-left-24"
      >
        <CardIcon tone="amber" path="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
        <div className="leading-tight">
          <p className="text-[13px] font-bold text-brand-950">{t('reminder.title')}</p>
          <p className="mt-0.5 text-[11px] text-brand-600">{t('reminder.body')}</p>
        </div>
      </FloatingCard>
      <FloatingCard
        popDelay={2800}
        floatDuration="8s"
        className="-top-7 -left-4 hidden max-w-56 lg:block xl:-left-24"
      >
        <CardIcon tone="violet" path="M12 3a7 7 0 0 1 7 7v1.5a3.5 3.5 0 0 1-7 0V10a2 2 0 1 0-4 0v6a7 7 0 0 0 11 5.7M5 10v1.5a3.5 3.5 0 0 0 .8 2.2" />
        <div className="leading-tight">
          <p className="text-[13px] font-bold text-brand-950">{t('ai.title')}</p>
          <p className="mt-0.5 text-[11px] text-brand-600">{t('ai.body')}</p>
        </div>
        <span className="relative ml-1 inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-brand-600" aria-hidden>
          <span className="absolute right-0.5 h-5 w-5 rounded-full bg-white shadow" />
        </span>
      </FloatingCard>
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
  // One half must always be wider than the viewport so the loop never shows
  // a gap, even on very wide monitors. The track renders two halves.
  const marqueeHalf = Array.from({ length: 4 }, () => verticals).flat();
  const marqueeItems = [...marqueeHalf, ...marqueeHalf];

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
            <HeroShowcase />
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
        <div className="relative border-t border-white/10 bg-brand-950/40 py-4 overflow-hidden lg:py-5">
          <div className="animate-marquee flex w-max items-center gap-10 whitespace-nowrap">
            {marqueeItems.map((key, index) => (
              <span
                key={`${key}-${index}`}
                className="flex items-center gap-10 text-base font-semibold tracking-wide text-brand-100 lg:text-lg"
              >
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
