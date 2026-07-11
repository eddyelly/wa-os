'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { getTokens } from '@/lib/api';
import { ConversationThread } from '@/components/conversation-thread';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getTokens()) {
      router.replace('/login');
      return;
    }
    setChecked(true);
  }, [router]);

  if (!checked) {
    return null;
  }

  return <ConversationThread conversationId={id} />;
}
