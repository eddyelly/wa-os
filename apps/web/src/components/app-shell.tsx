'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { BusinessModule } from '@waos/shared';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { clearSession, getStoredUser, getTokens, type StoredUser } from '@/lib/api';
import { resetSocket } from '@/lib/socket';
import { LanguageSwitcher } from './language-switcher';
import { NotificationBell } from './notification-bell';

interface NavItem {
  href: string;
  label: string;
  requiredModule?: BusinessModule;
}

/**
 * Client shell for authenticated screens: token guard plus the bottom nav
 * (primary actions stay thumb-reach on mobile).
 */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getTokens()) {
      router.replace('/login');
      return;
    }
    setUser(getStoredUser());
    setChecked(true);
  }, [router]);

  if (!checked) {
    return null;
  }

  const logout = (): void => {
    clearSession();
    resetSocket();
    router.replace('/login');
  };

  const modules = user?.organization.modules ?? ['appointments'];
  const allNavItems: NavItem[] = [
    { href: '/home', label: t('home') },
    { href: '/inbox', label: t('inbox') },
    { href: '/appointments', label: t('appointments'), requiredModule: 'appointments' },
    { href: '/products', label: t('products'), requiredModule: 'shop' },
    { href: '/orders', label: t('orders'), requiredModule: 'shop' },
    { href: '/contacts', label: t('contacts') },
    { href: '/settings', label: t('settings') },
  ];
  const navItems = allNavItems.filter(
    (item) => !item.requiredModule || modules.includes(item.requiredModule),
  );

  return (
    <div className="flex min-h-dvh flex-col bg-brand-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-100 bg-white px-4 py-3">
        <Link href="/home" className="text-lg font-bold text-brand-900">
          {process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS'}
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationBell />
          <span className="hidden text-sm text-brand-700 sm:block">
            {user?.organization.name}
          </span>
          <LanguageSwitcher />
          <button
            onClick={logout}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
          >
            {t('logout')}
          </button>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 pt-4 pb-24 ${wide ? 'max-w-7xl' : 'max-w-3xl'}`}>{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-brand-100 bg-white">
        <div className="mx-auto flex max-w-3xl">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 min-w-0 overflow-hidden truncate py-3 text-center text-sm font-medium ${
                  active ? 'text-brand-800 font-semibold' : 'text-brand-500'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
