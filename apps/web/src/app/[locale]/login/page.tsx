'use client';

import { useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { authResponseSchema } from '@waos/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { apiFetch, ApiError, setSession } from '@/lib/api';
import { resetSocket } from '@/lib/socket';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
import { OnboardingShell } from '@/components/onboarding-shell';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const raw = await apiFetch<unknown>('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      setSession(authResponseSchema.parse(raw));
      // Drop any socket from a previous identity so realtime events arrive
      // for the organization that just logged in.
      resetSocket();
      router.replace('/inbox');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
      setBusy(false);
    }
  };

  return (
    <OnboardingShell>
      <Card className="w-full p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-brand-900">{t('loginTitle')}</h1>
        <p className="mt-1 text-sm text-brand-600">{t('loginSubtitle')}</p>
        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
          <Field label={t('email')}>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); }}
            />
          </Field>
          <Field label={t('password')}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
            />
          </Field>
          {error ? <ErrorBox message={error} /> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? t('loggingIn') : t('login')}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-brand-700">
          {t('noAccount')}{' '}
          <Link href="/signup" className="font-semibold text-brand-800 underline underline-offset-2">
            {t('signupLink')}
          </Link>
        </p>
      </Card>
    </OnboardingShell>
  );
}
