'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderDto, OrderStatus } from '@waos/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, getStoredUser } from '@/lib/api';
import { listOrders, setOrderStatus } from '@/lib/shop-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { Badge, EmptyState, ErrorBox, Skeleton } from '@/components/ui';

type Filter = 'ALL' | OrderStatus;

/** Mirrors the backend's legal order state machine (order-service.ts). */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PAID', 'FULFILLED', 'CANCELLED'],
  PAID: ['FULFILLED', 'CANCELLED'],
  FULFILLED: [],
  CANCELLED: [],
};

/** Translation key for the button that moves an order into this status. */
const ACTION_LABEL_KEY: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: '',
  CONFIRMED: 'confirm',
  PAID: 'markPaid',
  FULFILLED: 'fulfil',
  CANCELLED: 'cancel',
};

function statusTone(status: OrderStatus): 'warning' | 'success' | 'neutral' {
  if (status === 'PENDING_CONFIRMATION') {
    return 'warning';
  }
  if (status === 'CANCELLED') {
    return 'neutral';
  }
  return 'success';
}

function shortId(id: string): string {
  return `#${id.slice(-6)}`;
}

export default function OrdersPage() {
  const t = useTranslations('orders');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const shopOrg = (getStoredUser()?.organization.modules ?? []).includes('shop');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    data: orders,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.orders(filter),
    queryFn: () => listOrders(filter === 'ALL' ? undefined : { status: filter }),
  });

  useEffect(() => {
    if (!shopOrg) {
      router.replace('/home');
    }
  }, [router, shopOrg]);

  if (!shopOrg) {
    return null;
  }

  const transition = async (order: OrderDto, status: OrderStatus): Promise<void> => {
    if (status === 'CANCELLED' && !window.confirm(t('cancelConfirm'))) {
      return;
    }
    setActionError(null);
    setBusyId(order.id);
    try {
      await setOrderStatus(order.id, status);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('loadError'));
    } finally {
      setBusyId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ordersRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot }),
      ]);
    }
  };

  const filters: { key: Filter; label: string }[] = [
    { key: 'ALL', label: t('filterAll') },
    { key: 'PENDING_CONFIRMATION', label: t('statusPENDING_CONFIRMATION') },
    { key: 'CONFIRMED', label: t('statusCONFIRMED') },
    { key: 'PAID', label: t('statusPAID') },
    { key: 'FULFILLED', label: t('statusFULFILLED') },
    { key: 'CANCELLED', label: t('statusCANCELLED') },
  ];

  return (
    <AppShell>
      <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFilter(f.key);
            }}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-brand-700 text-white'
                : 'bg-white text-brand-700 hover:bg-brand-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isError ? (
        <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
      ) : orders === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <>
          {actionError ? (
            <div className="mb-3">
              <ErrorBox message={actionError} />
            </div>
          ) : null}
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-brand-500">{shortId(order.id)}</span>
                  <Badge tone={statusTone(order.status)}>{t(`status${order.status}`)}</Badge>
                </div>
                <p className="mt-1 truncate font-semibold text-brand-950">
                  {order.contact.name ?? order.contact.phone}
                </p>

                <ul className="mt-2 space-y-1">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-brand-800">
                        {item.quantity} x {item.productName}
                      </span>
                      <span className="shrink-0 font-medium text-brand-900">
                        {item.agreedPrice.toLocaleString(locale)} TZS
                      </span>
                      {item.listPrice !== item.agreedPrice ? (
                        <span className="shrink-0 text-xs text-brand-400 line-through">
                          {item.listPrice.toLocaleString(locale)} TZS
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <p className="mt-2 font-bold text-brand-950">
                  {t('total')}: {order.totalAgreed.toLocaleString(locale)} TZS
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-brand-500">
                    {new Date(order.createdAt).toLocaleString(locale)}
                  </span>
                  {order.conversationId ? (
                    <Link
                      href={`/inbox/${order.conversationId}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      {t('viewChat')}
                    </Link>
                  ) : null}
                </div>

                {TRANSITIONS[order.status].length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {TRANSITIONS[order.status].map((target) => (
                      <button
                        key={target}
                        disabled={busyId === order.id}
                        onClick={() => void transition(order, target)}
                        className={
                          target === 'CANCELLED'
                            ? 'rounded-lg bg-transparent px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50'
                            : 'rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200 disabled:opacity-50'
                        }
                      >
                        {t(ACTION_LABEL_KEY[target])}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}
