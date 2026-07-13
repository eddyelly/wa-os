'use client';

import { useState, type ReactNode } from 'react';
import { getStoredUser, clearSession, type StoredUser } from '@/lib/api';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { useSocketInvalidation } from '@/lib/use-socket-invalidation';
import { resetSocket } from '@/lib/socket';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './shell/sidebar';
import { TopHeader } from './shell/top-header';
import { BottomNav } from './shell/bottom-nav';
import { MoreSheet } from './shell/more-sheet';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

export function AppShell({
  children,
  wide = false,
  title,
}: {
  children: ReactNode;
  wide?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [user] = useState<StoredUser | null>(() => getStoredUser());
  const [moreOpen, setMoreOpen] = useState(false);
  const checked = useAuthGuard();
  useSocketInvalidation();

  if (!checked) {
    return null;
  }

  const modules = user?.organization.modules ?? ['appointments'];
  const orgName = user?.organization.name ?? appName;
  const logout = (): void => {
    clearSession();
    resetSocket();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-dvh bg-brand-50">
      <Sidebar modules={modules} orgName={orgName} onLogout={logout} />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <TopHeader title={title ?? appName} />
        <main
          className={cn(
            'mx-auto w-full flex-1 px-4 pt-4 pb-24 lg:pb-8',
            wide ? 'max-w-7xl' : 'max-w-3xl',
          )}
        >
          {children}
        </main>
        <BottomNav modules={modules} onOpenMore={() => { setMoreOpen(true); }} />
        <MoreSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          modules={modules}
          orgName={orgName}
          onLogout={logout}
        />
      </div>
    </div>
  );
}
