'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { getTokens } from './api';

/**
 * Redirects to /login when no session tokens are present. Returns false
 * until the check has run so callers can withhold authenticated markup
 * during the single render where the redirect may fire.
 */
export function useAuthGuard(): boolean {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getTokens()) {
      router.replace('/login');
      return;
    }
    setChecked(true);
  }, [router]);

  return checked;
}
