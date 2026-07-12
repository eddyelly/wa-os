'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { NotificationDto } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/shop-api';
import { getSocket } from '@/lib/socket';
import { Skeleton } from './ui';

/**
 * Where an item click lands. HANDOFF payloads carry a conversationId when
 * the handoff already has a thread; missing or malformed values fall back
 * to the inbox list rather than a broken link. Payload is untyped JSON, so
 * every field is narrowed before use.
 */
function targetPath(notification: NotificationDto): string {
  if (notification.type === 'NEW_ORDER') {
    return '/orders';
  }
  if (notification.type === 'LOW_STOCK') {
    return '/products';
  }
  const { conversationId } = notification.payload;
  return typeof conversationId === 'string' && conversationId.length > 0
    ? `/inbox/${conversationId}`
    : '/inbox';
}

/**
 * Header bell for realtime notifications (new orders, low stock, handoffs).
 * Renders for every organization, appointment-only or shop-enabled alike:
 * a HANDOFF can happen regardless of which modules are on.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationDto[] | null>(null);

  const refreshUnread = useCallback(async (): Promise<void> => {
    try {
      const unread = await listNotifications(true);
      setUnreadCount(unread.length);
    } catch {
      // The bell degrades to no badge rather than throwing into the shell.
    }
  }, []);

  const loadFull = useCallback(async (): Promise<void> => {
    try {
      const list = await listNotifications(false);
      setItems(list);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }
    const onNew = (): void => {
      void refreshUnread();
    };
    socket.on('notification.new', onNew);
    return () => {
      socket.off('notification.new', onNew);
    };
  }, [refreshUnread]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onOutsideClick = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutsideClick);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadFull();
  }, [open, loadFull]);

  const togglePanel = (): void => {
    setOpen((c) => !c);
  };

  const handleItemClick = (notification: NotificationDto): void => {
    void markNotificationRead(notification.id).then(refreshUnread);
    setOpen(false);
    router.push(targetPath(notification));
  };

  const handleMarkAllRead = async (): Promise<void> => {
    try {
      await markAllNotificationsRead();
    } finally {
      await Promise.all([refreshUnread(), loadFull()]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={togglePanel}
        aria-label={t('label')}
        className="relative rounded-lg p-2 text-brand-700 hover:bg-brand-100"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl bg-white shadow-lg ring-1 ring-brand-100">
          <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3">
            <span className="text-sm font-semibold text-brand-900">{t('label')}</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                {t('markAllRead')}
              </button>
            ) : null}
          </div>

          {items === null ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-semibold text-brand-900">{t('emptyTitle')}</p>
              <p className="mt-1 text-xs text-brand-600">{t('emptyHint')}</p>
            </div>
          ) : (
            <ul>
              {items.map((notification) => (
                <li key={notification.id} className="border-b border-brand-50 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      handleItemClick(notification);
                    }}
                    className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-brand-50"
                  >
                    <span className="flex items-center gap-2">
                      {notification.readAt === null ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-accent-500" aria-hidden />
                      ) : null}
                      <span className="truncate text-sm font-medium text-brand-900">
                        {t(`type${notification.type}`)}
                      </span>
                    </span>
                    <span className="text-xs text-brand-500">
                      {new Date(notification.createdAt).toLocaleTimeString(locale, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
