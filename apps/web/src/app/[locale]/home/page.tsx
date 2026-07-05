'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AppointmentDto } from '@waos/shared';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { EmptyState, ErrorBox, Skeleton } from '@/components/ui';

interface Summary {
  conversationsToday: number;
  pendingHandoffs: number;
  deflection: { replied: number; handedOff: number; percent: number | null };
  upcomingAppointments: AppointmentDto[];
}

export default function HomeDashboardPage() {
  const t = useTranslations('homeDash');
  const locale = useLocale();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await apiFetch<{ summary: Summary }>('/api/v1/dashboard');
      setSummary(data.summary);
      setError(null);
    } catch {
      setError(t('loadError'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <h1 className="mb-4 text-xl font-bold text-brand-900">{t('title')}</h1>
      {error ? (
        <ErrorBox message={error} onRetry={() => void load()} retryLabel={t('retry')} />
      ) : summary === null ? (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/inbox" className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-3xl font-bold text-brand-900">{summary.conversationsToday}</p>
              <p className="mt-1 text-xs text-brand-600">{t('conversationsToday')}</p>
            </Link>
            <Link href="/inbox" className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-3xl font-bold text-amber-600">{summary.pendingHandoffs}</p>
              <p className="mt-1 text-xs text-brand-600">{t('pendingHandoffs')}</p>
            </Link>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-3xl font-bold text-brand-900">
                {summary.deflection.percent === null ? '--' : `${summary.deflection.percent}%`}
              </p>
              <p className="mt-1 text-xs text-brand-600">{t('deflection')}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-3xl font-bold text-brand-900">
                {summary.deflection.replied + summary.deflection.handedOff}
              </p>
              <p className="mt-1 text-xs text-brand-600">{t('aiAnswersWeek')}</p>
            </div>
          </div>

          <h2 className="mt-6 mb-2 text-sm font-semibold text-brand-800">{t('upcoming')}</h2>
          {summary.upcomingAppointments.length === 0 ? (
            <EmptyState title={t('noUpcomingTitle')} hint={t('noUpcomingHint')} />
          ) : (
            <ul className="space-y-2">
              {summary.upcomingAppointments.map((appointment) => (
                <li key={appointment.id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="font-semibold text-brand-950">
                    {new Date(appointment.startsAt).toLocaleString(locale, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="text-sm text-brand-600">
                    {appointment.serviceName}, {appointment.contact.name ?? appointment.contact.phone}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}
