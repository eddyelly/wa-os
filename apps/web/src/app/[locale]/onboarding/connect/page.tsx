'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { connectChannelResponseSchema, type ChannelDto } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { apiFetch, ApiError, getStoredUser, getTokens } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { Badge, Button, Card, ErrorBox, Spinner } from '@/components/ui';
import { OnboardingShell } from '@/components/onboarding-shell';

interface ChannelListResponse {
  channels: ChannelDto[];
}

interface StatusEvent {
  channelId: string;
  status: ChannelDto['status'];
  qr?: { code: string; base64?: string };
}

export default function OnboardingConnectPage() {
  const t = useTranslations('connect');
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelDto | null>(null);
  const [qr, setQr] = useState<{ code: string; base64?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channelIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const shopOrg = (getStoredUser()?.organization.modules ?? []).includes('shop');

  const start = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const existing = await apiFetch<ChannelListResponse>('/api/v1/channels');
      // Reuse the org's channel even when DISCONNECTED: reconnect re-issues a
      // QR, while creating a fresh channel would leak instances on every
      // restart or reload.
      const current =
        existing.channels.find((c) => c.status !== 'DISCONNECTED') ?? existing.channels[0];
      const raw = current
        ? await apiFetch<unknown>(`/api/v1/channels/${current.id}/connect`, { method: 'POST' })
        : await apiFetch<unknown>('/api/v1/channels', { method: 'POST' });
      const result = connectChannelResponseSchema.parse(raw);
      channelIdRef.current = result.channel.id;
      setChannel(result.channel);
      setQr(result.qr ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('startError'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    if (!getTokens()) {
      router.replace('/login');
      return;
    }
    // React StrictMode mounts effects twice in dev; without this guard the
    // two concurrent runs race past the "existing channel?" check and each
    // create a channel and an Evolution instance.
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void start();
  }, [router, start]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      return;
    }
    const onStatus = (event: StatusEvent): void => {
      if (channelIdRef.current && event.channelId !== channelIdRef.current) {
        return;
      }
      setChannel((prev) => (prev ? { ...prev, status: event.status } : prev));
      if (event.qr) {
        setQr(event.qr);
      }
      if (event.status === 'CONNECTED') {
        setQr(null);
      }
    };
    socket.on('channel.status_changed', onStatus);
    return () => {
      socket.off('channel.status_changed', onStatus);
    };
  }, []);

  const connected = channel?.status === 'CONNECTED';

  return (
    <OnboardingShell step={1} includeProducts={shopOrg}>
      <Card className="w-full p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-brand-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-600">{t('subtitle')}</p>

        {error ? (
          <div className="mt-6">
            <ErrorBox message={error} onRetry={() => void start()} retryLabel={t('retry')} />
          </div>
        ) : connected ? (
          <div className="mt-6 space-y-4 text-center">
            <Badge tone="success">{t('statusConnected')}</Badge>
            <p className="text-sm text-brand-700">{t('connectedHint')}</p>
            <Button
              onClick={() => {
                router.push(shopOrg ? '/onboarding/products' : '/onboarding/knowledge');
              }}
              className="w-full"
            >
              {t('continue')}
            </Button>
          </div>
        ) : qr ? (
          <div className="mt-6 space-y-4">
            <div className="flex justify-center rounded-2xl border-2 border-brand-100 bg-white p-3 shadow-inner">
              {qr.base64 ? (
                <img src={qr.base64} alt={t('qrAlt')} className="h-64 w-64" />
              ) : (
                <p className="text-xs break-all text-brand-700">{qr.code}</p>
              )}
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-brand-800">
              <li>{t('step1')}</li>
              <li>{t('step2')}</li>
              <li>{t('step3')}</li>
            </ol>
            <div className="flex items-center justify-center gap-2">
              <Badge tone="warning">{t('statusWaiting')}</Badge>
              <Button variant="ghost" onClick={() => void start()} disabled={busy}>
                {t('refreshQr')}
              </Button>
            </div>
          </div>
        ) : (
          <Spinner label={t('preparing')} />
        )}

        <p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          {t('banRiskDisclosure')}
        </p>
      </Card>
    </OnboardingShell>
  );
}
