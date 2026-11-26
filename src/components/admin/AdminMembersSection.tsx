import { useState, type FormEvent } from 'react';
import {
  Eye,
  KeyRound,
  Loader2,
  Search,
  Unlock,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import type { FineRecord, LoanRecord, PasswordResetRequest, ReservationRecord, User } from '../../types';

interface AdminMembersSectionProps {
  mode: 'student' | 'faculty';
  currentUserId: number;
  users: User[];
  passwordResets: PasswordResetRequest[];
  defaultMaxBooks: number;
  busyAction: string | null;
  onRefresh: () => Promise<void>;
  onOpenCreateAccount: (defaultType: 'student' | 'faculty') => void;
  onUserStatus: (userId: number, status: 'active' | 'disabled') => void;
  onUnlockUser: (userId: number) => void;
  onIssueResetCode: (userId: number) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export function AdminMembersSection({
  mode,
  currentUserId,
  users,
  passwordResets,
  defaultMaxBooks,
  busyAction,
  onRefresh,
  onOpenCreateAccount,
  onUserStatus,
  onUnlockUser,
  onIssueResetCode,
  onNotify,
}: AdminMembersSectionProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'disabled'>('all');

  // Activity Drawer + Limit Edit Modal
  const [drawerData, setDrawerData] = useState<{
    member: User;
    loans: LoanRecord[];
    fines: FineRecord[];
    reservations: ReservationRecord[];
  } | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState(false);

  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    department: '',
    phone: '',
    maxLoansOverride: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const scopedUsers = users.filter((u) => {
    if (u.memberType !== mode) return false;
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.fullName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.studentId || '').toLowerCase().includes(q) ||
      u.department.toLowerCase().includes(q)
    );
  });

  const scopedResets = passwordResets.filter((pr) =>
    users.some((u) => u.id === pr.userId && u.memberType === mode)
  );

  async function openMemberDrawer(userId: number) {
    setLoadingDrawer(true);
    try {
      const res = await apiRequest<{
        member: User;
        loans: LoanRecord[];
        fines: FineRecord[];
        reservations: ReservationRecord[];
      }>(`/api/admin/users/${userId}/activity`);
      setDrawerData(res);
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setLoadingDrawer(false);
    }
  }

  function startEditMember(u: User) {
    setEditTarget(u);
    setEditForm({
      fullName: u.fullName,
      department: u.department,
      phone: u.phone || '',
      maxLoansOverride: u.maxLoansOverride ? String(u.maxLoansOverride) : '',
    });
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      await apiRequest(`/api/admin/users/${editTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editForm.fullName,
          department: editForm.department,
          phone: editForm.phone,
          maxLoansOverride: editForm.maxLoansOverride.trim() === '' ? null : Number(editForm.maxLoansOverride),
        }),
      });
      onNotify('success', 'Member profile and borrowing limit updated.');
      setEditTarget(null);
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="space-y-6">
      {scopedResets.length > 0 && (
        <section className="student-glass-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-[#A78BFA]">
            Pending Password Reset Verification Queue
          </h3>
          <div className="divide-y divide-white/10">
            {scopedResets.map((pr) => (
              <div key={pr.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="text-[#CBD5E1]">
                  <span className="font-medium text-white">{pr.fullName}</span>
                  <span className="mx-1.5 text-white/30">·</span>
                  <span className="font-mono text-[#A78BFA]">{pr.studentId || pr.email}</span>
                </div>
                <button
                  type="button"
                  disabled={busyAction === `reset-${pr.userId}`}
                  onClick={() => onIssueResetCode(pr.userId)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Issue Reset Code</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Search & Filter Toolbar */}
      <div className="student-glass-card rounded-2xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#A78BFA]/80 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${mode === 'student' ? 'students' : 'faculty'} by name, ID, email, or department...`}
            className="dark-glass-input obsidian-input-focus w-full rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter member status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="dark-glass-input obsidian-input-focus rounded-xl px-3 py-2 text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending Approval</option>
            <option value="disabled">Deactivated</option>
          </select>

          <button
            type="button"
            onClick={() => onOpenCreateAccount(mode)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Register {mode === 'student' ? 'Student' : 'Faculty'}</span>
          </button>
        </div>
      </div>

      {/* Members Table */}
      <div className="student-glass-card rounded-2xl overflow-hidden">
        {scopedUsers.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#94A3B8]">
            No {mode} accounts match your current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-[#080B16]/85 text-[#A78BFA]">
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Borrow Limit</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {scopedUsers.map((u) => {
                  const isLocked = Boolean(u.lockedUntil && u.lockedUntil > Date.now());
                  return (
                    <tr key={u.id} className="student-row-hover">
                      <td className="py-3 px-4">
                        <div className="font-medium text-white text-sm">{u.fullName}</div>
                        <div className="text-[#94A3B8]">
                          {u.email}
                          {u.studentId && <span className="font-mono text-[#A78BFA]"> · {u.studentId}</span>}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#CBD5E1]">{u.department}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[#38BDF8]">
                        {u.maxLoansOverride ?? defaultMaxBooks} books
                        {u.maxLoansOverride ? ' (custom)' : ''}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-medium">
                        {isLocked ? (
                          <span className="text-rose-400">Locked Out</span>
                        ) : u.status === 'active' ? (
                          <span className="text-emerald-300">Active</span>
                        ) : u.status === 'pending' ? (
                          <span className="text-amber-300">Pending Approval</span>
                        ) : (
                          <span className="text-[#64748B]">Deactivated</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void openMemberDrawer(u.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#A78BFA]/30 px-2.5 py-1.5 text-xs text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>History</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditMember(u)}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-[#E2E8F0] hover:border-[#38BDF8] cursor-pointer"
                          >
                            Edit / Limit
                          </button>
                          {u.status === 'pending' && (
                            <button
                              type="button"
                              disabled={busyAction === `user-status-${u.id}`}
                              onClick={() => onUserStatus(u.id, 'active')}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 cursor-pointer"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                          )}
                          {isLocked && (
                            <button
                              type="button"
                              disabled={busyAction === `unlock-${u.id}`}
                              onClick={() => onUnlockUser(u.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 px-2.5 py-1.5 text-xs text-amber-300 cursor-pointer"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              <span>Unlock</span>
                            </button>
                          )}
                          {u.status !== 'disabled' && (
                            <button
                              type="button"
                              disabled={busyAction === `reset-${u.id}`}
                              onClick={() => onIssueResetCode(u.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-[#CBD5E1] hover:border-[#A78BFA] cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {u.id !== currentUserId && u.status !== 'pending' && (
                            <button
                              type="button"
                              disabled={busyAction === `user-status-${u.id}`}
                              onClick={() => onUserStatus(u.id, u.status === 'active' ? 'disabled' : 'active')}
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer ${
                                u.status === 'active'
                                  ? 'border border-red-400/30 text-red-300 hover:bg-red-950/40'
                                  : 'border border-emerald-400/30 text-emerald-300 hover:bg-emerald-950/40'
                              }`}
                            >
                              {u.status === 'active' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Profile & Individual Limit Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-[#040610]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Edit Member &amp; Borrowing Limit</h3>
              <button type="button" onClick={() => setEditTarget(null)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#CBD5E1] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editForm.fullName}
                  onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Department</label>
                <input
                  type="text"
                  required
                  value={editForm.department}
                  onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Phone</label>
                <input
                  type="text"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">
                  Individual Borrowing Limit (Leave blank for default {defaultMaxBooks})
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={editForm.maxLoansOverride}
                  onChange={(e) => setEditForm((f) => ({ ...f, maxLoansOverride: e.target.value }))}
                  placeholder={`Default (${defaultMaxBooks})`}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="rounded-xl border border-white/15 px-4 py-2 text-xs text-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                >
                  {savingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Member Activity Slide-over Drawer */}
      {(loadingDrawer || drawerData) && (
        <div className="fixed inset-0 z-50 bg-[#040610]/75 backdrop-blur-xs flex justify-end">
          <div className="flex-1" onClick={() => setDrawerData(null)} />
          <div className="w-full max-w-lg h-full bg-[#0A0D1A] border-l border-[#A78BFA]/25 p-5 overflow-y-auto space-y-5">
            {loadingDrawer ? (
              <div className="h-full flex items-center justify-center text-xs text-[#A78BFA] gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading member ledger...</span>
              </div>
            ) : drawerData ? (
              <>
                <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                  <div>
                    <div className="text-xs font-mono uppercase text-[#A78BFA]">
                      {drawerData.member.memberType} · {drawerData.member.studentId || 'No ID'}
                    </div>
                    <h3 className="text-xl font-semibold text-white mt-0.5">
                      {drawerData.member.fullName}
                    </h3>
                    <p className="text-xs text-[#94A3B8]">{drawerData.member.email} · {drawerData.member.department}</p>
                  </div>
                  <button type="button" onClick={() => setDrawerData(null)} className="text-[#94A3B8] hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-[#A78BFA]">
                    Borrowing History ({drawerData.loans.length})
                  </h4>
                  {drawerData.loans.length === 0 ? (
                    <p className="text-xs text-[#94A3B8]">No loans recorded for this member.</p>
                  ) : (
                    <div className="space-y-2">
                      {drawerData.loans.map((l) => (
                        <div key={l.id} className="rounded-xl border border-white/10 bg-[#12162A]/80 p-3 text-xs space-y-1">
                          <div className="font-medium text-white">{l.book_title}</div>
                          <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-[#94A3B8]">
                            <span>Issued {l.issued_at.slice(0, 10)} · Due {l.due_date.slice(0, 10)}</span>
                            <span className={l.status === 'overdue' ? 'text-rose-400' : l.status === 'active' ? 'text-emerald-300' : 'text-[#64748B]'}>
                              {l.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-[#A78BFA]">
                    Fine History ({drawerData.fines.length})
                  </h4>
                  {drawerData.fines.length === 0 ? (
                    <p className="text-xs text-[#94A3B8]">No fines on record.</p>
                  ) : (
                    <div className="space-y-2">
                      {drawerData.fines.map((f) => (
                        <div key={f.id} className="rounded-xl border border-white/10 bg-[#12162A]/80 p-3 text-xs flex items-center justify-between gap-2">
                          <div>
                            <div className="text-white">{f.reason}</div>
                            <div className="text-[11px] text-[#94A3B8] capitalize">{f.status}</div>
                          </div>
                          <div className="font-mono font-semibold text-[#A78BFA] tabular-nums">
                            ${(f.amount_cents / 100).toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
