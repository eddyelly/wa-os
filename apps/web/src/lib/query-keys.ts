/**
 * Central registry of TanStack Query keys. Root keys (the `*Root` and plain
 * array entries) are what the socket invalidation bridge targets so a single
 * event invalidates every parameterized variant of a query.
 */
export const queryKeys = {
  dashboard: ['dashboard'] as const,
  conversations: (status?: string) => ['conversations', status ?? 'ALL'] as const,
  conversationsRoot: ['conversations'] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  messagesRoot: ['messages'] as const,
  team: ['team'] as const,
  contacts: (search?: string, tag?: string) => ['contacts', search ?? '', tag ?? ''] as const,
  contactsRoot: ['contacts'] as const,
  appointments: (from?: string) => ['appointments', from ?? ''] as const,
  appointmentsRoot: ['appointments'] as const,
  weeklyStats: ['weeklyStats'] as const,
  organization: ['organization'] as const,
  products: (includeInactive: boolean) => ['products', includeInactive] as const,
  productsRoot: ['products'] as const,
  orders: (status?: string, contactId?: string) => ['orders', status ?? 'ALL', contactId ?? ''] as const,
  ordersRoot: ['orders'] as const,
  notifications: (unreadOnly: boolean) => ['notifications', unreadOnly] as const,
  notificationsRoot: ['notifications'] as const,
};
