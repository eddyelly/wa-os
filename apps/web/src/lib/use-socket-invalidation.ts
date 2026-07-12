'use client';

import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from './query-keys';
import { getSocket } from './socket';

/**
 * Bridges realtime socket events into TanStack Query cache invalidation so
 * open screens refresh without each one wiring its own socket listener.
 * `channel.status_changed` is intentionally excluded: the connect page owns
 * that state itself.
 */
export function useSocketInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }

    const invalidate =
      (...keys: QueryKey[]) =>
      (): void => {
        for (const key of keys) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      };

    const handlers: Record<string, () => void> = {
      'message.new': invalidate(
        queryKeys.messagesRoot,
        queryKeys.conversationsRoot,
        queryKeys.dashboard,
      ),
      'message.updated': invalidate(
        queryKeys.messagesRoot,
        queryKeys.conversationsRoot,
        queryKeys.dashboard,
      ),
      'conversation.updated': invalidate(
        queryKeys.messagesRoot,
        queryKeys.conversationsRoot,
        queryKeys.dashboard,
      ),
      'notification.new': invalidate(
        queryKeys.notificationsRoot,
        queryKeys.ordersRoot,
        queryKeys.productsRoot,
        queryKeys.dashboard,
      ),
    };

    for (const [event, handler] of Object.entries(handlers)) {
      socket.on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        socket.off(event, handler);
      }
    };
  }, [queryClient]);
}
