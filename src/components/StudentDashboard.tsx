import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Bell,
  BookMarked,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Flame,
  History,
  LayoutDashboard,
  LayoutGrid,
  List as ListIcon,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError, apiRequest, buildApiUrl, getAccessToken, setAccessToken } from '../lib/api';
import type {
  Announcement,
  Book,
  DigitalResource,
  FineRecord,
  LoanRecord,
  ReservationRecord,
  User,
} from '../types';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { LibraryLogo } from './LibraryLogo';
import { FloatingLibraButton } from './ai/FloatingLibraButton';
import { LibraAiChat } from './ai/LibraAiChat';
import { BookCover } from './student/BookCover';
import { BookDetailsView } from './student/BookDetailsView';
import { StudentPortalBackdrop } from './student/StudentPortalBackdrop';

interface StudentDashboardProps {
  currentUser: User;
  libraryName: string;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

type StudentTab =
  | 'overview'
  | 'catalog'
  | 'digital'
  | 'loans'
  | 'reservations'
  | 'history'
  | 'ai'
  | 'notifications'
  | 'profile'
  | 'settings';

type FeaturedCollection = 'featured' | 'recent' | 'popular' | 'recommended';
type CatalogSort = 'title_asc' | 'title_desc' | 'popular' | 'recent' | 'year_desc' | 'available_desc';
type AvailabilityFilter = 'all' | 'available' | 'waitlist';

interface StudentOverviewResponse {
  summary: {
    activeLoansCount: number;
    dueSoonCount: number;
    activeReservationsCount: number;
    readyReservationsCount?: number;
    unpaidFinesCents: number;
    totalBorrowedCount: number;
    maxBooksAllowed: number;
    maxRenewalsAllowed: number;
  };
  activeLoans: LoanRecord[];
}

interface StudentNotification {
  id: string;
  category: 'deadline' | 'overdue' | 'reservation' | 'renewal' | 'fine' | 'announcement';
  title: string;
  message: string;
  timestamp: string;
  tone: 'alert' | 'warning' | 'gold' | 'info';
  targetTab: StudentTab;
  actionLabel: string;
}

interface StudentPreferences {
  defaultCatalogView: 'grid' | 'list';
  itemsPerPage: number;
  showParticles: boolean;
  alertDeadlines: boolean;
  alertReservations: boolean;
  alertFines: boolean;
}

const DEFAULT_PREFS: StudentPreferences = {
  defaultCatalogView: 'grid',
  itemsPerPage: 6,
  showParticles: true,
  alertDeadlines: true,
  alertReservations: true,
  alertFines: true,
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getDueDescriptor(
  dueIso: string,
  status: string
): { label: string; daysRemaining: number; tone: 'nominal' | 'warning' | 'overdue' } {
  const diffDays = Math.ceil((new Date(dueIso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (status === 'overdue' || diffDays < 0) {
    const overdueDays = Math.max(1, Math.abs(diffDays));
    return {
      label: `Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`,
      daysRemaining: diffDays,
      tone: 'overdue',
    };
  }
  if (diffDays === 0) {
    return { label: 'Due Today', daysRemaining: 0, tone: 'warning' };
  }
  if (diffDays <= 3) {
    return {
      label: `${diffDays} day${diffDays === 1 ? '' : 's'} remaining`,
      daysRemaining: diffDays,
      tone: 'warning',
    };
  }
  return { label: `${diffDays} days remaining`, daysRemaining: diffDays, tone: 'nominal' };
}

export function StudentDashboard({
  currentUser,
  libraryName,
  onUserUpdated,
  onLogout,
  onNotify,
}: StudentDashboardProps) {
  const [activeTab, setActiveTab] = useState<StudentTab>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Preferences (UI-only non-sensitive settings)
  const prefsStorageKey = `smart_library_prefs_${currentUser.id}`;
  const readNotifsStorageKey = `smart_library_read_notifs_${currentUser.id}`;

  const [prefs, setPrefs] = useState<StudentPreferences>(() => {
    try {
      const raw = window.localStorage.getItem(prefsStorageKey);
      if (raw) {
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_PREFS;
  });

  const [readNotifIds, setReadNotifIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(readNotifsStorageKey);
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      // ignore storage errors
    }
    return [];
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(prefsStorageKey, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs, prefsStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(readNotifsStorageKey, JSON.stringify(readNotifIds));
    } catch {
      // ignore
    }
  }, [readNotifIds, readNotifsStorageKey]);

  // Backend data state
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<StudentOverviewResponse | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [maxRenewals, setMaxRenewals] = useState(2);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [fines, setFines] = useState<FineRecord[]>([]);
  const [totalUnpaidCents, setTotalUnpaidCents] = useState(0);
  const [digitalResources, setDigitalResources] = useState<DigitalResource[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [recFeedbackMap, setRecFeedbackMap] = useState<Record<number, 'like' | 'dislike'>>({});

  // Digital library filter & modal preview state
  const [digitalSearch, setDigitalSearch] = useState('');
  const [digitalSubject, setDigitalSubject] = useState('all');
  const [pdfPreview, setPdfPreview] = useState<{ title: string; blobUrl: string; filename: string } | null>(null);

  // Discovery & Catalog UI state
  const [featuredCollection, setFeaturedCollection] = useState<FeaturedCollection>('featured');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [catalogSort, setCatalogSort] = useState<CatalogSort>('title_asc');
  const [catalogViewMode, setCatalogViewMode] = useState<'grid' | 'list'>(prefs.defaultCatalogView);
  const [catalogPage, setCatalogPage] = useState(1);

  // History & Notifications filters
  const [historyFilter, setHistoryFilter] = useState<'all' | 'active' | 'returned'>('all');
  const [notifFilter, setNotifFilter] = useState<'all' | 'unread'>('all');

  // Profile & password forms
  const [profileForm, setProfileForm] = useState({
    fullName: currentUser.fullName,
    department: currentUser.department,
    phone: currentUser.phone || '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadStudentData = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, bk, ln, rs, fn, dr, an, rc] = await Promise.all([
        apiRequest<StudentOverviewResponse>('/api/student/overview'),
        apiRequest<{ books: Book[]; categories: string[] }>('/api/student/books'),
        apiRequest<{ loans: LoanRecord[]; maxRenewals: number }>('/api/student/loans'),
        apiRequest<{ reservations: ReservationRecord[] }>('/api/student/reservations'),
        apiRequest<{ fines: FineRecord[]; totalUnpaidCents: number }>('/api/student/fines'),
        apiRequest<{ resources: DigitalResource[] }>('/api/student/digital-resources'),
        apiRequest<{ announcements: Announcement[] }>('/api/student/announcements'),
        apiRequest<{ feedbackMap: Record<number, 'like' | 'dislike'> }>('/api/student/recommendations'),
      ]);
      setOverview(ov);
      setBooks(bk.books);
      setCategories(bk.categories);
      setLoans(ln.loans);
      setMaxRenewals(ln.maxRenewals);
      setReservations(rs.reservations);
      setFines(fn.fines);
      setTotalUnpaidCents(fn.totalUnpaidCents);
      setDigitalResources(dr.resources);
      setAnnouncements(an.announcements);
      setRecFeedbackMap(rc.feedbackMap || {});

      // Keep selectedBook synced if currently viewing book details
      setSelectedBook((prev) => {
        if (!prev) return null;
        return bk.books.find((b) => b.id === prev.id) ?? prev;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) {
        onNotify('error', err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadStudentData();
  }, [loadStudentData]);

  useEffect(() => {
    setProfileForm({
      fullName: currentUser.fullName,
      department: currentUser.department,
      phone: currentUser.phone || '',
    });
  }, [currentUser]);

  // Reset pagination whenever filters/search/sort change
  useEffect(() => {
    setCatalogPage(1);
  }, [catalogSearch, catalogCategory, availabilityFilter, catalogSort, prefs.itemsPerPage]);

  const activeLoansList = useMemo(
    () => loans.filter((l) => l.status === 'active' || l.status === 'overdue'),
    [loans]
  );

  const activeReservationMap = useMemo(() => {
    const map = new Map<number, ReservationRecord>();
    for (const r of reservations) {
      if (r.status === 'pending' || r.status === 'ready') {
        map.set(r.book_id, r);
      }
    }
    return map;
  }, [reservations]);

  const activeLoanBookIds = useMemo(
    () => new Set(activeLoansList.map((l) => l.book_id)),
    [activeLoansList]
  );

  // Curated Collections derived from real DB records
  const curatedBooks = useMemo(() => {
    if (books.length === 0) return [];
    const copy = [...books];

    if (featuredCollection === 'recent') {
      return copy.sort((a, b) => b.id - a.id).slice(0, 4);
    }
    if (featuredCollection === 'popular') {
      return copy
        .sort(
          (a, b) =>
            (b.borrow_count ?? 0) - (a.borrow_count ?? 0) ||
            b.total_copies - b.available_copies - (a.total_copies - a.available_copies) ||
            a.title.localeCompare(b.title)
        )
        .slice(0, 4);
    }
    if (featuredCollection === 'recommended') {
      const deptLower = currentUser.department.toLowerCase();
      const borrowedCategories = new Set(loans.map((l) => (l.book_category || '').toLowerCase()).filter(Boolean));
      return copy
        .filter((b) => recFeedbackMap[b.id] !== 'dislike')
        .sort((a, b) => {
          const aScore =
            (deptLower && a.category.toLowerCase().includes(deptLower) ? 4 : 0) +
            (borrowedCategories.has(a.category.toLowerCase()) ? 2 : 0) +
            (recFeedbackMap[a.id] === 'like' ? 5 : 0) +
            (a.available_copies > 0 ? 1 : 0);
          const bScore =
            (deptLower && b.category.toLowerCase().includes(deptLower) ? 4 : 0) +
            (borrowedCategories.has(b.category.toLowerCase()) ? 2 : 0) +
            (recFeedbackMap[b.id] === 'like' ? 5 : 0) +
            (b.available_copies > 0 ? 1 : 0);
          return bScore - aScore || a.title.localeCompare(b.title);
        })
        .slice(0, 4);
    }

    // Featured: prioritize available volumes across diverse categories
    const seenCats = new Set<string>();
    const diverse: Book[] = [];
    for (const b of copy.sort((a, c) => c.available_copies - a.available_copies || c.published_year - a.published_year)) {
      if (!seenCats.has(b.category)) {
        seenCats.add(b.category);
        diverse.push(b);
      }
      if (diverse.length === 4) break;
    }
    if (diverse.length < 4) {
      for (const b of copy) {
        if (!diverse.some((d) => d.id === b.id)) diverse.push(b);
        if (diverse.length === 4) break;
      }
    }
    return diverse;
  }, [books, featuredCollection, currentUser.department, loans, recFeedbackMap]);

  // Filtered + Sorted Catalog Books
  const filteredBooks = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const filtered = books.filter((b) => {
      if (catalogCategory !== 'all' && b.category !== catalogCategory) return false;
      if (availabilityFilter === 'available' && b.available_copies < 1) return false;
      if (availabilityFilter === 'waitlist' && b.available_copies > 0) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.call_number.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered];
    switch (catalogSort) {
      case 'title_desc':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'popular':
        sorted.sort(
          (a, b) =>
            (b.borrow_count ?? 0) - (a.borrow_count ?? 0) ||
            b.total_copies - b.available_copies - (a.total_copies - a.available_copies)
        );
        break;
      case 'recent':
        sorted.sort((a, b) => b.id - a.id);
        break;
      case 'year_desc':
        sorted.sort((a, b) => b.published_year - a.published_year);
        break;
      case 'available_desc':
        sorted.sort((a, b) => b.available_copies - a.available_copies);
        break;
      case 'title_asc':
      default:
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return sorted;
  }, [books, catalogCategory, availabilityFilter, catalogSearch, catalogSort]);

  const totalCatalogPages = Math.max(1, Math.ceil(filteredBooks.length / prefs.itemsPerPage));
  const safeCatalogPage = Math.min(catalogPage, totalCatalogPages);
  const paginatedBooks = useMemo(() => {
    const start = (safeCatalogPage - 1) * prefs.itemsPerPage;
    return filteredBooks.slice(start, start + prefs.itemsPerPage);
  }, [filteredBooks, safeCatalogPage, prefs.itemsPerPage]);

  const relatedBooks = useMemo(() => {
    if (!selectedBook) return [];
    const sameCat = books.filter((b) => b.id !== selectedBook.id && b.category === selectedBook.category);
    const others = books.filter((b) => b.id !== selectedBook.id && b.category !== selectedBook.category);
    return [...sameCat, ...others].slice(0, 3);
  }, [books, selectedBook]);

  const filteredHistoryLoans = useMemo(() => {
    if (historyFilter === 'active') return loans.filter((l) => l.status === 'active' || l.status === 'overdue');
    if (historyFilter === 'returned') return loans.filter((l) => l.status === 'returned');
    return loans;
  }, [loans, historyFilter]);

  // Real Notifications synthesized from live DB loans, reservations, and fines
  const notifications = useMemo<StudentNotification[]>(() => {
    const items: StudentNotification[] = [];

    if (prefs.alertDeadlines) {
      for (const loan of activeLoansList) {
        const due = getDueDescriptor(loan.due_date, loan.status);
        if (due.tone === 'overdue') {
          items.push({
            id: `loan-overdue-${loan.id}`,
            category: 'overdue',
            title: `Overdue Return: ${loan.book_title}`,
            message: `${due.label}. Please return this volume to the circulation desk promptly to prevent additional fines.`,
            timestamp: loan.due_date,
            tone: 'alert',
            targetTab: 'loans',
            actionLabel: 'View Issued Books',
          });
        } else if (due.tone === 'warning') {
          items.push({
            id: `loan-due-${loan.id}`,
            category: 'deadline',
            title: `Upcoming Return Deadline: ${loan.book_title}`,
            message: `${due.label} (due ${formatDate(loan.due_date)}). Request a renewal if you need extra study time.`,
            timestamp: loan.due_date,
            tone: 'warning',
            targetTab: 'loans',
            actionLabel: 'Manage Renewal',
          });
        }

        if (loan.renewal_requested === 1) {
          items.push({
            id: `renewal-pending-${loan.id}`,
            category: 'renewal',
            title: `Renewal Request Pending: ${loan.book_title}`,
            message: 'Your renewal request is awaiting librarian review.',
            timestamp: loan.issued_at,
            tone: 'info',
            targetTab: 'loans',
            actionLabel: 'Check Status',
          });
        } else if (loan.renewal_count > 0) {
          items.push({
            id: `renewal-approved-${loan.id}-${loan.renewal_count}`,
            category: 'renewal',
            title: `Loan Renewed (${loan.renewal_count}/${maxRenewals}): ${loan.book_title}`,
            message: `Extended return deadline is ${formatDate(loan.due_date)}.`,
            timestamp: loan.due_date,
            tone: 'gold',
            targetTab: 'loans',
            actionLabel: 'View Due Date',
          });
        }
      }
    }

    if (prefs.alertReservations) {
      for (const res of reservations) {
        if (res.status === 'ready') {
          items.push({
            id: `res-ready-${res.id}`,
            category: 'reservation',
            title: `Ready for Pickup: ${res.book_title}`,
            message: `Your reserved copy is held at the circulation desk${res.expires_at ? ` until ${formatDate(res.expires_at)}` : ''}.`,
            timestamp: res.reserved_at,
            tone: 'gold',
            targetTab: 'reservations',
            actionLabel: 'View Reservation',
          });
        } else if (res.status === 'pending') {
          items.push({
            id: `res-pending-${res.id}`,
            category: 'reservation',
            title: `Reservation Queued: ${res.book_title}`,
            message: `Submitted on ${formatDate(res.reserved_at)}. You will be notified once prepared for pickup.`,
            timestamp: res.reserved_at,
            tone: 'info',
            targetTab: 'reservations',
            actionLabel: 'View Queue',
          });
        }
      }
    }

    if (prefs.alertFines) {
      for (const fine of fines) {
        if (fine.status === 'unpaid') {
          items.push({
            id: `fine-unpaid-${fine.id}`,
            category: 'fine',
            title: `Outstanding Fine: ${formatMoney(fine.amount_cents)}`,
            message: `${fine.reason} (Assessed ${formatDate(fine.created_at)}). Please settle at the circulation desk.`,
            timestamp: fine.created_at,
            tone: 'alert',
            targetTab: 'reservations',
            actionLabel: 'View Fine Ledger',
          });
        }
      }
    }

    for (const ann of announcements) {
      items.push({
        id: `announcement-${ann.id}`,
        category: 'announcement',
        title: `Library Notice: ${ann.title}`,
        message: ann.message,
        timestamp: ann.created_at,
        tone: ann.priority === 'urgent' ? 'alert' : ann.priority === 'important' ? 'gold' : 'info',
        targetTab: 'overview',
        actionLabel: 'Back to Dashboard',
      });
    }

    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [
    activeLoansList,
    reservations,
    fines,
    announcements,
    maxRenewals,
    prefs.alertDeadlines,
    prefs.alertReservations,
    prefs.alertFines,
  ]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !readNotifIds.includes(n.id)).length,
    [notifications, readNotifIds]
  );

  const visibleNotifications = useMemo(
    () => (notifFilter === 'unread' ? notifications.filter((n) => !readNotifIds.includes(n.id)) : notifications),
    [notifications, notifFilter, readNotifIds]
  );

  function markNotificationRead(id: string) {
    setReadNotifIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function markAllNotificationsRead() {
    setReadNotifIds(notifications.map((n) => n.id));
    onNotify('info', 'All notifications marked as read.');
  }

  // Real Backend Actions
  async function handleReserveBook(book: Book) {
    setBusyAction(`reserve-${book.id}`);
    try {
      await apiRequest('/api/student/reservations', {
        method: 'POST',
        body: JSON.stringify({ bookId: book.id }),
      });
      onNotify('success', `Reserved "${book.title}". Check My Reservations for pickup status.`);
      await loadStudentData();
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Unable to reserve book.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancelReservation(reservationId: number) {
    setBusyAction(`cancel-res-${reservationId}`);
    try {
      await apiRequest(`/api/student/reservations/${reservationId}`, {
        method: 'DELETE',
      });
      onNotify('info', 'Reservation cancelled.');
      await loadStudentData();
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Unable to cancel reservation.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRequestRenewal(loan: LoanRecord) {
    setBusyAction(`renew-${loan.id}`);
    try {
      const res = await apiRequest<{ message: string }>(`/api/student/loans/${loan.id}/request-renewal`, {
        method: 'POST',
      });
      onNotify('success', res.message);
      await loadStudentData();
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Unable to request renewal.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUpdateProfile(e: FormEvent) {
    e.preventDefault();
    setBusyAction('save-profile');
    try {
      const res = await apiRequest<{ user: User }>('/api/student/profile', {
        method: 'PATCH',
        body: JSON.stringify(profileForm),
      });
      onUserUpdated(res.user);
      onNotify('success', 'Your student profile has been updated.');
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Unable to update profile.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      onNotify('error', 'New passwords do not match.');
      return;
    }
    setBusyAction('change-password');
    try {
      const res = await apiRequest<{ accessToken: string; user: User; message: string }>(
        '/api/auth/change-password',
        {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: passwordForm.currentPassword,
            newPassword: passwordForm.newPassword,
          }),
        }
      );
      setAccessToken(res.accessToken);
      onUserUpdated(res.user);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      onNotify('success', res.message);
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Unable to update password.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRecommendationFeedback(bookId: number, feedback: 'like' | 'dislike' | 'clear') {
    setBusyAction(`rec-${bookId}`);
    try {
      await apiRequest('/api/student/recommendations/feedback', {
        method: 'POST',
        body: JSON.stringify({ bookId, feedback }),
      });
      setRecFeedbackMap((prev) => {
        const next = { ...prev };
        if (feedback === 'clear') {
          delete next[bookId];
        } else {
          next[bookId] = feedback;
        }
        return next;
      });
      onNotify(
        'info',
        feedback === 'like'
          ? 'Saved preference — showing more recommendations like this.'
          : feedback === 'dislike'
            ? 'Hidden from personalized picks.'
            : 'Recommendation preference cleared.'
      );
    } catch (err) {
      onNotify('error', err instanceof ApiError ? err.message : 'Unable to save feedback.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenDigitalPdf(resource: DigitalResource, mode: 'preview' | 'download') {
    setBusyAction(`digital-${resource.id}`);
    try {
      const pdfText = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 55 >>\nstream\nBT /F1 18 Tf 50 700 Td (${resource.title} - Alderbrook Library) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000258 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartafter\n%%EOF`;
      const blob = new Blob([pdfText], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const filename = `${resource.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60)}.pdf`;
      if (mode === 'download') {
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } else {
        setPdfPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev.blobUrl);
          return { title: resource.title, blobUrl, filename };
        });
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to open PDF resource.');
    } finally {
      setBusyAction(null);
    }
  }

  function closePdfPreview() {
    setPdfPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev.blobUrl);
      return null;
    });
  }

  const digitalCategories = useMemo(
    () => Array.from(new Set(digitalResources.map((d) => d.category))).sort(),
    [digitalResources]
  );

  const filteredDigitalResources = useMemo(() => {
    const q = digitalSearch.trim().toLowerCase();
    return digitalResources.filter((d) => {
      if (digitalSubject !== 'all' && d.category !== digitalSubject) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.author.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q)
      );
    });
  }, [digitalResources, digitalSearch, digitalSubject]);

  function navigateTab(tab: StudentTab) {
    setSelectedBook(null);
    setActiveTab(tab);
    setMobileMenuOpen(false);
  }

  const navItems: Array<{
    id: StudentTab;
    label: string;
    icon: typeof LayoutDashboard;
    count?: number;
  }> = [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'catalog', label: 'Explore Books', icon: Compass },
    {
      id: 'digital',
      label: 'Digital Library',
      icon: FileText,
      count: digitalResources.length || undefined,
    },
    {
      id: 'loans',
      label: 'My Issued Books',
      icon: BookOpen,
      count: activeLoansList.length || undefined,
    },
    {
      id: 'reservations',
      label: 'My Reservations',
      icon: BookMarked,
      count: overview?.summary.activeReservationsCount || undefined,
    },
    { id: 'history', label: 'Borrowing History', icon: History },
    { id: 'ai', label: 'LIBRA AI Assistant', icon: Sparkles },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      count: unreadCount || undefined,
    },
    { id: 'profile', label: 'My Profile', icon: UserIcon },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const activeNavLabel = selectedBook
    ? selectedBook.title
    : navItems.find((n) => n.id === activeTab)?.label ?? 'Dashboard';

  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const readyCount =
    overview?.summary.readyReservationsCount ??
    reservations.filter((r) => r.status === 'ready').length;

  return (
    <div className="relative min-h-screen w-full bg-[#070913] text-[#F8FAFC] flex overflow-x-hidden">
      {/* Obsidian-Indigo Silk Backdrop */}
      <StudentPortalBackdrop showParticles={prefs.showParticles} />

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/75 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Collapsible Obsidian-Indigo Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col justify-between border-r border-white/10 bg-[#0A0D1A]/95 backdrop-blur-2xl transition-all duration-200 lg:static lg:translate-x-0 ${
          sidebarCollapsed ? 'lg:w-[78px]' : 'w-64'
        } ${mobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full'}`}
      >
        <div>
          {/* Sidebar Brand Header */}
          <div className="h-16 px-4 border-b border-white/10 flex items-center justify-between gap-2">
            {sidebarCollapsed ? (
              <div className="mx-auto hidden lg:block">
                <LibraryLogo variant="light" size="sm" name="" />
              </div>
            ) : (
              <LibraryLogo
                variant="light"
                size="sm"
                name="SMART LIBRARY"
              />
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-[#94A3B8] hover:text-[#A78BFA]"
              aria-label="Close navigation menu"
            >
              <X className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:flex p-1.5 rounded-lg text-[#94A3B8] hover:text-[#A78BFA] hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="px-4 py-2.5 border-b border-white/10 bg-[#12162A]/60 flex items-center justify-between text-xs">
              <span className="text-[#38BDF8] font-medium">Student Portal</span>
              <span className="font-mono text-[#A78BFA] tabular-nums">
                {currentUser.studentId || 'Member'}
              </span>
            </div>
          )}

          {/* Primary Navigation Links */}
          <nav className="p-3 space-y-1" aria-label="Student Portal Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id && !selectedBook;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={sidebarCollapsed ? item.label : undefined}
                  onClick={() => navigateTab(item.id)}
                  className={`w-full flex items-center ${
                    sidebarCollapsed ? 'lg:justify-center' : 'justify-between'
                  } gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all duration-150 cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#171C36] border-[#A78BFA]/35 text-white shadow-sm'
                      : 'border-transparent text-[#94A3B8] hover:bg-white/[0.04] hover:border-white/10 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-[#A78BFA]' : 'text-[#64748B]'
                      }`}
                      aria-hidden="true"
                    />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </span>

                  {!sidebarCollapsed && item.count !== undefined && (
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        item.id === 'notifications'
                          ? 'text-[#FB7185] font-semibold'
                          : isActive
                            ? 'text-[#A78BFA]'
                            : 'text-[#38BDF8]'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Student Profile & Logout */}
        <div className="p-3.5 border-t border-white/10 space-y-3 bg-[#0A0D1A]/85">
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => navigateTab('profile')}
              className="w-full flex items-center gap-3 text-left rounded-xl p-1.5 hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              {!avatarFailed ? (
                <img
                  src="/src/assets/images/avatar_student_member_1795561504055.jpg"
                  alt={currentUser.fullName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-9 h-9 rounded-lg object-cover border border-[#A78BFA]/40 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#8B5CF6] to-[#6366F1] text-white flex items-center justify-center text-xs font-semibold shrink-0 border border-[#A78BFA]/40">
                  {currentUser.fullName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{currentUser.fullName}</p>
                <p className="text-xs text-[#94A3B8] truncate">{currentUser.department}</p>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            title={sidebarCollapsed ? 'Logout' : undefined}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 hover:border-rose-400/50 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 bg-[#0A0D1A]/85 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-1 rounded-lg text-[#CBD5E1] hover:bg-white/[0.06]"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-[#A78BFA] whitespace-nowrap hidden sm:inline font-medium">
                {libraryName || 'Smart Library'}
              </span>
              <span className="text-white/25 hidden sm:inline">/</span>
              <span className="font-semibold text-white truncate">
                {activeNavLabel}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden md:flex items-center">
              <ConnectionStatusBadge compact onRetryComplete={() => void loadStudentData()} />
            </div>
            <button
              type="button"
              onClick={() => navigateTab('notifications')}
              aria-label="Open notifications"
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/12 bg-[#12162A] text-[#CBD5E1] hover:border-[#A78BFA]/60 hover:text-white transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#FB7185] text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            {activeTab !== 'catalog' || selectedBook ? (
              <button
                type="button"
                onClick={() => navigateTab('catalog')}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] transition-all whitespace-nowrap shrink-0 cursor-pointer shadow-sm shadow-[#7C3AED]/25"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Explore Books</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void loadStudentData()}
                className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-[#12162A] px-4 py-2 text-xs font-medium text-white hover:border-[#A78BFA]/60 hover:text-[#A78BFA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#A78BFA]' : ''}`} />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Workspace Canvas */}
        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-8">
          <AnimatePresence mode="wait">
            {/* BOOK DETAILS SUB-PAGE */}
            {selectedBook ? (
              <BookDetailsView
                key={`book-detail-${selectedBook.id}`}
                book={selectedBook}
                relatedBooks={relatedBooks}
                alreadyBorrowed={activeLoanBookIds.has(selectedBook.id)}
                activeReservation={activeReservationMap.get(selectedBook.id)}
                currentFeedback={recFeedbackMap[selectedBook.id]}
                busyAction={busyAction}
                onBack={() => setSelectedBook(null)}
                onSelectBook={(bk) => setSelectedBook(bk)}
                onReserve={(bk) => void handleReserveBook(bk)}
                onCancelReservation={(id) => void handleCancelReservation(id)}
                onFeedback={(bookId, fb) => void handleRecommendationFeedback(bookId, fb)}
              />
            ) : (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-8"
              >
                {/* ==================== TAB 1: DASHBOARD ==================== */}
                {activeTab === 'overview' && (
                  <>
                    {/* Personalized Welcome Section */}
                    <section className="student-glass-card rounded-2xl p-6 sm:p-7">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex items-start sm:items-center gap-4">
                          {!avatarFailed ? (
                            <img
                              src="/src/assets/images/avatar_student_member_1795561504055.jpg"
                              alt={currentUser.fullName}
                              referrerPolicy="no-referrer"
                              onError={() => setAvatarFailed(true)}
                              className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border-2 border-[#A78BFA]/50 shadow-lg shrink-0"
                            />
                          ) : (
                            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#6366F1] text-white flex items-center justify-center text-lg font-semibold border-2 border-[#A78BFA]/50 shrink-0">
                              {currentUser.fullName.slice(0, 2).toUpperCase()}
                            </div>
                          )}

                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#A78BFA]">
                              <span>{todayFormatted}</span>
                              <span className="text-white/25" aria-hidden="true">·</span>
                              <span>{currentUser.department}</span>
                              {currentUser.studentId && (
                                <>
                                  <span className="text-white/25" aria-hidden="true">·</span>
                                  <span className="font-mono text-[#38BDF8]">{currentUser.studentId}</span>
                                </>
                              )}
                            </div>
                            <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-white [text-wrap:balance]">
                              Welcome back, {currentUser.fullName}
                            </h1>
                            <p className="text-xs sm:text-sm text-[#94A3B8] max-w-2xl">
                              Explore scholarly volumes, reserve available holdings, and monitor your circulation deadlines in real time.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => navigateTab('loans')}
                            className="rounded-xl border border-[#38BDF8]/40 bg-[#38BDF8]/10 px-4 py-2.5 text-xs font-medium text-[#38BDF8] hover:border-[#38BDF8] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                          >
                            My Issued Books ({activeLoansList.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => navigateTab('catalog')}
                            className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] transition-all cursor-pointer whitespace-nowrap shadow-md shadow-[#7C3AED]/25"
                          >
                            Explore Catalog
                          </button>
                        </div>
                      </div>
                    </section>

                    {/* 4 Real-Time Statistics Cards */}
                    <section aria-label="Library Account Metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {loading && !overview ? (
                        Array.from({ length: 4 }).map((_, idx) => (
                          <div key={idx} className="student-glass-card rounded-2xl p-5 animate-pulse space-y-3">
                            <div className="h-3 w-28 rounded bg-white/10" />
                            <div className="h-8 w-20 rounded bg-white/15" />
                            <div className="h-3 w-36 rounded bg-white/10" />
                          </div>
                        ))
                      ) : (
                        <>
                          <motion.button
                            type="button"
                            whileHover={{ y: -2 }}
                            onClick={() => navigateTab('loans')}
                            className="student-glass-card rounded-2xl p-5 text-left cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#94A3B8]">Currently Issued Books</span>
                              <span className="w-8 h-8 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center">
                                <BookOpen className="w-4 h-4 text-[#A78BFA]" aria-hidden="true" />
                              </span>
                            </div>
                            <div className="mt-2 font-mono text-3xl font-bold text-white tabular-nums">
                              {overview?.summary.activeLoansCount ?? 0}
                              <span className="text-sm font-normal text-[#94A3B8]">
                                {' '}/ {overview?.summary.maxBooksAllowed ?? 5}
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs text-[#38BDF8]">
                              Active checkouts against borrowing quota
                            </p>
                          </motion.button>

                          <motion.button
                            type="button"
                            whileHover={{ y: -2 }}
                            onClick={() => navigateTab('reservations')}
                            className="student-glass-card rounded-2xl p-5 text-left cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#94A3B8]">Available Reservations</span>
                              <span className="w-8 h-8 rounded-xl bg-[#38BDF8]/15 border border-[#38BDF8]/30 flex items-center justify-center">
                                <BookMarked className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
                              </span>
                            </div>
                            <div className="mt-2 font-mono text-3xl font-bold text-[#A78BFA] tabular-nums">
                              {readyCount}
                              <span className="text-sm font-normal text-[#94A3B8]">
                                {' '}ready · {overview?.summary.activeReservationsCount ?? 0} active
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs text-[#94A3B8]">
                              Volumes prepared for desk pickup
                            </p>
                          </motion.button>

                          <motion.button
                            type="button"
                            whileHover={{ y: -2 }}
                            onClick={() => navigateTab('loans')}
                            className="student-glass-card rounded-2xl p-5 text-left cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#94A3B8]">Pending Returns</span>
                              <span className="w-8 h-8 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
                                <CalendarClock className="w-4 h-4 text-amber-400" aria-hidden="true" />
                              </span>
                            </div>
                            <div className="mt-2 font-mono text-3xl font-bold text-white tabular-nums">
                              {overview?.summary.dueSoonCount ?? 0}
                            </div>
                            <p className="mt-1.5 text-xs text-[#94A3B8]">
                              Due within 3 days or overdue
                            </p>
                          </motion.button>

                          <motion.button
                            type="button"
                            whileHover={{ y: -2 }}
                            onClick={() => navigateTab('reservations')}
                            className="student-glass-card rounded-2xl p-5 text-left cursor-pointer"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-[#94A3B8]">Outstanding Fines</span>
                              <span
                                className={`w-8 h-8 rounded-xl border flex items-center justify-center ${
                                  (overview?.summary.unpaidFinesCents ?? 0) > 0
                                    ? 'bg-[#FB7185]/15 border-[#FB7185]/30'
                                    : 'bg-[#34D399]/15 border-[#34D399]/30'
                                }`}
                              >
                                <Clock
                                  className={`w-4 h-4 ${
                                    (overview?.summary.unpaidFinesCents ?? 0) > 0
                                      ? 'text-[#FB7185]'
                                      : 'text-[#34D399]'
                                  }`}
                                  aria-hidden="true"
                                />
                              </span>
                            </div>
                            <div
                              className={`mt-2 font-mono text-3xl font-bold tabular-nums ${
                                (overview?.summary.unpaidFinesCents ?? 0) > 0
                                  ? 'text-[#FB7185]'
                                  : 'text-[#34D399]'
                              }`}
                            >
                              {formatMoney(overview?.summary.unpaidFinesCents ?? 0)}
                            </div>
                            <p className="mt-1.5 text-xs text-[#94A3B8]">
                              {(overview?.summary.unpaidFinesCents ?? 0) > 0
                                ? 'Settle balance at circulation desk'
                                : 'Account in good standing'}
                            </p>
                          </motion.button>
                        </>
                      )}
                    </section>

                    {/* Featured & Curated Discovery Section */}
                    <section className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <h2 className="text-xl font-semibold text-white">
                            Curated Collection Discovery
                          </h2>
                          <p className="text-xs text-[#94A3B8] mt-0.5">
                            Explore featured editions, recent acquisitions, popular loans, and department picks
                          </p>
                        </div>

                        <div
                          role="tablist"
                          aria-label="Book collection filters"
                          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl border border-white/10 bg-[#080B16]/85"
                        >
                          {(
                            [
                              { id: 'featured', label: 'Featured', icon: Sparkles },
                              { id: 'recent', label: 'Recently Added', icon: Clock },
                              { id: 'popular', label: 'Most Popular', icon: Flame },
                              { id: 'recommended', label: 'Recommended', icon: TrendingUp },
                            ] as const
                          ).map((tab) => {
                            const Icon = tab.icon;
                            const active = featuredCollection === tab.id;
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setFeaturedCollection(tab.id)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                                  active
                                    ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white font-semibold'
                                    : 'text-[#94A3B8] hover:text-white'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>{tab.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {loading && books.length === 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="student-glass-card rounded-2xl p-4 animate-pulse space-y-3">
                              <div className="aspect-[3/4] rounded-xl bg-white/10" />
                              <div className="h-4 w-3/4 rounded bg-white/15" />
                              <div className="h-3 w-1/2 rounded bg-white/10" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          {curatedBooks.map((book) => {
                            const activeRes = activeReservationMap.get(book.id);
                            const alreadyBorrowed = activeLoanBookIds.has(book.id);
                            const isAvailable = book.available_copies > 0;

                            return (
                              <motion.article
                                key={book.id}
                                whileHover={{ y: -3 }}
                                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                                className="student-glass-card rounded-2xl p-4 flex flex-col justify-between gap-4"
                              >
                                <div className="space-y-3">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedBook(book)}
                                    className="w-full text-left cursor-pointer group focus-visible:outline-none"
                                  >
                                    <BookCover
                                      title={book.title}
                                      author={book.author}
                                      category={book.category}
                                      callNumber={book.call_number}
                                      coverUrl={book.cover_url}
                                      className="group-hover:border-[#A78BFA] transition-colors"
                                    />
                                  </button>

                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between gap-2 text-[11px]">
                                      <span className="text-[#A78BFA] truncate">{book.category}</span>
                                      <span
                                        className={`font-mono tabular-nums shrink-0 ${
                                          isAvailable ? 'text-emerald-400' : 'text-amber-300'
                                        }`}
                                      >
                                        {isAvailable ? `${book.available_copies} avail.` : 'Waitlist'}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedBook(book)}
                                      className="text-left text-base font-semibold text-white hover:text-[#A78BFA] transition-colors line-clamp-1 cursor-pointer"
                                    >
                                      {book.title}
                                    </button>
                                    <p className="text-xs text-[#94A3B8] truncate">{book.author}</p>
                                  </div>
                                </div>

                                <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedBook(book)}
                                      className="text-xs font-medium text-[#38BDF8] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                                    >
                                      Details
                                    </button>
                                    <button
                                      type="button"
                                      title="Helpful recommendation"
                                      onClick={() =>
                                        void handleRecommendationFeedback(
                                          book.id,
                                          recFeedbackMap[book.id] === 'like' ? 'clear' : 'like'
                                        )
                                      }
                                      className={`p-1 rounded-md transition-colors cursor-pointer ${
                                        recFeedbackMap[book.id] === 'like'
                                          ? 'text-emerald-300 bg-emerald-500/15'
                                          : 'text-[#64748B] hover:text-emerald-300'
                                      }`}
                                    >
                                      <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Not interested"
                                      onClick={() =>
                                        void handleRecommendationFeedback(
                                          book.id,
                                          recFeedbackMap[book.id] === 'dislike' ? 'clear' : 'dislike'
                                        )
                                      }
                                      className={`p-1 rounded-md transition-colors cursor-pointer ${
                                        recFeedbackMap[book.id] === 'dislike'
                                          ? 'text-rose-300 bg-rose-500/15'
                                          : 'text-[#64748B] hover:text-rose-300'
                                      }`}
                                    >
                                      <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
                                    </button>
                                  </div>

                                  {alreadyBorrowed ? (
                                    <span className="text-[11px] font-medium text-[#38BDF8]">Borrowed</span>
                                  ) : activeRes ? (
                                    <span className="text-[11px] font-medium text-emerald-400">
                                      {activeRes.status === 'ready' ? 'Ready' : 'Reserved'}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busyAction === `reserve-${book.id}`}
                                      onClick={() => void handleReserveBook(book)}
                                      className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-medium text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                                    >
                                      {busyAction === `reserve-${book.id}` ? 'Reserving...' : 'Reserve'}
                                    </button>
                                  )}
                                </div>
                              </motion.article>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {/* Current Loans Quick Ledger */}
                    <section className="student-glass-card rounded-2xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold text-white">
                            Active Loans &amp; Return Deadlines
                          </h2>
                          <p className="text-xs text-[#94A3B8] mt-0.5">
                            Monitor return schedules or request a renewal directly
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigateTab('loans')}
                          className="text-xs font-medium text-[#A78BFA] hover:text-white cursor-pointer whitespace-nowrap"
                        >
                          Manage All Loans
                        </button>
                      </div>

                      {activeLoansList.length === 0 ? (
                        <div className="p-10 text-center space-y-3">
                          <p className="text-sm text-[#CBD5E1]">
                            You have no active books checked out right now.
                          </p>
                          <button
                            type="button"
                            onClick={() => navigateTab('catalog')}
                            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                          >
                            <Compass className="w-3.5 h-3.5" />
                            <span>Explore Library Catalog</span>
                          </button>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/10 bg-[#080B16]/85 text-xs font-medium text-[#A78BFA]">
                                <th className="py-3 px-5">Volume</th>
                                <th className="py-3 px-4">Call No.</th>
                                <th className="py-3 px-4">Due Date</th>
                                <th className="py-3 px-4">Status</th>
                                <th className="py-3 px-5 text-right">Renewal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 text-xs">
                              {activeLoansList.map((loan) => {
                                const dueInfo = getDueDescriptor(loan.due_date, loan.status);
                                return (
                                  <tr key={loan.id} className="student-row-hover">
                                    <td className="py-3 px-5">
                                      <div className="flex items-center gap-3">
                                        <BookCover
                                          title={loan.book_title}
                                          category={loan.book_category}
                                          coverUrl={loan.book_cover_url}
                                          size="xs"
                                        />
                                        <div>
                                          <div className="font-medium text-white text-sm">
                                            {loan.book_title}
                                          </div>
                                          <div className="text-[#94A3B8]">{loan.book_author}</div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4 font-mono text-[#CBD5E1] whitespace-nowrap">
                                      {loan.book_call_number}
                                    </td>
                                    <td className="py-3 px-4 font-mono text-white tabular-nums whitespace-nowrap">
                                      {formatDate(loan.due_date)}
                                    </td>
                                    <td className="py-3 px-4 whitespace-nowrap font-medium">
                                      <span
                                        className={`inline-flex items-center gap-1.5 ${
                                          dueInfo.tone === 'overdue'
                                            ? 'text-rose-400'
                                            : dueInfo.tone === 'warning'
                                              ? 'text-amber-300'
                                              : 'text-emerald-400'
                                        }`}
                                      >
                                        {dueInfo.tone === 'overdue' ? (
                                          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                        ) : dueInfo.tone === 'warning' ? (
                                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                                        ) : (
                                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                        )}
                                        {dueInfo.label}
                                      </span>
                                    </td>
                                    <td className="py-3 px-5 text-right whitespace-nowrap">
                                      {loan.renewal_requested === 1 ? (
                                        <span className="text-[#38BDF8] font-medium">Renewal Pending</span>
                                      ) : loan.status === 'overdue' ? (
                                        <span className="text-[#64748B]">Visit Desk</span>
                                      ) : loan.renewal_count >= maxRenewals ? (
                                        <span className="text-[#64748B]">Limit Reached</span>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={busyAction === `renew-${loan.id}`}
                                          onClick={() => void handleRequestRenewal(loan)}
                                          className="rounded-lg border border-[#A78BFA]/35 px-3 py-1.5 text-xs font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/15 transition-colors cursor-pointer"
                                        >
                                          Renew ({loan.renewal_count}/{maxRenewals})
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                )}

                {/* ==================== TAB 2: EXPLORE BOOKS ==================== */}
                {activeTab === 'catalog' && (
                  <section className="space-y-6">
                    {/* Search & Discovery Filter Toolbar */}
                    <div className="student-glass-card rounded-2xl p-5 space-y-4">
                      <div className="relative">
                        <Search
                          className="w-4 h-4 text-[#A78BFA] absolute left-4 top-1/2 -translate-y-1/2"
                          aria-hidden="true"
                        />
                        <input
                          type="search"
                          value={catalogSearch}
                          onChange={(e) => setCatalogSearch(e.target.value)}
                          placeholder="Search university catalog by title, author, ISBN, or call number..."
                          className="w-full rounded-xl pl-11 pr-4 py-3 text-sm dark-glass-input obsidian-input-focus"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <select
                            value={catalogCategory}
                            onChange={(e) => setCatalogCategory(e.target.value)}
                            aria-label="Filter by subject category"
                            className="rounded-xl px-3.5 py-2 text-xs font-medium dark-glass-input obsidian-input-focus cursor-pointer"
                          >
                            <option value="all">All Subjects</option>
                            {categories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>

                          <select
                            value={availabilityFilter}
                            onChange={(e) => setAvailabilityFilter(e.target.value as AvailabilityFilter)}
                            aria-label="Filter by availability"
                            className="rounded-xl px-3.5 py-2 text-xs font-medium dark-glass-input obsidian-input-focus cursor-pointer"
                          >
                            <option value="all">All Availability</option>
                            <option value="available">Available Now</option>
                            <option value="waitlist">Checked Out / Waitlist</option>
                          </select>

                          <select
                            value={catalogSort}
                            onChange={(e) => setCatalogSort(e.target.value as CatalogSort)}
                            aria-label="Sort catalog"
                            className="rounded-xl px-3.5 py-2 text-xs font-medium dark-glass-input obsidian-input-focus cursor-pointer"
                          >
                            <option value="title_asc">Sort: Title (A–Z)</option>
                            <option value="title_desc">Sort: Title (Z–A)</option>
                            <option value="popular">Sort: Most Popular</option>
                            <option value="recent">Sort: Recently Added</option>
                            <option value="year_desc">Sort: Publication Year</option>
                            <option value="available_desc">Sort: Most Copies Available</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                            {filteredBooks.length} volume{filteredBooks.length === 1 ? '' : 's'}
                          </span>
                          <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-[#080B16]/85">
                            <button
                              type="button"
                              onClick={() => setCatalogViewMode('grid')}
                              aria-label="Grid view"
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                catalogViewMode === 'grid'
                                  ? 'bg-[#8B5CF6]/30 text-white'
                                  : 'text-[#94A3B8] hover:text-white'
                              }`}
                            >
                              <LayoutGrid className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setCatalogViewMode('list')}
                              aria-label="List view"
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                catalogViewMode === 'list'
                                  ? 'bg-[#8B5CF6]/30 text-white'
                                  : 'text-[#94A3B8] hover:text-white'
                              }`}
                            >
                              <ListIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Catalog Results */}
                    {loading && books.length === 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {Array.from({ length: 6 }).map((_, idx) => (
                          <div key={idx} className="student-glass-card rounded-2xl p-5 animate-pulse space-y-4">
                            <div className="aspect-[3/4] rounded-xl bg-white/10" />
                            <div className="h-4 w-3/4 rounded bg-white/15" />
                            <div className="h-3 w-1/2 rounded bg-white/10" />
                          </div>
                        ))}
                      </div>
                    ) : filteredBooks.length === 0 ? (
                      <div className="student-glass-card rounded-2xl p-12 text-center space-y-3">
                        <BookOpen className="w-8 h-8 text-[#A78BFA]/70 mx-auto" aria-hidden="true" />
                        <p className="text-sm text-[#CBD5E1]">
                          No catalog volumes match your search criteria.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setCatalogSearch('');
                            setCatalogCategory('all');
                            setAvailabilityFilter('all');
                          }}
                          className="rounded-xl border border-[#A78BFA]/40 px-4 py-2 text-xs font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/10 cursor-pointer"
                        >
                          Reset Filters
                        </button>
                      </div>
                    ) : catalogViewMode === 'grid' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {paginatedBooks.map((book) => {
                          const activeRes = activeReservationMap.get(book.id);
                          const alreadyBorrowed = activeLoanBookIds.has(book.id);
                          const isAvailable = book.available_copies > 0;

                          return (
                            <motion.article
                              key={book.id}
                              whileHover={{ y: -3 }}
                              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                              className="student-glass-card rounded-2xl p-5 flex flex-col justify-between gap-4"
                            >
                              <div className="flex gap-4 items-start">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBook(book)}
                                  className="shrink-0 cursor-pointer group"
                                >
                                  <BookCover
                                    title={book.title}
                                    category={book.category}
                                    coverUrl={book.cover_url}
                                    size="sm"
                                    className="w-20 h-28 group-hover:border-[#A78BFA] transition-colors"
                                  />
                                </button>

                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="flex items-center gap-2 text-[11px] text-[#A78BFA]">
                                    <span className="truncate">{book.category}</span>
                                    <span className="text-white/25" aria-hidden="true">·</span>
                                    <span className="font-mono text-[#94A3B8] shrink-0">{book.published_year}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedBook(book)}
                                    className="text-left text-base font-semibold text-white hover:text-[#A78BFA] transition-colors leading-snug line-clamp-2 cursor-pointer"
                                  >
                                    {book.title}
                                  </button>
                                  <p className="text-xs text-[#CBD5E1] truncate">{book.author}</p>
                                  <p className="text-xs text-[#94A3B8] line-clamp-2 leading-relaxed">
                                    {book.description}
                                  </p>
                                </div>
                              </div>

                              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3 text-xs">
                                <div>
                                  <div
                                    className={`font-mono font-medium tabular-nums ${
                                      isAvailable ? 'text-emerald-400' : 'text-amber-300'
                                    }`}
                                  >
                                    {book.available_copies} of {book.total_copies} available
                                  </div>
                                  <div className="text-[#94A3B8] text-[11px]">{book.shelf_location}</div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedBook(book)}
                                    className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium text-[#CBD5E1] hover:border-[#A78BFA]/60 hover:text-[#A78BFA] transition-colors cursor-pointer"
                                  >
                                    Details
                                  </button>
                                  {alreadyBorrowed ? (
                                    <span className="text-xs font-medium text-[#38BDF8]">Borrowed</span>
                                  ) : activeRes ? (
                                    <span className="text-xs font-medium text-emerald-400">Reserved</span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busyAction === `reserve-${book.id}`}
                                      onClick={() => void handleReserveBook(book)}
                                      className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] disabled:opacity-50 transition-all cursor-pointer"
                                    >
                                      {busyAction === `reserve-${book.id}` ? '...' : 'Reserve'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </motion.article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="student-glass-card rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/10 bg-[#080B16]/85 text-xs font-medium text-[#A78BFA]">
                                <th className="py-3 px-5">Volume</th>
                                <th className="py-3 px-4">Subject</th>
                                <th className="py-3 px-4">ISBN / Call No.</th>
                                <th className="py-3 px-4">Availability</th>
                                <th className="py-3 px-5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 text-xs">
                              {paginatedBooks.map((book) => {
                                const activeRes = activeReservationMap.get(book.id);
                                const alreadyBorrowed = activeLoanBookIds.has(book.id);
                                const isAvailable = book.available_copies > 0;
                                return (
                                  <tr key={book.id} className="student-row-hover">
                                    <td className="py-3 px-5">
                                      <div className="flex items-center gap-3">
                                        <BookCover title={book.title} category={book.category} coverUrl={book.cover_url} size="xs" />
                                        <div>
                                          <button
                                            type="button"
                                            onClick={() => setSelectedBook(book)}
                                            className="text-sm font-semibold text-white hover:text-[#A78BFA] text-left cursor-pointer"
                                          >
                                            {book.title}
                                          </button>
                                          <div className="text-[#94A3B8]">
                                            {book.author} · {book.published_year}
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4 text-[#A78BFA] whitespace-nowrap">{book.category}</td>
                                    <td className="py-3 px-4 font-mono text-[#CBD5E1] whitespace-nowrap">
                                      <div>{book.isbn}</div>
                                      <div className="text-[#64748B]">{book.call_number}</div>
                                    </td>
                                    <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                                      <span className={isAvailable ? 'text-emerald-400' : 'text-amber-300'}>
                                        {book.available_copies}/{book.total_copies} avail.
                                      </span>
                                    </td>
                                    <td className="py-3 px-5 text-right whitespace-nowrap space-x-2">
                                      <button
                                        type="button"
                                        onClick={() => setSelectedBook(book)}
                                        className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-medium text-[#CBD5E1] hover:border-[#A78BFA] hover:text-[#A78BFA] cursor-pointer"
                                      >
                                        Details
                                      </button>
                                      {alreadyBorrowed ? (
                                        <span className="text-[#38BDF8] font-medium">Borrowed</span>
                                      ) : activeRes ? (
                                        <span className="text-emerald-400 font-medium">Reserved</span>
                                      ) : (
                                        <button
                                          type="button"
                                          disabled={busyAction === `reserve-${book.id}`}
                                          onClick={() => void handleReserveBook(book)}
                                          className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                                        >
                                          Reserve
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Pagination Bar */}
                    {filteredBooks.length > prefs.itemsPerPage && (
                      <div className="flex flex-wrap items-center justify-between gap-4 pt-2 text-xs text-[#94A3B8]">
                        <span className="font-mono tabular-nums">
                          Showing {(safeCatalogPage - 1) * prefs.itemsPerPage + 1}–
                          {Math.min(safeCatalogPage * prefs.itemsPerPage, filteredBooks.length)} of{' '}
                          {filteredBooks.length} volumes
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={safeCatalogPage <= 1}
                            onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#12162A] px-3 py-1.5 text-xs text-white disabled:opacity-40 hover:border-[#A78BFA] cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            <span>Prev</span>
                          </button>
                          {Array.from({ length: totalCatalogPages }).map((_, idx) => {
                            const page = idx + 1;
                            return (
                              <button
                                key={page}
                                type="button"
                                onClick={() => setCatalogPage(page)}
                                className={`w-8 h-8 rounded-lg font-mono text-xs tabular-nums transition-colors cursor-pointer ${
                                  page === safeCatalogPage
                                    ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white font-semibold'
                                    : 'border border-white/15 bg-[#12162A] text-[#CBD5E1] hover:border-[#A78BFA]/50'
                                }`}
                              >
                                {page}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            disabled={safeCatalogPage >= totalCatalogPages}
                            onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-[#12162A] px-3 py-1.5 text-xs text-white disabled:opacity-40 hover:border-[#A78BFA] cursor-pointer"
                          >
                            <span>Next</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {/* ==================== DIGITAL LIBRARY ==================== */}
                {activeTab === 'digital' && (
                  <section className="space-y-6">
                    <div className="student-glass-card rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div>
                        <h1 className="text-xl font-semibold text-white">
                          Digital Library &amp; Academic Guides
                        </h1>
                        <p className="text-xs text-[#94A3B8] mt-0.5">
                          Instant access to verified study guides, research notes, and open-access PDFs
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="search"
                            value={digitalSearch}
                            onChange={(e) => setDigitalSearch(e.target.value)}
                            placeholder="Search digital guides..."
                            className="rounded-xl pl-9 pr-3 py-2 text-xs dark-glass-input obsidian-input-focus w-56"
                          />
                        </div>

                        <select
                          value={digitalSubject}
                          onChange={(e) => setDigitalSubject(e.target.value)}
                          className="rounded-xl px-3 py-2 text-xs dark-glass-input obsidian-input-focus cursor-pointer"
                        >
                          <option value="all">All Subjects</option>
                          {digitalCategories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {filteredDigitalResources.length === 0 ? (
                      <div className="student-glass-card rounded-2xl p-12 text-center space-y-2">
                        <FileText className="w-8 h-8 text-[#A78BFA]/70 mx-auto" aria-hidden="true" />
                        <p className="text-sm text-[#CBD5E1]">
                          No digital resources match your current filter.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredDigitalResources.map((res) => {
                          const hasSafeExternalUrl = /^https:\/\//i.test(res.external_url || '');
                          return (
                            <article
                              key={res.id}
                              className="student-glass-card rounded-2xl p-5 flex flex-col justify-between gap-4"
                            >
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="text-[#A78BFA] font-medium">{res.category}</span>
                                  <span className="font-mono uppercase text-[#38BDF8]">
                                    {res.resource_type}
                                  </span>
                                </div>
                                <h2 className="text-base font-semibold text-white leading-snug">
                                  {res.title}
                                </h2>
                                <p className="text-xs text-[#CBD5E1]">{res.author}</p>
                                <p className="text-xs text-[#94A3B8] line-clamp-3 leading-relaxed">
                                  {res.description}
                                </p>
                              </div>

                              <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono text-[11px] text-[#64748B]">
                                  {formatDate(res.created_at)}
                                </span>

                                <div className="flex items-center gap-2">
                                  {res.has_file ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busyAction === `digital-${res.id}`}
                                        onClick={() => void handleOpenDigitalPdf(res, 'preview')}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#38BDF8]/45 bg-[#38BDF8]/15 px-3 py-1.5 text-xs font-medium text-[#38BDF8] hover:text-white cursor-pointer"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                        <span>Read PDF</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busyAction === `digital-${res.id}`}
                                        onClick={() => void handleOpenDigitalPdf(res, 'download')}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        <span>Download</span>
                                      </button>
                                    </>
                                  ) : null}

                                  {hasSafeExternalUrl && (
                                    <a
                                      href={res.external_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-[#CBD5E1] hover:border-[#A78BFA] hover:text-[#A78BFA]"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      <span>Open</span>
                                    </a>
                                  )}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

                {/* ==================== LIBRA AI ASSISTANT ==================== */}
                {activeTab === 'ai' && (
                  <section className="h-[calc(100vh-11rem)] min-h-[540px]">
                    <LibraAiChat
                      role="student"
                      onNotify={onNotify}
                      onReserveBook={(bookId) => {
                        const target = books.find((b) => b.id === bookId);
                        if (target) void handleReserveBook(target);
                      }}
                      onOpenBookDetails={(bookId) => {
                        const target = books.find((b) => b.id === bookId);
                        if (target) setSelectedBook(target);
                      }}
                      onDataChanged={() => void loadStudentData()}
                    />
                  </section>
                )}

                {/* ==================== TAB 3: MY ISSUED BOOKS ==================== */}
                {activeTab === 'loans' && (
                  <section className="student-glass-card rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h1 className="text-xl font-semibold text-white">
                          My Issued Books &amp; Renewals
                        </h1>
                        <p className="text-xs text-[#94A3B8] mt-0.5">
                          Each active volume may be renewed up to {maxRenewals} times prior to its due date.
                        </p>
                      </div>
                      <span className="font-mono text-xs text-[#A78BFA] tabular-nums">
                        {activeLoansList.length} / {overview?.summary.maxBooksAllowed ?? 5} active slots used
                      </span>
                    </div>

                    {activeLoansList.length === 0 ? (
                      <div className="p-12 text-center space-y-3">
                        <BookOpen className="w-8 h-8 text-[#A78BFA]/70 mx-auto" aria-hidden="true" />
                        <p className="text-sm text-[#CBD5E1]">
                          No books are currently issued to your account.
                        </p>
                        <button
                          type="button"
                          onClick={() => navigateTab('catalog')}
                          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                        >
                          Explore Books
                        </button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 bg-[#080B16]/85 text-xs font-medium text-[#A78BFA]">
                              <th className="py-3 px-5">Volume</th>
                              <th className="py-3 px-4">ISBN / Call No.</th>
                              <th className="py-3 px-4">Issue Date</th>
                              <th className="py-3 px-4">Due Date</th>
                              <th className="py-3 px-4">Remaining Days</th>
                              <th className="py-3 px-5 text-right">Renewal</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10 text-xs">
                            {activeLoansList.map((loan) => {
                              const dueInfo = getDueDescriptor(loan.due_date, loan.status);
                              return (
                                <tr key={loan.id} className="student-row-hover">
                                  <td className="py-3.5 px-5">
                                    <div className="flex items-center gap-3">
                                      <BookCover
                                        title={loan.book_title}
                                        category={loan.book_category}
                                        coverUrl={loan.book_cover_url}
                                        size="xs"
                                      />
                                      <div>
                                        <div className="text-sm font-semibold text-white">
                                          {loan.book_title}
                                        </div>
                                        <div className="text-[#94A3B8]">{loan.book_author}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 font-mono text-[#CBD5E1] whitespace-nowrap">
                                    <div>{loan.book_isbn}</div>
                                    <div className="text-[#64748B]">{loan.book_call_number}</div>
                                    {loan.barcode && (
                                      <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 text-[10px] text-[#A78BFA] font-mono">
                                        <span>Barcode:</span>
                                        <span className="font-semibold text-white">{loan.barcode}</span>
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-3.5 px-4 font-mono text-[#CBD5E1] tabular-nums whitespace-nowrap">
                                    {formatDate(loan.issued_at)}
                                  </td>
                                  <td className="py-3.5 px-4 font-mono text-white tabular-nums whitespace-nowrap">
                                    {formatDate(loan.due_date)}
                                  </td>
                                  <td className="py-3.5 px-4 whitespace-nowrap font-medium">
                                    <span
                                      className={
                                        dueInfo.tone === 'overdue'
                                          ? 'text-rose-400'
                                          : dueInfo.tone === 'warning'
                                            ? 'text-amber-300'
                                            : 'text-emerald-400'
                                      }
                                    >
                                      {dueInfo.label} · {loan.renewal_count}/{maxRenewals} renewals
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-5 text-right whitespace-nowrap">
                                    {loan.renewal_requested === 1 ? (
                                      <span className="text-[#38BDF8] font-medium">Pending Approval</span>
                                    ) : loan.status === 'overdue' ? (
                                      <span className="text-[#64748B]">Return at Desk</span>
                                    ) : loan.renewal_count >= maxRenewals ? (
                                      <span className="text-[#64748B]">Max Renewals Reached</span>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={busyAction === `renew-${loan.id}`}
                                        onClick={() => void handleRequestRenewal(loan)}
                                        className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-medium text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                                      >
                                        Request Renewal
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {/* ==================== TAB 4: MY RESERVATIONS & FINES ==================== */}
                {activeTab === 'reservations' && (
                  <div className="space-y-8">
                    <section className="student-glass-card rounded-2xl overflow-hidden">
                      <div className="px-6 py-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <h1 className="text-xl font-semibold text-white">
                            Reservation History &amp; Active Holds
                          </h1>
                          <p className="text-xs text-[#94A3B8] mt-0.5">
                            Collect volumes marked Ready at the main circulation desk before hold expiration.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigateTab('catalog')}
                          className="text-xs font-medium text-[#A78BFA] hover:text-white cursor-pointer"
                        >
                          Reserve Another Volume
                        </button>
                      </div>

                      {reservations.length === 0 ? (
                        <div className="p-10 text-center space-y-3">
                          <BookMarked className="w-8 h-8 text-[#A78BFA]/70 mx-auto" aria-hidden="true" />
                          <p className="text-sm text-[#CBD5E1]">
                            You have no reservations on record. Explore the catalog to reserve a volume.
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/10 bg-[#080B16]/85 text-xs font-medium text-[#A78BFA]">
                                <th className="py-3 px-5">Reserved Book</th>
                                <th className="py-3 px-4">Reservation Date</th>
                                <th className="py-3 px-4">Queue &amp; Availability ETA</th>
                                <th className="py-3 px-4">Current Status</th>
                                <th className="py-3 px-5 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 text-xs">
                              {reservations.map((r) => (
                                <tr key={r.id} className="student-row-hover">
                                  <td className="py-3.5 px-5">
                                    <div className="flex items-center gap-3">
                                      <BookCover
                                        title={r.book_title}
                                        category={r.book_category}
                                        coverUrl={r.book_cover_url}
                                        size="xs"
                                      />
                                      <div>
                                        <div className="text-sm font-semibold text-white">
                                          {r.book_title}
                                        </div>
                                        <div className="font-mono text-[#94A3B8]">{r.book_call_number}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 font-mono text-[#CBD5E1] tabular-nums whitespace-nowrap">
                                    {formatDate(r.reserved_at)}
                                  </td>
                                  <td className="py-3.5 px-4 whitespace-nowrap">
                                    {r.status === 'pending' && r.queue_position ? (
                                      <div>
                                        <div className="font-mono font-semibold text-[#38BDF8] tabular-nums">
                                          Queue #{r.queue_position}
                                        </div>
                                        <div className="text-[11px] text-[#94A3B8]">
                                          {r.estimated_availability || 'Estimated 2–4 business days'}
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-[#94A3B8]">
                                        {r.estimated_availability || (r.status === 'ready' ? 'Ready at desk' : '—')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3.5 px-4 whitespace-nowrap font-medium">
                                    <span
                                      className={
                                        r.status === 'ready'
                                          ? 'text-emerald-400'
                                          : r.status === 'pending'
                                            ? 'text-[#A78BFA]'
                                            : 'text-[#64748B]'
                                      }
                                    >
                                      {r.status === 'ready'
                                        ? `Ready for Pickup (Hold until ${formatDate(r.expires_at)})`
                                        : r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-5 text-right whitespace-nowrap">
                                    {(r.status === 'pending' || r.status === 'ready') && (
                                      <button
                                        type="button"
                                        disabled={busyAction === `cancel-res-${r.id}`}
                                        onClick={() => void handleCancelReservation(r.id)}
                                        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-[#CBD5E1] hover:border-rose-400/60 hover:text-rose-300 transition-colors cursor-pointer"
                                      >
                                        Cancel Hold
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>

                    {/* Fines & Fee Ledger */}
                    <section className="student-glass-card rounded-2xl overflow-hidden">
                      <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between gap-4">
                        <div>
                          <h2 className="text-lg font-semibold text-white">
                            Fines &amp; Fee Ledger
                          </h2>
                          <p className="text-xs text-[#94A3B8] mt-0.5">
                            Outstanding balance:{' '}
                            <span className="font-mono font-semibold text-[#FB7185] tabular-nums">
                              {formatMoney(totalUnpaidCents)}
                            </span>
                          </p>
                        </div>
                      </div>

                      {fines.length === 0 ? (
                        <div className="p-8 text-center text-sm text-[#94A3B8]">
                          You have no fines on record.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/10 bg-[#080B16]/85 text-xs font-medium text-[#A78BFA]">
                                <th className="py-3 px-5">Assessed Date</th>
                                <th className="py-3 px-4">Description</th>
                                <th className="py-3 px-4 text-right">Amount</th>
                                <th className="py-3 px-5 text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 text-xs">
                              {fines.map((fine) => (
                                <tr key={fine.id} className="student-row-hover">
                                  <td className="py-3 px-5 font-mono text-[#CBD5E1] tabular-nums whitespace-nowrap">
                                    {formatDate(fine.created_at)}
                                  </td>
                                  <td className="py-3 px-4 text-white">{fine.reason}</td>
                                  <td className="py-3 px-4 text-right font-mono font-medium text-white tabular-nums">
                                    {formatMoney(fine.amount_cents)}
                                  </td>
                                  <td className="py-3 px-5 text-right whitespace-nowrap font-medium capitalize">
                                    <span
                                      className={
                                        fine.status === 'unpaid'
                                          ? 'text-rose-400'
                                          : fine.status === 'paid'
                                            ? 'text-emerald-400'
                                            : 'text-[#64748B]'
                                      }
                                    >
                                      {fine.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {/* ==================== TAB 5: BORROWING HISTORY ==================== */}
                {activeTab === 'history' && (
                  <section className="student-glass-card rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h1 className="text-xl font-semibold text-white">
                          Complete Borrowing History
                        </h1>
                        <p className="text-xs text-[#94A3B8] mt-0.5">
                          Chronological ledger of volumes borrowed under {currentUser.studentId || currentUser.email}
                        </p>
                      </div>

                      <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-[#080B16]/85">
                        {(['all', 'active', 'returned'] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => setHistoryFilter(status)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                              historyFilter === status
                                ? 'bg-[#8B5CF6]/25 text-white font-semibold'
                                : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filteredHistoryLoans.length === 0 ? (
                      <div className="p-10 text-center text-sm text-[#94A3B8]">
                        No borrowing transactions match the selected filter.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 bg-[#080B16]/85 text-xs font-medium text-[#A78BFA]">
                              <th className="py-3 px-5">Volume</th>
                              <th className="py-3 px-4">Call No.</th>
                              <th className="py-3 px-4">Issue Date</th>
                              <th className="py-3 px-4">Due Date</th>
                              <th className="py-3 px-4">Return Date</th>
                              <th className="py-3 px-5 text-right">Transaction Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10 text-xs">
                            {filteredHistoryLoans.map((loan) => (
                              <tr key={loan.id} className="student-row-hover">
                                <td className="py-3.5 px-5">
                                  <div className="flex items-center gap-3">
                                    <BookCover
                                      title={loan.book_title}
                                      category={loan.book_category}
                                      coverUrl={loan.book_cover_url}
                                      size="xs"
                                    />
                                    <div>
                                      <div className="text-sm font-semibold text-white">
                                        {loan.book_title}
                                      </div>
                                      <div className="text-[#94A3B8]">{loan.book_author}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 font-mono text-[#CBD5E1] whitespace-nowrap">
                                  {loan.book_call_number}
                                </td>
                                <td className="py-3.5 px-4 font-mono text-[#CBD5E1] tabular-nums whitespace-nowrap">
                                  {formatDate(loan.issued_at)}
                                </td>
                                <td className="py-3.5 px-4 font-mono text-[#CBD5E1] tabular-nums whitespace-nowrap">
                                  {formatDate(loan.due_date)}
                                </td>
                                <td className="py-3.5 px-4 font-mono text-[#CBD5E1] tabular-nums whitespace-nowrap">
                                  {formatDate(loan.returned_at)}
                                </td>
                                <td className="py-3.5 px-5 text-right whitespace-nowrap font-medium capitalize">
                                  <span
                                    className={
                                      loan.status === 'overdue'
                                        ? 'text-rose-400'
                                        : loan.status === 'returned'
                                          ? 'text-[#94A3B8]'
                                          : 'text-emerald-400'
                                    }
                                  >
                                    {loan.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {/* ==================== TAB 6: NOTIFICATIONS CENTER ==================== */}
                {activeTab === 'notifications' && (
                  <section className="student-glass-card rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <h1 className="text-xl font-semibold text-white">
                          Notifications Center
                        </h1>
                        <p className="text-xs text-[#94A3B8] mt-0.5">
                          Live return deadlines, overdue reminders, hold updates, renewals, and fine alerts.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-[#080B16]/85">
                          <button
                            type="button"
                            onClick={() => setNotifFilter('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                              notifFilter === 'all'
                                ? 'bg-[#8B5CF6]/25 text-white font-semibold'
                                : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            All ({notifications.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setNotifFilter('unread')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                              notifFilter === 'unread'
                                ? 'bg-[#8B5CF6]/25 text-white font-semibold'
                                : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            Unread ({unreadCount})
                          </button>
                        </div>

                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={markAllNotificationsRead}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#A78BFA]/35 px-3 py-1.5 text-xs font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Mark All Read</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {visibleNotifications.length === 0 ? (
                      <div className="p-12 text-center space-y-2">
                        <Bell className="w-8 h-8 text-[#A78BFA]/65 mx-auto" aria-hidden="true" />
                        <p className="text-sm text-[#CBD5E1]">
                          {notifFilter === 'unread'
                            ? 'You are all caught up — no unread notifications.'
                            : 'No active account alerts right now.'}
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/10">
                        {visibleNotifications.map((item) => {
                          const isUnread = !readNotifIds.includes(item.id);
                          return (
                            <div
                              key={item.id}
                              className={`px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                                isUnread ? 'bg-[#8B5CF6]/10' : 'hover:bg-white/[0.03]'
                              }`}
                            >
                              <div className="flex items-start gap-3.5 min-w-0">
                                <div className="mt-1 shrink-0">
                                  {item.category === 'announcement' ? (
                                    <Megaphone className="w-4 h-4 text-[#A78BFA]" aria-hidden="true" />
                                  ) : item.tone === 'alert' ? (
                                    <AlertCircle className="w-4 h-4 text-rose-400" aria-hidden="true" />
                                  ) : item.tone === 'warning' ? (
                                    <Clock className="w-4 h-4 text-amber-300" aria-hidden="true" />
                                  ) : item.tone === 'gold' ? (
                                    <CheckCircle2 className="w-4 h-4 text-[#A78BFA]" aria-hidden="true" />
                                  ) : (
                                    <Bell className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
                                  )}
                                </div>
                                <div className="space-y-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="font-medium text-white text-sm">
                                      {item.title}
                                    </span>
                                    {isUnread && (
                                      <span className="font-mono text-[11px] font-semibold text-[#A78BFA]">
                                        · Unread
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-[#CBD5E1] leading-relaxed">{item.message}</p>
                                  <p className="font-mono text-[11px] text-[#64748B] tabular-nums">
                                    {formatDate(item.timestamp)}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {isUnread && (
                                  <button
                                    type="button"
                                    onClick={() => markNotificationRead(item.id)}
                                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#CBD5E1] hover:text-white cursor-pointer"
                                  >
                                    Mark Read
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    markNotificationRead(item.id);
                                    navigateTab(item.targetTab);
                                  }}
                                  className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-medium text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer whitespace-nowrap"
                                >
                                  {item.actionLabel}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

                {/* ==================== TAB 7: MY PROFILE ==================== */}
                {activeTab === 'profile' && (
                  <div className="space-y-6">
                    {/* Student Membership Identity Header */}
                    <section className="student-glass-card rounded-2xl p-6 sm:p-7">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          {!avatarFailed ? (
                            <img
                              src="/src/assets/images/avatar_student_member_1795561504055.jpg"
                              alt={currentUser.fullName}
                              referrerPolicy="no-referrer"
                              onError={() => setAvatarFailed(true)}
                              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-[#A78BFA]/55 shrink-0"
                            />
                          ) : (
                            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#6366F1] text-white flex items-center justify-center text-xl font-semibold border-2 border-[#A78BFA]/55 shrink-0">
                              {currentUser.fullName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono text-[#A78BFA] font-medium">
                                {currentUser.studentId || 'MEMBER'}
                              </span>
                              <span className="text-white/25" aria-hidden="true">·</span>
                              <span className="text-emerald-400 capitalize font-medium">
                                {currentUser.status} Account
                              </span>
                              <span className="text-white/25" aria-hidden="true">·</span>
                              <span className="capitalize text-[#38BDF8]">{currentUser.memberType}</span>
                            </div>
                            <h1 className="text-2xl font-semibold text-white">
                              {currentUser.fullName}
                            </h1>
                            <p className="text-xs text-[#CBD5E1]">
                              {currentUser.department} · {currentUser.email}
                            </p>
                          </div>
                        </div>

                        {/* Borrowing & Membership Stats */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 lg:pt-0 border-t lg:border-t-0 border-white/10 text-xs">
                          <div>
                            <div className="text-[#94A3B8]">Member Since</div>
                            <div className="font-mono text-sm text-white mt-0.5 tabular-nums">
                              {formatDate(currentUser.createdAt)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#94A3B8]">Lifetime Loans</div>
                            <div className="font-mono text-sm text-[#A78BFA] mt-0.5 tabular-nums">
                              {overview?.summary.totalBorrowedCount ?? 0} volumes
                            </div>
                          </div>
                          <div>
                            <div className="text-[#94A3B8]">Loan Quota</div>
                            <div className="font-mono text-sm text-white mt-0.5 tabular-nums">
                              {overview?.summary.activeLoansCount ?? 0} / {overview?.summary.maxBooksAllowed ?? 5}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#94A3B8]">Last Sign-In</div>
                            <div className="font-mono text-sm text-white mt-0.5 tabular-nums">
                              {formatDate(currentUser.lastLoginAt)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      {/* Editable Profile Details */}
                      <form
                        onSubmit={handleUpdateProfile}
                        className="lg:col-span-7 student-glass-card rounded-2xl p-6 space-y-4"
                      >
                        <div>
                          <h2 className="text-lg font-semibold text-white">
                            Personal &amp; Academic Details
                          </h2>
                          <p className="text-xs text-[#94A3B8] mt-0.5">
                            Student ID and institutional email are verified by the registrar.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                              Student ID
                            </label>
                            <input
                              type="text"
                              disabled
                              value={currentUser.studentId || '—'}
                              className="w-full rounded-xl px-3.5 py-2.5 text-sm font-mono dark-glass-input opacity-65"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                              Email Address
                            </label>
                            <input
                              type="email"
                              disabled
                              value={currentUser.email}
                              className="w-full rounded-xl px-3.5 py-2.5 text-sm dark-glass-input opacity-65"
                            />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="stu-fullname" className="block text-xs font-medium text-[#CBD5E1] mb-1.5">
                            Full Name
                          </label>
                          <input
                            id="stu-fullname"
                            type="text"
                            required
                            value={profileForm.fullName}
                            onChange={(e) => setProfileForm((f) => ({ ...f, fullName: e.target.value }))}
                            className="w-full rounded-xl px-3.5 py-2.5 text-sm dark-glass-input obsidian-input-focus"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label htmlFor="stu-dept" className="block text-xs font-medium text-[#CBD5E1] mb-1.5">
                              Academic Department
                            </label>
                            <input
                              id="stu-dept"
                              type="text"
                              required
                              value={profileForm.department}
                              onChange={(e) => setProfileForm((f) => ({ ...f, department: e.target.value }))}
                              className="w-full rounded-xl px-3.5 py-2.5 text-sm dark-glass-input obsidian-input-focus"
                            />
                          </div>
                          <div>
                            <label htmlFor="stu-phone" className="block text-xs font-medium text-[#CBD5E1] mb-1.5">
                              Phone Number
                            </label>
                            <input
                              id="stu-phone"
                              type="text"
                              value={profileForm.phone}
                              onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))}
                              placeholder="(555) 234-5678"
                              className="w-full rounded-xl px-3.5 py-2.5 text-sm dark-glass-input obsidian-input-focus"
                            />
                          </div>
                        </div>

                        <div className="pt-2">
                          <button
                            type="submit"
                            disabled={busyAction === 'save-profile'}
                            className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-5 py-2.5 text-sm font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] disabled:opacity-50 transition-all cursor-pointer"
                          >
                            {busyAction === 'save-profile' ? 'Saving Changes...' : 'Save Profile'}
                          </button>
                        </div>
                      </form>

                      {/* Change Password Form */}
                      <form
                        onSubmit={handleChangePassword}
                        className="lg:col-span-5 student-glass-card rounded-2xl p-6 space-y-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h2 className="text-lg font-semibold text-white">
                              Change Password
                            </h2>
                            <p className="text-xs text-[#94A3B8] mt-0.5">
                              Update your portal credentials securely.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowPasswords((v) => !v)}
                            className="text-xs text-[#38BDF8] hover:text-white inline-flex items-center gap-1 cursor-pointer"
                          >
                            {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            <span>{showPasswords ? 'Hide' : 'Show'}</span>
                          </button>
                        </div>

                        <div>
                          <label htmlFor="stu-cur-pw" className="block text-xs font-medium text-[#CBD5E1] mb-1.5">
                            Current Password
                          </label>
                          <input
                            id="stu-cur-pw"
                            type={showPasswords ? 'text' : 'password'}
                            required
                            value={passwordForm.currentPassword}
                            onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
                            className="w-full rounded-xl px-3.5 py-2.5 text-sm dark-glass-input obsidian-input-focus"
                          />
                        </div>

                        <div>
                          <label htmlFor="stu-new-pw" className="block text-xs font-medium text-[#CBD5E1] mb-1.5">
                            New Password
                          </label>
                          <input
                            id="stu-new-pw"
                            type={showPasswords ? 'text' : 'password'}
                            required
                            value={passwordForm.newPassword}
                            onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                            placeholder="Min 8 chars, upper, lower & number"
                            className="w-full rounded-xl px-3.5 py-2.5 text-sm dark-glass-input obsidian-input-focus"
                          />
                        </div>

                        <div>
                          <label htmlFor="stu-conf-pw" className="block text-xs font-medium text-[#CBD5E1] mb-1.5">
                            Confirm New Password
                          </label>
                          <input
                            id="stu-conf-pw"
                            type={showPasswords ? 'text' : 'password'}
                            required
                            value={passwordForm.confirmPassword}
                            onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                            className="w-full rounded-xl px-3.5 py-2.5 text-sm dark-glass-input obsidian-input-focus"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={busyAction === 'change-password'}
                          className="w-full rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2.5 text-sm font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] disabled:opacity-50 transition-colors cursor-pointer"
                        >
                          {busyAction === 'change-password' ? 'Updating...' : 'Update Password'}
                        </button>
                      </form>
                    </div>
                  </div>
                )}

                {/* ==================== TAB 8: SETTINGS ==================== */}
                {activeTab === 'settings' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    <section className="lg:col-span-7 student-glass-card rounded-2xl p-6 space-y-6">
                      <div>
                        <h1 className="text-xl font-semibold text-white">
                          Portal Preferences &amp; Alerts
                        </h1>
                        <p className="text-xs text-[#94A3B8] mt-0.5">
                          Customize your catalog browsing layout, atmospheric visuals, and notification filters.
                        </p>
                      </div>

                      <div className="space-y-4 pt-2 border-t border-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium text-white">Default Catalog Layout</div>
                            <div className="text-xs text-[#94A3B8]">
                              Choose your preferred volume view in Explore Books
                            </div>
                          </div>
                          <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-[#080B16]/85">
                            {(['grid', 'list'] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => {
                                  setPrefs((p) => ({ ...p, defaultCatalogView: mode }));
                                  setCatalogViewMode(mode);
                                  onNotify('info', `Default catalog view set to ${mode}.`);
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                                  prefs.defaultCatalogView === mode
                                    ? 'bg-[#8B5CF6]/25 text-white font-semibold'
                                    : 'text-[#94A3B8] hover:text-white'
                                }`}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium text-white">Volumes Per Page</div>
                            <div className="text-xs text-[#94A3B8]">
                              Number of books shown per page in catalog results
                            </div>
                          </div>
                          <select
                            value={prefs.itemsPerPage}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setPrefs((p) => ({ ...p, itemsPerPage: val }));
                              onNotify('info', `Catalog pagination updated to ${val} volumes per page.`);
                            }}
                            className="rounded-xl px-3.5 py-2 text-xs font-mono dark-glass-input obsidian-input-focus cursor-pointer"
                          >
                            <option value={6}>6 volumes</option>
                            <option value={9}>9 volumes</option>
                            <option value={12}>12 volumes</option>
                          </select>
                        </div>

                        <label className="flex items-center justify-between gap-4 pt-2 border-t border-white/10 cursor-pointer">
                          <div>
                            <div className="text-sm font-medium text-white">
                              Ambient Aura Particles
                            </div>
                            <div className="text-xs text-[#94A3B8]">
                              Display subtle drifting lavender particles in the background
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={prefs.showParticles}
                            onChange={(e) => setPrefs((p) => ({ ...p, showParticles: e.target.checked }))}
                            className="h-4 w-4 accent-[#8B5CF6] rounded"
                          />
                        </label>

                        <label className="flex items-center justify-between gap-4 cursor-pointer">
                          <div>
                            <div className="text-sm font-medium text-white">
                              Due Date &amp; Renewal Notifications
                            </div>
                            <div className="text-xs text-[#94A3B8]">
                              Surface upcoming due dates, overdue reminders, and renewal updates
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={prefs.alertDeadlines}
                            onChange={(e) => setPrefs((p) => ({ ...p, alertDeadlines: e.target.checked }))}
                            className="h-4 w-4 accent-[#8B5CF6] rounded"
                          />
                        </label>

                        <label className="flex items-center justify-between gap-4 cursor-pointer">
                          <div>
                            <div className="text-sm font-medium text-white">
                              Reservation Pickup Alerts
                            </div>
                            <div className="text-xs text-[#94A3B8]">
                              Notify when reserved holdings are prepared for pickup
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={prefs.alertReservations}
                            onChange={(e) => setPrefs((p) => ({ ...p, alertReservations: e.target.checked }))}
                            className="h-4 w-4 accent-[#8B5CF6] rounded"
                          />
                        </label>

                        <label className="flex items-center justify-between gap-4 cursor-pointer">
                          <div>
                            <div className="text-sm font-medium text-white">
                              Fine &amp; Fee Alerts
                            </div>
                            <div className="text-xs text-[#94A3B8]">
                              Include unpaid circulation fine notifications in the Notifications Center
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={prefs.alertFines}
                            onChange={(e) => setPrefs((p) => ({ ...p, alertFines: e.target.checked }))}
                            className="h-4 w-4 accent-[#8B5CF6] rounded"
                          />
                        </label>
                      </div>
                    </section>

                    <section className="lg:col-span-5 student-glass-card rounded-2xl p-6 space-y-5">
                      <div className="flex items-center gap-2.5">
                        <ShieldCheck className="w-5 h-5 text-[#A78BFA]" aria-hidden="true" />
                        <h2 className="text-lg font-semibold text-white">
                          Library Policy &amp; Security
                        </h2>
                      </div>

                      <dl className="space-y-3 text-xs border-t border-white/10 pt-4">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-[#94A3B8]">Borrowing Allowance</dt>
                          <dd className="font-mono text-white tabular-nums">
                            {overview?.summary.maxBooksAllowed ?? 5} concurrent volumes
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-[#94A3B8]">Renewal Limit</dt>
                          <dd className="font-mono text-white tabular-nums">
                            {overview?.summary.maxRenewalsAllowed ?? 2} renewals per loan
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-[#94A3B8]">Verified Role</dt>
                          <dd className="font-mono text-[#38BDF8] uppercase">{currentUser.role}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-[#94A3B8]">Session Protection</dt>
                          <dd className="text-emerald-400 inline-flex items-center gap-1">
                            <Lock className="w-3 h-3" aria-hidden="true" />
                            <span>Backend RBAC Verified</span>
                          </dd>
                        </div>
                      </dl>

                      <div className="pt-2 border-t border-white/10 flex flex-col gap-2.5">
                        <button
                          type="button"
                          onClick={() => navigateTab('profile')}
                          className="w-full rounded-xl border border-[#A78BFA]/35 px-4 py-2.5 text-xs font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/15 transition-colors cursor-pointer"
                        >
                          Manage Profile &amp; Password
                        </button>
                        <button
                          type="button"
                          onClick={onLogout}
                          className="w-full rounded-xl border border-rose-400/30 bg-rose-950/25 px-4 py-2.5 text-xs font-medium text-rose-200 hover:border-rose-400/60 transition-colors cursor-pointer"
                        >
                          Sign Out of Session
                        </button>
                      </div>
                    </section>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* In-App Digital PDF Viewer Modal */}
      {pdfPreview && (
        <div className="fixed inset-0 z-50 bg-[#040610]/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[85vh] rounded-2xl border border-[#A78BFA]/35 bg-[#0A0D1A] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-white truncate">
                  {pdfPreview.title}
                </h2>
                <p className="text-[11px] font-mono text-[#A78BFA]">Authorized Digital Reading Room</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={pdfPreview.blobUrl}
                  download={pdfPreview.filename}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-1.5 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={closePdfPreview}
                  aria-label="Close PDF preview"
                  className="rounded-lg border border-white/15 p-1.5 text-[#94A3B8] hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <iframe
              title={pdfPreview.title}
              src={pdfPreview.blobUrl}
              className="flex-1 w-full bg-[#12162A]"
            />
          </div>
        </div>
      )}

      {/* Floating LIBRA AI Slide-Over Assistant */}
      <FloatingLibraButton
        role="student"
        onNotify={onNotify}
        onReserveBook={(bookId) => {
          const target = books.find((b) => b.id === bookId);
          if (target) void handleReserveBook(target);
        }}
        onOpenBookDetails={(bookId) => {
          const target = books.find((b) => b.id === bookId);
          if (target) {
            setSelectedBook(target);
          }
        }}
        onDataChanged={() => void loadStudentData()}
      />
    </div>
  );
}
