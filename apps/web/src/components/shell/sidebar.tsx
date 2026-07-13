'use client';

import { useTranslations } from 'next-intl';
import type { BusinessModule } from '@waos/shared';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { visibleEntries } from './nav-model';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

export function Sidebar({
  modules,
  orgName,
  onLogout,
}: {
  modules: readonly BusinessModule[];
  orgName: string;
  onLogout: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const entries = visibleEntries(modules);
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-brand-900 text-brand-50 lg:flex">
      <div className="px-5 py-5 text-lg font-bold">
        {appName}
        <span className="text-accent-400">.</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {entries.map((e) => {
          const active = pathname.startsWith(e.href);
          const Icon = e.icon;
          return (
            <Link
              key={e.key}
              href={e.href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-brand-700 text-white' : 'text-brand-100 hover:bg-brand-800',
              )}
            >
              <Icon className="size-5 shrink-0" />
              {t(e.key)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-brand-800 px-4 py-4">
        <p className="truncate text-sm font-medium text-brand-100">{orgName}</p>
        <button
          onClick={onLogout}
          className="mt-1 text-xs text-brand-300 underline underline-offset-2 hover:text-brand-100"
        >
          {t('logout')}
        </button>
      </div>
    </aside>
  );
}
