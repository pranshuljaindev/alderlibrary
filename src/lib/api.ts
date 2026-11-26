import { handleClientApi } from './clientStore';
import { setConnectionState } from './connectionStatus';

export function buildApiUrl(path: string): string {
  return path;
}

let inMemoryAccessToken: string | null = null;
let sessionExpiredHandler: ((message: string) => void) | null = null;

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      window.localStorage.setItem('alderbrook_token', token);
    } else {
      window.localStorage.removeItem('alderbrook_token');
      window.localStorage.removeItem('alderbrook_user');
    }
  }
}

export function getAccessToken(): string | null {
  if (!inMemoryAccessToken && typeof window !== 'undefined') {
    inMemoryAccessToken = window.localStorage.getItem('alderbrook_token');
  }
  return inMemoryAccessToken;
}

export function setSessionExpiredHandler(handler: ((message: string) => void) | null): void {
  sessionExpiredHandler = handler;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  lockedUntil?: number;

  constructor(message: string, status: number, code?: string, lockedUntil?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.lockedUntil = lockedUntil;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { skipAuthHandling?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  const { skipAuthHandling, headers: _, ...rest } = options;
  const method = (rest.method || 'GET').toUpperCase();

  let parsedBody: any = undefined;
  if (rest.body && typeof rest.body === 'string') {
    try {
      parsedBody = JSON.parse(rest.body);
    } catch {
      parsedBody = rest.body;
    }
  }

  // Execute 100% client-side via clientStore (localStorage engine)
  // Ensures zero network requests to non-existent backend endpoints, eliminating HTTP 405 completely.
  const result = handleClientApi(method, path, parsedBody);
  setConnectionState('connected', 'Running in local frontend-only demo mode.');

  if (result.status >= 400) {
    if (result.status === 401 && !skipAuthHandling && inMemoryAccessToken) {
      inMemoryAccessToken = null;
      window.localStorage.removeItem('alderbrook_token');
      sessionExpiredHandler?.(result.data.error || 'Your session expired. Please sign in again.');
    }
    throw new ApiError(
      result.data.error || `Request failed with status ${result.status}`,
      result.status,
      result.data.code,
      result.data.lockedUntil
    );
  }

  return result.data as T;
}
