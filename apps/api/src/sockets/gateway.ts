import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from '../lib/config.js';
import { verifyToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';

// Realtime events the dashboard listens for. Payloads carry ids and
// metadata only; clients refetch details over REST when needed.
export type SocketEvent =
  | 'message.new'
  | 'message.updated'
  | 'conversation.updated'
  | 'channel.status_changed'
  | 'notification.new';

let io: Server | null = null;

function orgRoom(organizationId: string): string {
  return `org:${organizationId}`;
}

export function initSocketGateway(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: config.WEB_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token as unknown;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const subject = verifyToken(token, 'access');
      const data = socket.data as Record<string, string>;
      data.organizationId = subject.organizationId;
      data.userId = subject.userId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const organizationId = (socket.data as Record<string, string>).organizationId ?? '';
    void socket.join(orgRoom(organizationId));
    logger.debug({ socketId: socket.id }, 'socket connected');
  });

  return io;
}

export function emitToOrg(
  organizationId: string,
  event: SocketEvent,
  payload: Record<string, unknown>,
): void {
  if (!io) {
    return;
  }
  io.to(orgRoom(organizationId)).emit(event, payload);
}

export async function closeSocketGateway(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
