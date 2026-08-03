'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupplierDto } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { ApiError, getStoredUser } from '@/lib/api';
import { createSupplier, deleteSupplier, listSuppliers, updateSupplier } from '@/lib/sourcing-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import {
  Button, Card, EmptyState, ErrorBox, Field, Input, SearchInput, Skeleton,
  Table, TableHeader, Th, TableBody, TableRow, Td, RowActions,
} from '@/components/ui';

/** "city, country" when a city is on file, otherwise just the country code. */
function formatLocation(supplier: Pick<SupplierDto, 'city' | 'country'>): string {
  return supplier.city ? `${supplier.city}, ${supplier.country}` : supplier.country;
}

export default function SuppliersPage() {
  const t = useTranslations('suppliers');
  const router = useRouter();
  const queryClient = useQueryClient();
  const sourcingOrg = (getStoredUser()?.organization.modules ?? []).includes('sourcing');

  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [market, setMarket] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [notes, setNotes] = useState('');

  const {
    data: suppliers,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.suppliers,
    queryFn: listSuppliers,
  });

  useEffect(() => {
    if (!sourcingOrg) {
      router.replace('/home');
    }
  }, [router, sourcingOrg]);

  if (!sourcingOrg) {
    return null;
  }

  const resetForm = (): void => {
    setEditingId(null);
    setName('');
    setCountry('');
    setCity('');
    setMarket('');
    setAddress('');
    setContactName('');
    setContactPhone('');
    setContactNote('');
    setNotes('');
    setFormError(null);
  };

  const startEdit = (supplier: SupplierDto): void => {
    setEditingId(supplier.id);
    setName(supplier.name);
    setCountry(supplier.country);
    setCity(supplier.city ?? '');
    setMarket(supplier.market ?? '');
    setAddress(supplier.address ?? '');
    setContactName(supplier.contactName ?? '');
    setContactPhone(supplier.contactPhone ?? '');
    setContactNote(supplier.contactNote ?? '');
    setNotes(supplier.notes ?? '');
    setFormError(null);
  };

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const trimmedCountry = country.trim();
    if (!/^[A-Za-z]{2}$/.test(trimmedCountry)) {
      setFormError(t('invalidCountry'));
      return;
    }

    const payload = {
      name: name.trim(),
      country: trimmedCountry,
      city: city.trim() || undefined,
      market: market.trim() || undefined,
      address: address.trim() || undefined,
      contactName: contactName.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      contactNote: contactNote.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    setBusy(true);
    try {
      if (editingId) {
        await updateSupplier(editingId, payload);
      } else {
        await createSupplier(payload);
      }
      resetForm();
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliersRoot });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(t('deleteConfirm'))) {
      return;
    }
    setActionError(null);
    try {
      await deleteSupplier(id);
      if (editingId === id) {
        resetForm();
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliersRoot });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('saveError'));
    }
  };

  const query = search.trim().toLowerCase();
  const filtered = (suppliers ?? []).filter(
    (supplier) =>
      query === '' ||
      supplier.name.toLowerCase().includes(query) ||
      (supplier.city ?? '').toLowerCase().includes(query) ||
      (supplier.market ?? '').toLowerCase().includes(query),
  );

  return (
    <AppShell title={t('title')}>
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-brand-900">
          {editingId ? t('editTitle') : t('addTitle')}
        </h2>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field label={t('name')}>
            <Input
              required
              minLength={2}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('country')} hint={t('countryHint')}>
              <Input
                required
                maxLength={2}
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                }}
              />
            </Field>
            <Field label={t('city')}>
              <Input
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('market')}>
              <Input
                value={market}
                onChange={(e) => {
                  setMarket(e.target.value);
                }}
              />
            </Field>
            <Field label={t('address')}>
              <Input
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('contactName')}>
              <Input
                value={contactName}
                onChange={(e) => {
                  setContactName(e.target.value);
                }}
              />
            </Field>
            <Field label={t('contactPhone')}>
              <Input
                type="tel"
                value={contactPhone}
                onChange={(e) => {
                  setContactPhone(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field label={t('contactNote')} hint={t('contactNoteHint')}>
            <Input
              value={contactNote}
              onChange={(e) => {
                setContactNote(e.target.value);
              }}
            />
          </Field>
          <Field label={t('notes')} hint={t('notesHint')}>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={3}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
            />
          </Field>
          {formError ? <ErrorBox message={formError} /> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? t('saving') : t('save')}
            </Button>
            {editingId ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={resetForm}>
                {t('cancelEdit')}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      <div className="mb-3">
        <SearchInput
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
      </div>

      {isError ? (
        <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
      ) : suppliers === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : filtered.length === 0 ? (
        suppliers.length > 0 ? (
          <EmptyState title={t('noResultsTitle')} hint={t('noResultsHint')} />
        ) : (
          <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
        )
      ) : (
        <>
          {actionError ? <div className="mb-3"><ErrorBox message={actionError} /></div> : null}
          <Table>
            <TableHeader>
              <Th>{t('colSupplier')}</Th>
              <Th>{t('colLocation')}</Th>
              <Th>{t('colMarket')}</Th>
              <Th>{t('colItems')}</Th>
              <Th className="text-right">{t('colActions')}</Th>
            </TableHeader>
            <TableBody>
              {filtered.map((supplier) => (
                <TableRow key={supplier.id}>
                  <Td>
                    <p className="font-semibold text-brand-950">{supplier.name}</p>
                  </Td>
                  <Td>{formatLocation(supplier)}</Td>
                  <Td>{supplier.market ?? ''}</Td>
                  <Td>{t('itemCount', { count: supplier.itemCount })}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <RowActions
                        label={`${t('colActions')}: ${supplier.name}`}
                        actions={[
                          { key: 'edit', label: t('edit'), onSelect: () => { startEdit(supplier); } },
                          {
                            key: 'view',
                            label: t('viewItems'),
                            onSelect: () => { router.push(`/suppliers/${supplier.id}`); },
                          },
                          {
                            key: 'delete',
                            label: t('delete'),
                            tone: 'danger' as const,
                            onSelect: () => void remove(supplier.id),
                          },
                        ]}
                      />
                    </div>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="lg:hidden">
            <ul className="space-y-2">
              {filtered.map((supplier) => (
                <li key={supplier.id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="font-semibold text-brand-950">{supplier.name}</p>
                  <p className="text-sm text-brand-700">{formatLocation(supplier)}</p>
                  {supplier.market ? <p className="text-sm text-brand-600">{supplier.market}</p> : null}
                  <p className="mt-1 text-xs text-brand-500">
                    {t('itemCount', { count: supplier.itemCount })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        startEdit(supplier);
                      }}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
                    >
                      {t('edit')}
                    </button>
                    <button
                      onClick={() => {
                        router.push(`/suppliers/${supplier.id}`);
                      }}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
                    >
                      {t('viewItems')}
                    </button>
                    <button
                      onClick={() => void remove(supplier.id)}
                      className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                    >
                      {t('delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </AppShell>
  );
}
