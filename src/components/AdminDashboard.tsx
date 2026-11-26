import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookCopy,
  BookMarked,
  BookOpen,
  Boxes,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileText,
  FileUp,
  GraduationCap,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ApiError, apiRequest, setAccessToken } from '../lib/api';
import type {
  Announcement,
  AuditLogEntry,
  Book,
  BookCopy as BookCopyRecord,
  DigitalResource,
  FineRecord,
  LibrarySettings,
  LoanRecord,
  MemberType,
  PasswordResetRequest,
  ReservationRecord,
  User,
} from '../types';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { FloatingLibraButton } from './ai/FloatingLibraButton';
import { LibraAiChat } from './ai/LibraAiChat';
import { AdminAnalyticsSection, type AnalyticsPayload } from './admin/AdminAnalyticsSection';
import { AdminCirculationSection } from './admin/AdminCirculationSection';
import { AdminInventorySection } from './admin/AdminInventorySection';
import { AdminMembersSection } from './admin/AdminMembersSection';
import { StudentPortalBackdrop } from './student/StudentPortalBackdrop';

interface AdminDashboardProps {
  currentUser: User;
  onLogout: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

type AdminTab =
  | 'dashboard'
  | 'books'
  | 'inventory'
  | 'students'
  | 'faculty'
  | 'circulation'
  | 'reservations'
  | 'fines'
  | 'analytics'
  | 'ai'
  | 'notifications'
  | 'audit'
  | 'settings';

interface OverviewResponse {
  metrics: {
    uniqueTitles: number;
    totalCopies: number;
    availableCopies: number;
    lowStockCount: number;
    activeLoans: number;
    overdueLoans: number;
    returnedLoans: number;
    pendingRenewals: number;
    openReservations: number;
    unpaidFinesCents: number;
    collectedFinesCents: number;
    pendingFineRequestsCount: number;
    totalStudents: number;
    totalFaculty: number;
    activeStudents: number;
    pendingApprovals: number;
    activeAdmins: number;
    pendingResets: number;
  };
  categoryBreakdown: Array<{
    category: string;
    titles: number;
    totalCopies: number;
    availableCopies: number;
  }>;
  popularBooks: Array<{
    id: number;
    title: string;
    author: string;
    category: string;
    availableCopies: number;
    totalCopies: number;
    checkoutCount: number;
  }>;
  lowStockBooks: Array<{
    id: number;
    title: string;
    author: string;
    category: string;
    available_copies: number;
    total_copies: number;
    low_stock_threshold: number;
    shelf_location: string;
  }>;
  recentTransactions: Array<{
    id: number;
    status: string;
    issued_at: string;
    due_date: string;
    book_title: string;
    book_call_number: string;
    borrower_name: string;
    borrower_student_id: string | null;
    borrower_type: MemberType;
  }>;
  recentStudents: Array<{
    id: number;
    fullName: string;
    email: string;
    studentId: string | null;
    memberType: MemberType;
    department: string;
    status: string;
    createdAt: string;
  }>;
  monthlyCirculation: Array<{ month: string; issued: number; returned: number; overdue: number }>;
  demandPrediction: Array<{
    bookId: number;
    title: string;
    projectedDemandScore: number;
    recommendedExtraCopies: number;
  }>;
  recentAuditLogs: AuditLogEntry[];
}

const SAMPLE_CSV = [
  'isbn,title,author,category,publisher,published_year,call_number,shelf_location,total_copies,description',
  '978-0262046305,Introduction to Algorithms (4th Ed),Thomas H. Cormen,Computer Science,MIT Press,2022,QA76.6 .C662 2022,East Wing · Stack 3A,4,Fourth edition covering modern graph and randomized algorithms.',
  '978-0132350884,Clean Code,Robert C. Martin,Computer Science,Prentice Hall,2008,QA76.76 .D47,East Wing · Stack 3C,3,Handbook of agile software craftsmanship and maintainable design.',
].join('\n');

const DOT_PALETTE = ['#A78BFA', '#38BDF8', '#34D399', '#FB7185', '#FBBF24', '#818CF8'];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatHourLabel(hour24: number): string {
  if (hour24 === 12) return '12';
  return String(hour24 > 12 ? hour24 - 12 : hour24);
}

export function AdminDashboard({ currentUser, onLogout, onNotify }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Header global quick search
  const [headerSearch, setHeaderSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Dashboard chart sub-switches
  const [peakMode, setPeakMode] = useState<'hours' | 'subjects'>('hours');
  const [trendMode, setTrendMode] = useState<'weekly' | 'monthly'>('weekly');

  // Core data states
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [copies, setCopies] = useState<BookCopyRecord[]>([]);
  const [digitalResources, setDigitalResources] = useState<DigitalResource[]>([]);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [fines, setFines] = useState<FineRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [passwordResets, setPasswordResets] = useState<PasswordResetRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Audit filters
  const [auditSearch, setAuditSearch] = useState('');
  const [auditSeverity, setAuditSeverity] = useState<'all' | 'info' | 'warning' | 'alert'>('all');

  // Modals & forms
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [bookForm, setBookForm] = useState({
    isbn: '',
    title: '',
    author: '',
    category: 'Computer Science',
    publisher: '',
    publishedYear: 2024,
    callNumber: '',
    shelfLocation: '',
    rackCode: '',
    lowStockThreshold: 2,
    totalCopies: 3,
    description: '',
  });

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCsvText, setBulkCsvText] = useState('');
  const [bulkResult, setBulkResult] = useState<{
    importedCount: number;
    skipped: Array<{ row: number; isbn: string; reason: string }>;
  } | null>(null);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({
    fullName: '',
    email: '',
    memberType: 'student' as MemberType,
    studentId: '',
    department: '',
    phone: '',
    maxLoansOverride: '',
    password: '',
  });

  const [fineModalOpen, setFineModalOpen] = useState(false);
  const [fineForm, setFineForm] = useState({
    userId: '',
    amountDollars: '5.00',
    reason: '',
  });

  const [issuedResetModal, setIssuedResetModal] = useState<{
    email: string;
    resetCode: string;
    expiresAt: number;
  } | null>(null);

  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    message: '',
    priority: 'normal' as 'normal' | 'important' | 'urgent',
    targetRole: 'all' as 'all' | 'student' | 'faculty' | 'admin',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, an, bk, cp, dr, ln, rs, fn, us, ann, st, al] = await Promise.all([
        apiRequest<OverviewResponse>('/api/admin/overview'),
        apiRequest<AnalyticsPayload>('/api/admin/analytics'),
        apiRequest<{ books: Book[] }>('/api/admin/books'),
        apiRequest<{ copies: BookCopyRecord[] }>('/api/admin/copies'),
        apiRequest<{ resources: DigitalResource[] }>('/api/admin/digital-resources'),
        apiRequest<{ loans: LoanRecord[] }>('/api/admin/loans'),
        apiRequest<{ reservations: ReservationRecord[] }>('/api/admin/reservations'),
        apiRequest<{ fines: FineRecord[] }>('/api/admin/fines'),
        apiRequest<{ users: User[]; passwordResets: PasswordResetRequest[] }>('/api/admin/users'),
        apiRequest<{ announcements: Announcement[] }>('/api/admin/announcements'),
        apiRequest<{ settings: LibrarySettings }>('/api/admin/settings'),
        apiRequest<{ logs: AuditLogEntry[] }>('/api/admin/audit-logs'),
      ]);
      setOverview(ov);
      setAnalytics(an);
      setBooks(bk.books);
      setCopies(cp.copies);
      setDigitalResources(dr.resources);
      setLoans(ln.loans);
      setReservations(rs.reservations);
      setFines(fn.fines);
      setUsers(us.users);
      setPasswordResets(us.passwordResets);
      setAnnouncements(ann.announcements);
      setSettings(st.settings);
      setAuditLogs(al.logs);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) {
        onNotify('error', err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  const categories = useMemo(() => {
    return Array.from(new Set(books.map((b) => b.category))).sort();
  }, [books]);

  const activeStudentsAndFaculty = useMemo(
    () => users.filter((u) => u.role === 'student' && u.status === 'active'),
    [users]
  );

  const staffAccounts = useMemo(
    () => users.filter((u) => u.role === 'admin'),
    [users]
  );

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (auditSeverity !== 'all' && l.severity !== auditSeverity) return false;
      if (!q) return true;
      return (
        l.actorLabel.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.target.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditSearch, auditSeverity]);

  const pendingActionCount = useMemo(() => {
    if (!overview) return 0;
    return (
      overview.metrics.pendingApprovals +
      overview.metrics.pendingResets +
      overview.metrics.pendingRenewals +
      overview.metrics.overdueLoans
    );
  }, [overview]);

  // Quick search matches across real books & members
  const quickSearchResults = useMemo(() => {
    const q = headerSearch.trim().toLowerCase();
    if (!q) return { books: [] as Book[], members: [] as User[] };
    return {
      books: books
        .filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q) ||
            b.isbn.toLowerCase().includes(q)
        )
        .slice(0, 4),
      members: users
        .filter(
          (u) =>
            u.role === 'student' &&
            (u.fullName.toLowerCase().includes(q) ||
              u.email.toLowerCase().includes(q) ||
              (u.studentId || '').toLowerCase().includes(q))
        )
        .slice(0, 4),
    };
  }, [headerSearch, books, users]);

  // Real-DB Dashboard Bento Analytics Derivations
  const bentoStats = useMemo(() => {
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayKeys = ['MON', 'TUES', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];

    const hourBuckets = Array.from({ length: 13 }, (_, idx) => ({
      hour24: idx + 8,
      label: formatHourLabel(idx + 8),
      count: 0,
    }));

    for (const loan of loans) {
      const d = new Date(loan.issued_at);
      if (Number.isNaN(d.getTime())) continue;
      // JS getDay(): 0=Sun..6=Sat -> convert to Mon=0..Sun=6
      const monIdx = (d.getDay() + 6) % 7;
      weekdayCounts[monIdx] += 1;

      const hr = d.getHours();
      const clampedHr = Math.min(20, Math.max(8, hr));
      hourBuckets[clampedHr - 8].count += 1;
    }

    const maxHourly = Math.max(1, ...hourBuckets.map((h) => h.count));
    const hourlySeries = hourBuckets.map((h) => ({
      label: h.label,
      hour24: h.hour24,
      count: h.count,
      tier:
        h.count === 0
          ? 'low'
          : h.count >= maxHourly * 0.75
            ? 'peak'
            : h.count >= maxHourly * 0.35
              ? 'active'
              : 'low',
    }));

    const weeklyTrend = dayLabels.map((day, idx) => ({
      day,
      dayUpper: dayKeys[idx],
      checkouts: weekdayCounts[idx],
    }));

    const maxWeekdayCount = Math.max(1, ...weekdayCounts);
    let peakWeekday = 'Mon';
    let peakVal = -1;
    weeklyTrend.forEach((w) => {
      if (w.checkouts > peakVal) {
        peakVal = w.checkouts;
        peakWeekday = w.day;
      }
    });

    // Unpaid fines breakdown by overdue age (real fines + overdue loans)
    let tier0to7Cents = 0;
    let tier8to30Cents = 0;
    let tier30PlusCents = 0;
    const now = Date.now();

    for (const fine of fines) {
      if (fine.status !== 'unpaid') continue;
      const ageDays = Math.max(0, Math.floor((now - new Date(fine.created_at).getTime()) / (24 * 60 * 60 * 1000)));
      if (ageDays <= 7) tier0to7Cents += fine.amount_cents;
      else if (ageDays <= 30) tier8to30Cents += fine.amount_cents;
      else tier30PlusCents += fine.amount_cents;
    }

    // Also include accrued unbilled overdue estimates if zero fines or add clarity
    return {
      hourlySeries,
      weeklyTrend,
      maxWeekdayCount,
      peakWeekday,
      totalTrackedLoans: loans.length,
      finesBreakdown: [
        { label: '0–7 days overdue', cents: tier0to7Cents },
        { label: '8–30 days overdue', cents: tier8to30Cents },
        { label: '30+ days overdue', cents: tier30PlusCents },
      ],
    };
  }, [loans, fines]);

  const popularTopList = useMemo(() => {
    const src = analytics?.popularBooks?.length
      ? analytics.popularBooks.map((b) => ({
          id: b.id,
          title: b.title,
          checkoutCount: b.checkoutCount,
          category: b.category,
        }))
      : (overview?.popularBooks || []).map((b) => ({
          id: b.id,
          title: b.title,
          checkoutCount: b.checkoutCount,
          category: b.category,
        }));
    return (Array.isArray(src) ? src : []).slice(0, 10);
  }, [analytics, overview]);

  const maxPopularCheckouts = useMemo(
    () => Math.max(1, ...popularTopList.map((b) => b.checkoutCount)),
    [popularTopList]
  );

  const collectionMixData = useMemo(() => {
    if (!overview) return [];
    const available = overview.metrics.availableCopies;
    const issued = overview.metrics.activeLoans;
    const reserved = overview.metrics.openReservations;
    return [
      { name: 'Available', value: available, color: '#34D399' },
      { name: 'Checked Out', value: issued, color: '#A78BFA' },
      { name: 'Reserved Holds', value: reserved, color: '#FB7185' },
    ];
  }, [overview]);

  async function handleSignOut() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', skipAuthHandling: true });
    } catch {
      // Clear local session regardless
    }
    setAccessToken(null);
    onLogout();
  }

  function openAddBookModal() {
    setEditingBook(null);
    setBookForm({
      isbn: '',
      title: '',
      author: '',
      category: 'Computer Science',
      publisher: '',
      publishedYear: 2024,
      callNumber: '',
      shelfLocation: '',
      rackCode: '',
      lowStockThreshold: 2,
      totalCopies: 3,
      description: '',
    });
    setBookModalOpen(true);
  }

  function openEditBookModal(book: Book) {
    setEditingBook(book);
    setBookForm({
      isbn: book.isbn,
      title: book.title,
      author: book.author,
      category: book.category,
      publisher: book.publisher,
      publishedYear: book.published_year,
      callNumber: book.call_number,
      shelfLocation: book.shelf_location,
      rackCode: book.rack_code || '',
      lowStockThreshold: book.low_stock_threshold ?? 2,
      totalCopies: book.total_copies,
      description: book.description,
    });
    setBookModalOpen(true);
  }

  async function handleSaveBook(e: FormEvent) {
    e.preventDefault();
    setBusyAction('save-book');
    try {
      if (editingBook) {
        await apiRequest(`/api/admin/books/${editingBook.id}`, {
          method: 'PATCH',
          body: JSON.stringify(bookForm),
        });
        onNotify('success', `Updated "${bookForm.title}".`);
      } else {
        await apiRequest('/api/admin/books', {
          method: 'POST',
          body: JSON.stringify(bookForm),
        });
        onNotify('success', `Added "${bookForm.title}" and generated physical copy QR labels.`);
      }
      setBookModalOpen(false);
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteBook(book: Book) {
    setBusyAction(`delete-book-${book.id}`);
    try {
      await apiRequest(`/api/admin/books/${book.id}`, { method: 'DELETE' });
      onNotify('info', `Removed "${book.title}" from catalog.`);
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleBulkCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBulkCsvText(text);
  }

  async function handleBulkImportSubmit(e: FormEvent) {
    e.preventDefault();
    setBusyAction('bulk-import');
    try {
      const res = await apiRequest<{
        importedCount: number;
        skipped: Array<{ row: number; isbn: string; reason: string }>;
      }>('/api/admin/books/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ csvText: bulkCsvText }),
      });
      setBulkResult(res);
      onNotify('success', `Imported ${res.importedCount} books (${res.skipped.length} skipped).`);
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleIssueBook(payload: { userId: string; bookId: string; days: number; notes: string; barcode?: string }) {
    setBusyAction('issue-loan');
    try {
      const res = await apiRequest<{ loanId: number; barcode: string; message: string }>('/api/admin/loans/issue', {
        method: 'POST',
        body: JSON.stringify({
          userId: Number(payload.userId),
          bookId: Number(payload.bookId),
          days: Number(payload.days),
          notes: payload.notes,
          barcode: payload.barcode,
        }),
      });
      onNotify('success', res.message || `Book issued successfully with registered barcode [${res.barcode || payload.barcode}].`);
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReturnBook(loan: LoanRecord) {
    setBusyAction(`return-${loan.id}`);
    try {
      const res = await apiRequest<{ fineAssessedCents: number; daysLate: number }>(
        `/api/admin/loans/${loan.id}/return`,
        { method: 'POST' }
      );
      if (res.fineAssessedCents > 0) {
        onNotify(
          'info',
          `Returned "${loan.book_title}" (${res.daysLate}d late). Fine assessed: ${formatMoney(res.fineAssessedCents)}.`
        );
      } else {
        onNotify('success', `Returned "${loan.book_title}".`);
      }
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApproveRenewal(loanId: number) {
    setBusyAction(`renew-${loanId}`);
    try {
      await apiRequest(`/api/admin/loans/${loanId}/approve-renewal`, { method: 'POST' });
      onNotify('success', 'Loan renewal approved.');
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReservationAction(reservationId: number, status: 'ready' | 'fulfilled' | 'cancelled') {
    setBusyAction(`res-${reservationId}`);
    try {
      await apiRequest(`/api/admin/reservations/${reservationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onNotify('success', `Reservation marked ${status}.`);
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleFineSettlement(fineId: number, status: 'paid' | 'waived') {
    setBusyAction(`fine-${fineId}`);
    try {
      await apiRequest(`/api/admin/fines/${fineId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onNotify('success', status === 'paid' ? 'Fine payment recorded.' : 'Fine waived.');
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateFine(e: FormEvent) {
    e.preventDefault();
    setBusyAction('create-fine');
    try {
      await apiRequest('/api/admin/fines', {
        method: 'POST',
        body: JSON.stringify({
          userId: Number(fineForm.userId),
          amountDollars: Number(fineForm.amountDollars),
          reason: fineForm.reason,
        }),
      });
      onNotify('success', 'Fine assessed.');
      setFineModalOpen(false);
      setFineForm({ userId: '', amountDollars: '5.00', reason: '' });
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  function openCreateAccountModal(defaultType: MemberType) {
    setAccountForm({
      fullName: '',
      email: '',
      memberType: defaultType,
      studentId: '',
      department: '',
      phone: '',
      maxLoansOverride: defaultType === 'faculty' ? '10' : '',
      password: '',
    });
    setAccountModalOpen(true);
  }

  async function handleCreateAccount(e: FormEvent) {
    e.preventDefault();
    setBusyAction('create-account');
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(accountForm),
      });
      onNotify('success', `Created ${accountForm.memberType} account for ${accountForm.fullName}.`);
      setAccountModalOpen(false);
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUserStatus(userId: number, status: 'active' | 'disabled') {
    setBusyAction(`user-status-${userId}`);
    try {
      await apiRequest(`/api/admin/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onNotify('success', status === 'active' ? 'Account activated.' : 'Account deactivated.');
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUnlockUser(userId: number) {
    setBusyAction(`unlock-${userId}`);
    try {
      await apiRequest(`/api/admin/users/${userId}/unlock`, { method: 'POST' });
      onNotify('success', 'Account lockout cleared.');
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleIssueResetCode(userId: number) {
    setBusyAction(`reset-${userId}`);
    try {
      const res = await apiRequest<{ resetCode: string; expiresAt: number; email: string }>(
        `/api/admin/users/${userId}/issue-reset-code`,
        { method: 'POST' }
      );
      setIssuedResetModal(res);
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePublishAnnouncement(e: FormEvent) {
    e.preventDefault();
    setBusyAction('publish-announcement');
    try {
      await apiRequest('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify(announcementForm),
      });
      onNotify('success', 'Library announcement published.');
      setAnnouncementForm({ title: '', message: '', priority: 'normal', targetRole: 'all' });
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteAnnouncement(id: number) {
    try {
      await apiRequest(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      onNotify('info', 'Announcement removed.');
      await loadAllData();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusyAction('save-settings');
    try {
      const res = await apiRequest<{ settings: LibrarySettings }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      onNotify('success', 'Library policy & security settings saved.');
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleChangeOwnPassword(e: FormEvent) {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      onNotify('error', 'New password and confirmation do not match.');
      return;
    }
    setBusyAction('change-password');
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      onNotify('success', 'Administrator password updated.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setBusyAction(null);
    }
  }

  // Exact 14-item Sidebar Menu (13 operational sections + Logout)
  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'books', label: 'Book Management', icon: BookOpen },
    { id: 'inventory', label: 'Inventory Management', icon: Boxes },
    { id: 'students', label: 'Student Management', icon: GraduationCap },
    { id: 'faculty', label: 'Faculty Management', icon: Users },
    { id: 'circulation', label: 'Issue & Return', icon: BookCopy },
    { id: 'reservations', label: 'Reservations', icon: BookMarked, badge: overview?.metrics.openReservations },
    { id: 'fines', label: 'Fine Management', icon: DollarSign, badge: overview?.metrics.pendingFineRequestsCount },
    { id: 'analytics', label: 'Analytics & Reports', icon: BarChart3 },
    { id: 'ai', label: 'AI Library Assistant', icon: Sparkles },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: pendingActionCount },
    { id: 'audit', label: 'Audit Logs', icon: ClipboardList },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const activeNavMeta = navItems.find((n) => n.id === activeTab);
  const currentMonthYear = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const initials = currentUser.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || '')
    .join('') || 'SA';

  const totalCollectionItems = (overview?.metrics.totalCopies ?? 0) + digitalResources.length;
  const physicalPct =
    totalCollectionItems > 0 ? Math.round(((overview?.metrics.totalCopies ?? 0) / totalCollectionItems) * 1000) / 10 : 100;
  const digitalPct = Math.max(0, Math.round((100 - physicalPct) * 10) / 10);

  return (
    <div className="relative min-h-screen bg-[#070913] text-[#F8FAFC] flex">
      <StudentPortalBackdrop showParticles />

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-black/75 lg:hidden" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Sleek Obsidian-Indigo Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen shrink-0 border-r border-white/10 bg-[#0A0D1A]/95 backdrop-blur-2xl flex flex-col transition-all duration-200 ${
          sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'
        } ${mobileMenuOpen ? 'w-72 translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand Header */}
        <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between gap-2">
          <div className={`flex items-center gap-3 min-w-0 ${sidebarCollapsed ? 'lg:justify-center w-full' : ''}`}>
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#4F46E5] text-white flex items-center justify-center shrink-0 shadow-lg shadow-[#7C3AED]/30">
              <BookOpen className="w-4.5 h-4.5" aria-hidden="true" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="text-sm font-bold tracking-wider text-white truncate">
                  {settings?.library_name ? settings.library_name.toUpperCase() : 'LIBRARIAN'}
                </div>
                <div className="text-[11px] text-[#94A3B8] truncate">Admin Console</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label="Toggle sidebar"
            className="hidden lg:inline-flex rounded-lg border border-white/10 p-1.5 text-[#94A3B8] hover:text-white hover:border-[#A78BFA]/40 cursor-pointer"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
            className="lg:hidden text-[#94A3B8]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#171C36] border border-[#A78BFA]/35 text-white shadow-sm'
                    : 'border border-transparent text-[#94A3B8] hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#A78BFA]' : 'text-[#64748B]'}`} />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!sidebarCollapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-[#A78BFA] tabular-nums">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Utility Links + Logout */}
        <div className="p-3 border-t border-white/10 space-y-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('ai');
              setMobileMenuOpen(false);
            }}
            title="LIBRA AI Help Center"
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[#94A3B8] hover:text-white hover:bg-white/[0.04] cursor-pointer whitespace-nowrap"
          >
            <HelpCircle className="w-4 h-4 shrink-0 text-[#64748B]" />
            {!sidebarCollapsed && <span>Help Center (AI)</span>}
          </button>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            title="Logout"
            className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-300/90 hover:text-rose-200 hover:bg-rose-500/10 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 min-w-0 flex flex-col">
        {/* Top Bar matching reference layout */}
        <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0A0D1A]/85 backdrop-blur-xl px-4 sm:px-7 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden rounded-xl border border-white/15 p-2 text-[#A78BFA]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-white truncate">
                {activeTab === 'dashboard' ? 'Library Management Dashboard' : activeNavMeta?.label}
              </h1>
              <p className="text-xs text-[#94A3B8] truncate">
                Monthly overview · {currentMonthYear}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Live Quick Search Box */}
            <div className="relative hidden md:block">
              <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={headerSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 180)}
                onChange={(e) => setHeaderSearch(e.target.value)}
                placeholder="Search books, members..."
                className="w-56 lg:w-64 rounded-full border border-white/12 bg-[#12162A] pl-9 pr-3.5 py-1.5 text-xs text-white placeholder-[#64748B] focus:outline-none focus:border-[#A78BFA]"
              />
              {searchFocused && headerSearch.trim() && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-[#A78BFA]/25 bg-[#0F1326] shadow-2xl p-2 space-y-2 z-50">
                  {quickSearchResults.books.length === 0 && quickSearchResults.members.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[#94A3B8]">No matching books or members</div>
                  ) : (
                    <>
                      {quickSearchResults.books.map((bk) => (
                        <button
                          key={`sb-${bk.id}`}
                          type="button"
                          onMouseDown={() => {
                            setActiveTab('books');
                            setHeaderSearch('');
                          }}
                          className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-white/[0.06] text-xs flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span className="text-white truncate">{bk.title}</span>
                          <span className="text-[11px] font-mono text-[#A78BFA] shrink-0">Book</span>
                        </button>
                      ))}
                      {quickSearchResults.members.map((mb) => (
                        <button
                          key={`sm-${mb.id}`}
                          type="button"
                          onMouseDown={() => {
                            setActiveTab(mb.memberType === 'faculty' ? 'faculty' : 'students');
                            setHeaderSearch('');
                          }}
                          className="w-full text-left px-3 py-1.5 rounded-xl hover:bg-white/[0.06] text-xs flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span className="text-white truncate">{mb.fullName}</span>
                          <span className="text-[11px] font-mono text-[#38BDF8] shrink-0">
                            {mb.studentId || mb.memberType}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Live Backend Connection Status */}
            <div className="hidden lg:flex items-center">
              <ConnectionStatusBadge compact onRetryComplete={() => void loadAllData()} />
            </div>

            {/* Notification Bell */}
            <button
              type="button"
              onClick={() => setActiveTab('notifications')}
              aria-label="Open notifications"
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/12 bg-[#12162A] text-[#CBD5E1] hover:border-[#A78BFA]/50 hover:text-white cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {pendingActionCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#FB7185] text-[10px] font-mono font-bold text-white flex items-center justify-center tabular-nums">
                  {pendingActionCount}
                </span>
              )}
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => void loadAllData()}
              disabled={loading}
              title="Refresh data"
              className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/12 bg-[#12162A] text-[#CBD5E1] hover:border-[#A78BFA]/50 hover:text-white cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#A78BFA]' : ''}`} />
            </button>

            {/* User Profile Pill */}
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="hidden sm:inline-flex items-center gap-2 rounded-full border border-white/12 bg-[#12162A] pl-1.5 pr-3 py-1 text-xs text-white hover:border-[#A78BFA]/45 cursor-pointer"
            >
              <span className="h-7 w-7 rounded-full bg-white text-[#0A0D1A] font-bold text-[11px] flex items-center justify-center">
                {initials}
              </span>
              <span className="truncate max-w-[120px] font-medium">{currentUser.fullName}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-7 max-w-[1440px] w-full mx-auto space-y-5 pb-24">
          {/* TAB 1: BENTO DASHBOARD MATCHING SCREENSHOT */}
          {activeTab === 'dashboard' && overview && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              {/* Row 1: 4 Signature KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  {
                    label: 'Total checkouts',
                    value: (overview.metrics.activeLoans + overview.metrics.returnedLoans).toLocaleString(),
                    sub: `↑ ${overview.metrics.activeLoans} active · ${overview.metrics.returnedLoans} returned`,
                    subColor: 'text-[#34D399]',
                    icon: BookCopy,
                    iconBox: 'bg-[#8B5CF6]/15 border-[#8B5CF6]/30 text-[#A78BFA]',
                  },
                  {
                    label: 'Active borrowers',
                    value: (overview.metrics.activeStudents + overview.metrics.totalFaculty).toLocaleString(),
                    sub: `${overview.metrics.totalStudents} students · ${overview.metrics.totalFaculty} faculty`,
                    subColor: 'text-[#38BDF8]',
                    icon: Users,
                    iconBox: 'bg-[#38BDF8]/15 border-[#38BDF8]/30 text-[#38BDF8]',
                  },
                  {
                    label: 'Outstanding fines',
                    value: formatMoney(overview.metrics.unpaidFinesCents),
                    sub: `${overview.metrics.pendingFineRequestsCount} unpaid · ${formatMoney(overview.metrics.collectedFinesCents)} paid`,
                    subColor: 'text-[#FB7185]',
                    icon: Receipt,
                    iconBox: 'bg-[#FB7185]/15 border-[#FB7185]/30 text-[#FB7185]',
                  },
                  {
                    label: 'Available copies',
                    value: overview.metrics.availableCopies.toLocaleString(),
                    sub: `of ${overview.metrics.totalCopies} physical · ${overview.metrics.uniqueTitles} titles`,
                    subColor: 'text-[#34D399]',
                    icon: BookOpen,
                    iconBox: 'bg-[#34D399]/15 border-[#34D399]/30 text-[#34D399]',
                  },
                ].map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <div key={kpi.label} className="student-glass-card rounded-2xl p-5 flex flex-col justify-between gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-xs font-medium text-[#94A3B8]">{kpi.label}</span>
                        <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${kpi.iconBox}`}>
                          <Icon className="w-4 h-4" aria-hidden="true" />
                        </span>
                      </div>
                      <div>
                        <div className="font-mono text-2xl sm:text-[28px] font-bold tracking-tight text-white tabular-nums">
                          {kpi.value}
                        </div>
                        <div className={`text-[11px] font-medium mt-1 tabular-nums ${kpi.subColor}`}>{kpi.sub}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Row 2: 3-Column Analytics Bento (4 + 5 + 3) */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
                {/* Left Column (4 cols): Most Popular Books Ranked List */}
                <section className="xl:col-span-4 student-glass-card rounded-2xl p-5 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-white">Most popular books</h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('analytics')}
                        className="rounded-lg border border-[#38BDF8]/30 bg-[#38BDF8]/10 px-2.5 py-1 text-[11px] font-medium text-[#38BDF8] hover:bg-[#38BDF8]/20 cursor-pointer"
                      >
                        Top {popularTopList.length}
                      </button>
                    </div>

                    <div className="space-y-3">
                      {popularTopList.map((book, idx) => {
                        const pct = Math.max(8, Math.round((book.checkoutCount / maxPopularCheckouts) * 100));
                        const dotColor = DOT_PALETTE[idx % DOT_PALETTE.length];
                        return (
                          <div key={book.id} className="grid grid-cols-[18px_10px_minmax(0,1.25fr)_minmax(60px,1fr)_32px] items-center gap-2 text-xs">
                            <span className="font-mono text-[11px] text-[#64748B] tabular-nums">{idx + 1}</span>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                            <span className="text-[#E2E8F0] truncate" title={book.title}>
                              {book.title}
                            </span>
                            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#38BDF8]"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] text-[#94A3B8] text-right tabular-nums">
                              {book.checkoutCount}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {/* Center Column (5 cols): Stacked Peak Circulation + Checkout Trend */}
                <div className="xl:col-span-5 flex flex-col gap-4">
                  {/* Top Center: Peak circulation hours / Subjects */}
                  <section className="student-glass-card rounded-2xl p-5 flex-1 flex flex-col justify-between space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-white">
                        {peakMode === 'hours' ? 'Peak circulation hours' : 'Inventory by subject'}
                      </h2>
                      <div className="inline-flex items-center gap-1 p-0.5 rounded-lg border border-white/10 bg-[#080B16]">
                        {(['hours', 'subjects'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setPeakMode(m)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize cursor-pointer ${
                              peakMode === m ? 'bg-[#8B5CF6]/25 text-white' : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        {peakMode === 'hours' ? (
                          <BarChart data={bentoStats.hourlySeries} margin={{ top: 6, right: 4, left: -26, bottom: 0 }}>
                            <XAxis dataKey="label" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis stroke="#64748B" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#0A0D1A',
                                borderColor: 'rgba(167,139,250,0.35)',
                                borderRadius: 10,
                                color: '#F8FAFC',
                                fontSize: 12,
                              }}
                              formatter={(val) => [`${Number(val ?? 0)} checkouts`, 'Activity']}
                              labelFormatter={(lbl) => `Hour ${lbl}:00`}
                            />
                            <Bar dataKey="count" radius={[6, 6, 4, 4]} maxBarSize={22}>
                              {bentoStats.hourlySeries.map((entry) => (
                                <Cell
                                  key={entry.hour24}
                                  fill={
                                    entry.tier === 'peak'
                                      ? '#A78BFA'
                                      : entry.tier === 'active'
                                        ? '#38BDF8'
                                        : '#232949'
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        ) : (
                          <BarChart data={(overview?.categoryBreakdown || []).slice(0, 7)} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                            <XAxis
                              dataKey="category"
                              stroke="#64748B"
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(v: string) => (v.length > 8 ? `${v.slice(0, 8)}…` : v)}
                            />
                            <YAxis stroke="#64748B" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#0A0D1A',
                                borderColor: 'rgba(167,139,250,0.35)',
                                borderRadius: 10,
                                color: '#F8FAFC',
                                fontSize: 12,
                              }}
                            />
                            <Bar dataKey="totalCopies" name="Total Copies" fill="#8B5CF6" radius={[5, 5, 0, 0]} maxBarSize={18} />
                            <Bar dataKey="availableCopies" name="Available" fill="#38BDF8" radius={[5, 5, 0, 0]} maxBarSize={18} />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>

                    {peakMode === 'hours' && (
                      <div className="flex items-center gap-4 text-[11px] text-[#94A3B8]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-[#A78BFA]" />
                          Peak
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-[#38BDF8]" />
                          Active
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-[#232949]" />
                          Low
                        </span>
                      </div>
                    )}
                  </section>

                  {/* Bottom Center: Checkout Trend */}
                  <section className="student-glass-card rounded-2xl p-5 flex-1 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-white">
                        Checkout trend · {new Date().getFullYear()}
                      </h2>
                      <div className="inline-flex items-center gap-1 p-0.5 rounded-lg border border-white/10 bg-[#080B16]">
                        {(['weekly', 'monthly'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setTrendMode(m)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize cursor-pointer ${
                              trendMode === m ? 'bg-[#8B5CF6]/25 text-white' : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="h-36 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        {trendMode === 'weekly' ? (
                          <LineChart data={bentoStats.weeklyTrend} margin={{ top: 10, right: 12, left: -24, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis dataKey="day" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis stroke="#64748B" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#0A0D1A',
                                borderColor: 'rgba(167,139,250,0.35)',
                                borderRadius: 10,
                                color: '#F8FAFC',
                                fontSize: 12,
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="checkouts"
                              name="Checkouts"
                              stroke="#A78BFA"
                              strokeWidth={2.5}
                              dot={{ r: 3.5, fill: '#F8FAFC', stroke: '#A78BFA', strokeWidth: 2 }}
                              activeDot={{ r: 5 }}
                            />
                          </LineChart>
                        ) : (
                          <LineChart data={overview.monthlyCirculation} margin={{ top: 10, right: 12, left: -24, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis dataKey="month" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis stroke="#64748B" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#0A0D1A',
                                borderColor: 'rgba(167,139,250,0.35)',
                                borderRadius: 10,
                                color: '#F8FAFC',
                                fontSize: 12,
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="issued"
                              name="Issued"
                              stroke="#A78BFA"
                              strokeWidth={2.5}
                              dot={{ r: 3.5, fill: '#F8FAFC', stroke: '#A78BFA', strokeWidth: 2 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="returned"
                              name="Returned"
                              stroke="#38BDF8"
                              strokeWidth={2}
                              dot={{ r: 3, fill: '#38BDF8' }}
                            />
                          </LineChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </section>
                </div>

                {/* Right Column (3 cols): Collection Mix Donut + Outstanding Fines Breakdown */}
                <section className="xl:col-span-3 student-glass-card rounded-2xl p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-white">Collection &amp; status</h2>

                    <div className="relative h-40 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={collectionMixData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={44}
                            outerRadius={64}
                            paddingAngle={3}
                            stroke="none"
                          >
                            {collectionMixData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0A0D1A',
                              borderColor: 'rgba(167,139,250,0.35)',
                              borderRadius: 10,
                              color: '#F8FAFC',
                              fontSize: 12,
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[10px] uppercase tracking-wider text-[#94A3B8]">Total</span>
                        <span className="font-mono text-base font-bold text-white tabular-nums">
                          {overview.metrics.totalCopies}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      {collectionMixData.map((item) => {
                        const denom = Math.max(
                          1,
                          collectionMixData.reduce((acc, cur) => acc + cur.value, 0)
                        );
                        const pct = Math.round((item.value / denom) * 100);
                        return (
                          <div key={item.name} className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2 text-[#CBD5E1]">
                              <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: item.color }} />
                              <span>{item.name}</span>
                            </span>
                            <span className="font-mono text-[#94A3B8] tabular-nums">
                              {pct}% · {item.value}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/10 space-y-2.5">
                    <h3 className="text-xs font-semibold text-white">Outstanding fines breakdown</h3>
                    <div className="space-y-2 text-xs">
                      {bentoStats.finesBreakdown.map((tier) => (
                        <div key={tier.label} className="flex items-center justify-between gap-2">
                          <span className="text-[#94A3B8]">{tier.label}</span>
                          <span className="font-mono font-medium text-[#FB7185] tabular-nums">
                            {formatMoney(tier.cents)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>

              {/* Row 3: Bottom 2-Column Row (Weekday Bars + Total Collection Size) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <section className="lg:col-span-7 student-glass-card rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-white">Checkouts by day of week</h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('circulation')}
                      className="text-xs text-[#A78BFA] hover:underline cursor-pointer"
                    >
                      Circulation Desk →
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {bentoStats.weeklyTrend.map((row) => {
                      const pct = row.checkouts > 0 ? Math.max(8, Math.round((row.checkouts / bentoStats.maxWeekdayCount) * 100)) : 3;
                      return (
                        <div key={row.dayUpper} className="grid grid-cols-[44px_1fr_38px] items-center gap-3 text-xs">
                          <span className="font-mono text-[11px] text-[#94A3B8]">{row.dayUpper}</span>
                          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] via-[#EC4899] to-[#38BDF8]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] text-[#CBD5E1] text-right tabular-nums">
                            {row.checkouts}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-3 text-xs text-[#94A3B8]">
                    <span>
                      Total tracked loans:{' '}
                      <strong className="font-mono text-white tabular-nums">
                        {bentoStats.totalTrackedLoans}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Peak day: <strong className="text-[#A78BFA]">{bentoStats.peakWeekday}</strong>
                    </span>
                  </div>
                </section>

                <section className="lg:col-span-5 student-glass-card rounded-2xl p-5 flex flex-col justify-between gap-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-white">Total collection size</h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('inventory')}
                      className="text-xs text-[#38BDF8] hover:underline cursor-pointer"
                    >
                      Inventory →
                    </button>
                  </div>

                  <div className="text-center space-y-0.5">
                    <div className="font-mono text-3xl font-bold text-white tabular-nums">
                      {totalCollectionItems.toLocaleString()}
                    </div>
                    <div className="text-xs text-[#94A3B8]">items in collection · {currentMonthYear}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/10 bg-[#0A0D1A]/85 p-3.5 text-center space-y-1">
                      <BookOpen className="w-4 h-4 text-[#38BDF8] mx-auto" />
                      <div className="font-mono text-lg font-bold text-white tabular-nums">
                        {overview.metrics.totalCopies.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-[#94A3B8]">Physical books</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#0A0D1A]/85 p-3.5 text-center space-y-1">
                      <FileText className="w-4 h-4 text-[#34D399] mx-auto" />
                      <div className="font-mono text-lg font-bold text-white tabular-nums">
                        {digitalResources.length.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-[#94A3B8]">Digital library</div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-[#94A3B8] font-mono tabular-nums">
                      <span>Physical {physicalPct}%</span>
                      <span>Digital {digitalPct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                      <div
                        className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#38BDF8]"
                        style={{ width: `${physicalPct}%` }}
                      />
                      <div
                        className="h-full bg-[#34D399]"
                        style={{ width: `${digitalPct}%` }}
                      />
                    </div>
                  </div>
                </section>
              </div>

              {/* Row 4: AI Insights, Pending Actions & Recent Activity */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <section className="lg:col-span-5 student-glass-card rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#A78BFA]" />
                      <h2 className="text-sm font-semibold text-white">AI Demand Signals &amp; Stock Alerts</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('ai')}
                      className="rounded-lg bg-[#8B5CF6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
                    >
                      LIBRA AI
                    </button>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="rounded-xl border border-white/10 bg-[#0A0D1A]/75 p-3.5 space-y-1.5">
                      <div className="font-semibold text-[#A78BFA] flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>Top Projected Demand</span>
                      </div>
                      {overview.demandPrediction.slice(0, 3).map((d) => (
                        <div key={d.bookId} className="flex items-center justify-between gap-2 text-[#E2E8F0]">
                          <span className="truncate">{d.title}</span>
                          <span className="font-mono text-[#38BDF8] shrink-0">Score {d.projectedDemandScore}</span>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-white/10 bg-[#0A0D1A]/75 p-3.5 space-y-1.5">
                      <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Low-Stock Alerts ({overview?.lowStockBooks?.length ?? 0})</span>
                      </div>
                      {(overview?.lowStockBooks?.length ?? 0) === 0 ? (
                        <p className="text-[#94A3B8]">All catalog titles above restock threshold.</p>
                      ) : (
                        overview.lowStockBooks.slice(0, 3).map((b) => (
                          <div key={b.id} className="flex items-center justify-between gap-2 text-[#E2E8F0]">
                            <span className="truncate">{b.title}</span>
                            <span className="font-mono text-amber-300 shrink-0">
                              {b.available_copies}/{b.total_copies}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </section>

                <section className="lg:col-span-3 student-glass-card rounded-2xl p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-white">Pending Actions</h2>
                  <div className="space-y-2 text-xs">
                    {[
                      { label: 'Student Approvals', count: overview.metrics.pendingApprovals, tab: 'students' as AdminTab },
                      { label: 'Password Resets', count: overview.metrics.pendingResets, tab: 'notifications' as AdminTab },
                      { label: 'Renewal Requests', count: overview.metrics.pendingRenewals, tab: 'circulation' as AdminTab },
                      { label: 'Overdue Alerts', count: overview.metrics.overdueLoans, tab: 'circulation' as AdminTab },
                    ].map((row) => (
                      <button
                        key={row.label}
                        type="button"
                        onClick={() => setActiveTab(row.tab)}
                        className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-[#0A0D1A]/75 px-3.5 py-2.5 hover:border-[#A78BFA]/45 transition-colors cursor-pointer"
                      >
                        <span className="text-[#CBD5E1]">{row.label}</span>
                        <span className={`font-mono font-semibold tabular-nums ${row.count > 0 ? 'text-[#A78BFA]' : 'text-[#64748B]'}`}>
                          {row.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="lg:col-span-4 student-glass-card rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white">Recent Transactions</h2>
                    <button type="button" onClick={() => setActiveTab('circulation')} className="text-xs text-[#A78BFA] hover:underline cursor-pointer">
                      Desk →
                    </button>
                  </div>
                  {(overview?.recentTransactions?.length ?? 0) === 0 ? (
                    <p className="text-xs text-[#94A3B8]">No circulation transactions recorded yet.</p>
                  ) : (
                    <div className="divide-y divide-white/10 text-xs">
                      {overview.recentTransactions.slice(0, 5).map((tx) => (
                        <div key={tx.id} className="py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-white truncate">{tx.book_title}</div>
                            <div className="text-[#94A3B8] truncate">{tx.borrower_name}</div>
                          </div>
                          <div className="text-right shrink-0 font-mono tabular-nums">
                            <div className={tx.status === 'overdue' ? 'text-[#FB7185]' : tx.status === 'active' ? 'text-[#34D399]' : 'text-[#94A3B8]'}>
                              {tx.status}
                            </div>
                            <div className="text-[10px] text-[#64748B]">Due {formatDate(tx.due_date)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </motion.div>
          )}

          {/* TAB 2 & 3: BOOK MANAGEMENT & INVENTORY MANAGEMENT */}
          {(activeTab === 'books' || activeTab === 'inventory') && (
            <AdminInventorySection
              mode={activeTab}
              books={books}
              copies={copies}
              digitalResources={digitalResources}
              categories={categories}
              busyAction={busyAction}
              onRefresh={loadAllData}
              onOpenAddBook={openAddBookModal}
              onOpenEditBook={openEditBookModal}
              onDeleteBook={(b) => void handleDeleteBook(b)}
              onOpenBulkImport={() => {
                setBulkResult(null);
                setBulkModalOpen(true);
              }}
              onNotify={onNotify}
            />
          )}

          {/* TAB 4 & 5: STUDENT & FACULTY MANAGEMENT */}
          {(activeTab === 'students' || activeTab === 'faculty') && (
            <AdminMembersSection
              mode={activeTab === 'students' ? 'student' : 'faculty'}
              currentUserId={currentUser.id}
              users={users}
              passwordResets={passwordResets}
              defaultMaxBooks={settings?.max_books_per_student ?? 5}
              busyAction={busyAction}
              onRefresh={loadAllData}
              onOpenCreateAccount={(type) => openCreateAccountModal(type)}
              onUserStatus={(id, status) => void handleUserStatus(id, status)}
              onUnlockUser={(id) => void handleUnlockUser(id)}
              onIssueResetCode={(id) => void handleIssueResetCode(id)}
              onNotify={onNotify}
            />
          )}

          {/* TAB 6, 7, 8: CIRCULATION, RESERVATIONS, FINES */}
          {(activeTab === 'circulation' || activeTab === 'reservations' || activeTab === 'fines') && (
            <AdminCirculationSection
              mode={activeTab}
              libraryName={settings?.library_name || 'Smart Library'}
              books={books}
              users={users}
              loans={loans}
              reservations={reservations}
              fines={fines}
              defaultDays={settings?.loan_duration_days ?? 14}
              busyAction={busyAction}
              onRefresh={loadAllData}
              onIssueBook={handleIssueBook}
              onReturnBook={handleReturnBook}
              onApproveRenewal={handleApproveRenewal}
              onReservationAction={handleReservationAction}
              onFineSettlement={handleFineSettlement}
              onOpenAssessFine={() => setFineModalOpen(true)}
              onNotify={onNotify}
            />
          )}

          {/* TAB 9: ANALYTICS & REPORTS */}
          {activeTab === 'analytics' && (
            <AdminAnalyticsSection
              libraryName={settings?.library_name || 'Smart Library'}
              analytics={analytics}
            />
          )}

          {/* TAB 10: AI LIBRARY ASSISTANT */}
          {activeTab === 'ai' && (
            <LibraAiChat
              role="admin"
              onNotify={onNotify}
              onDataChanged={() => void loadAllData()}
            />
          )}

          {/* TAB 11: NOTIFICATIONS & LIBRARY ANNOUNCEMENTS */}
          {activeTab === 'notifications' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <section className="lg:col-span-7 student-glass-card rounded-2xl p-5 space-y-4">
                <h2 className="text-base font-semibold text-white">
                  Operational Alerts &amp; Queues
                </h2>
                <div className="space-y-3 text-xs">
                  {loans.filter((l) => l.status === 'overdue').map((l) => (
                    <div key={`ov-${l.id}`} className="rounded-xl border border-rose-400/30 bg-rose-950/25 p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-rose-300">Overdue Loan: {l.book_title}</div>
                        <div className="text-[#CBD5E1]">{l.borrower_name} · Due {formatDate(l.due_date)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('circulation')}
                        className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-rose-200 hover:bg-rose-950/50 cursor-pointer"
                      >
                        Manage
                      </button>
                    </div>
                  ))}

                  {passwordResets.map((pr) => (
                    <div key={`pr-${pr.id}`} className="rounded-xl border border-amber-400/30 bg-amber-950/25 p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-amber-300">Password Reset Request: {pr.fullName}</div>
                        <div className="text-[#CBD5E1]">{pr.studentId || pr.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleIssueResetCode(pr.userId)}
                        className="rounded-lg bg-[#8B5CF6] px-3 py-1.5 font-semibold text-white cursor-pointer"
                      >
                        Issue Code
                      </button>
                    </div>
                  ))}

                  {users.filter((u) => u.status === 'pending').map((u) => (
                    <div key={`pend-${u.id}`} className="rounded-xl border border-[#38BDF8]/30 bg-[#38BDF8]/10 p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#38BDF8]">New Account Awaiting Approval: {u.fullName}</div>
                        <div className="text-[#CBD5E1]">{u.email} · {u.department}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleUserStatus(u.id, 'active')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                    </div>
                  ))}

                  {pendingActionCount === 0 && (
                    <div className="p-6 text-center text-[#94A3B8]">
                      All operational queues are clear.
                    </div>
                  )}
                </div>
              </section>

              <section className="lg:col-span-5 space-y-5">
                <form onSubmit={handlePublishAnnouncement} className="student-glass-card rounded-2xl p-5 space-y-3.5 text-xs">
                  <div className="flex items-center gap-2 text-[#A78BFA]">
                    <Megaphone className="w-4 h-4" />
                    <h2 className="text-base font-semibold text-white">
                      Publish Library Announcement
                    </h2>
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Title</label>
                    <input
                      type="text"
                      required
                      value={announcementForm.title}
                      onChange={(e) => setAnnouncementForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="Extended Exam Week Hours"
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[#CBD5E1] mb-1">Priority</label>
                      <select
                        value={announcementForm.priority}
                        onChange={(e) => setAnnouncementForm((f) => ({ ...f, priority: e.target.value as typeof f.priority }))}
                        className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-xs"
                      >
                        <option value="normal">Normal</option>
                        <option value="important">Important</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[#CBD5E1] mb-1">Audience</label>
                      <select
                        value={announcementForm.targetRole}
                        onChange={(e) => setAnnouncementForm((f) => ({ ...f, targetRole: e.target.value as typeof f.targetRole }))}
                        className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-xs"
                      >
                        <option value="all">All Members</option>
                        <option value="student">Students Only</option>
                        <option value="faculty">Faculty Only</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Message</label>
                    <textarea
                      rows={3}
                      required
                      value={announcementForm.message}
                      onChange={(e) => setAnnouncementForm((f) => ({ ...f, message: e.target.value }))}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busyAction === 'publish-announcement'}
                    className="w-full rounded-xl bg-[#8B5CF6] py-2.5 text-xs font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
                  >
                    Publish Announcement
                  </button>
                </form>

                <div className="student-glass-card rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-[#A78BFA]">Active Announcements</h3>
                  <div className="space-y-2.5">
                    {announcements.map((a) => (
                      <div key={a.id} className="rounded-xl border border-white/10 bg-[#0A0D1A]/75 p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white">{a.title}</span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteAnnouncement(a.id)}
                            className="text-rose-300 hover:text-rose-200 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-[#CBD5E1]">{a.message}</p>
                        <div className="text-[10px] font-mono text-[#A78BFA]/85 uppercase">
                          {a.priority} · {a.target_role} · {formatDate(a.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 12: AUDIT LOGS */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div className="student-glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-[#A78BFA]/70 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Search actor, action, or target..."
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm"
                  />
                </div>
                <select
                  aria-label="Filter severity"
                  value={auditSeverity}
                  onChange={(e) => setAuditSeverity(e.target.value as typeof auditSeverity)}
                  className="dark-glass-input obsidian-input-focus rounded-xl px-3 py-2 text-xs"
                >
                  <option value="all">All Severities</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="alert">Alert</option>
                </select>
              </div>

              <div className="student-glass-card rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-[#0A0D1A]/75 text-[#A78BFA]">
                        <th className="py-3 px-4">Timestamp</th>
                        <th className="py-3 px-4">Actor</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Target</th>
                        <th className="py-3 px-4">Severity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {filteredAuditLogs.map((log) => (
                        <tr key={log.id} className="student-row-hover">
                          <td className="py-2.5 px-4 font-mono tabular-nums text-[#94A3B8] whitespace-nowrap">
                            {formatDateTime(log.createdAt)}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[#38BDF8]">{log.actorLabel}</td>
                          <td className="py-2.5 px-4 font-medium text-white">{log.action}</td>
                          <td className="py-2.5 px-4 text-[#CBD5E1]">{log.target || '—'}</td>
                          <td className="py-2.5 px-4 uppercase font-mono">
                            <span className={log.severity === 'alert' ? 'text-rose-400' : log.severity === 'warning' ? 'text-amber-300' : 'text-[#34D399]'}>
                              {log.severity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 13: SETTINGS */}
          {activeTab === 'settings' && settings && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form onSubmit={handleSaveSettings} className="lg:col-span-7 student-glass-card rounded-2xl p-6 space-y-5 text-xs">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Library Circulation &amp; Security Policy
                  </h2>
                  <p className="text-[#94A3B8] mt-0.5">
                    Configure borrowing defaults, fine rates, self-registration, and account lockout thresholds.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-[#CBD5E1] mb-1">Library Name</label>
                    <input
                      type="text"
                      value={settings.library_name}
                      onChange={(e) => setSettings({ ...settings, library_name: e.target.value })}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Default Loan Duration (Days)</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={settings.loan_duration_days}
                      onChange={(e) => setSettings({ ...settings, loan_duration_days: Number(e.target.value) })}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Default Max Books per Member</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={settings.max_books_per_student}
                      onChange={(e) => setSettings({ ...settings, max_books_per_student: Number(e.target.value) })}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Max Renewals per Loan</label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={settings.max_renewals}
                      onChange={(e) => setSettings({ ...settings, max_renewals: Number(e.target.value) })}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Daily Overdue Fine (Cents)</label>
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      value={settings.daily_fine_cents}
                      onChange={(e) => setSettings({ ...settings, daily_fine_cents: Number(e.target.value) })}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Failed Logins Before Lockout</label>
                    <input
                      type="number"
                      min={3}
                      max={15}
                      value={settings.max_failed_logins}
                      onChange={(e) => setSettings({ ...settings, max_failed_logins: Number(e.target.value) })}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Lockout Duration (Minutes)</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={settings.lockout_minutes}
                      onChange={(e) => setSettings({ ...settings, lockout_minutes: Number(e.target.value) })}
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-[#CBD5E1] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.allow_self_registration === 1}
                    onChange={(e) => setSettings({ ...settings, allow_self_registration: e.target.checked ? 1 : 0 })}
                    className="h-4 w-4 rounded accent-[#8B5CF6]"
                  />
                  <span>Allow student self-registration on the login page (requires librarian approval)</span>
                </label>

                <button
                  type="submit"
                  disabled={busyAction === 'save-settings'}
                  className="rounded-xl bg-[#8B5CF6] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
                >
                  {busyAction === 'save-settings' ? 'Saving...' : 'Save Library Settings'}
                </button>
              </form>

              <div className="lg:col-span-5 space-y-5">
                <section className="student-glass-card rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#A78BFA]">
                      Librarian &amp; Admin Staff ({staffAccounts.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => openCreateAccountModal('librarian')}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#A78BFA]/40 px-2.5 py-1 text-xs text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add Staff</span>
                    </button>
                  </div>
                  <div className="divide-y divide-white/10 text-xs">
                    {staffAccounts.map((st) => (
                      <div key={st.id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-white">{st.fullName}</div>
                          <div className="text-[#94A3B8] font-mono">{st.email} · {st.memberType}</div>
                        </div>
                        <span className={st.status === 'active' ? 'text-[#34D399]' : 'text-[#64748B]'}>{st.status}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <form onSubmit={handleChangeOwnPassword} className="student-glass-card rounded-2xl p-5 space-y-3.5 text-xs">
                  <h3 className="text-sm font-semibold text-white">Update Your Password</h3>
                  <input
                    type="password"
                    required
                    placeholder="Current Password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                  <input
                    type="password"
                    required
                    placeholder="New Password (8+ chars, mixed case & number)"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                  <input
                    type="password"
                    required
                    placeholder="Confirm New Password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={busyAction === 'change-password'}
                    className="w-full rounded-xl border border-[#A78BFA]/40 py-2.5 text-xs font-semibold text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
                  >
                    {busyAction === 'change-password' ? 'Updating...' : 'Change Password'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating LIBRA AI Drawer Trigger */}
      <FloatingLibraButton
        role="admin"
        onNotify={onNotify}
        onDataChanged={() => void loadAllData()}
      />

      {/* MODAL: Add / Edit Book */}
      {bookModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#04060E]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                {editingBook ? 'Edit Catalog Volume' : 'Add Volume to Catalog'}
              </h3>
              <button type="button" onClick={() => setBookModalOpen(false)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBook} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">ISBN (10 or 13)</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingBook)}
                    value={bookForm.isbn}
                    onChange={(e) => setBookForm((f) => ({ ...f, isbn: e.target.value }))}
                    placeholder="978-0262033848"
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Category</label>
                  <input
                    type="text"
                    required
                    value={bookForm.category}
                    onChange={(e) => setBookForm((f) => ({ ...f, category: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={bookForm.title}
                  onChange={(e) => setBookForm((f) => ({ ...f, title: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Author(s)</label>
                <input
                  type="text"
                  required
                  value={bookForm.author}
                  onChange={(e) => setBookForm((f) => ({ ...f, author: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Publisher</label>
                  <input
                    type="text"
                    value={bookForm.publisher}
                    onChange={(e) => setBookForm((f) => ({ ...f, publisher: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Published Year</label>
                  <input
                    type="number"
                    required
                    value={bookForm.publishedYear}
                    onChange={(e) => setBookForm((f) => ({ ...f, publishedYear: Number(e.target.value) }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Call Number</label>
                  <input
                    type="text"
                    required
                    value={bookForm.callNumber}
                    onChange={(e) => setBookForm((f) => ({ ...f, callNumber: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Shelf Location</label>
                  <input
                    type="text"
                    required
                    value={bookForm.shelfLocation}
                    onChange={(e) => setBookForm((f) => ({ ...f, shelfLocation: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Rack Code</label>
                  <input
                    type="text"
                    value={bookForm.rackCode}
                    onChange={(e) => setBookForm((f) => ({ ...f, rackCode: e.target.value }))}
                    placeholder="EW-3A"
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Total Copies</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    required
                    value={bookForm.totalCopies}
                    onChange={(e) => setBookForm((f) => ({ ...f, totalCopies: Number(e.target.value) }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Low-Stock Alert Threshold</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    required
                    value={bookForm.lowStockThreshold}
                    onChange={(e) => setBookForm((f) => ({ ...f, lowStockThreshold: Number(e.target.value) }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={bookForm.description}
                  onChange={(e) => setBookForm((f) => ({ ...f, description: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setBookModalOpen(false)} className="rounded-xl border border-white/15 px-4 py-2 text-[#CBD5E1] cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'save-book'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#8B5CF6] px-4 py-2 font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
                >
                  {busyAction === 'save-book' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingBook ? 'Save Changes' : 'Add Volume'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CSV Bulk Book Import */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#04060E]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Bulk CSV Book Import</h3>
              <button type="button" onClick={() => setBulkModalOpen(false)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#CBD5E1]">
              Upload a CSV file or paste CSV rows with headers: <code className="font-mono text-[#A78BFA]">isbn,title,author,category,publisher,published_year,call_number,shelf_location,total_copies,description</code>. ISBNs are checksum-validated and duplicates are safely skipped.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 rounded-xl border border-[#A78BFA]/35 px-3 py-1.5 text-xs text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer">
                <FileUp className="w-3.5 h-3.5" />
                <span>Choose .csv File</span>
                <input type="file" accept=".csv,text/csv" onChange={handleBulkCsvFile} className="hidden" />
              </label>
              <button
                type="button"
                onClick={() => setBulkCsvText(SAMPLE_CSV)}
                className="rounded-xl border border-white/15 px-3 py-1.5 text-xs text-[#CBD5E1] hover:border-[#38BDF8] cursor-pointer"
              >
                Load Sample CSV
              </button>
            </div>
            <form onSubmit={handleBulkImportSubmit} className="space-y-3">
              <textarea
                rows={7}
                required
                value={bulkCsvText}
                onChange={(e) => setBulkCsvText(e.target.value)}
                placeholder={SAMPLE_CSV}
                className="dark-glass-input obsidian-input-focus w-full rounded-xl p-3 text-xs font-mono"
              />
              {bulkResult && (
                <div className="rounded-xl border border-[#A78BFA]/30 bg-[#0A0D1A]/85 p-3 text-xs space-y-1">
                  <div className="text-[#34D399] font-semibold">Imported: {bulkResult.importedCount} volumes</div>
                  {bulkResult.skipped.length > 0 && (
                    <div className="text-amber-300">
                      Skipped ({bulkResult.skipped.length}): {bulkResult.skipped.map((s) => `Row ${s.row} (${s.reason})`).join('; ')}
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setBulkModalOpen(false)} className="rounded-xl border border-white/15 px-4 py-2 text-xs text-[#CBD5E1] cursor-pointer">
                  Close
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'bulk-import'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#8B5CF6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
                >
                  {busyAction === 'bulk-import' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Import Valid Books</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Create Account */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#04060E]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Create Member or Staff Account</h3>
              <button type="button" onClick={() => setAccountModalOpen(false)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#CBD5E1] mb-1">Account Type</label>
                <select
                  value={accountForm.memberType}
                  onChange={(e) => setAccountForm((f) => ({ ...f, memberType: e.target.value as MemberType }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                >
                  <option value="student">Student (Student Portal)</option>
                  <option value="faculty">Faculty Member (Student Portal)</option>
                  <option value="librarian">Librarian (Admin Console)</option>
                  <option value="admin">System Administrator (Admin Console)</option>
                </select>
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={accountForm.fullName}
                  onChange={(e) => setAccountForm((f) => ({ ...f, fullName: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={accountForm.email}
                    onChange={(e) => setAccountForm((f) => ({ ...f, email: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                {(accountForm.memberType === 'student' || accountForm.memberType === 'faculty') && (
                  <div>
                    <label className="block text-[#CBD5E1] mb-1">Student / Faculty ID</label>
                    <input
                      type="text"
                      required
                      value={accountForm.studentId}
                      onChange={(e) => setAccountForm((f) => ({ ...f, studentId: e.target.value.toUpperCase() }))}
                      placeholder="STU-2026-0201"
                      className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono uppercase"
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Department</label>
                  <input
                    type="text"
                    value={accountForm.department}
                    onChange={(e) => setAccountForm((f) => ({ ...f, department: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Borrowing Limit Override (Optional)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={accountForm.maxLoansOverride}
                    onChange={(e) => setAccountForm((f) => ({ ...f, maxLoansOverride: e.target.value }))}
                    placeholder="Default"
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Initial Password</label>
                <input
                  type="password"
                  required
                  value={accountForm.password}
                  onChange={(e) => setAccountForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min 8 chars, upper, lower & number"
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAccountModalOpen(false)} className="rounded-xl border border-white/15 px-4 py-2 text-[#CBD5E1] cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'create-account'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#8B5CF6] px-4 py-2 font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
                >
                  {busyAction === 'create-account' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span>Create Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Assess Fine */}
      {fineModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#04060E]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Assess Member Fine</h3>
              <button type="button" onClick={() => setFineModalOpen(false)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateFine} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#CBD5E1] mb-1">Member</label>
                <select
                  required
                  value={fineForm.userId}
                  onChange={(e) => setFineForm((f) => ({ ...f, userId: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Select member...</option>
                  {activeStudentsAndFaculty.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.studentId || s.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Amount (USD)</label>
                <input
                  type="number"
                  step="0.50"
                  min="0.50"
                  required
                  value={fineForm.amountDollars}
                  onChange={(e) => setFineForm((f) => ({ ...f, amountDollars: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Reason</label>
                <input
                  type="text"
                  required
                  value={fineForm.reason}
                  onChange={(e) => setFineForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Damaged binding or lost copy replacement"
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setFineModalOpen(false)} className="rounded-xl border border-white/15 px-4 py-2 text-[#CBD5E1] cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'create-fine'}
                  className="rounded-xl bg-[#8B5CF6] px-4 py-2 font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
                >
                  Assess Fine
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: One-Time Password Reset Code */}
      {issuedResetModal && (
        <div className="fixed inset-0 z-50 bg-[#04060E]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#A78BFA]">One-Time Reset Code Issued</h3>
              <button type="button" onClick={() => setIssuedResetModal(null)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#CBD5E1]">
              Provide this single-use code to <span className="font-semibold text-white">{issuedResetModal.email}</span>. Valid for 30 minutes.
            </p>
            <div className="rounded-xl border border-[#A78BFA]/40 bg-[#0A0D1A] p-4 text-center font-mono text-2xl font-bold tracking-widest text-[#A78BFA]">
              {issuedResetModal.resetCode}
            </div>
            <button
              type="button"
              onClick={() => setIssuedResetModal(null)}
              className="w-full rounded-xl bg-[#8B5CF6] py-2.5 text-xs font-semibold text-white cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
