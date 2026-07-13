'use client';

import { use } from 'react';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { ConversationThread } from '@/components/conversation-thread';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const checked = useAuthGuard();

  if (!checked) {
    return null;
  }

  return <ConversationThread conversationId={id} />;
}
