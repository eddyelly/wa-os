'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { updateShopSettingsRequestSchema, type BusinessModule } from '@waos/shared';
import { apiFetch, ApiError, getStoredUser, updateStoredOrganization } from '@/lib/api';
import { getOrganization, listTeam } from '@/lib/app-api';
import { updateShopSettings } from '@/lib/shop-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { Badge, Button, Card, ErrorBox, Field, Input, Skeleton } from '@/components/ui';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const queryClient = useQueryClient();
  const isOwner = getStoredUser()?.user.role === 'OWNER';
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [vertical, setVertical] = useState('');
  const [language, setLanguage] = useState('sw');
  const [timezone, setTimezone] = useState('');

  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [aiOn, setAiOn] = useState(true);
  const [threshold, setThreshold] = useState(0.7);
  const [toneNotes, setToneNotes] = useState('');

  const [modules, setModules] = useState<BusinessModule[]>(['appointments']);
  const [savingModules, setSavingModules] = useState(false);

  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [ownerAlertPhone, setOwnerAlertPhone] = useState('');
  const [ownerAlertPhoneError, setOwnerAlertPhoneError] = useState<string | null>(null);
  const [ownerAlertsEnabled, setOwnerAlertsEnabled] = useState(false);
  const [savingShop, setSavingShop] = useState(false);

  const {
    data: org,
    isPending: orgPending,
    isError: orgHasError,
    refetch: refetchOrg,
  } = useQuery({ queryKey: queryKeys.organization, queryFn: getOrganization });

  const {
    data: team,
    isPending: teamPending,
    isError: teamHasError,
    refetch: refetchTeam,
  } = useQuery({ queryKey: queryKeys.team, queryFn: listTeam });

  const loading = orgPending || teamPending;
  const displayError = mutationError ?? (orgHasError || teamHasError ? t('loadError') : null);

  useEffect(() => {
    if (!org) {
      return;
    }
    setName(org.name);
    setVertical(org.vertical);
    setLanguage(org.language);
    setTimezone(org.timezone);
    setAiOn(org.settings?.aiEnabled !== false);
    setThreshold(org.settings?.aiConfidenceThreshold ?? 0.7);
    setToneNotes(org.settings?.toneNotes ?? '');
    setModules(org.modules);
    setPaymentInstructions(org.settings?.paymentInstructions ?? '');
    const ownerAlertPhoneValue = org.settings?.ownerAlertPhone ?? '';
    setOwnerAlertPhone(ownerAlertPhoneValue);
    setOwnerAlertsEnabled(ownerAlertPhoneValue !== '' && org.settings?.ownerAlertsEnabled === true);
  }, [org]);

  const retryLoad = (): void => {
    setMutationError(null);
    void refetchOrg();
    void refetchTeam();
  };

  const saveProfile = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await apiFetch('/api/v1/organization', {
        method: 'PATCH',
        body: { name, vertical, language, timezone },
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization });
      setNotice(t('saved'));
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const invite = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setTempPassword(null);
    try {
      const result = await apiFetch<{ user: { temporaryPassword: string } }>(
        '/api/v1/organization/users',
        { method: 'POST', body: { name: inviteName, email: inviteEmail } },
      );
      setTempPassword(result.user.temporaryPassword);
      setInviteName('');
      setInviteEmail('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.team });
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const saveAi = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await apiFetch('/api/v1/organization/ai-settings', {
        method: 'PATCH',
        body: { aiEnabled: aiOn, aiConfidenceThreshold: threshold, toneNotes },
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization });
      setNotice(t('saved'));
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const toggleModule = (module: BusinessModule): void => {
    setModules((current) =>
      current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
    );
  };

  const saveModules = async (): Promise<void> => {
    setSavingModules(true);
    setNotice(null);
    try {
      const response = await apiFetch<{ organization: { modules: BusinessModule[] } }>(
        '/api/v1/organization',
        { method: 'PATCH', body: { modules } },
      );
      updateStoredOrganization({ modules: response.organization.modules });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization });
      setNotice(t('saved'));
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setSavingModules(false);
    }
  };

  const saveShop = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setSavingShop(true);
    setNotice(null);
    try {
      const trimmedPhone = ownerAlertPhone.trim();
      if (
        trimmedPhone !== '' &&
        !updateShopSettingsRequestSchema.shape.ownerAlertPhone.safeParse(trimmedPhone).success
      ) {
        setOwnerAlertPhoneError(t('ownerAlertPhoneInvalid'));
        return;
      }
      setOwnerAlertPhoneError(null);
      await updateShopSettings({
        paymentInstructions,
        ownerAlertPhone: trimmedPhone === '' ? null : trimmedPhone,
        ownerAlertsEnabled: trimmedPhone === '' ? false : ownerAlertsEnabled,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization });
      setNotice(t('saved'));
    } catch (err) {
      setMutationError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setSavingShop(false);
    }
  };

  const thresholdLabel =
    threshold <= 0.5 ? t('thresholdLow') : threshold <= 0.75 ? t('thresholdMedium') : t('thresholdHigh');

  return (
    <AppShell title={t('title')}>
      {displayError ? (
        <ErrorBox message={displayError} onRetry={retryLoad} retryLabel={t('retry')} />
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{notice}</p>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="text-base font-semibold text-brand-900">{t('profileSection')}</h2>
            <form onSubmit={(e) => void saveProfile(e)} className="mt-4 space-y-3">
              <Field label={t('businessName')}>
                <Input
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </Field>
              <Field label={t('vertical')}>
                <Input
                  required
                  value={vertical}
                  onChange={(e) => {
                    setVertical(e.target.value);
                  }}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('language')}>
                  <select
                    value={language}
                    onChange={(e) => {
                      setLanguage(e.target.value);
                    }}
                    className="min-h-12 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
                  >
                    <option value="sw">Kiswahili</option>
                    <option value="en">English</option>
                  </select>
                </Field>
                <Field label={t('timezone')}>
                  <Input
                    required
                    value={timezone}
                    onChange={(e) => {
                      setTimezone(e.target.value);
                    }}
                  />
                </Field>
              </div>
              <Button type="submit" disabled={busy}>
                {t('save')}
              </Button>
            </form>
          </Card>

          {isOwner ? (
            <Card>
              <h2 className="text-base font-semibold text-brand-900">{t('modulesSection')}</h2>
              <p className="mt-1 text-sm text-brand-700">{t('modulesHint')}</p>
              <div className="mt-3 flex flex-col gap-2">
                {(['appointments', 'shop'] as const).map((module) => (
                  <label key={module} className="flex items-center gap-2 text-sm text-brand-900">
                    <input
                      type="checkbox"
                      checked={modules.includes(module)}
                      onChange={() => {
                        toggleModule(module);
                      }}
                      disabled={modules.length === 1 && modules.includes(module)}
                    />
                    {module === 'appointments' ? t('moduleAppointments') : t('moduleShop')}
                  </label>
                ))}
              </div>
              <Button
                type="button"
                className="mt-3"
                onClick={() => void saveModules()}
                disabled={savingModules}
              >
                {savingModules ? t('saving') : t('save')}
              </Button>
            </Card>
          ) : null}

          {isOwner && modules.includes('shop') ? (
            <Card>
              <h2 className="text-base font-semibold text-brand-900">{t('shopSection')}</h2>
              <form onSubmit={(e) => void saveShop(e)} className="mt-4 space-y-4">
                <Field label={t('paymentInstructions')} hint={t('paymentInstructionsHint')}>
                  <textarea
                    value={paymentInstructions}
                    onChange={(e) => {
                      setPaymentInstructions(e.target.value);
                    }}
                    rows={3}
                    maxLength={500}
                    className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
                  />
                </Field>
                <Field
                  label={t('ownerAlertPhone')}
                  hint={t('ownerAlertPhoneHint')}
                  error={ownerAlertPhoneError ?? undefined}
                >
                  <Input
                    type="tel"
                    placeholder="+2557..."
                    value={ownerAlertPhone}
                    onChange={(e) => {
                      const value = e.target.value;
                      setOwnerAlertPhone(value);
                      if (value.trim() === '') {
                        setOwnerAlertsEnabled(false);
                      }
                    }}
                  />
                </Field>
                <label className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 p-3">
                  <input
                    type="checkbox"
                    checked={ownerAlertsEnabled}
                    disabled={ownerAlertPhone.trim() === ''}
                    onChange={(e) => {
                      setOwnerAlertsEnabled(e.target.checked);
                    }}
                    className="mt-0.5 h-5 w-5 accent-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span className="block text-sm font-medium text-brand-900">
                    {t('ownerAlertsEnabled')}
                  </span>
                </label>
                <Button type="submit" disabled={savingShop}>
                  {savingShop ? t('saving') : t('save')}
                </Button>
              </form>
            </Card>
          ) : null}

          {isOwner ? (
            <Card>
              <h2 className="text-base font-semibold text-brand-900">{t('teamSection')}</h2>
              <ul className="mt-3 space-y-2">
                {(team ?? []).map((member) => (
                  <li key={member.id} className="flex items-center justify-between text-sm">
                    <span className="text-brand-950">
                      {member.name} <span className="text-brand-500">({member.email})</span>
                    </span>
                    <Badge tone={member.role === 'OWNER' ? 'success' : 'neutral'}>
                      {member.role === 'OWNER' ? t('roleOwner') : t('roleStaff')}
                    </Badge>
                  </li>
                ))}
              </ul>
              <form onSubmit={(e) => void invite(e)} className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('inviteName')}>
                    <Input
                      required
                      minLength={2}
                      value={inviteName}
                      onChange={(e) => {
                        setInviteName(e.target.value);
                      }}
                    />
                  </Field>
                  <Field label={t('inviteEmail')}>
                    <Input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => {
                        setInviteEmail(e.target.value);
                      }}
                    />
                  </Field>
                </div>
                <Button type="submit" variant="secondary" disabled={busy}>
                  {t('invite')}
                </Button>
                {tempPassword ? (
                  <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {t('tempPasswordNote')} <strong className="font-mono">{tempPassword}</strong>
                  </p>
                ) : null}
              </form>
            </Card>
          ) : null}

          {isOwner ? (
            <Card>
              <h2 className="text-base font-semibold text-brand-900">{t('aiSection')}</h2>
              <form onSubmit={(e) => void saveAi(e)} className="mt-4 space-y-4">
                <label className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 p-3">
                  <input
                    type="checkbox"
                    checked={aiOn}
                    onChange={(e) => {
                      setAiOn(e.target.checked);
                    }}
                    className="mt-0.5 h-5 w-5 accent-brand-700"
                  />
                  <span>
                    <span className="block text-sm font-medium text-brand-900">
                      {t('aiEnabledLabel')}
                    </span>
                    <span className="block text-xs text-brand-600">{t('aiEnabledHint')}</span>
                  </span>
                </label>
                <Field label={t('threshold')} hint={t('thresholdHint')}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0.1}
                      max={0.95}
                      step={0.05}
                      value={threshold}
                      onChange={(e) => {
                        setThreshold(Number(e.target.value));
                      }}
                      className="flex-1 accent-brand-700"
                    />
                    <span className="w-28 text-sm font-medium text-brand-800">{thresholdLabel}</span>
                  </div>
                </Field>
                <Field label={t('toneNotes')} hint={t('toneNotesHint')}>
                  <textarea
                    value={toneNotes}
                    onChange={(e) => {
                      setToneNotes(e.target.value);
                    }}
                    rows={3}
                    className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
                    placeholder={t('toneNotesPlaceholder')}
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  {t('save')}
                </Button>
              </form>
            </Card>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
