'use client';

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { KnowledgeDocDto } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { apiFetch, ApiError, apiUpload, getTokens } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Skeleton } from '@/components/ui';

interface DocsResponse {
  docs: KnowledgeDocDto[];
}

export default function KnowledgePage() {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const [docs, setDocs] = useState<KnowledgeDocDto[] | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await apiFetch<DocsResponse>('/api/v1/knowledge');
      setDocs(data.docs);
    } catch {
      setError(t('loadError'));
    }
  }, [t]);

  useEffect(() => {
    if (!getTokens()) {
      router.replace('/login');
      return;
    }
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5_000);
    return () => {
      clearInterval(timer);
    };
  }, [router, load]);

  const submitText = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/knowledge', { method: 'POST', body: { title, content } });
      setTitle('');
      setContent('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiUpload('/api/v1/knowledge/upload', formData);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  };

  const remove = async (id: string): Promise<void> => {
    await apiFetch(`/api/v1/knowledge/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl bg-brand-50 px-4 py-8">
      <Card>
        <div className="mb-4 flex items-center gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-brand-200" />
          <span className="h-2 w-2 rounded-full bg-brand-200" />
          <span className="h-2 w-6 rounded-full bg-brand-700" />
        </div>
        <h1 className="text-2xl font-bold text-brand-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-600">{t('subtitle')}</p>

        <form onSubmit={(e) => void submitText(e)} className="mt-6 space-y-4">
          <Field label={t('docTitle')} hint={t('docTitleHint')}>
            <Input
              required
              minLength={2}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </Field>
          <Field label={t('docContent')} hint={t('docContentHint')}>
            <textarea
              required
              minLength={10}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
              }}
              rows={6}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
              placeholder={t('docContentPlaceholder')}
            />
          </Field>
          {error ? <ErrorBox message={error} /> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? t('saving') : t('addInfo')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="flex-1"
            >
              {t('uploadFile')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void uploadFile(file);
                }
              }}
            />
          </div>
        </form>
      </Card>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-brand-800">{t('yourDocs')}</h2>
        {docs === null ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : docs.length === 0 ? (
          <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-brand-950">{doc.title}</p>
                  <p className="text-xs text-brand-500">
                    {doc.chunkCount > 0 && doc.embeddedCount >= doc.chunkCount ? (
                      <Badge tone="success">{t('ready')}</Badge>
                    ) : (
                      <Badge tone="warning">{t('processing')}</Badge>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => void remove(doc.id)}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  {t('delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6">
        <Button onClick={() => { router.push('/onboarding/test'); }} className="w-full">
          {t('continue')}
        </Button>
      </div>
    </main>
  );
}
