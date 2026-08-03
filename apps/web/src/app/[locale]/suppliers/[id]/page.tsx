'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SOURCING_CURRENCIES,
  type SourcedItemDto,
  type SourcingImportResponse,
  type SupplierDto,
} from '@waos/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, getStoredUser } from '@/lib/api';
import {
  createSourcedItem,
  deleteSourcedItem,
  importSourcedItemsCsv,
  listSourcedItems,
  listSuppliers,
  removeSourcedItemImage,
  updateSourcedItem,
  uploadSourcedItemImage,
} from '@/lib/sourcing-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import {
  Button, Card, EmptyState, ErrorBox, Field, Input, SearchInput, Skeleton,
  Table, TableHeader, Th, TableBody, TableRow, Td, ThumbCell, RowActions,
} from '@/components/ui';

type SourcingCurrency = (typeof SOURCING_CURRENCIES)[number];

/** "city, country" when a city is on file, otherwise just the country code. */
function formatLocation(supplier: Pick<SupplierDto, 'city' | 'country'>): string {
  return supplier.city ? `${supplier.city}, ${supplier.country}` : supplier.country;
}

export default function SupplierDetailPage() {
  const { id: supplierId } = useParams<{ id: string }>();
  const t = useTranslations('sourcedItems');
  const tSuppliers = useTranslations('suppliers');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sourcingOrg = (getStoredUser()?.organization.modules ?? []).includes('sourcing');

  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<SourcingCurrency>(SOURCING_CURRENCIES[0]);
  const [unit, setUnit] = useState('');
  const [moq, setMoq] = useState('');
  const [notes, setNotes] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const formPhotoRef = useRef<HTMLInputElement | null>(null);

  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<SourcingImportResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const TEMPLATE_CSV =
    'name,description,price,priceCurrency,unit,moq,notes\r\n' +
    '"Leather handbag","Black, PU leather",45.50,CNY,"per piece",50,"Ask for the 100pc price"\r\n';

  const downloadTemplate = (): void => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'waos-sourced-items-template.csv';
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  };

  const runImport = async (file: File): Promise<void> => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importSourcedItemsCsv(supplierId, file);
      setImportResult(result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sourcedItemsRoot });
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : t('importError'));
    } finally {
      setImportBusy(false);
      if (importFileRef.current) {
        importFileRef.current.value = '';
      }
    }
  };

  const { data: suppliers } = useQuery({
    queryKey: queryKeys.suppliers,
    queryFn: listSuppliers,
  });
  const supplier = suppliers?.find((s) => s.id === supplierId);

  const {
    data: items,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.sourcedItems(supplierId),
    queryFn: () => listSourcedItems(supplierId),
  });

  useEffect(() => {
    if (!sourcingOrg) {
      router.replace('/home');
    }
  }, [router, sourcingOrg]);

  useEffect(() => {
    const url = pendingPhotoUrl;
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [pendingPhotoUrl]);

  if (!sourcingOrg) {
    return null;
  }

  const selectPendingPhoto = (file: File | null): void => {
    setPendingPhoto(file);
    setPendingPhotoUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return file ? URL.createObjectURL(file) : null;
    });
  };

  const resetForm = (): void => {
    setEditingId(null);
    setName('');
    setDescription('');
    setPrice('');
    setCurrency(SOURCING_CURRENCIES[0]);
    setUnit('');
    setMoq('');
    setNotes('');
    setFormError(null);
    selectPendingPhoto(null);
    setPhotoWarning(null);
  };

  const startEdit = (item: SourcedItemDto): void => {
    setEditingId(item.id);
    setName(item.name);
    setDescription(item.description ?? '');
    setPrice(String(item.priceAmount / 100));
    setCurrency(item.priceCurrency as SourcingCurrency);
    setUnit(item.unit ?? '');
    setMoq(item.moq !== null ? String(item.moq) : '');
    setNotes(item.notes ?? '');
    setFormError(null);
    selectPendingPhoto(null);
  };

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const priceNum = Number(price);
    const moqTrimmed = moq.trim();
    const moqNum = moqTrimmed === '' ? null : Number.parseInt(moqTrimmed, 10);

    const invalid =
      Number.isNaN(priceNum) ||
      priceNum <= 0 ||
      (moqNum !== null && (Number.isNaN(moqNum) || moqNum <= 0));

    if (invalid) {
      setFormError(t('invalidPrice'));
      return;
    }

    const trimmedDescription = description.trim();
    const trimmedUnit = unit.trim();
    const trimmedNotes = notes.trim();

    setBusy(true);
    try {
      if (editingId) {
        await updateSourcedItem(supplierId, editingId, {
          name: name.trim(),
          description: trimmedDescription === '' ? null : trimmedDescription,
          priceAmount: Math.round(priceNum * 100),
          priceCurrency: currency,
          unit: trimmedUnit === '' ? null : trimmedUnit,
          moq: moqNum,
          notes: trimmedNotes === '' ? null : trimmedNotes,
        });
        resetForm();
        await queryClient.invalidateQueries({ queryKey: queryKeys.sourcedItemsRoot });
      } else {
        const created = await createSourcedItem(supplierId, {
          name: name.trim(),
          description: trimmedDescription === '' ? undefined : trimmedDescription,
          priceAmount: Math.round(priceNum * 100),
          priceCurrency: currency,
          unit: trimmedUnit === '' ? undefined : trimmedUnit,
          moq: moqNum ?? undefined,
          notes: trimmedNotes === '' ? undefined : trimmedNotes,
        });
        let photoFailed = false;
        if (pendingPhoto) {
          try {
            await uploadSourcedItemImage(supplierId, created.id, pendingPhoto);
          } catch {
            // The item is saved; only the photo failed. Say so honestly
            // instead of reporting the whole save as failed.
            photoFailed = true;
          }
        }
        resetForm();
        if (photoFailed) {
          setPhotoWarning(t('photoUploadFailed'));
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.sourcedItemsRoot });
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (itemId: string): Promise<void> => {
    if (!window.confirm(t('deleteConfirm'))) {
      return;
    }
    setActionError(null);
    try {
      await deleteSourcedItem(supplierId, itemId);
      if (editingId === itemId) {
        resetForm();
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.sourcedItemsRoot });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('saveError'));
    }
  };

  const triggerUpload = (itemId: string): void => {
    setUploadTargetId(itemId);
    fileRef.current?.click();
  };

  const uploadImage = async (itemId: string, file: File): Promise<void> => {
    setUploadingId(itemId);
    setActionError(null);
    try {
      await uploadSourcedItemImage(supplierId, itemId, file);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sourcedItemsRoot });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setUploadingId(null);
      setUploadTargetId(null);
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  };

  const removePhoto = async (itemId: string, imageId: string): Promise<void> => {
    setUploadingId(itemId);
    setActionError(null);
    try {
      await removeSourcedItemImage(supplierId, itemId, imageId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sourcedItemsRoot });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setUploadingId(null);
    }
  };

  const query = search.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (item) => query === '' || item.name.toLowerCase().includes(query),
  );

  return (
    <AppShell title={supplier?.name ?? t('title')}>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={downloadTemplate}>
          {t('downloadTemplate')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={importBusy}
          onClick={() => {
            importFileRef.current?.click();
          }}
        >
          {importBusy ? t('importing') : t('importCsv')}
        </Button>
        <input
          ref={importFileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void runImport(file);
            }
          }}
        />
      </div>
      {importError ? (
        <div className="mb-4">
          <ErrorBox message={importError} />
        </div>
      ) : null}
      {importResult ? (
        <div className="mb-4 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-brand-950">
              {t('importedCount', { count: importResult.created })}
            </p>
            <button
              type="button"
              onClick={() => {
                setImportResult(null);
              }}
              className="text-xs font-medium text-brand-500 hover:text-brand-800"
            >
              {t('importDismiss')}
            </button>
          </div>
          {importResult.failures.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-brand-700">{t('importFailuresTitle')}</p>
              <ul className="mt-1 space-y-1">
                {importResult.failures.map((failure) => (
                  <li key={failure.row} className="text-sm text-red-800">
                    <span className="font-semibold">{t('importRow', { row: failure.row })}:</span>{' '}
                    {failure.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      <Card className="mb-4">
        <Link
          href="/suppliers"
          className="mb-3 inline-block text-sm font-medium text-brand-600 hover:underline"
        >
          &larr; {t('backToSuppliers')}
        </Link>
        {supplier ? (
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-brand-950">{supplier.name}</h2>
            <p className="text-sm text-brand-700">{formatLocation(supplier)}</p>
            {supplier.market ? <p className="text-sm text-brand-600">{supplier.market}</p> : null}
            {supplier.address ? <p className="text-sm text-brand-600">{supplier.address}</p> : null}
            {supplier.contactName ? (
              <p className="pt-1 text-sm text-brand-800">
                <span className="font-medium">{tSuppliers('contactName')}:</span>{' '}
                {supplier.contactName}
              </p>
            ) : null}
            {supplier.contactPhone ? (
              <p className="text-sm text-brand-800">
                <span className="font-medium">{tSuppliers('contactPhone')}:</span>{' '}
                <a href={`tel:${supplier.contactPhone}`} className="text-brand-700 underline">
                  {supplier.contactPhone}
                </a>
              </p>
            ) : null}
            {supplier.contactNote ? (
              <p className="text-sm text-brand-800">
                <span className="font-medium">{tSuppliers('contactNote')}:</span>{' '}
                {supplier.contactNote}
              </p>
            ) : null}
            {supplier.notes ? <p className="pt-1 text-sm text-brand-600">{supplier.notes}</p> : null}
          </div>
        ) : null}
      </Card>

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
            <Field label={t('price')} hint={t('priceHint')}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step="0.01"
                required
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                }}
              />
            </Field>
            <Field label={t('currency')}>
              <select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value as SourcingCurrency);
                }}
                className="min-h-12 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
              >
                {SOURCING_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('unit')} hint={t('unitHint')}>
              <Input
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                }}
              />
            </Field>
            <Field label={t('moq')}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={moq}
                onChange={(e) => {
                  setMoq(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field label={t('description')}>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={3}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
            />
          </Field>
          <Field label={t('notes')}>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={3}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
            />
          </Field>
          <Field label={t('photo')} hint={t('photoHint')}>
            {editingId ? (
              <div className="flex flex-wrap items-center gap-3">
                {(items?.find((i) => i.id === editingId)?.images ?? []).map((image) => (
                  <div key={image.id} className="flex flex-col items-center gap-1">
                    <ThumbCell src={image.mediaUrl} alt={name} />
                    <button
                      type="button"
                      onClick={() => void removePhoto(editingId, image.id)}
                      className="text-[11px] font-medium text-red-700 hover:underline"
                    >
                      {t('removePhoto')}
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploadingId !== null}
                  onClick={() => {
                    triggerUpload(editingId);
                  }}
                >
                  {uploadingId !== null ? t('uploading') : t('addPhoto')}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {pendingPhotoUrl ? (
                  <div className="flex flex-col items-center gap-1">
                    <ThumbCell src={pendingPhotoUrl} alt={t('photo')} />
                    <button
                      type="button"
                      onClick={() => {
                        selectPendingPhoto(null);
                      }}
                      className="text-[11px] font-medium text-red-700 hover:underline"
                    >
                      {t('removePhoto')}
                    </button>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    formPhotoRef.current?.click();
                  }}
                >
                  {t('addPhoto')}
                </Button>
                <input
                  ref={formPhotoRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    selectPendingPhoto(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </Field>
          {formError ? <ErrorBox message={formError} /> : null}
          {photoWarning ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {photoWarning}
            </div>
          ) : null}
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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          const targetId = uploadTargetId;
          if (file && targetId) {
            void uploadImage(targetId, file);
          }
        }}
      />

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
      ) : items === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : filtered.length === 0 ? (
        items.length > 0 ? (
          <EmptyState title={t('noResultsTitle')} hint={t('noResultsHint')} />
        ) : (
          <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
        )
      ) : (
        <>
          {actionError ? <div className="mb-3"><ErrorBox message={actionError} /></div> : null}
          <Table>
            <TableHeader>
              <Th>{t('colItem')}</Th>
              <Th>{t('colPrice')}</Th>
              <Th>{t('colUnit')}</Th>
              <Th>{t('colMoq')}</Th>
              <Th className="text-right">{t('colActions')}</Th>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ThumbCell src={item.images[0]?.mediaUrl ?? null} alt={item.name} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-brand-950">{item.name}</p>
                        {item.description ? (
                          <p className="max-w-[28rem] truncate text-xs text-brand-500">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {(item.priceAmount / 100).toLocaleString(locale)} {item.priceCurrency}
                  </Td>
                  <Td>{item.unit ?? ''}</Td>
                  <Td>{item.moq ?? ''}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <RowActions
                        label={`${t('colActions')}: ${item.name}`}
                        actions={[
                          { key: 'edit', label: t('edit'), onSelect: () => { startEdit(item); } },
                          {
                            key: 'photo',
                            label: uploadingId !== null ? t('uploading') : t('addPhoto'),
                            disabled: uploadingId !== null,
                            onSelect: () => { triggerUpload(item.id); },
                          },
                          ...item.images.map((image, index) => ({
                            key: `rm-${image.id}`,
                            label:
                              item.images.length > 1
                                ? `${t('removePhoto')} ${index + 1}`
                                : t('removePhoto'),
                            onSelect: () => void removePhoto(item.id, image.id),
                          })),
                          {
                            key: 'delete',
                            label: t('delete'),
                            tone: 'danger' as const,
                            onSelect: () => void remove(item.id),
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
              {filtered.map((item) => (
                <li key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex gap-3">
                    {item.images[0]?.mediaUrl ? (
                      <img
                        src={item.images[0].mediaUrl}
                        alt={item.name}
                        className="h-16 w-16 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="h-16 w-16 shrink-0 rounded-xl bg-brand-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-brand-950">{item.name}</p>
                      <p className="text-sm text-brand-700">
                        {(item.priceAmount / 100).toLocaleString(locale)} {item.priceCurrency}
                        {item.unit ? ` / ${item.unit}` : ''}
                      </p>
                      {item.moq !== null ? (
                        <p className="text-xs text-brand-600">
                          {t('colMoq')}: {item.moq}
                        </p>
                      ) : null}
                      {item.description ? (
                        <p className="mt-1 truncate text-xs text-brand-500">{item.description}</p>
                      ) : null}
                    </div>
                  </div>

                  {item.images.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {item.images.map((image) => (
                        <div key={image.id} className="flex flex-col items-center gap-1">
                          {image.mediaUrl ? (
                            <img
                              src={image.mediaUrl}
                              alt={item.name}
                              className="h-12 w-12 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-brand-100" />
                          )}
                          <button
                            onClick={() => void removePhoto(item.id, image.id)}
                            className="text-[11px] font-medium text-red-700 hover:underline"
                          >
                            {t('removePhoto')}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        startEdit(item);
                      }}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
                    >
                      {t('edit')}
                    </button>
                    <button
                      onClick={() => {
                        triggerUpload(item.id);
                      }}
                      disabled={uploadingId !== null}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200 disabled:opacity-50"
                    >
                      {uploadingId !== null ? t('uploading') : t('addPhoto')}
                    </button>
                    <button
                      onClick={() => void remove(item.id)}
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
