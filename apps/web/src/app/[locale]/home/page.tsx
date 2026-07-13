'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { getStoredUser } from '@/lib/api';
import { getDashboardSummary } from '@/lib/app-api';
import { listOrders } from '@/lib/shop-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { EmptyState, ErrorBox, Skeleton, StatCard } from '@/components/ui';

export default function HomeDashboardPage() {
  const t = useTranslations('homeDash');
  const locale = useLocale();
  // Lazy synchronous init mirrors AppShell so modules are known on first
  // paint (no flash of the wrong KPI set).
  const [modules] = useState<string[]>(() => getStoredUser()?.organization.modules ?? ['appointments']);
  const hasShop = modules.includes('shop');
  const hasAppointments = modules.includes('appointments');

  const {
    data: summary,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: getDashboardSummary,
  });

  // Reuses the existing validated orders read and its query key; no new
  // contract. Fetched only for shop orgs.
  const pendingOrders = useQuery({
    queryKey: queryKeys.orders('PENDING_CONFIRMATION'),
    queryFn: () => listOrders({ status: 'PENDING_CONFIRMATION' }),
    enabled: hasShop,
  });

  const money = (value: number): string => `${value.toLocaleString(locale)} TZS`;

  return (
    <AppShell title={t('title')}>
      {isError ? (
        <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
      ) : isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: hasShop ? 8 : 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard tone="brand" label={t('conversationsToday')} value={String(summary.conversationsToday)} />
            <StatCard
              tone={summary.pendingHandoffs > 0 ? 'accent' : 'neutral'}
              label={t('pendingHandoffs')}
              value={String(summary.pendingHandoffs)}
            />
            <StatCard
              tone="brand"
              label={t('deflection')}
              value={summary.deflection.percent === null ? '--' : `${summary.deflection.percent}%`}
            />
            <StatCard
              tone="neutral"
              label={t('aiAnswersWeek')}
              value={String(summary.deflection.replied + summary.deflection.handedOff)}
            />
            {summary.sales ? (
              <>
                <StatCard tone="brand" label={t('ordersToday')} value={String(summary.sales.ordersToday)} />
                <StatCard tone="brand" label={t('revenueWeek')} value={money(summary.sales.revenueAgreedThisWeek)} />
                <StatCard
                  tone={summary.sales.pendingConfirmations > 0 ? 'accent' : 'neutral'}
                  label={t('pendingConfirmations')}
                  value={String(summary.sales.pendingConfirmations)}
                />
                <StatCard
                  tone={summary.sales.lowStockCount > 0 ? 'accent' : 'neutral'}
                  label={t('lowStock')}
                  value={String(summary.sales.lowStockCount)}
                />
              </>
            ) : null}
          </div>

          {hasShop ? (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-brand-800">{t('pendingOrders')}</h2>
              {pendingOrders.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : pendingOrders.isError ? (
                <ErrorBox
                  message={t('ordersError')}
                  onRetry={() => void pendingOrders.refetch()}
                  retryLabel={t('retry')}
                />
              ) : pendingOrders.data.length === 0 ? (
                <EmptyState title={t('noPendingOrdersTitle')} hint={t('noPendingOrdersHint')} />
              ) : (
                <ul className="space-y-2">
                  {pendingOrders.data.slice(0, 5).map((order) => (
                    <li key={order.id}>
                      <Link
                        href="/orders"
                        className="flex items-center justify-between rounded-2xl border border-brand-100 bg-white p-4 shadow-sm transition-colors hover:bg-brand-50"
                      >
                        <span className="font-semibold text-brand-950">
                          {order.contact.name ?? order.contact.phone}
                        </span>
                        <span className="text-sm font-medium text-brand-700">{money(order.totalAgreed)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {hasAppointments ? (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-brand-800">{t('upcoming')}</h2>
              {summary.upcomingAppointments.length === 0 ? (
                <EmptyState title={t('noUpcomingTitle')} hint={t('noUpcomingHint')} />
              ) : (
                <ul className="space-y-2">
                  {summary.upcomingAppointments.map((appointment) => (
                    <li
                      key={appointment.id}
                      className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm"
                    >
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
            </section>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
