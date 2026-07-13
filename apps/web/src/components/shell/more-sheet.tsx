'use client';

import { useTranslations } from 'next-intl';
import type { BusinessModule } from '@waos/shared';
import { Link } from '@/i18n/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/shadcn/dialog';
import { overflowEntries } from './nav-model';

export function MoreSheet({
  open,
  onOpenChange,
  modules,
  orgName,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modules: readonly BusinessModule[];
  orgName: string;
  onLogout: () => void;
}) {
  const t = useTranslations('nav');
  const entries = overflowEntries(modules);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-2">
        <DialogHeader>
          <DialogTitle>{orgName}</DialogTitle>
        </DialogHeader>
        <nav className="flex flex-col">
          {entries.map((e) => {
            const Icon = e.icon;
            return (
              <Link
                key={e.key}
                href={e.href}
                onClick={() => {
                  onOpenChange(false);
                }}
                className="flex items-center gap-3 rounded-xl px-2 py-3 text-sm font-medium text-brand-800 hover:bg-brand-50"
              >
                <Icon className="size-5" />
                {t(e.key)}
              </Link>
            );
          })}
          <button
            onClick={onLogout}
            className="mt-1 flex items-center gap-3 rounded-xl px-2 py-3 text-left text-sm font-medium text-red-700 hover:bg-red-50"
          >
            {t('logout')}
          </button>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
