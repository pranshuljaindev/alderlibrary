import { useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Barcode,
  BookCopy as BookCopyIcon,
  CheckCircle2,
  Loader2,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  X,
} from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import type { Book, BookCopy, FineRecord, LoanRecord, ReservationRecord, User } from '../../types';
import { BookScannerModal } from '../common/BookScannerModal';

interface AdminCirculationSectionProps {
  mode: 'circulation' | 'reservations' | 'fines';
  libraryName: string;
  books: Book[];
  users: User[];
  loans: LoanRecord[];
  reservations: ReservationRecord[];
  fines: FineRecord[];
  defaultDays: number;
  busyAction: string | null;
  onRefresh: () => Promise<void>;
  onIssueBook: (payload: { userId: string; bookId: string; days: number; notes: string; barcode?: string }) => Promise<void>;
  onReturnBook: (loan: LoanRecord) => Promise<void>;
  onApproveRenewal: (loanId: number) => Promise<void>;
  onReservationAction: (reservationId: number, status: 'ready' | 'fulfilled' | 'cancelled') => Promise<void>;
  onFineSettlement: (fineId: number, status: 'paid' | 'waived') => Promise<void>;
  onOpenAssessFine: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function generateSampleBarcode(): string {
  return `BC-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function AdminCirculationSection({
  mode,
  libraryName,
  books,
  users,
  loans,
  reservations,
  fines,
  defaultDays,
  busyAction,
  onRefresh,
  onIssueBook,
  onReturnBook,
  onApproveRenewal,
  onReservationAction,
  onFineSettlement,
  onOpenAssessFine,
  onNotify,
}: AdminCirculationSectionProps) {
  const [deskTab, setDeskTab] = useState<'standard' | 'barcode-return' | 'qr'>('standard');
  const [loanFilter, setLoanFilter] = useState<'open' | 'overdue' | 'returned' | 'all'>('open');
  const [issueForm, setIssueForm] = useState({
    userId: '',
    bookId: '',
    days: defaultDays,
    notes: '',
    barcode: generateSampleBarcode(),
  });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'book-lookup' | 'issue-barcode' | 'return-barcode'>('book-lookup');

  // Barcode Return & Verification State
  const [returnBarcode, setReturnBarcode] = useState('');
  const [verifiedLoan, setVerifiedLoan] = useState<LoanRecord | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // QR Checkout / Return
  const [qrCode, setQrCode] = useState('');
  const [qrUserId, setQrUserId] = useState('');
  const [qrLookup, setQrLookup] = useState<{
    copy: BookCopy & { book_title: string; book_call_number: string; shelf_location: string };
    activeLoan: { id: number; borrower_name: string; borrower_email: string; due_date: string } | null;
  } | null>(null);
  const [qrBusy, setQrBusy] = useState(false);

  // Printable Receipt Modal
  const [receiptLoan, setReceiptLoan] = useState<LoanRecord | null>(null);

  const activeMembers = users.filter((u) => u.role === 'student' && u.status === 'active');
  const availableBooks = books.filter((b) => b.available_copies > 0);
  const activeLoansWithBarcodes = loans.filter((l) => l.status !== 'returned' && (l.barcode || l.copy_code));

  const filteredLoans = loans.filter((l) => {
    if (loanFilter === 'open') return l.status === 'active' || l.status === 'overdue';
    if (loanFilter === 'overdue') return l.status === 'overdue';
    if (loanFilter === 'returned') return l.status === 'returned';
    return true;
  });

  async function handleStandardIssue(e: FormEvent) {
    e.preventDefault();
    await onIssueBook(issueForm);
    setIssueForm((f) => ({
      ...f,
      bookId: '',
      notes: '',
      barcode: generateSampleBarcode(),
    }));
  }

  async function handleVerifyBarcode(codeToVerify?: string) {
    const code = (codeToVerify ?? returnBarcode).trim();
    if (!code) {
      onNotify('error', 'Please enter or scan a barcode sticker to verify.');
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);
    setVerifiedLoan(null);
    try {
      const res = await apiRequest<{ matched: boolean; loan: LoanRecord }>('/api/admin/loans/verify-barcode', {
        method: 'POST',
        body: JSON.stringify({ barcode: code }),
      });
      if (res.matched && res.loan) {
        setVerifiedLoan(res.loan);
        onNotify('success', `Barcode verified! Active loan matched for "${res.loan.book_title}".`);
      }
    } catch (err) {
      setVerifiedLoan(null);
      const msg = err instanceof ApiError ? err.message : `No active loan found matching barcode "${code}".`;
      setVerifyError(msg);
      onNotify('error', msg);
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleProcessVerifiedReturn() {
    if (!verifiedLoan) return;
    await onReturnBook(verifiedLoan);
    setVerifiedLoan(null);
    setReturnBarcode('');
  }

  function handleQuickFillBarcode(code: string) {
    setReturnBarcode(code);
    void handleVerifyBarcode(code);
  }

  async function handleQrInspect(e: FormEvent) {
    e.preventDefault();
    const code = qrCode.trim();
    if (!code) return;
    setQrBusy(true);
    try {
      const res = await apiRequest<{
        copy: BookCopy & { book_title: string; book_call_number: string; shelf_location: string };
        activeLoan: { id: number; borrower_name: string; borrower_email: string; due_date: string } | null;
      }>(`/api/admin/qr/${encodeURIComponent(code)}`);
      setQrLookup(res);
    } catch (err) {
      setQrLookup(null);
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setQrBusy(false);
    }
  }

  async function handleQrTransact(action: 'issue' | 'return') {
    if (!qrLookup) return;
    setQrBusy(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        action: 'issue' | 'return';
        copyCode: string;
        fineAssessedCents?: number;
      }>('/api/admin/qr/transact', {
        method: 'POST',
        body: JSON.stringify({
          code: qrLookup.copy.qr_token,
          action,
          userId: action === 'issue' ? Number(qrUserId) : undefined,
        }),
      });
      if (res.action === 'issue') {
        onNotify('success', `QR Checkout completed for ${res.copyCode}.`);
      } else {
        onNotify(
          res.fineAssessedCents && res.fineAssessedCents > 0 ? 'info' : 'success',
          res.fineAssessedCents && res.fineAssessedCents > 0
            ? `QR Return completed. Overdue fine assessed: ${formatMoney(res.fineAssessedCents)}.`
            : `QR Return completed for ${res.copyCode}.`
        );
      }
      setQrLookup(null);
      setQrCode('');
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setQrBusy(false);
    }
  }

  if (mode === 'reservations') {
    return (
      <section className="student-glass-card rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-base font-semibold text-white">
            Smart Reservation Queue ({reservations.length})
          </h2>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            FIFO queue tracking. Mark copies ready for circulation desk pickup or fulfill upon checkout.
          </p>
        </div>
        {reservations.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#94A3B8]">No reservations found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-[#080B16]/85 text-[#A78BFA]">
                  <th className="py-3 px-4">Queue</th>
                  <th className="py-3 px-4">Volume</th>
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4">Reserved On</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {reservations.map((res) => (
                  <tr key={res.id} className="student-row-hover">
                    <td className="py-3 px-4 font-mono text-[#A78BFA] tabular-nums">
                      {res.queue_position ? `#${res.queue_position}` : '—'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{res.book_title}</div>
                      <div className="font-mono text-[#94A3B8]">
                        {res.book_call_number} · {res.book_available_copies} avail
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-white">{res.student_name}</div>
                      <div className="font-mono text-[#94A3B8]">{res.student_code || res.student_email}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[#CBD5E1]">
                      {formatDate(res.reserved_at)}
                    </td>
                    <td className="py-3 px-4 capitalize font-medium">
                      <span
                        className={
                          res.status === 'ready'
                            ? 'text-emerald-300'
                            : res.status === 'pending'
                              ? 'text-amber-300'
                              : 'text-[#64748B]'
                        }
                      >
                        {res.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {(res.status === 'pending' || res.status === 'ready') && (
                        <div className="inline-flex items-center gap-1.5">
                          {res.status === 'pending' && (
                            <button
                              type="button"
                              disabled={busyAction === `res-${res.id}`}
                              onClick={() => void onReservationAction(res.id, 'ready')}
                              className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-2.5 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                            >
                              Mark Ready
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyAction === `res-${res.id}`}
                            onClick={() => void onReservationAction(res.id, 'fulfilled')}
                            className="rounded-lg border border-emerald-400/35 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-950/40 cursor-pointer"
                          >
                            Fulfill
                          </button>
                          <button
                            type="button"
                            disabled={busyAction === `res-${res.id}`}
                            onClick={() => void onReservationAction(res.id, 'cancelled')}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-[#CBD5E1] hover:border-rose-400/50 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  if (mode === 'fines') {
    const unpaidCents = fines.filter((f) => f.status === 'unpaid').reduce((a, b) => a + b.amount_cents, 0);
    const paidCents = fines.filter((f) => f.status === 'paid').reduce((a, b) => a + b.amount_cents, 0);
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="student-glass-card rounded-2xl p-4">
            <div className="text-xs text-[#94A3B8]">Total Unpaid Balance</div>
            <div className="font-mono text-2xl font-semibold text-rose-400 tabular-nums mt-1">
              {formatMoney(unpaidCents)}
            </div>
          </div>
          <div className="student-glass-card rounded-2xl p-4">
            <div className="text-xs text-[#94A3B8]">Total Fines Collected</div>
            <div className="font-mono text-2xl font-semibold text-emerald-300 tabular-nums mt-1">
              {formatMoney(paidCents)}
            </div>
          </div>
          <div className="student-glass-card rounded-2xl p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-[#94A3B8]">Manual Assessment</div>
              <div className="text-xs text-[#CBD5E1] mt-1">Damage, lost copy, or late fee</div>
            </div>
            <button
              type="button"
              onClick={onOpenAssessFine}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3.5 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Assess Fine</span>
            </button>
          </div>
        </div>

        <section className="student-glass-card rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-semibold text-white">
              Member Fines Ledger ({fines.length})
            </h2>
          </div>
          {fines.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#94A3B8]">No fines assessed.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-[#080B16]/85 text-[#A78BFA]">
                    <th className="py-3 px-4">Member</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {fines.map((fine) => (
                    <tr key={fine.id} className="student-row-hover">
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{fine.student_name}</div>
                        <div className="font-mono text-[#94A3B8]">{fine.student_code || fine.student_email}</div>
                      </td>
                      <td className="py-3 px-4 text-[#CBD5E1]">{fine.reason}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-[#A78BFA] tabular-nums">
                        {formatMoney(fine.amount_cents)}
                      </td>
                      <td className="py-3 px-4 font-medium capitalize">
                        <span
                          className={
                            fine.status === 'unpaid'
                              ? 'text-rose-400'
                              : fine.status === 'paid'
                                ? 'text-emerald-300'
                                : 'text-[#64748B]'
                          }
                        >
                          {fine.status === 'paid' ? `Paid (${formatDate(fine.settled_at)})` : fine.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {fine.status === 'unpaid' && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyAction === `fine-${fine.id}`}
                              onClick={() => void onFineSettlement(fine.id, 'paid')}
                              className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-2.5 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                            >
                              Record Payment
                            </button>
                            <button
                              type="button"
                              disabled={busyAction === `fine-${fine.id}`}
                              onClick={() => void onFineSettlement(fine.id, 'waived')}
                              className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-[#CBD5E1] hover:border-[#38BDF8] cursor-pointer"
                            >
                              Waive
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  // Circulation Desk (Standard Issue + QR Issue/Return + Loans Ledger + Printable Receipt)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-4 student-glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-1.5 border-b border-white/10 pb-3">
          <button
            type="button"
            onClick={() => setDeskTab('standard')}
            className={`flex-1 rounded-xl py-2 px-2 text-xs font-semibold cursor-pointer transition-colors text-center ${
              deskTab === 'standard' ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white shadow-md shadow-[#7C3AED]/20' : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            Desk Checkout
          </button>
          <button
            type="button"
            onClick={() => setDeskTab('barcode-return')}
            className={`flex-1 rounded-xl py-2 px-2 text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors text-center ${
              deskTab === 'barcode-return' ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white shadow-md shadow-[#7C3AED]/20' : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Barcode Return</span>
          </button>
          <button
            type="button"
            onClick={() => setDeskTab('qr')}
            className={`rounded-xl py-2 px-2.5 text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors ${
              deskTab === 'qr' ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white shadow-md shadow-[#7C3AED]/20' : 'text-[#94A3B8] hover:text-white'
            }`}
            title="QR Code Scan Desk"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>QR</span>
          </button>
        </div>

        {deskTab === 'standard' && (
          <form onSubmit={handleStandardIssue} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-[#CBD5E1] mb-1">Borrower (Student or Faculty)</label>
              <select
                required
                value={issueForm.userId}
                onChange={(e) => setIssueForm((f) => ({ ...f, userId: e.target.value }))}
                className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
              >
                <option value="">Select active member...</option>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName} ({m.studentId || m.email})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[#CBD5E1]">Catalog Volume</label>
                <button
                  type="button"
                  onClick={() => {
                    setScannerMode('book-lookup');
                    setScannerOpen(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A78BFA] hover:text-white cursor-pointer"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>Scan Book</span>
                </button>
              </div>
              <select
                required
                value={issueForm.bookId}
                onChange={(e) => setIssueForm((f) => ({ ...f, bookId: e.target.value }))}
                className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
              >
                <option value="">Select available book...</option>
                {availableBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} ({b.available_copies} avail)
                  </option>
                ))}
              </select>
            </div>

            {/* Special Barcode Registration Section */}
            <div className="rounded-xl border border-[#A78BFA]/30 bg-[#0F1326]/70 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-white font-semibold text-xs">
                  <Barcode className="w-4 h-4 text-[#A78BFA]" />
                  <span>Special Barcode Registration</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setScannerMode('issue-barcode');
                      setScannerOpen(true);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-[#A78BFA] hover:text-white cursor-pointer font-medium"
                  >
                    <ScanLine className="w-3 h-3" />
                    <span>Scan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIssueForm((f) => ({ ...f, barcode: generateSampleBarcode() }))}
                    className="inline-flex items-center gap-1 text-[11px] text-[#38BDF8] hover:text-white cursor-pointer font-medium"
                    title="Generate a fresh unique barcode"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Generate</span>
                  </button>
                </div>
              </div>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={issueForm.barcode}
                  onChange={(e) => setIssueForm((f) => ({ ...f, barcode: e.target.value.toUpperCase() }))}
                  placeholder="e.g. BC-984210"
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-[#A78BFA]"
                />
                <span className="absolute right-2.5 top-2 text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#8B5CF6]/20 text-[#A78BFA] border border-[#8B5CF6]/30">
                  Tag
                </span>
              </div>
              <p className="text-[10px] text-[#94A3B8]">
                This unique barcode tag is registered with this issuance and will be strictly verified upon return.
              </p>
            </div>

            <div>
              <label className="block text-[#CBD5E1] mb-1">Loan Period (Days)</label>
              <input
                type="number"
                min={1}
                max={90}
                required
                value={issueForm.days}
                onChange={(e) => setIssueForm((f) => ({ ...f, days: Number(e.target.value) }))}
                className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[#CBD5E1] mb-1">Circulation Note (Optional)</label>
              <input
                type="text"
                value={issueForm.notes}
                onChange={(e) => setIssueForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Reserve desk pickup / condition note"
                className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busyAction === 'issue-loan'}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2.5 text-sm font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] disabled:opacity-50 cursor-pointer shadow-lg shadow-[#7C3AED]/25"
            >
              {busyAction === 'issue-loan' ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookCopyIcon className="w-4 h-4" />}
              <span>Issue Book &amp; Register Barcode</span>
            </button>
          </form>
        )}

        {/* Dedicated Barcode Return Desk */}
        {deskTab === 'barcode-return' && (
          <div className="space-y-4 text-xs">
            <div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-[#A78BFA]" />
                <span>Barcode Return &amp; Verification Desk</span>
              </div>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Scan or enter the book's registered barcode sticker to verify loan records and check in the book.
              </p>
            </div>

            {/* Barcode Search Form */}
            <form onSubmit={(e) => { e.preventDefault(); void handleVerifyBarcode(); }} className="space-y-2">
              <label className="block text-[#CBD5E1]">Scan / Enter Physical Barcode Sticker</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={returnBarcode}
                  onChange={(e) => {
                    setReturnBarcode(e.target.value.toUpperCase());
                    if (verifyError) setVerifyError(null);
                  }}
                  placeholder="Scan or enter barcode (e.g. BC-984210)..."
                  className="dark-glass-input obsidian-input-focus flex-1 rounded-xl px-3 py-2 text-xs font-mono font-semibold uppercase tracking-wider text-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    setScannerMode('return-barcode');
                    setScannerOpen(true);
                  }}
                  title="Scan barcode with camera"
                  className="rounded-xl border border-[#A78BFA]/40 bg-[#8B5CF6]/20 px-3 py-2 text-xs font-semibold text-[#A78BFA] hover:bg-[#8B5CF6]/30 cursor-pointer shrink-0"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                </button>
                <button
                  type="submit"
                  disabled={isVerifying || !returnBarcode.trim()}
                  className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3.5 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] disabled:opacity-50 cursor-pointer shrink-0 inline-flex items-center gap-1.5"
                >
                  {isVerifying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Verify</span>
                </button>
              </div>
            </form>

            {/* Quick-test chips of active barcodes */}
            {activeLoansWithBarcodes.length > 0 && (
              <div className="space-y-1.5 bg-[#080B16]/60 rounded-xl p-3 border border-white/5">
                <div className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider">
                  Active Issued Barcodes (Click to test):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeLoansWithBarcodes.slice(0, 5).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => handleQuickFillBarcode(l.barcode || l.copy_code || '')}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-2 py-1 text-[11px] font-mono text-[#A78BFA] hover:bg-[#8B5CF6]/25 hover:text-white transition-colors cursor-pointer"
                    >
                      <ScanLine className="w-3 h-3 text-[#A78BFA]" />
                      <span>{l.barcode || l.copy_code}</span>
                      <span className="text-[10px] text-[#94A3B8]">({l.book_title.slice(0, 12)}...)</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error Banner */}
            {verifyError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-xs text-rose-300 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-rose-200">Barcode Mismatch / Loan Not Found</div>
                  <div className="mt-0.5 text-rose-300/90">{verifyError}</div>
                </div>
              </div>
            )}

            {/* Verified Loan Match Card */}
            {verifiedLoan && (
              <div className="rounded-2xl border border-emerald-500/40 bg-[#061A14]/80 p-4 space-y-3.5 shadow-xl shadow-emerald-950/20">
                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
                  <div className="inline-flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Barcode Verified &amp; Matched!</span>
                  </div>
                  <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {verifiedLoan.barcode || verifiedLoan.copy_code}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div>
                    <div className="font-semibold text-white text-sm">{verifiedLoan.book_title}</div>
                    <div className="font-mono text-[#94A3B8] text-[11px]">
                      {verifiedLoan.book_call_number} · ISBN {verifiedLoan.book_isbn}
                    </div>
                  </div>
                  <div className="pt-1 border-t border-white/10 flex justify-between">
                    <span className="text-[#94A3B8]">Borrower:</span>
                    <span className="text-white font-medium">
                      {verifiedLoan.borrower_name} ({verifiedLoan.borrower_student_id || verifiedLoan.borrower_email})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Issued Date:</span>
                    <span className="font-mono text-[#CBD5E1]">{formatDate(verifiedLoan.issued_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Due Date:</span>
                    <span className="font-mono text-white font-semibold">{formatDate(verifiedLoan.due_date)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-[#94A3B8]">Return Condition:</span>
                    {new Date(verifiedLoan.due_date).getTime() < Date.now() ? (
                      <span className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-semibold text-[11px]">
                        Overdue (Fine will be assessed)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-[11px]">
                        On Time (No Fines)
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busyAction === `return-${verifiedLoan.id}`}
                  onClick={() => void handleProcessVerifiedReturn()}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 text-xs font-semibold text-white hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-950/40 cursor-pointer"
                >
                  {busyAction === `return-${verifiedLoan.id}` ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Confirm Return &amp; Restock Volume</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Scanner Modal Handler */}
        {scannerOpen && (
          <BookScannerModal
            books={books}
            title={
              scannerMode === 'book-lookup'
                ? 'Scan Catalog Volume Barcode'
                : scannerMode === 'issue-barcode'
                  ? 'Register Physical Copy Barcode'
                  : 'Scan Barcode for Book Return'
            }
            subtitle={
              scannerMode === 'book-lookup'
                ? 'Scan ISBN barcode or choose book to issue'
                : scannerMode === 'issue-barcode'
                  ? 'Scan sticker on physical book to register barcode'
                  : 'Scan book barcode sticker to verify and process return'
            }
            placeholder={
              scannerMode === 'book-lookup'
                ? 'Scan or enter ISBN...'
                : 'Scan or enter barcode (e.g. BC-984210)...'
            }
            onScanResult={
              scannerMode === 'book-lookup'
                ? (book) => setIssueForm((f) => ({ ...f, bookId: String(book.id) }))
                : undefined
            }
            onScanBarcode={
              scannerMode === 'issue-barcode'
                ? (code) => setIssueForm((f) => ({ ...f, barcode: code }))
                : scannerMode === 'return-barcode'
                  ? (code) => {
                      setReturnBarcode(code);
                      void handleVerifyBarcode(code);
                    }
                  : undefined
            }
            onClose={() => setScannerOpen(false)}
            onNotify={onNotify}
          />
        )}

        {deskTab === 'qr' && (
          <div className="space-y-4 text-xs">
            <form onSubmit={handleQrInspect} className="space-y-2.5">
              <label className="block text-[#CBD5E1]">Scan or Paste Copy QR Token / Copy Code</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={qrCode}
                  onChange={(e) => setQrCode(e.target.value)}
                  placeholder="SMARTLIB:LIB-0001-C01"
                  className="dark-glass-input obsidian-input-focus flex-1 rounded-xl px-3 py-2 text-xs font-mono"
                />
                <button
                  type="submit"
                  disabled={qrBusy}
                  className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                  <span>Scan</span>
                </button>
              </div>
            </form>

            {qrLookup && (
              <div className="rounded-xl border border-[#A78BFA]/30 bg-[#0A0D1A]/85 p-3.5 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-white">{qrLookup.copy.book_title}</div>
                  <div className="font-mono text-[#A78BFA]">
                    {qrLookup.copy.copy_code} · {qrLookup.copy.book_call_number}
                  </div>
                </div>
                {qrLookup.copy.availability_status === 'available' ? (
                  <div className="space-y-2.5">
                    <select
                      value={qrUserId}
                      onChange={(e) => setQrUserId(e.target.value)}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-xs"
                    >
                      <option value="">Select member to issue...</option>
                      {activeMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName} ({m.studentId || m.email})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!qrUserId || qrBusy}
                      onClick={() => void handleQrTransact('issue')}
                      className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                    >
                      Confirm QR Checkout
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {qrLookup.activeLoan ? (
                      <div className="text-amber-300">
                        Currently issued to {qrLookup.activeLoan.borrower_name} (Due {formatDate(qrLookup.activeLoan.due_date)})
                      </div>
                    ) : (
                      <div className="text-[#94A3B8]">Copy status: {qrLookup.copy.availability_status}</div>
                    )}
                    {qrLookup.activeLoan && (
                      <button
                        type="button"
                        disabled={qrBusy}
                        onClick={() => void handleQrTransact('return')}
                        className="w-full rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                      >
                        Process QR Return
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Loans Ledger */}
      <div className="lg:col-span-8 student-glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">Circulation Ledger</h2>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#080B16]/85 border border-white/10 text-xs">
            {(['open', 'overdue', 'returned', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setLoanFilter(f)}
                className={`px-3 py-1 rounded-lg capitalize cursor-pointer ${
                  loanFilter === f ? 'bg-[#8B5CF6]/25 text-white font-semibold' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-[#080B16]/85 text-[#A78BFA]">
                <th className="py-3 px-4">Volume</th>
                <th className="py-3 px-4">Registered Barcode</th>
                <th className="py-3 px-4">Borrower</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filteredLoans.map((loan) => (
                <tr key={loan.id} className="student-row-hover">
                  <td className="py-3 px-4">
                    <div className="font-medium text-white">{loan.book_title}</div>
                    <div className="font-mono text-[#94A3B8]">
                      {loan.book_call_number}
                      {loan.copy_code && !loan.barcode ? ` · ${loan.copy_code}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono">
                    {loan.barcode ? (
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 text-xs text-[#A78BFA]">
                        <ScanLine className="w-3 h-3 text-[#A78BFA]" />
                        <span className="font-semibold text-white">{loan.barcode}</span>
                      </div>
                    ) : loan.copy_code ? (
                      <span className="text-[#94A3B8] text-xs font-mono">{loan.copy_code}</span>
                    ) : (
                      <span className="text-[#64748B] text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-white">{loan.borrower_name}</div>
                    <div className="font-mono text-[#94A3B8]">{loan.borrower_student_id || loan.borrower_email}</div>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#CBD5E1]">{formatDate(loan.due_date)}</td>
                  <td className="py-3 px-4 font-medium capitalize">
                    <span
                      className={
                        loan.status === 'overdue'
                          ? 'text-rose-400'
                          : loan.status === 'active'
                            ? 'text-emerald-300'
                            : 'text-[#64748B]'
                      }
                    >
                      {loan.status}
                    </span>
                    {loan.renewal_requested === 1 && loan.status !== 'returned' && (
                      <div className="text-[11px] text-amber-300">Renewal Requested</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setReceiptLoan(loan)}
                        title="Printable Receipt"
                        className="rounded-lg border border-white/15 px-2 py-1.5 text-[#CBD5E1] hover:border-[#A78BFA] hover:text-[#A78BFA] cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      {loan.status !== 'returned' && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeskTab('barcode-return');
                            const code = loan.barcode || loan.copy_code || '';
                            if (code) {
                              setReturnBarcode(code);
                              void handleVerifyBarcode(code);
                            }
                          }}
                          title="Verify Barcode at Return Desk"
                          className="inline-flex items-center gap-1 rounded-lg border border-[#A78BFA]/35 bg-[#8B5CF6]/10 px-2.5 py-1.5 text-xs text-[#A78BFA] hover:bg-[#8B5CF6]/20 cursor-pointer"
                        >
                          <ScanLine className="w-3 h-3" />
                          <span>Verify</span>
                        </button>
                      )}
                      {loan.status !== 'returned' && loan.renewal_requested === 1 && (
                        <button
                          type="button"
                          disabled={busyAction === `renew-${loan.id}`}
                          onClick={() => void onApproveRenewal(loan.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#38BDF8]/40 px-2.5 py-1.5 text-xs text-[#38BDF8] hover:bg-[#38BDF8]/15 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Renew</span>
                        </button>
                      )}
                      {loan.status !== 'returned' && (
                        <button
                          type="button"
                          disabled={busyAction === `return-${loan.id}`}
                          onClick={() => void onReturnBook(loan)}
                          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-2.5 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Return</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable Circulation Receipt Modal */}
      {receiptLoan && (
        <div className="fixed inset-0 z-50 bg-[#040812]/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#F5F3EE] text-[#0B1220] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-300 pb-3">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-slate-500">{libraryName}</div>
                <h3 className="font-serif text-lg font-bold">Official Circulation Receipt</h3>
              </div>
              <button type="button" onClick={() => setReceiptLoan(null)} className="text-slate-500 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">Transaction ID</dt>
                <dd className="font-mono font-semibold">LN-{String(receiptLoan.id).padStart(5, '0')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Borrower</dt>
                <dd className="font-medium">{receiptLoan.borrower_name} ({receiptLoan.borrower_student_id || receiptLoan.borrower_email})</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Book Title</dt>
                <dd className="font-serif font-semibold text-right max-w-[230px]">{receiptLoan.book_title}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Call / Copy</dt>
                <dd className="font-mono">{receiptLoan.book_call_number}{receiptLoan.copy_code ? ` · ${receiptLoan.copy_code}` : ''}</dd>
              </div>
              {receiptLoan.barcode && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Registered Barcode</dt>
                  <dd className="font-mono font-bold text-slate-900">{receiptLoan.barcode}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">Issued Date</dt>
                <dd className="font-mono">{formatDate(receiptLoan.issued_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Due Date</dt>
                <dd className="font-mono font-semibold">{formatDate(receiptLoan.due_date)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Status</dt>
                <dd className="uppercase font-mono font-semibold">{receiptLoan.status}</dd>
              </div>
            </dl>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-300">
              <button
                type="button"
                onClick={() => setReceiptLoan(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1220] px-4 py-2 text-xs font-semibold text-[#F5F3EE] cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
