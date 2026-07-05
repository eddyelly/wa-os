'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { getTokens } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getTokens() ? '/inbox' : '/login');
  }, [router]);

  return null;
}
