'use client';

import { useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { authResponseSchema } from '@waos/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { apiFetch, ApiError, setSession } from '@/lib/api';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';

export default function SignupPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [businessName, setBusinessName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const raw = await apiFetch<unknown>('/api/v1/auth/signup', {
        method: 'POST',
        body: { businessName, name, email, password, language: locale },
        auth: false,
      });
      setSession(authResponseSchema.parse(raw));
      router.replace('/onboarding/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('genericError'));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-brand-50 px-4 py-8">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-brand-900">{t('signupTitle')}</h1>
        <p className="mt-1 text-sm text-brand-600">{t('signupSubtitle')}</p>
        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
          <Field label={t('businessName')} hint={t('businessNameHint')}>
            <Input
              required
              minLength={2}
              value={businessName}
              onChange={(e) => { setBusinessName(e.target.value); }}
            />
          </Field>
          <Field label={t('yourName')}>
            <Input required minLength={2} value={name} onChange={(e) => { setName(e.target.value); }} />
          </Field>
          <Field label={t('email')}>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); }}
            />
          </Field>
          <Field label={t('password')} hint={t('passwordHint')}>
            <Input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
            />
          </Field>
          {error ? <ErrorBox message={error} /> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? t('signingUp') : t('signup')}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-brand-700">
          {t('haveAccount')}{' '}
          <Link href="/login" className="font-semibold text-brand-800 underline underline-offset-2">
            {t('loginLink')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
