'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ConversationListItem, ConversationStatus } from '@waos/shared';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { AppShell } from '@/components/app-shell';
import { Badge, EmptyState, ErrorBox, Skeleton } from '@/components/ui';

type Filter = 'ALL' | 'PENDING' | 'OPEN' | 'CLOSED';

interface ConversationsResponse {
  conversations: ConversationListItem[];
}

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

export default function InboxPage() {
  const t = useTranslations('inbox');
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const query = filter === 'ALL' ? '' : `?status=${filter}`;
      const data = await apiFetch<ConversationsResponse>(`/api/v1/conversations${query}`);
      setItems(data.conversations);
      setError(null);
    } catch {
      setError(t('loadError'));
    }
  }, [filter, t]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }
    const refresh = (): void => {
      void load();
    };
    socket.on('message.new', refresh);
    socket.on('conversation.updated', refresh);
    return () => {
      socket.off('message.new', refresh);
      socket.off('conversation.updated', refresh);
    };
  }, [load]);

  const filters: { key: Filter; label: string }[] = [
    { key: 'ALL', label: t('filterAll') },
    { key: 'PENDING', label: t('filterNeedsAttention') },
    { key: 'OPEN', label: t('filterOpen') },
    { key: 'CLOSED', label: t('filterClosed') },
  ];

  const statusTone = (status: ConversationStatus): 'warning' | 'success' | 'neutral' =>
    status === 'PENDING' ? 'warning' : status === 'OPEN' ? 'success' : 'neutral';

  return (
    <AppShell>
      <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => { setFilter(f.key); }}
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

      {error ? (
        <ErrorBox message={error} onRetry={() => void load()} retryLabel={t('retry')} />
      ) : items === null ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/inbox/${item.id}`}
                className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition-colors hover:bg-brand-50"
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
