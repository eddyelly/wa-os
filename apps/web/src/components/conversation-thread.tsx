'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationListItem, MessageDto } from '@waos/shared';
import { Link } from '@/i18n/navigation';
import { apiFetch, ApiError, getStoredUser } from '@/lib/api';
import { listConversations, listMessages, listTeam } from '@/lib/app-api';
import { listOrders } from '@/lib/shop-api';
import { queryKeys } from '@/lib/query-keys';
import { Badge, Button, ErrorBox, Spinner } from '@/components/ui-legacy';

function tickmarks(status: MessageDto['status']): string {
  switch (status) {
    case 'READ':
    case 'DELIVERED':
      return '✓✓';
    case 'SENT':
      return '✓';
    case 'QUEUED':
      return '⏱';
    default:
      return '';
  }
}

/**
 * The full conversation view: header with agent controls, message list, and
 * composer. Renders standalone (own full-height screen, back link) or
 * embedded as the right pane of the two-pane inbox.
 */
export function ConversationThread({
  conversationId,
  embedded = false,
}: {
  conversationId: string;
  embedded?: boolean;
}) {
  const id = conversationId;
  const t = useTranslations('thread');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const shopOrg = (getStoredUser()?.organization.modules ?? []).includes('shop');
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const {
    data: messages,
    isPending: messagesPending,
    isError: messagesHasError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: queryKeys.messages(id),
    queryFn: () => listMessages(id),
  });

  const {
    data: conversations,
    isPending: conversationsPending,
    isError: conversationsHasError,
    refetch: refetchConversations,
  } = useQuery({
    queryKey: queryKeys.conversations('ALL'),
    queryFn: () => listConversations(),
  });

  const {
    data: team,
    isPending: teamPending,
    isError: teamHasError,
    refetch: refetchTeam,
  } = useQuery({
    queryKey: queryKeys.team,
    queryFn: listTeam,
  });

  // Combined so the header, message list, and team select flip from loading
  // to loaded in one render, matching the pre-migration Promise.all: nothing
  // here populates until messages, conversations, and team have all resolved.
  const isPending = messagesPending || conversationsPending || teamPending;
  const isError = messagesHasError || conversationsHasError || teamHasError;
  const conversation =
    !isPending && !isError ? (conversations.find((c) => c.id === id) ?? null) : null;

  const retryThread = (): void => {
    void refetchMessages();
    void refetchConversations();
    void refetchTeam();
  };

  const contactId = conversation?.contact.id;
  const { data: orders } = useQuery({
    queryKey: queryKeys.orders('ALL', contactId),
    queryFn: () => listOrders({ contactId }),
    enabled: shopOrg && !!contactId,
  });
  const orderCount = orders?.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const invalidateThread = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.messagesRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationsRoot }),
    ]);
  };

  const send = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    if (draft.trim().length === 0) {
      return;
    }
    setBusy(true);
    setSendError(null);
    try {
      await apiFetch(`/api/v1/conversations/${id}/messages`, {
        method: 'POST',
        body: { body: draft.trim() },
      });
      setDraft('');
      await invalidateThread();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('sendError'));
    } finally {
      setBusy(false);
    }
  };

  const setAi = async (aiEnabled: boolean): Promise<void> => {
    await apiFetch(`/api/v1/conversations/${id}/ai`, { method: 'POST', body: { aiEnabled } });
    await invalidateThread();
  };

  const setStatus = async (status: ConversationListItem['status']): Promise<void> => {
    await apiFetch(`/api/v1/conversations/${id}/status`, { method: 'POST', body: { status } });
    await invalidateThread();
  };

  const assign = async (assigneeId: string): Promise<void> => {
    await apiFetch(`/api/v1/conversations/${id}/assign`, {
      method: 'POST',
      body: { assigneeId: assigneeId === '' ? null : assigneeId },
    });
    await invalidateThread();
  };

  const optIn = async (): Promise<void> => {
    if (!conversation) {
      return;
    }
    await apiFetch(`/api/v1/contacts/${conversation.contact.id}/opt-in`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversationsRoot });
  };

  const bubbleFor = (message: MessageDto): string => {
    if (message.direction === 'IN') {
      return 'self-start bg-white text-brand-950';
    }
    if (message.authorType === 'AI') {
      return 'self-end bg-violet-50 text-brand-950 border border-violet-200';
    }
    return 'self-end bg-brand-100 text-brand-950';
  };

  return (
    <div
      className={
        embedded ? 'flex h-full min-h-0 flex-col bg-brand-50' : 'flex h-dvh flex-col bg-brand-50'
      }
    >
      <header className="z-10 border-b border-brand-100 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {embedded ? null : (
            <Link href="/inbox" aria-label={t('back')} className="text-xl text-brand-700">
              {'←'}
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-brand-950">
              {conversation?.contact.name ?? conversation?.contact.phone ?? ''}
            </p>
            <p className="truncate text-xs text-brand-500">{conversation?.contact.phone}</p>
          </div>
          {conversation ? (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-brand-700">
                <input
                  type="checkbox"
                  checked={conversation.aiEnabled}
                  onChange={(e) => void setAi(e.target.checked)}
                  className="h-4 w-4 accent-brand-700"
                />
                {t('aiToggle')}
              </label>
            </div>
          ) : null}
        </div>
        {conversation ? (
          <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-2">
            <Badge
              tone={
                conversation.status === 'PENDING'
                  ? 'warning'
                  : conversation.status === 'OPEN'
                    ? 'success'
                    : 'neutral'
              }
            >
              {t(`status${conversation.status}`)}
            </Badge>
            <select
              value={conversation.assigneeId ?? ''}
              onChange={(e) => void assign(e.target.value)}
              className="rounded-lg border border-brand-200 bg-white px-2 py-1 text-xs text-brand-800"
              aria-label={t('assignLabel')}
            >
              <option value="">{t('unassigned')}</option>
              {(team ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            {conversation.status !== 'CLOSED' ? (
              <button
                onClick={() => void setStatus('CLOSED')}
                className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
              >
                {t('closeConversation')}
              </button>
            ) : (
              <button
                onClick={() => void setStatus('OPEN')}
                className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
              >
                {t('reopenConversation')}
              </button>
            )}
            {conversation.contact.optedInAt === null ? (
              <button
                onClick={() => void optIn()}
                className="rounded-lg bg-brand-100 px-2 py-1 text-xs font-semibold text-brand-900 hover:bg-brand-200"
              >
                {t('optIn')}
              </button>
            ) : null}
            <Link
              href={`/appointments?contactId=${conversation.contact.id}`}
              className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 underline underline-offset-2 hover:bg-brand-100"
            >
              {t('bookAppointment')}
            </Link>
            {orderCount > 0 ? (
              <Link
                href="/orders"
                className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 underline underline-offset-2 hover:bg-brand-100"
              >
                {t('ordersChip', { count: orderCount })}
              </Link>
            ) : null}
            {conversation.status === 'PENDING' ? (
              <button
                onClick={() => {
                  void setAi(false).then(() => setStatus('OPEN'));
                }}
                className="rounded-lg bg-accent-500 px-2 py-1 text-xs font-semibold text-white hover:bg-accent-600"
              >
                {t('takeOver')}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4">
          {isError ? (
            <ErrorBox message={t('loadError')} onRetry={retryThread} retryLabel={t('retry')} />
          ) : isPending ? (
            <Spinner label={t('loading')} />
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-brand-600">{t('emptyThread')}</p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex max-w-[85%] flex-col rounded-2xl px-4 py-2.5 shadow-sm ${bubbleFor(message)}`}
              >
                {message.authorType === 'AI' ? (
                  <span className="mb-0.5 text-[10px] font-bold tracking-wide text-violet-700 uppercase">
                    {t('aiBadge')}
                  </span>
                ) : null}
                {message.mediaUrl ? (
                  message.type === 'IMAGE' ? (
                    <img
                      src={message.mediaUrl}
                      alt={t('mediaAlt')}
                      className="mb-1 max-h-64 rounded-lg"
                    />
                  ) : (
                    <a
                      href={message.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-1 text-sm font-medium text-brand-700 underline"
                    >
                      {t('downloadMedia')}
                    </a>
                  )
                ) : null}
                {message.body ? (
                  <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                ) : null}
                <span className="mt-1 self-end text-[10px] text-brand-500">
                  {new Date(message.createdAt).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {message.direction === 'OUT' ? ` ${tickmarks(message.status)}` : ''}
                  {message.status === 'BLOCKED' ? ` ${t('blocked')}` : ''}
                  {message.status === 'FAILED' ? ` ${t('failed')}` : ''}
                </span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="border-t border-brand-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {sendError ? <p className="mb-2 text-xs text-red-700">{sendError}</p> : null}
          <form onSubmit={(e) => void send(e)} className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              placeholder={t('composerPlaceholder')}
              rows={1}
              className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-brand-200 bg-white px-4 py-2.5 text-base"
            />
            <Button type="submit" disabled={busy || draft.trim().length === 0}>
              {t('send')}
            </Button>
          </form>
        </div>
      </footer>
    </div>
  );
}
