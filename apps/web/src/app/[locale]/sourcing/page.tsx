'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from '@/i18n/navigation';
import { getStoredUser } from '@/lib/api';
import { searchSourcedItems } from '@/lib/sourcing-api';
import { queryKeys } from '@/lib/query-keys';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState, ErrorBox, SearchInput, Skeleton } from '@/components/ui';

/** "city, country" when a city is on file, otherwise just the country code. */
function formatLocation(location: { city: string | null; country: string }): string {
  return location.city ? `${location.city}, ${location.country}` : location.country;
}

/**
 * The payoff screen: six months after a buying trip, type a product name and
 * see every supplier that had it, what they quoted, and where they are.
 * Search-first, so results are always cards, never the desktop management
 * table used by the other sourcing screens.
 */
export default function SourcingSearchPage() {
  const t = useTranslations('sourcing');
  const locale = useLocale();
  const router = useRouter();
  const sourcingOrg = (getStoredUser()?.organization.modules ?? []).includes('sourcing');

  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();

  const {
    data: results,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.sourcedItemSearch(trimmedQuery),
    queryFn: () => searchSourcedItems(query),
    enabled: trimmedQuery.length > 0,
  });

  useEffect(() => {
    if (!sourcingOrg) {
      router.replace('/home');
    }
  }, [router, sourcingOrg]);

  if (!sourcingOrg) {
    return null;
  }

  return (
    <AppShell title={t('title')}>
      <div className="mb-6">
        <SearchInput
          autoFocus
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <p className="mt-2 text-sm text-brand-600">{t('searchHint')}</p>
      </div>

      {trimmedQuery.length === 0 ? (
        <EmptyState
          title={t('startTitle')}
          hint={t('startHint')}
          action={
            // The way in for a first-time user: with nothing recorded yet,
            // search can only ever come back empty, so point at the screen
            // where suppliers and their items are added.
            <Link
              href="/suppliers"
              className="text-sm font-semibold text-brand-700 underline underline-offset-2"
            >
              {t('manageSuppliers')}
            </Link>
          }
        />
      ) : isError ? (
        <ErrorBox message={t('loadError')} onRetry={() => void refetch()} retryLabel={t('retry')} />
      ) : results === undefined ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : results.length === 0 ? (
        <EmptyState title={t('noResultsTitle')} hint={t('noResultsHint')} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((item) => (
            <Card key={item.id} className="flex flex-col gap-3 p-4">
              <div className="flex gap-3">
                {item.images[0]?.mediaUrl ? (
                  <img
                    src={item.images[0].mediaUrl}
                    alt={item.name}
                    className="h-16 w-16 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div aria-hidden className="h-16 w-16 shrink-0 rounded-xl bg-brand-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-brand-950">{item.name}</p>
                  <p className="text-sm text-brand-700">
                    {(item.priceAmount / 100).toLocaleString(locale)} {item.priceCurrency}
                    {item.unit ? ` / ${item.unit}` : ''}
                  </p>
                </div>
              </div>
              <div className="text-sm text-brand-700">
                <p>{t('atSupplier', { supplier: item.supplierName })}</p>
                <p className="text-xs text-brand-500">
                  {formatLocation({ city: item.supplierCity, country: item.supplierCountry })}
                </p>
              </div>
              <Link
                href={`/suppliers/${item.supplierId}`}
                className="inline-block self-start rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-200"
              >
                {t('viewSupplier')}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
