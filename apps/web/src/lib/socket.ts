import { io, type Socket } from 'socket.io-client';
import { API_URL, getTokens } from './api.js';

let socket: Socket | null = null;

/**
 * One realtime connection per tab. The auth callback re-reads the token on
 * every (re)connect so token rotation does not strand the socket.
 */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined' || !getTokens()) {
    return null;
  }
  socket ??= io(API_URL, {
    auth: (cb) => {
      cb({ token: getTokens()?.accessToken ?? '' });
    },
  });
  return socket;
}

export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
}
