import { authResponseSchema, type AuthResponse, type TokenPair } from '@waos/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKENS_KEY = 'waos.tokens';
const USER_KEY = 'waos.user';

export type StoredUser = Pick<AuthResponse, 'user' | 'organization'>;

export function getTokens(): TokenPair | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
  } catch {
    return null;
  }
}

export function setSession(auth: AuthResponse): void {
  window.localStorage.setItem(TOKENS_KEY, JSON.stringify(auth.tokens));
  window.localStorage.setItem(
    USER_KEY,
    JSON.stringify({ user: auth.user, organization: auth.organization }),
  );
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKENS_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function tryRefresh(): Promise<boolean> {
  const tokens = getTokens();
  if (!tokens) {
    return false;
  }
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!response.ok) {
      return false;
    }
    const auth = authResponseSchema.parse((await response.json()) as unknown);
    setSession(auth);
    return true;
  } catch {
    return false;
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const doFetch = (): Promise<Response> => {
    const tokens = getTokens();
    return fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.auth !== false && tokens
          ? { Authorization: `Bearer ${tokens.accessToken}` }
          : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  let response = await doFetch();
  if (response.status === 401 && options.auth !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      response = await doFetch();
    } else {
      clearSession();
    }
  }

  if (!response.ok) {
    let code = 'REQUEST_FAILED';
    let message = 'Request failed. Try again.';
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // keep defaults
    }
    throw new ApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}

/** Multipart upload with the same auth and refresh behavior as apiFetch. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const doFetch = (): Promise<Response> => {
    const tokens = getTokens();
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {},
      body: formData,
    });
  };
  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      response = await doFetch();
    }
  }
  if (!response.ok) {
    let message = 'Upload failed. Try again.';
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // keep default
    }
    throw new ApiError(response.status, 'UPLOAD_FAILED', message);
  }
  return (await response.json()) as T;
}
