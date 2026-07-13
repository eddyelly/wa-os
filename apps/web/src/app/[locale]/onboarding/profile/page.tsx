'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { BusinessModule } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { apiFetch, ApiError, getStoredUser, updateStoredOrganization } from '@/lib/api';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { Button, Card, ErrorBox, Field, Input, Skeleton } from '@/components/ui-legacy';
import { OnboardingShell } from '@/components/onboarding-shell';

type ModuleChoice = 'appointments' | 'shop' | 'both';

const choiceToModules: Record<ModuleChoice, BusinessModule[]> = {
  appointments: ['appointments'],
  shop: ['shop'],
  both: ['appointments', 'shop'],
};

interface OrganizationResponse {
  organization: {
    id: string;
    name: string;
    vertical: string;
    language: string;
    timezone: string;
    modules?: BusinessModule[];
  };
}

export default function OnboardingProfilePage() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const checked = useAuthGuard();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [vertical, setVertical] = useState('');
  const [moduleChoice, setModuleChoice] = useState<ModuleChoice>('appointments');
  const [language, setLanguage] = useState('sw');
  const [timezone, setTimezone] = useState('Africa/Dar_es_Salaam');
  // The trail's step count depends on the module choice already saved for
  // this org, not the in-progress radio selection above: the choice on this
  // page only takes effect (and updates the stored organization) on submit.
  const shopOrg = (getStoredUser()?.organization.modules ?? []).includes('shop');

  useEffect(() => {
    if (!checked) {
      return;
    }
    apiFetch<OrganizationResponse>('/api/v1/organization')
      .then(({ organization }) => {
        setName(organization.name);
        setVertical(organization.vertical);
        const loadedModules = organization.modules ?? ['appointments'];
        setModuleChoice(
          loadedModules.includes('shop') && loadedModules.includes('appointments')
            ? 'both'
            : loadedModules.includes('shop')
              ? 'shop'
              : 'appointments',
        );
        setLanguage(organization.language);
        setTimezone(organization.timezone);
        setLoading(false);
      })
      .catch(() => {
        setError(t('loadError'));
        setLoading(false);
      });
  }, [checked, t]);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const modules = choiceToModules[moduleChoice];
      await apiFetch('/api/v1/organization', {
        method: 'PATCH',
        body: { name, vertical, language, timezone, modules },
      });
      updateStoredOrganization({ modules });
      router.push('/onboarding/connect');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveError'));
      setBusy(false);
    }
  };

  return (
    <OnboardingShell step={0} includeProducts={shopOrg}>
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
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1.5 block text-sm font-medium text-brand-900">
                {t('modulesLabel')}
              </legend>
              <div className="flex flex-col gap-2">
                {(['appointments', 'shop', 'both'] as const).map((choice) => (
                  <label
                    key={choice}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${
                      moduleChoice === choice
                        ? 'border-brand-600 bg-brand-50 text-brand-900'
                        : 'border-brand-100 bg-white text-brand-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="modules"
                      value={choice}
                      checked={moduleChoice === choice}
                      onChange={() => { setModuleChoice(choice); }}
                    />
                    <span>
                      <span className="block font-medium">{t(`modules_${choice}`)}</span>
                      <span className="block text-xs text-brand-600">{t(`modules_${choice}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <span className="mt-1 block text-xs text-brand-600">{t('modulesHint')}</span>
            </fieldset>
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
