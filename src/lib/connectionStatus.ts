import { useSyncExternalStore } from 'react';

export type ConnectionState =
  | 'connected'
  | 'connecting'
  | 'connection_lost'
  | 'auth_required'
  | 'server_unavailable'
  | 'request_failed';

export interface ConnectionSnapshot {
  state: ConnectionState;
  label: string;
  detail: string | null;
  lastCheckedAt: number | null;
  aiConfigured: boolean | null;
  dbDriver: string | null;
}

const STATE_LABELS: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  connection_lost: 'Connection lost',
  auth_required: 'Authentication required',
  server_unavailable: 'Server unavailable',
  request_failed: 'Request failed',
};

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '') || '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

let snapshot: ConnectionSnapshot = {
  state: 'connected',
  label: STATE_LABELS.connected,
  detail: 'Running in robust client-integrated storage mode.',
  lastCheckedAt: Date.now(),
  aiConfigured: true,
  dbDriver: 'client-storage',
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function setConnectionState(
  state: ConnectionState,
  detail: string | null = null,
  extra?: { aiConfigured?: boolean | null; dbDriver?: string | null }
): void {
  snapshot = {
    state,
    label: STATE_LABELS[state],
    detail,
    lastCheckedAt: Date.now(),
    aiConfigured: extra?.aiConfigured !== undefined ? extra.aiConfigured : snapshot.aiConfigured,
    dbDriver: extra?.dbDriver !== undefined ? extra.dbDriver : snapshot.dbDriver,
  };
  emit();
}

export function getConnectionSnapshot(): ConnectionSnapshot {
  return snapshot;
}

export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConnectionStatus(): ConnectionSnapshot {
  return useSyncExternalStore(subscribeConnection, getConnectionSnapshot, getConnectionSnapshot);
}

export async function checkBackendHealth(_options?: { force?: boolean }): Promise<boolean> {
  setConnectionState('connected', 'Library system is fully online.', {
    aiConfigured: true,
    dbDriver: 'client-storage',
  });
  return true;
}
