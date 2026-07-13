'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactDto } from '@waos/shared';
import { apiFetch } from '@/lib/api';
import { listContacts } from '@/lib/app-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Skeleton } from '@/components/ui-legacy';

export default function ContactsPage() {
  const t = useTranslations('contacts');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editLanguage, setEditLanguage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [search]);

  const {
    data: items,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.contacts(debouncedSearch),
    queryFn: () => listContacts(debouncedSearch),
  });

  const startEdit = (contact: ContactDto): void => {
    setEditing(contact);
    setEditName(contact.name ?? '');
    setEditTags(contact.tags.join(', '));
    setEditLanguage(contact.language ?? '');
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/v1/contacts/${editing.id}`, {
        method: 'PATCH',
        body: {
          name: editName.trim().length > 0 ? editName.trim() : null,
          language: editLanguage === '' ? null : editLanguage,
          tags: editTags
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0),
        },
      });
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.contactsRoot });
    } finally {
      setBusy(false);
    }
  };

  const optIn = async (id: string): Promise<void> => {
    await apiFetch(`/api/v1/contacts/${id}/opt-in`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: queryKeys.contactsRoot });
  };

  return (
    <AppShell>
      <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>
      <Input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
        placeholder={t('searchPlaceholder')}
        className="mb-4"
      />
      {isError ? (
        <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
      ) : isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <ul className="space-y-2">
          {items.map((contact) => (
            <li key={contact.id} className="rounded-2xl bg-white p-4 shadow-sm">
              {editing?.id === contact.id ? (
                <div className="space-y-3">
                  <Field label={t('name')}>
                    <Input
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value);
                      }}
                    />
                  </Field>
                  <Field label={t('tags')} hint={t('tagsHint')}>
                    <Input
                      value={editTags}
                      onChange={(e) => {
                        setEditTags(e.target.value);
                      }}
                    />
                  </Field>
                  <Field label={t('language')}>
                    <select
                      value={editLanguage}
                      onChange={(e) => {
                        setEditLanguage(e.target.value);
                      }}
                      className="min-h-12 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
                    >
                      <option value="">{t('languageUnknown')}</option>
                      <option value="sw">Kiswahili</option>
                      <option value="en">English</option>
                    </select>
                  </Field>
                  <div className="flex gap-2">
                    <Button onClick={() => void saveEdit()} disabled={busy} className="flex-1">
                      {busy ? t('saving') : t('save')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-brand-950">
                      {contact.name ?? contact.phone}
                    </p>
                    <p className="text-xs text-brand-500">{contact.phone}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {contact.optedInAt ? (
                        <Badge tone="success">{t('optedIn')}</Badge>
                      ) : (
                        <Badge tone="neutral">{t('notOptedIn')}</Badge>
                      )}
                      {contact.language ? <Badge>{contact.language}</Badge> : null}
                      {contact.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      onClick={() => {
                        startEdit(contact);
                      }}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
                    >
                      {t('edit')}
                    </button>
                    {contact.optedInAt === null ? (
                      <button
                        onClick={() => void optIn(contact.id)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                      >
                        {t('recordOptIn')}
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
