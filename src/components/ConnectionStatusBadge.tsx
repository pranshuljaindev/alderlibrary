import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { checkBackendHealth, useConnectionStatus } from '../lib/connectionStatus';

interface ConnectionStatusBadgeProps {
  compact?: boolean;
  onRetryComplete?: () => void;
}

export function ConnectionStatusBadge({ compact = false, onRetryComplete }: ConnectionStatusBadgeProps) {
  const status = useConnectionStatus();
  const [retrying, setRetrying] = useState(false);

  const isHealthy = status.state === 'connected';
  const isConnecting = status.state === 'connecting' || retrying;
  const isProblem = !isHealthy && !isConnecting;

  const dotClass = isHealthy
    ? 'bg-emerald-400'
    : isConnecting
      ? 'bg-[#60A5FA]'
      : status.state === 'auth_required'
        ? 'bg-amber-400'
        : 'bg-rose-400';

  const textClass = isHealthy
    ? 'text-[#F5F3EE]/80'
    : isConnecting
      ? 'text-[#93C5FD]'
      : status.state === 'auth_required'
        ? 'text-amber-300'
        : 'text-rose-300';

  async function handleRetry() {
    setRetrying(true);
    try {
      const ok = await checkBackendHealth({ force: true });
      if (ok) {
        onRetryComplete?.();
      }
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-2 text-xs whitespace-nowrap shrink-0 ${
        compact
          ? 'rounded-full border border-white/10 bg-[#12162A]/90 px-2.5 py-1'
          : ''
      }`}
      role="status"
      aria-live="polite"
      title={status.detail || status.label}
    >
      <span
        className={`inline-flex rounded-full h-2 w-2 shrink-0 ${dotClass} ${
          isConnecting ? 'animate-pulse' : ''
        }`}
        aria-hidden="true"
      />
      <span className={`font-medium ${textClass}`}>
        {isConnecting ? 'Connecting...' : status.label}
      </span>

      {isProblem && (
        <button
          type="button"
          onClick={() => void handleRetry()}
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-white hover:border-[#D6AD60]/60 hover:text-[#D6AD60] transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}
