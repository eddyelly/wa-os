/**
 * Notification stub (Task 5). Task 6 replaces this body with the real
 * implementation: persisting a Notification row and emitting it over
 * Socket.IO. Kept here now, against the exact signature callers use, so
 * order-service compiles and its tests can spy on the call.
 */
export const notificationService = {
  async notify(
    type: 'NEW_ORDER' | 'LOW_STOCK' | 'HANDOFF',
    payload: Record<string, unknown>,
  ): Promise<void> {
    void type;
    void payload;
    await Promise.resolve();
  },
};
