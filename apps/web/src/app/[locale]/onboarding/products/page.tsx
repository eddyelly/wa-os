'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ProductDto } from '@waos/shared';
import { useRouter } from '@/i18n/navigation';
import { ApiError, getStoredUser } from '@/lib/api';
import { createProduct } from '@/lib/shop-api';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
import { OnboardingShell } from '@/components/onboarding-shell';

const DEFAULT_STOCK_QTY = '0';
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export default function OnboardingProductsPage() {
  const t = useTranslations('onboardingProducts');
  const router = useRouter();
  const locale = useLocale();
  const shopOrg = (getStoredUser()?.organization.modules ?? []).includes('shop');
  const checked = useAuthGuard();

  // Products added this visit only. A listProducts fetch would work too, but
  // it costs a round trip this step does not need: the user just created
  // these, so the local copy is already correct and keeps the step fast.
  const [added, setAdded] = useState<ProductDto[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [stockQty, setStockQty] = useState(DEFAULT_STOCK_QTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!checked) {
      return;
    }
    if (!shopOrg) {
      router.replace('/onboarding/knowledge');
    }
  }, [checked, router, shopOrg]);

  const goToKnowledge = (): void => {
    router.push('/onboarding/knowledge');
  };

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    const priceNum = Number.parseInt(price, 10);
    const stockQtyNum = Number.parseInt(stockQty, 10);
    const minPriceTrimmed = minPrice.trim();
    const minPriceNum = minPriceTrimmed === '' ? null : Number.parseInt(minPriceTrimmed, 10);

    const invalid =
      Number.isNaN(priceNum) ||
      priceNum <= 0 ||
      Number.isNaN(stockQtyNum) ||
      stockQtyNum < 0 ||
      (minPriceNum !== null && (Number.isNaN(minPriceNum) || minPriceNum <= 0));

    if (invalid) {
      setError(t('invalidNumbers'));
      return;
    }

    setBusy(true);
    try {
      const product = await createProduct({
        name,
        price: priceNum,
        minPrice: minPriceNum ?? undefined,
        stockQty: stockQtyNum,
        lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
      });
      setAdded((prev) => [...prev, product]);
      setName('');
      setPrice('');
      setMinPrice('');
      setStockQty(DEFAULT_STOCK_QTY);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingShell step={2} includeProducts wide>
      <Card className="p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-brand-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-600">{t('subtitle')}</p>

        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
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
            <Field label={t('price')}>
              <Input
                type="number"
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
                min={1}
                value={minPrice}
                onChange={(e) => {
                  setMinPrice(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field label={t('stockQty')}>
            <Input
              type="number"
              min={0}
              required
              value={stockQty}
              onChange={(e) => {
                setStockQty(e.target.value);
              }}
            />
          </Field>
          {error ? <ErrorBox message={error} /> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {t('addAnother')}
          </Button>
        </form>
      </Card>

      {added.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-brand-100">{t('added')}</h2>
          <ul className="space-y-2">
            {added.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm"
              >
                <span className="truncate font-medium text-brand-950">{product.name}</span>
                <span className="text-sm text-brand-700">
                  {product.price.toLocaleString(locale)} TZS
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 space-y-3">
        <Button onClick={goToKnowledge} className="w-full">
          {t('continue')}
        </Button>
        <button
          type="button"
          onClick={goToKnowledge}
          className="w-full text-center text-sm font-medium text-white/80 hover:text-white"
        >
          {t('skip')}
        </button>
      </div>
    </OnboardingShell>
  );
}
