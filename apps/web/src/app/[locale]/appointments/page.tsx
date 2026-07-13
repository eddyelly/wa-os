'use client';

import { Suspense, useState, type SyntheticEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppointmentDto } from '@waos/shared';
import { apiFetch, ApiError } from '@/lib/api';
import { getWeeklyStats, listAppointments, listContacts } from '@/lib/app-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Skeleton } from '@/components/ui-legacy';

function statusTone(status: AppointmentDto['status']): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'REMINDED':
      return 'warning';
    case 'NO_SHOW':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function AppointmentsPageInner() {
  const t = useTranslations('appointments');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(searchParams.has('contactId'));
  const [contactId, setContactId] = useState(searchParams.get('contactId') ?? '');
  const [serviceName, setServiceName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');

  const {
    data: items,
    isPending: itemsPending,
    isError: itemsHasError,
    refetch: refetchItems,
  } = useQuery({
    queryKey: queryKeys.appointments(),
    queryFn: () => listAppointments(),
  });

  const {
    data: contacts,
    isPending: contactsPending,
    isError: contactsHasError,
    refetch: refetchContacts,
  } = useQuery({
    queryKey: queryKeys.contacts(),
    queryFn: () => listContacts(),
  });

  const {
    data: stats,
    isPending: statsPending,
    isError: statsHasError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: queryKeys.weeklyStats,
    queryFn: getWeeklyStats,
  });

  // Combined so the list, the weekly-stats banner, and the create-form's
  // contact dropdown flip from loading to loaded in one render, matching the
  // pre-migration Promise.all: nothing here populates until appointments,
  // contacts, and weeklyStats have all resolved.
  const isPending = itemsPending || contactsPending || statsPending;
  const isError = itemsHasError || contactsHasError || statsHasError;
  const contactOptions = !isPending && !isError ? contacts : [];
  const statsToShow = !isPending && !isError ? stats : undefined;

  const retryLoad = (): void => {
    void refetchItems();
    void refetchContacts();
    void refetchStats();
  };

  const invalidateAppointments = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.appointmentsRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.weeklyStats }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
  };

  const create = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const starts = new Date(startsAt);
      const ends = new Date(starts.getTime() + Number(durationMinutes) * 60_000);
      await apiFetch('/api/v1/appointments', {
        method: 'POST',
        body: {
          contactId,
          serviceName,
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
        },
      });
      setServiceName('');
      setStartsAt('');
      setShowForm(false);
      await invalidateAppointments();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: AppointmentDto['status']): Promise<void> => {
    await apiFetch(`/api/v1/appointments/${id}/status`, { method: 'POST', body: { status } });
    await invalidateAppointments();
  };

  const grouped = (items ?? []).reduce<Map<string, AppointmentDto[]>>((map, item) => {
    const day = new Date(item.startsAt).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    map.set(day, [...(map.get(day) ?? []), item]);
    return map;
  }, new Map());

  return (
    <AppShell>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-900">{t('title')}</h1>
        <Button
          onClick={() => {
            setShowForm((v) => !v);
          }}
        >
          {showForm ? t('hideForm') : t('newAppointment')}
        </Button>
      </div>

      {statsToShow ? (
        <div className="mb-4 flex gap-2">
          <span className="rounded-xl bg-white px-3 py-2 text-xs text-brand-800 shadow-sm">
            {t('remindersSentWeek', { count: statsToShow.remindersSent })}
          </span>
          <span className="rounded-xl bg-white px-3 py-2 text-xs text-brand-800 shadow-sm">
            {t('noShowsWeek', { count: statsToShow.noShowsMarked })}
          </span>
        </div>
      ) : null}

      {showForm ? (
        <Card className="mb-4">
          <form onSubmit={(e) => void create(e)} className="space-y-4">
            <Field label={t('customer')}>
              <select
                required
                value={contactId}
                onChange={(e) => {
                  setContactId(e.target.value);
                }}
                className="min-h-12 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
              >
                <option value="">{t('chooseCustomer')}</option>
                {contactOptions.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name ?? contact.phone}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('service')}>
              <Input
                required
                minLength={2}
                value={serviceName}
                onChange={(e) => {
                  setServiceName(e.target.value);
                }}
                placeholder={t('servicePlaceholder')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('when')}>
                <Input
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(e) => {
                    setStartsAt(e.target.value);
                  }}
                />
              </Field>
              <Field label={t('durationMinutes')}>
                <Input
                  type="number"
                  min={15}
                  step={15}
                  required
                  value={durationMinutes}
                  onChange={(e) => {
                    setDurationMinutes(e.target.value);
                  }}
                />
              </Field>
            </div>
            {formError ? <ErrorBox message={formError} /> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t('saving') : t('save')}
            </Button>
            <p className="text-xs text-brand-600">{t('reminderNote')}</p>
          </form>
        </Card>
      ) : null}

      {isError ? (
        <ErrorBox message={t('loadError')} onRetry={retryLoad} retryLabel={t('retry')} />
      ) : isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        [...grouped.entries()].map(([day, dayItems]) => (
          <section key={day} className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-brand-700">{day}</h2>
            <ul className="space-y-2">
              {dayItems.map((item) => (
                <li key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-brand-950">
                        {new Date(item.startsAt).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        {item.serviceName}
                      </p>
                      <p className="truncate text-sm text-brand-600">
                        {item.contact.name ?? item.contact.phone}
                        {item.contact.optedInAt === null ? ` (${t('noOptIn')})` : ''}
                      </p>
                    </div>
                    <Badge tone={statusTone(item.status)}>{t(`status${item.status}`)}</Badge>
                  </div>
                  {['BOOKED', 'REMINDED'].includes(item.status) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void setStatus(item.id, 'COMPLETED')}
                        className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
                      >
                        {t('markCompleted')}
                      </button>
                      <button
                        onClick={() => void setStatus(item.id, 'NO_SHOW')}
                        className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200"
                      >
                        {t('markNoShow')}
                      </button>
                      <button
                        onClick={() => void setStatus(item.id, 'CANCELLED')}
                        className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </AppShell>
  );
}

export default function AppointmentsPage() {
  // useSearchParams requires a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <AppointmentsPageInner />
    </Suspense>
  );
}
