'use client';

import { useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { apiFetch, ApiError } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Field, Input } from '@/components/ui';
import { OnboardingShell } from '@/components/onboarding-shell';

interface AiTestResponse {
  result: {
    reply: string | null;
    confidence: number;
    intent: string | null;
    action: 'REPLY' | 'HANDOFF';
    chunksUsed: number;
  };
}

export default function OnboardingTestPage() {
  const t = useTranslations('testAi');
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AiTestResponse['result'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch<AiTestResponse>('/api/v1/ai/test', {
        method: 'POST',
        body: { question },
      });
      setResult(data.result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingShell step={3}>
      <Card className="w-full p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-brand-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-600">{t('subtitle')}</p>

        <form onSubmit={(e) => void ask(e)} className="mt-6 space-y-4">
          <Field label={t('question')} hint={t('questionHint')}>
            <Input
              required
              minLength={2}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
              }}
              placeholder={t('questionPlaceholder')}
            />
          </Field>
          {error ? <ErrorBox message={error} /> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? t('asking') : t('ask')}
          </Button>
        </form>

        {result ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-2xl bg-brand-50 p-4">
              {result.reply ? (
                <p className="text-sm whitespace-pre-wrap text-brand-950">{result.reply}</p>
              ) : (
                <p className="text-sm text-brand-600">{t('noReply')}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {result.action === 'REPLY' ? (
                <Badge tone="success">{t('wouldReply')}</Badge>
              ) : (
                <Badge tone="warning">{t('wouldHandOff')}</Badge>
              )}
              <span className="text-brand-600">
                {t('confidence', { percent: Math.round(result.confidence * 100) })}
              </span>
              <span className="text-brand-600">{t('chunksUsed', { count: result.chunksUsed })}</span>
            </div>
            {result.action === 'HANDOFF' ? (
              <p className="text-xs text-brand-600">{t('handoffHint')}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex gap-2">
          <Button variant="secondary" onClick={() => { router.push('/onboarding/knowledge'); }} className="flex-1">
            {t('addMoreInfo')}
          </Button>
          <Button onClick={() => { router.push('/inbox'); }} className="flex-1">
            {t('finish')}
          </Button>
        </div>
      </Card>
    </OnboardingShell>
  );
}
