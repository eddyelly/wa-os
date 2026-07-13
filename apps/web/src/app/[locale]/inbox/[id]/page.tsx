'use client';

import { use } from 'react';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { useSocketInvalidation } from '@/lib/use-socket-invalidation';
import { ConversationThread } from '@/components/conversation-thread';

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const checked = useAuthGuard();
  useSocketInvalidation();

  if (!checked) {
    return null;
  }

  return <ConversationThread conversationId={id} />;
}
