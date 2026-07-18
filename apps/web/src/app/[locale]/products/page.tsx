'use client';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportProductsResponse, ProductDto } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { ApiError, getStoredUser } from '@/lib/api';
import {
  createProduct,
  deleteProduct,
  importProductsCsv,
  listProducts,
  removeProductImage,
  updateProduct,
  uploadProductImage,
} from '@/lib/shop-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import {
  Badge, Button, Card, EmptyState, ErrorBox, Field, Input, SearchInput, Skeleton,
  Table, TableHeader, Th, TableBody, TableRow, Td, ThumbCell, RowActions,
} from '@/components/ui';

const DEFAULT_STOCK_QTY = '0';
const DEFAULT_LOW_STOCK_THRESHOLD = '5';

export default function ProductsPage() {
  const t = useTranslations('products');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const shopOrg = (getStoredUser()?.organization.modules ?? []).includes('shop');
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
  const [minPrice, setMinPrice] = useState('');
  const [stockQty, setStockQty] = useState(DEFAULT_STOCK_QTY);
  const [lowStockThreshold, setLowStockThreshold] = useState(DEFAULT_LOW_STOCK_THRESHOLD);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const formPhotoRef = useRef<HTMLInputElement | null>(null);

  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportProductsResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const TEMPLATE_CSV =
    'name,description,price,minPrice,stockQty,lowStockThreshold,tags\r\n' +
    '"Shea Hair Butter","Natural shea butter for dry hair",20000,17000,10,5,"hair|butter"\r\n';

  const downloadTemplate = (): void => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'waos-products-template.csv';
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
      const result = await importProductsCsv(file);
      setImportResult(result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : t('importError'));
    } finally {
      setImportBusy(false);
      if (importFileRef.current) {
        importFileRef.current.value = '';
      }
    }
  };

  const {
    data: products,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.products(true),
    queryFn: () => listProducts(true),
  });

  useEffect(() => {
    if (!shopOrg) {
      router.replace('/home');
    }
  }, [router, shopOrg]);

  useEffect(() => {
    const url = pendingPhotoUrl;
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [pendingPhotoUrl]);

  if (!shopOrg) {
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
    setMinPrice('');
    setStockQty(DEFAULT_STOCK_QTY);
    setLowStockThreshold(DEFAULT_LOW_STOCK_THRESHOLD);
    setFormError(null);
    selectPendingPhoto(null);
    setPhotoWarning(null);
  };

  const startEdit = (product: ProductDto): void => {
    setEditingId(product.id);
    setName(product.name);
    setDescription(product.description ?? '');
    setPrice(String(product.price));
    setMinPrice(product.minPrice !== null ? String(product.minPrice) : '');
    setStockQty(String(product.stockQty));
    setLowStockThreshold(String(product.lowStockThreshold));
    setFormError(null);
    selectPendingPhoto(null);
  };

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const priceNum = Number.parseInt(price, 10);
    const stockQtyNum = Number.parseInt(stockQty, 10);
    const lowStockThresholdNum = Number.parseInt(lowStockThreshold, 10);
    const minPriceTrimmed = minPrice.trim();
    const minPriceNum = minPriceTrimmed === '' ? null : Number.parseInt(minPriceTrimmed, 10);

    const invalid =
      Number.isNaN(priceNum) ||
      priceNum <= 0 ||
      Number.isNaN(stockQtyNum) ||
      stockQtyNum < 0 ||
      Number.isNaN(lowStockThresholdNum) ||
      lowStockThresholdNum < 0 ||
      (minPriceNum !== null && (Number.isNaN(minPriceNum) || minPriceNum <= 0));

    if (invalid) {
      setFormError(t('invalidNumbers'));
      return;
    }

    setBusy(true);
    try {
      const trimmedDescription = description.trim();
      if (editingId) {
        await updateProduct(editingId, {
          name,
          description: trimmedDescription === '' ? null : trimmedDescription,
          price: priceNum,
          minPrice: minPriceNum,
          stockQty: stockQtyNum,
          lowStockThreshold: lowStockThresholdNum,
        });
      } else {
        const created = await createProduct({
          name,
          description: trimmedDescription === '' ? undefined : trimmedDescription,
          price: priceNum,
          minPrice: minPriceNum ?? undefined,
          stockQty: stockQtyNum,
          lowStockThreshold: lowStockThresholdNum,
        });
        let photoFailed = false;
        if (pendingPhoto) {
          try {
            await uploadProductImage(created.id, pendingPhoto);
          } catch {
            // The product is saved; only the photo failed. Say so honestly
            // instead of reporting the whole save as failed.
            photoFailed = true;
          }
        }
        resetForm();
        if (photoFailed) {
          setPhotoWarning(t('photoUploadFailed'));
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
        return;
      }
      resetForm();
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (product: ProductDto): Promise<void> => {
    setActionError(null);
    try {
      await updateProduct(product.id, { isActive: !product.isActive });
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('saveError'));
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(t('deleteConfirm'))) {
      return;
    }
    setActionError(null);
    try {
      await deleteProduct(id);
      if (editingId === id) {
        resetForm();
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('saveError'));
    }
  };

  const triggerUpload = (id: string): void => {
    setUploadTargetId(id);
    fileRef.current?.click();
  };

  const uploadImage = async (id: string, file: File): Promise<void> => {
    setUploadingId(id);
    setActionError(null);
    try {
      await uploadProductImage(id, file);
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
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

  const removeImage = async (productId: string, imageId: string): Promise<void> => {
    setUploadingId(productId);
    setActionError(null);
    try {
      await removeProductImage(productId, imageId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setUploadingId(null);
    }
  };

  const query = search.trim().toLowerCase();
  const filtered = (products ?? []).filter(
    (p) =>
      query === '' ||
      p.name.toLowerCase().includes(query) ||
      p.tags.some((tag) => tag.toLowerCase().includes(query)),
  );

  return (
    <AppShell title={t('title')}>
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
          <Field label={t('description')} hint={t('descriptionHint')}>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={3}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('price')}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                required
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                }}
              />
            </Field>
            <Field label={t('minPrice')} hint={t('minPriceHint')}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={minPrice}
                onChange={(e) => {
                  setMinPrice(e.target.value);
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('stockQty')}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                required
                value={stockQty}
                onChange={(e) => {
                  setStockQty(e.target.value);
                }}
              />
            </Field>
            <Field label={t('lowStockThreshold')}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                required
                value={lowStockThreshold}
                onChange={(e) => {
                  setLowStockThreshold(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field label={t('photoLabel')} hint={t('photoHint')}>
            {editingId ? (
              <div className="flex flex-wrap items-center gap-3">
                {(products?.find((p) => p.id === editingId)?.images ?? []).map((image) => (
                  <div key={image.id} className="flex flex-col items-center gap-1">
                    <ThumbCell src={image.mediaUrl} alt={image.description || name} />
                    <button
                      type="button"
                      onClick={() => void removeImage(editingId, image.id)}
                      className="text-[11px] font-medium text-red-700 hover:underline"
                    >
                      {t('removeImage')}
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
                  {uploadingId !== null ? t('uploading') : t('addImage')}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {pendingPhotoUrl ? (
                  <div className="flex flex-col items-center gap-1">
                    <ThumbCell src={pendingPhotoUrl} alt={t('photoLabel')} />
                    <button
                      type="button"
                      onClick={() => {
                        selectPendingPhoto(null);
                      }}
                      className="text-[11px] font-medium text-red-700 hover:underline"
                    >
                      {t('removeImage')}
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
                  {t('addImage')}
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
      ) : products === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : filtered.length === 0 ? (
        products.length > 0 ? (
          <EmptyState title={t('noResultsTitle')} hint={t('noResultsHint')} />
        ) : (
          <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
        )
      ) : (
        <>
          {actionError ? <div className="mb-3"><ErrorBox message={actionError} /></div> : null}
          <Table>
            <TableHeader>
              <Th>{t('colProduct')}</Th>
              <Th>{t('colPrice')}</Th>
              <Th>{t('colStock')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th className="text-right">{t('colActions')}</Th>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ThumbCell src={product.images[0]?.mediaUrl ?? null} alt={product.name} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-brand-950">{product.name}</p>
                        {product.description ? (
                          <p className="max-w-[28rem] truncate text-xs text-brand-500">
                            {product.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{product.price.toLocaleString(locale)} TZS</Td>
                  <Td>
                    <span className="mr-2">{product.stockQty}</span>
                    {product.stockQty === 0 ? (
                      <Badge tone="danger">{t('stockBadge', { count: product.stockQty })}</Badge>
                    ) : product.stockQty <= product.lowStockThreshold ? (
                      <Badge tone="warning">{t('stockBadge', { count: product.stockQty })}</Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={product.isActive ? 'success' : 'neutral'}>
                      {product.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <RowActions
                        label={`${t('colActions')}: ${product.name}`}
                        actions={[
                          { key: 'edit', label: t('edit'), onSelect: () => { startEdit(product); } },
                          {
                            key: 'photo',
                            label: uploadingId !== null ? t('uploading') : t('addImage'),
                            disabled: uploadingId !== null,
                            onSelect: () => { triggerUpload(product.id); },
                          },
                          ...product.images.map((image, index) => ({
                            key: `rm-${image.id}`,
                            label:
                              product.images.length > 1
                                ? `${t('removeImage')} ${index + 1}`
                                : t('removeImage'),
                            onSelect: () => void removeImage(product.id, image.id),
                          })),
                          {
                            key: 'toggle',
                            label: product.isActive ? t('deactivate') : t('activate'),
                            onSelect: () => void toggleActive(product),
                          },
                          {
                            key: 'delete',
                            label: t('delete'),
                            tone: 'danger' as const,
                            onSelect: () => void remove(product.id),
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
              {filtered.map((product) => (
                <li key={product.id} className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex gap-3">
                    {product.images[0]?.mediaUrl ? (
                      <img
                        src={product.images[0].mediaUrl}
                        alt={product.name}
                        className="h-16 w-16 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="h-16 w-16 shrink-0 rounded-xl bg-brand-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-brand-950">{product.name}</p>
                        {!product.isActive ? <Badge tone="neutral">{t('inactive')}</Badge> : null}
                      </div>
                      <p className="text-sm text-brand-700">
                        {product.price.toLocaleString(locale)} TZS
                      </p>
                      <p className="text-xs text-brand-600">
                        {t('floorLabel')}:{' '}
                        {product.minPrice !== null
                          ? `${product.minPrice.toLocaleString(locale)} TZS`
                          : t('noFloor')}
                      </p>
                      <div className="mt-1">
                        <Badge tone={product.stockQty <= product.lowStockThreshold ? 'danger' : 'neutral'}>
                          {t('stockBadge', { count: product.stockQty })}
                        </Badge>
                      </div>
                      {product.tags.length > 0 ? (
                        <p className="mt-1 truncate text-xs text-brand-500">{product.tags.join(', ')}</p>
                      ) : null}
                    </div>
                  </div>

                  {product.images.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {product.images.map((image) => (
                        <div key={image.id} className="flex flex-col items-center gap-1">
                          {image.mediaUrl ? (
                            <img
                              src={image.mediaUrl}
                              alt={image.description || product.name}
                              className="h-12 w-12 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-brand-100" />
                          )}
                          <button
                            onClick={() => void removeImage(product.id, image.id)}
                            className="text-[11px] font-medium text-red-700 hover:underline"
                          >
                            {t('removeImage')}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        startEdit(product);
                      }}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
                    >
                      {t('edit')}
                    </button>
                    <button
                      onClick={() => void toggleActive(product)}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
                    >
                      {product.isActive ? t('deactivate') : t('activate')}
                    </button>
                    <button
                      onClick={() => {
                        triggerUpload(product.id);
                      }}
                      disabled={uploadingId !== null}
                      className="rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200 disabled:opacity-50"
                    >
                      {uploadingId !== null ? t('uploading') : t('addImage')}
                    </button>
                    <button
                      onClick={() => void remove(product.id)}
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
