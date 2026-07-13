'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { ConversationStatus } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { listConversations } from '@/lib/app-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { ConversationThread } from '@/components/conversation-thread';
import { Badge, EmptyState, ErrorBox, Input, Skeleton } from '@/components/ui';

type Filter = 'ALL' | 'PENDING' | 'OPEN' | 'CLOSED';

function initials(name: string | null, phone: string): string {
  if (name && name.trim().length > 0) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }
  return phone.slice(-2);
}

/** True on lg+ viewports, where the inbox shows the thread beside the list. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = (): void => {
      setIsDesktop(query.matches);
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);
  return isDesktop;
}

export default function InboxPage() {
  const t = useTranslations('inbox');
  const locale = useLocale();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data: items,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.conversations(filter),
    queryFn: () => listConversations(filter === 'ALL' ? undefined : filter),
  });

  const filters: { key: Filter; label: string }[] = [
    { key: 'ALL', label: t('filterAll') },
    { key: 'PENDING', label: t('filterNeedsAttention') },
    { key: 'OPEN', label: t('filterOpen') },
    { key: 'CLOSED', label: t('filterClosed') },
  ];

  const statusTone = (status: ConversationStatus): 'warning' | 'success' | 'neutral' =>
    status === 'PENDING' ? 'warning' : status === 'OPEN' ? 'success' : 'neutral';

  const needle = search.trim().toLowerCase();
  const visible =
    items === undefined
      ? null
      : needle.length === 0
        ? items
        : items.filter(
            (item) =>
              (item.contact.name ?? '').toLowerCase().includes(needle) ||
              item.contact.phone.toLowerCase().includes(needle),
          );

  const open = (id: string): void => {
    if (isDesktop) {
      setSelectedId(id);
    } else {
      router.push(`/inbox/${id}`);
    }
  };

  return (
    <AppShell wide>
      <div className="lg:grid lg:h-[calc(100dvh-11.5rem)] lg:grid-cols-[24rem_minmax(0,1fr)] lg:gap-4">
        <section className="flex min-h-0 flex-col lg:overflow-hidden">
          <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="mb-3"
          />
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
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

          <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
            {isError ? (
              <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
            ) : visible === null ? (
              <div className="space-y-2">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : visible.length === 0 ? (
              needle.length > 0 ? (
                <EmptyState title={t('noResultsTitle')} hint={t('noResultsHint')} />
              ) : (
                <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
              )
            ) : (
              <ul className="space-y-2">
                {visible.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => {
                        open(item.id);
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left shadow-sm transition-colors ${
                        selectedId === item.id
                          ? 'bg-brand-100'
                          : 'bg-white hover:bg-brand-50'
                      }`}
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-200 text-sm font-bold text-brand-900">
                        {initials(item.contact.name, item.contact.phone)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold text-brand-950">
                            {item.contact.name ?? item.contact.phone}
                          </span>
                          <span className="shrink-0 text-xs text-brand-500">
                            {item.lastMessageAt
                              ? new Date(item.lastMessageAt).toLocaleTimeString(locale, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : ''}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span className="truncate text-sm text-brand-600">
                            {item.lastMessagePreview ?? ''}
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={statusTone(item.status)}>{t(`status${item.status}`)}</Badge>
                        {item.aiEnabled ? <Badge tone="ai">{t('aiOn')}</Badge> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="hidden min-h-0 overflow-hidden rounded-2xl border border-brand-100 bg-brand-50 shadow-sm lg:block">
          {selectedId ? (
            <ConversationThread key={selectedId} conversationId={selectedId} embedded />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState title={t('selectTitle')} hint={t('selectHint')} />
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
