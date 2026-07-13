'use client';

import { NotificationBell } from '@/components/notification-bell';
import { LanguageSwitcher } from '@/components/language-switcher';

export function TopHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-100 bg-white px-4 py-3">
      <h1 className="truncate text-lg font-bold text-brand-900">{title}</h1>
      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationBell />
        <LanguageSwitcher tone="light" />
      </div>
    </header>
  );
}
