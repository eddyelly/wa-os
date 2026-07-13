'use client';

import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';
import type { BusinessModule } from '@waos/shared';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { primaryEntries } from './nav-model';

export function BottomNav({
  modules,
  onOpenMore,
}: {
  modules: readonly BusinessModule[];
  onOpenMore: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const primary = primaryEntries(modules);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-brand-100 bg-white lg:hidden">
      {primary.map((e) => {
        const active = pathname.startsWith(e.href);
        const Icon = e.icon;
        return (
          <Link
            key={e.key}
            href={e.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium',
              active ? 'text-brand-800' : 'text-brand-500',
            )}
          >
            <Icon className="size-5" />
            {t(e.key)}
          </Link>
        );
      })}
      <button
        onClick={onOpenMore}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium text-brand-500"
      >
        <Menu className="size-5" />
        {t('more')}
      </button>
    </nav>
  );
}
