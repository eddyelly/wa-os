'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { apiFetch, ApiError, getTokens } from '@/lib/api';
import { Button, Card, ErrorBox, Field, Input, Skeleton } from '@/components/ui';
import { OnboardingShell } from '@/components/onboarding-shell';

interface OrganizationResponse {
  organization: {
    id: string;
    name: string;
    vertical: string;
    language: string;
    timezone: string;
  };
}

export default function OnboardingProfilePage() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [vertical, setVertical] = useState('');
  const [language, setLanguage] = useState('sw');
  const [timezone, setTimezone] = useState('Africa/Dar_es_Salaam');

  useEffect(() => {
    if (!getTokens()) {
      router.replace('/login');
      return;
    }
    apiFetch<OrganizationResponse>('/api/v1/organization')
      .then(({ organization }) => {
        setName(organization.name);
        setVertical(organization.vertical);
        setLanguage(organization.language);
        setTimezone(organization.timezone);
        setLoading(false);
      })
      .catch(() => {
        setError(t('loadError'));
        setLoading(false);
      });
  }, [router, t]);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/organization', {
        method: 'PATCH',
        body: { name, vertical, language, timezone },
      });
      router.push('/onboarding/connect');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveError'));
      setBusy(false);
    }
  };

  return (
    <OnboardingShell step={0}>
      <Card className="w-full p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-brand-900">{t('profileTitle')}</h1>
        <p className="mt-1 text-sm text-brand-600">{t('profileSubtitle')}</p>
        {loading ? (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
            <Field label={t('businessName')}>
              <Input required value={name} onChange={(e) => { setName(e.target.value); }} />
            </Field>
            <Field label={t('vertical')} hint={t('verticalHint')}>
              <Input required value={vertical} onChange={(e) => { setVertical(e.target.value); }} />
            </Field>
            <Field label={t('language')}>
              <select
                value={language}
                onChange={(e) => { setLanguage(e.target.value); }}
                className="min-h-12 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
              >
                <option value="sw">Kiswahili</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label={t('timezone')}>
              <Input required value={timezone} onChange={(e) => { setTimezone(e.target.value); }} />
            </Field>
            {error ? <ErrorBox message={error} /> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t('saving') : t('saveAndContinue')}
            </Button>
          </form>
        )}
      </Card>
    </OnboardingShell>
  );
}
