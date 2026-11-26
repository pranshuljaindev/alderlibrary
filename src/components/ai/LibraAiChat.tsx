import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApiError, apiRequest } from '../../lib/api';
import type {
  AiChatMessage,
  AiConversation,
  AiRecommendedBookCard,
  UserRole,
} from '../../types';
import { BookCover } from '../student/BookCover';

interface LibraAiChatProps {
  role: UserRole;
  compact?: boolean;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onReserveBook?: (bookId: number) => void;
  onOpenBookDetails?: (bookId: number) => void;
  onDataChanged?: () => void;
}

interface AiStatusResponse {
  assistantName: string;
  subtitle: string;
  tagline: string;
  model: string;
  configured: boolean;
  roleScope: UserRole;
  userUsage: { requests: number; totalTokens: number };
  globalUsage?: { requests: number; totalTokens: number };
}

interface CommandPreset {
  command: string;
  label: string;
  description: string;
  needsArg?: boolean;
}

const STUDENT_COMMAND_PRESETS: CommandPreset[] = [
  { command: '/find-book', label: 'Find Book', description: 'Search catalog by title, author, subject, or ISBN', needsArg: true },
  { command: '/recommend', label: 'Recommend', description: 'Get personalized study & reading picks' },
  { command: '/my-books', label: 'My Books', description: 'View currently issued & overdue volumes' },
  { command: '/due-dates', label: 'Due Dates', description: 'Check upcoming book return deadlines' },
  { command: '/my-history', label: 'My History', description: 'Review past & active borrowing history' },
  { command: '/my-fines', label: 'My Fines', description: 'Inspect unpaid or settled fine balances' },
  { command: '/reserve', label: 'Reserve', description: 'Check active holds & reserve available titles', needsArg: true },
  { command: '/renew', label: 'Renew', description: 'Check loan renewal eligibility' },
  { command: '/library-help', label: 'Library Help', description: 'Borrowing rules & command reference' },
];

const ADMIN_COMMAND_PRESETS: CommandPreset[] = [
  { command: '/dashboard', label: 'Dashboard', description: 'Live circulation, inventory & fine overview' },
  { command: '/inventory', label: 'Inventory', description: 'Category stock breakdown & utilization' },
  { command: '/low-stock', label: 'Low Stock', description: 'Titles at or below restock threshold' },
  { command: '/overdue', label: 'Overdue', description: 'All overdue loans & borrower contacts' },
  { command: '/students', label: 'Students', description: 'Search members or inspect pending approvals', needsArg: true },
  { command: '/popular-books', label: 'Popular Books', description: 'Most borrowed titles & demand leaderboard' },
  { command: '/fine-report', label: 'Fine Report', description: 'Unpaid, paid & waived fine ledger summary' },
  { command: '/analytics', label: 'Analytics', description: 'Monthly circulation trends & demand forecast' },
  { command: '/report', label: 'Full Report', description: 'Executive operations & action digest' },
  { command: '/help', label: 'Help', description: 'Admin slash commands & capabilities' },
];

const STUDENT_PROMPTS = [
  'Recommend Computer Science books tailored to my profile',
  'When are my borrowed books due and can I renew any?',
  'Check my active reservations and queue position',
  'Find digital study guides in Mathematics or Computing',
];

const ADMIN_PROMPTS = [
  'Summarize today’s library health, active loans, and overdue risk',
  'Identify low-stock books and projected demand restock priorities',
  'Generate a popular books circulation report',
  'List overdue loans and members with unpaid fines',
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function LibraAiChat({
  role,
  compact = false,
  onNotify,
  onReserveBook,
  onOpenBookDetails,
  onDataChanged,
}: LibraAiChatProps) {
  const [status, setStatus] = useState<AiStatusResponse | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [actionStates, setActionStates] = useState<Record<string, 'confirmed' | 'cancelled' | 'busy'>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadConversations = useCallback(async (convId?: string) => {
    setInitError(null);
    try {
      const qs = convId ? `?conversationId=${encodeURIComponent(convId)}` : '';
      const [st, convData] = await Promise.all([
        apiRequest<AiStatusResponse>('/api/ai/status'),
        apiRequest<{
          conversations: AiConversation[];
          activeConversationId: string | null;
          messages: AiChatMessage[];
        }>(`/api/ai/conversations${qs}`),
      ]);
      setStatus(st);
      setConversations(convData.conversations);
      setActiveConvId(convData.activeConversationId);
      setMessages(convData.messages);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unable to load LIBRA AI.';
      setInitError(msg);
      if (err instanceof ApiError && err.status !== 401) {
        onNotify('error', msg);
      }
    } finally {
      setLoadingInit(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function sendPrompt(promptText: string) {
    const clean = promptText.trim();
    if (!clean || sending) return;

    setLastFailedPrompt(null);
    const optimisticUser: AiChatMessage = {
      id: Date.now(),
      conversationId: activeConvId || 'pending',
      sender: 'user',
      content: clean,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setInput('');
    setSending(true);

    try {
      const res = await apiRequest<{
        conversationId: string;
        assistantMessage: AiChatMessage;
      }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: clean,
          conversationId: activeConvId || undefined,
        }),
      });

      setActiveConvId(res.conversationId);
      setMessages((prev) => [...prev, res.assistantMessage]);
      const convRefresh = await apiRequest<{ conversations: AiConversation[] }>('/api/ai/conversations');
      setConversations(convRefresh.conversations);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'LIBRA AI could not process your request.';
      setLastFailedPrompt(clean);
      onNotify('error', msg);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          conversationId: activeConvId || 'error',
          sender: 'assistant',
          content: `**LIBRA AI Notice:** ${msg}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handlePresetClick(preset: CommandPreset) {
    if (preset.needsArg) {
      // Allow immediate inspection or appending a search term
      setInput(`${preset.command} `);
      inputRef.current?.focus();
    } else {
      void sendPrompt(preset.command);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await sendPrompt(input);
  }

  async function handleNewChat() {
    setActiveConvId(null);
    setMessages([]);
    setLastFailedPrompt(null);
  }

  async function handleDeleteConversation() {
    if (!activeConvId) {
      setMessages([]);
      setLastFailedPrompt(null);
      return;
    }
    try {
      await apiRequest(`/api/ai/conversations/${encodeURIComponent(activeConvId)}`, {
        method: 'DELETE',
      });
      setActiveConvId(null);
      setMessages([]);
      setLastFailedPrompt(null);
      await loadConversations();
      onNotify('info', 'Conversation cleared.');
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    }
  }

  async function handlePendingAction(actionId: string, decision: 'confirm' | 'cancel') {
    setActionStates((prev) => ({ ...prev, [actionId]: 'busy' }));
    try {
      const res = await apiRequest<{ status: 'confirmed' | 'cancelled'; message: string }>('/api/ai/confirm-action', {
        method: 'POST',
        body: JSON.stringify({ actionId, decision }),
      });
      setActionStates((prev) => ({ ...prev, [actionId]: res.status }));
      onNotify(res.status === 'confirmed' ? 'success' : 'info', res.message);
      if (res.status === 'confirmed') {
        onDataChanged?.();
      }
    } catch (err) {
      setActionStates((prev) => {
        const next = { ...prev };
        delete next[actionId];
        return next;
      });
      if (err instanceof ApiError) onNotify('error', err.message);
    }
  }

  const commandPresets = role === 'admin' ? ADMIN_COMMAND_PRESETS : STUDENT_COMMAND_PRESETS;
  const suggestedPrompts = role === 'admin' ? ADMIN_PROMPTS : STUDENT_PROMPTS;

  return (
    <div
      className={`flex flex-col bg-[#0B0E1D]/95 border border-[#A78BFA]/20 rounded-2xl overflow-hidden ${
        compact ? 'h-full' : 'h-[calc(100vh-11rem)] min-h-[560px]'
      }`}
    >
      {/* Top Branding Bar */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-white/10 bg-[#10152B]/90 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#4F46E5] text-white flex items-center justify-center shrink-0 shadow-lg shadow-[#7C3AED]/25">
            <Sparkles className="w-4.5 h-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-semibold text-white truncate">
                LIBRA AI – Your Intelligent Library Assistant
              </h2>
            </div>
            <p className="text-[11px] text-[#A78BFA] flex items-center gap-2">
              <span>Your Library. Your Intelligence.</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#94A3B8] font-mono">
                {role === 'admin' ? 'Admin Intelligence Scope' : 'Member Academic Scope'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {conversations.length > 0 && !compact && (
            <select
              aria-label="Conversation history"
              value={activeConvId || ''}
              onChange={(e) => void loadConversations(e.target.value || undefined)}
              className="dark-glass-input obsidian-input-focus rounded-lg px-2.5 py-1.5 text-xs max-w-[180px]"
            >
              <option value="">New Conversation</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleNewChat}
            title="Start new conversation"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#A78BFA]/30 bg-[#0A0D1A]/80 px-2.5 py-1.5 text-xs font-medium text-white hover:border-[#A78BFA] hover:text-[#A78BFA] transition-colors cursor-pointer"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" />
            {!compact && <span>New</span>}
          </button>

          <button
            type="button"
            onClick={() => void handleDeleteConversation()}
            title="Clear conversation"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#0A0D1A]/80 px-2.5 py-1.5 text-xs font-medium text-[#94A3B8] hover:border-rose-400/50 hover:text-rose-300 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {!compact && <span>Clear</span>}
          </button>
        </div>
      </div>

      {/* Config Alert if GEMINI_API_KEY missing */}
      {status && !status.configured && (
        <div className="px-4 py-2 bg-amber-950/60 border-b border-amber-400/30 flex items-center gap-2 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          <span>
            Gemini natural-language mode requires <code className="font-mono text-amber-100">GEMINI_API_KEY</code>. All{' '}
            <code className="font-mono text-amber-100">/slash</code> database commands work directly below.
          </span>
        </div>
      )}

      {/* Quick Slash-Command Strip */}
      <div className="px-4 py-2 border-b border-white/10 bg-[#0D1224]/95 flex items-center gap-1.5 overflow-x-auto">
        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#94A3B8] shrink-0 mr-1">
          <Terminal className="w-3 h-3 text-[#A78BFA]" aria-hidden="true" />
          <span>Commands</span>
        </span>
        {commandPresets.map((preset) => (
          <button
            key={preset.command}
            type="button"
            disabled={sending}
            title={preset.description}
            onClick={() => handlePresetClick(preset)}
            className="shrink-0 rounded-lg border border-[#A78BFA]/25 bg-[#141A33] px-2.5 py-1 text-[11px] font-mono text-[#CBD5E1] hover:border-[#A78BFA]/70 hover:text-white hover:bg-[#8B5CF6]/20 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {preset.command}
          </button>
        ))}
      </div>

      {/* Messages Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {loadingInit ? (
          <div className="h-full flex items-center justify-center text-xs text-[#94A3B8] gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#A78BFA]" />
            <span>Initializing LIBRA AI context...</span>
          </div>
        ) : initError && messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center max-w-md mx-auto">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
            <p className="text-xs text-[#CBD5E1]">{initError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadingInit(true);
                void loadConversations();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#A78BFA]/40 bg-[#141A33] px-3 py-1.5 text-xs font-medium text-white hover:border-[#A78BFA] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center max-w-2xl mx-auto space-y-5 py-4">
            <div className="text-center space-y-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#8B5CF6]/15 border border-[#A78BFA]/35 text-[#A78BFA] mx-auto">
                <Sparkles className="w-6 h-6" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold text-white">
                {role === 'admin'
                  ? 'Operations, Inventory & Policy Intelligence'
                  : 'Ask About Books, Deadlines, Study Paths & Holds'}
              </h3>
              <p className="text-xs text-[#94A3B8] max-w-md mx-auto leading-relaxed">
                {role === 'admin'
                  ? 'Run live /slash commands or ask LIBRA AI about circulation, low-stock thresholds, overdue accounts, and demand forecasts.'
                  : 'Use /slash commands or natural questions to search the catalog, check due dates and holds, or discover recommended titles.'}
              </p>
            </div>

            {/* Structured Command Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {commandPresets.slice(0, 6).map((preset) => (
                <button
                  key={preset.command}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className="text-left rounded-xl border border-white/10 bg-[#12162A]/90 px-3 py-2.5 hover:border-[#A78BFA]/50 hover:bg-[#8B5CF6]/15 transition-all cursor-pointer"
                >
                  <div className="text-xs font-mono font-semibold text-[#A78BFA]">{preset.command}</div>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5 line-clamp-1">{preset.description}</div>
                </button>
              ))}
            </div>

            {status?.configured && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendPrompt(prompt)}
                    className="text-left rounded-xl border border-white/10 bg-[#12162A]/85 px-3.5 py-2.5 text-xs text-[#CBD5E1] hover:border-[#A78BFA]/45 hover:bg-[#8B5CF6]/15 hover:text-white transition-all cursor-pointer"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const recBooks = msg.metadata?.recommendedBooks || [];
            const tables = msg.metadata?.tables || [];
            const pendingAction = msg.metadata?.pendingAction;
            const actionStatus = pendingAction ? actionStates[pendingAction.actionId] || pendingAction.status : undefined;

            return (
              <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-2`}>
                <div
                  className={`max-w-[92%] sm:max-w-[82%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                    isUser
                      ? 'bg-[#4F46E5]/30 border border-[#A78BFA]/35 text-white'
                      : 'bg-[#12162A]/95 border border-white/10 text-[#E2E8F0]'
                  }`}
                >
                  <div className="prose prose-invert prose-sm max-w-none prose-headings:text-white prose-strong:text-[#A78BFA] prose-code:text-[#38BDF8] prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>

                  {/* Interactive Book Recommendation Cards */}
                  {recBooks.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {recBooks.map((book: AiRecommendedBookCard) => (
                        <div
                          key={book.id}
                          className="rounded-xl border border-white/10 bg-[#0A0D1A]/85 p-2.5 flex items-center gap-3"
                        >
                          <BookCover
                            title={book.title}
                            category={book.category}
                            coverUrl={book.cover_url}
                            size="xs"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="text-xs font-semibold text-white line-clamp-1">
                              {book.title}
                            </div>
                            <div className="text-[11px] text-[#94A3B8] truncate">{book.author}</div>
                            <div className="text-[10px] font-mono tabular-nums text-[#A78BFA]">
                              {book.call_number} · {book.available_copies}/{book.total_copies} avail
                            </div>
                            {book.reason && (
                              <div className="text-[10px] text-[#38BDF8] line-clamp-1">{book.reason}</div>
                            )}
                            {role === 'student' && (onReserveBook || onOpenBookDetails) && (
                              <div className="flex items-center gap-2 pt-1">
                                {onOpenBookDetails && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenBookDetails(book.id)}
                                    className="text-[10px] font-medium text-[#CBD5E1] hover:text-[#A78BFA] underline cursor-pointer"
                                  >
                                    Details
                                  </button>
                                )}
                                {onReserveBook && (
                                  <button
                                    type="button"
                                    onClick={() => onReserveBook(book.id)}
                                    className="inline-flex items-center gap-1 rounded-md bg-[#8B5CF6]/20 border border-[#A78BFA]/40 px-2 py-0.5 text-[10px] font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/30 cursor-pointer"
                                  >
                                    <BookMarked className="w-2.5 h-2.5" />
                                    <span>Reserve</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Admin Data Tables */}
                  {tables.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {tables.map((tbl, idx) => (
                        <div key={`${tbl.title}-${idx}`} className="rounded-xl border border-white/10 bg-[#0A0D1A]/85 overflow-hidden">
                          <div className="px-3 py-2 bg-[#12162A] border-b border-white/10 text-[11px] font-semibold text-[#A78BFA]">
                            {tbl.title}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="border-b border-white/10 text-[#94A3B8]">
                                  {tbl.columns.map((col) => (
                                    <th key={col} className="py-1.5 px-2.5 font-medium whitespace-nowrap">
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {tbl.rows.map((r, rIdx) => (
                                  <tr key={rIdx} className="hover:bg-[#8B5CF6]/10">
                                    {r.map((cell, cIdx) => (
                                      <td key={cIdx} className="py-1.5 px-2.5 text-[#E2E8F0] font-mono tabular-nums whitespace-nowrap">
                                        {String(cell)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Interactive Admin Action Confirmation Card */}
                  {pendingAction && role === 'admin' && (
                    <div className="mt-3 rounded-xl border border-[#A78BFA]/40 bg-[#0A0D1A]/90 p-3.5 space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#A78BFA]">
                        <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Confirmation Required Before Database Update</span>
                      </div>
                      <p className="text-xs text-white">{pendingAction.summary}</p>
                      {actionStatus === 'confirmed' ? (
                        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#34D399]">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Confirmed &amp; executed successfully</span>
                        </div>
                      ) : actionStatus === 'cancelled' ? (
                        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A3B8]">
                          <XCircle className="w-4 h-4" />
                          <span>Cancelled</span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={actionStatus === 'busy'}
                            onClick={() => void handlePendingAction(pendingAction.actionId, 'confirm')}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#8B5CF6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#7C3AED] disabled:opacity-50 cursor-pointer"
                          >
                            {actionStatus === 'busy' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>Confirm &amp; Execute</span>
                          </button>
                          <button
                            type="button"
                            disabled={actionStatus === 'busy'}
                            onClick={() => void handlePendingAction(pendingAction.actionId, 'cancel')}
                            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-[#CBD5E1] hover:border-rose-400/50 hover:text-rose-300 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <span className="text-[10px] font-mono tabular-nums text-[#64748B] px-1">
                  {isUser ? 'You' : 'LIBRA AI'} · {formatTime(msg.createdAt)}
                  {!isUser && msg.metadata?.tokensUsed ? ` · ${msg.metadata.tokensUsed} tokens` : ''}
                </span>
              </div>
            );
          })
        )}

        {lastFailedPrompt && !sending && (
          <div className="flex items-center justify-start">
            <button
              type="button"
              onClick={() => void sendPrompt(lastFailedPrompt)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#A78BFA]/40 bg-[#141A33] px-3 py-1.5 text-xs font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/20 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Last Request</span>
            </button>
          </div>
        )}

        {sending && (
          <div className="flex items-start gap-2">
            <div className="rounded-2xl bg-[#12162A]/90 border border-[#A78BFA]/25 px-4 py-3 inline-flex items-center gap-2 text-xs text-[#A78BFA]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>LIBRA AI is consulting library records...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <form onSubmit={handleSubmit} className="p-3 sm:p-4 border-t border-white/10 bg-[#10152B]/90 flex items-center gap-2.5">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder={
            role === 'admin'
              ? 'Type a /command (e.g. /dashboard, /overdue) or ask LIBRA AI...'
              : 'Type a /command (e.g. /find-book, /my-books) or ask LIBRA AI...'
          }
          className="dark-glass-input obsidian-input-focus flex-1 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Send message to LIBRA AI"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#8B5CF6] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-[#7C3AED] disabled:opacity-40 transition-all cursor-pointer shrink-0"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Ask</span>
        </button>
      </form>
    </div>
  );
}
