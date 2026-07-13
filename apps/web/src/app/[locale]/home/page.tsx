'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getDashboardSummary } from '@/lib/app-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { EmptyState, ErrorBox, Skeleton } from '@/components/ui';

export default function HomeDashboardPage() {
  const t = useTranslations('homeDash');
  const locale = useLocale();
  const {
    data: summary,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: getDashboardSummary,
  });

  return (
    <AppShell>
      <h1 className="mb-4 text-xl font-bold text-brand-900">{t('title')}</h1>
      {isError ? (
        <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
      ) : isPending ? (
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
