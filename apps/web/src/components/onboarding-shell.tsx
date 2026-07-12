'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from './language-switcher';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

function StepCircle({ state, index }: { state: 'done' | 'current' | 'todo'; index: number }) {
  if (state === 'done') {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-400 text-sm font-bold text-brand-950 shadow-sm">
        {'✓'}
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-brand-900 shadow-md ring-4 ring-white/30">
        {index + 1}
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white/70">
      {index + 1}
    </span>
  );
}

/**
 * The signature onboarding frame: deep green gradient, wordmark, language
 * switcher, and a labeled progress trail. Pass `step` as an index into the
 * rendered labels array on wizard screens; omit it for login and signup.
 * The trail is four steps normally, or five when `includeProducts` is set
 * (shop-module orgs get an extra "Products" step between connect and info).
 */
export function OnboardingShell({
  step,
  includeProducts = false,
  wide = false,
  children,
}: {
  step?: number;
  includeProducts?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('wizard');
  const steps = [
    t('stepProfile'),
    t('stepConnect'),
    ...(includeProducts ? [t('stepProducts')] : []),
    t('stepKnowledge'),
    t('stepTest'),
  ];

  return (
    <main className="relative min-h-dvh overflow-hidden bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600 px-4 py-6 sm:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -left-28 h-80 w-80 rounded-full bg-brand-400/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-accent-400/15 blur-3xl"
      />
      <div
        className={`relative mx-auto flex w-full flex-col ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <header className="mb-6 flex items-center justify-between">
          <span className="text-xl font-extrabold tracking-tight text-white">
            {appName}
            <span className="text-accent-400">.</span>
          </span>
          <LanguageSwitcher tone="dark" />
        </header>

        {typeof step === 'number' ? (
          <ol className="mb-6 flex items-start" aria-label={t('progressLabel')}>
            {steps.map((label, index) => {
              const state = index < step ? 'done' : index === step ? 'current' : 'todo';
              return (
                <li
                  key={label}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className="flex flex-1 items-start last:flex-none"
                >
                  <div className="flex flex-col items-center gap-1.5">
                    <StepCircle state={state} index={index} />
                    <span
                      className={`text-[11px] leading-none ${
                        state === 'current'
                          ? 'font-bold text-white'
                          : state === 'done'
                            ? 'font-medium text-accent-200'
                            : 'text-white/60'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                  {index < steps.length - 1 ? (
                    <span
                      aria-hidden
                      className={`mx-2 mt-4 h-1 flex-1 rounded-full ${
                        index < step ? 'bg-accent-400' : 'bg-white/20'
                      }`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}

        <div className="animate-fade-up">{children}</div>
      </div>
    </main>
  );
}
