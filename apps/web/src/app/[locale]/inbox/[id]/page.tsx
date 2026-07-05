'use client';

import { use, useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ConversationListItem, MessageDto } from '@waos/shared';
import { Link } from '@/i18n/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { Badge, Button, ErrorBox, Spinner } from '@/components/ui';

interface MessagesResponse {
  messages: MessageDto[];
}

interface ConversationsResponse {
  conversations: ConversationListItem[];
}

interface TeamResponse {
  users: { id: string; name: string; role: string }[];
}

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

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('thread');
  const locale = useLocale();
  const [messages, setMessages] = useState<MessageDto[] | null>(null);
  const [conversation, setConversation] = useState<ConversationListItem | null>(null);
  const [team, setTeam] = useState<TeamResponse['users']>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [msgs, convs, users] = await Promise.all([
        apiFetch<MessagesResponse>(`/api/v1/conversations/${id}/messages`),
        apiFetch<ConversationsResponse>('/api/v1/conversations'),
        apiFetch<TeamResponse>('/api/v1/organization/users'),
      ]);
      setMessages(msgs.messages);
      setConversation(convs.conversations.find((c) => c.id === id) ?? null);
      setTeam(users.users);
      setError(null);
    } catch {
      setError(t('loadError'));
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }
    const refresh = (event: { conversationId?: string }): void => {
      if (!event.conversationId || event.conversationId === id) {
        void load();
      }
    };
    socket.on('message.new', refresh);
    socket.on('message.updated', refresh);
    socket.on('conversation.updated', refresh);
    return () => {
      socket.off('message.new', refresh);
      socket.off('message.updated', refresh);
      socket.off('conversation.updated', refresh);
    };
  }, [id, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

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
      await load();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('sendError'));
    } finally {
      setBusy(false);
    }
  };

  const setAi = async (aiEnabled: boolean): Promise<void> => {
    await apiFetch(`/api/v1/conversations/${id}/ai`, { method: 'POST', body: { aiEnabled } });
    await load();
  };

  const setStatus = async (status: ConversationListItem['status']): Promise<void> => {
    await apiFetch(`/api/v1/conversations/${id}/status`, { method: 'POST', body: { status } });
    await load();
  };

  const assign = async (assigneeId: string): Promise<void> => {
    await apiFetch(`/api/v1/conversations/${id}/assign`, {
      method: 'POST',
      body: { assigneeId: assigneeId === '' ? null : assigneeId },
    });
    await load();
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
    <div className="flex min-h-dvh flex-col bg-brand-50">
      <header className="sticky top-0 z-10 border-b border-brand-100 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link href="/inbox" aria-label={t('back')} className="text-xl text-brand-700">
            {'←'}
          </Link>
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
              {team.map((member) => (
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

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-2 px-4 py-4">
        {error ? (
          <ErrorBox message={error} onRetry={() => void load()} retryLabel={t('retry')} />
        ) : messages === null ? (
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
      </main>

      <footer className="sticky bottom-0 border-t border-brand-100 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {sendError ? (
            <p className="mb-2 text-xs text-red-700">{sendError}</p>
          ) : null}
          <form onSubmit={(e) => void send(e)} className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => { setDraft(e.target.value); }}
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
