export type UserRole = 'admin' | 'student';
export type MemberType = 'admin' | 'librarian' | 'student' | 'faculty';
export type AccountStatus = 'active' | 'pending' | 'disabled';

export interface User {
  id: number;
  fullName: string;
  email: string;
  studentId: string | null;
  memberType: MemberType;
  role: UserRole;
  department: string;
  phone: string;
  status: AccountStatus;
  maxLoansOverride?: number | null;
  failedAttempts?: number;
  lockedUntil?: number | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface BootstrapStatus {
  needsAdminSetup: boolean;
  hasEnvPasscode: boolean;
  allowSelfRegistration: boolean;
  libraryName: string;
}

export interface Book {
  id: number;
  isbn: string;
  title: string;
  author: string;
  category: string;
  publisher: string;
  published_year: number;
  call_number: string;
  shelf_location: string;
  rack_code?: string;
  low_stock_threshold?: number;
  cover_url?: string;
  total_copies: number;
  available_copies: number;
  description: string;
  created_at: string;
  borrow_count?: number;
  active_reservation_count?: number;
}

export interface BookCopy {
  id: number;
  book_id: number;
  copy_code: string;
  qr_token: string;
  condition_status: 'new' | 'good' | 'fair' | 'damaged' | 'repair';
  availability_status: 'available' | 'issued' | 'reserved' | 'lost' | 'maintenance';
  rack_location: string;
  notes: string;
  created_at: string;
  book_title?: string;
  book_author?: string;
  book_isbn?: string;
  book_call_number?: string;
  book_category?: string;
  active_loan_id?: number | null;
  borrower_name?: string | null;
  borrower_email?: string | null;
}

export interface LoanRecord {
  id: number;
  book_id: number;
  copy_id?: number | null;
  copy_code?: string | null;
  barcode?: string | null;
  user_id: number;
  issued_at: string;
  due_date: string;
  returned_at: string | null;
  renewal_count: number;
  renewal_requested: number;
  status: 'active' | 'returned' | 'overdue';
  notes: string;
  book_title: string;
  book_author?: string;
  book_category?: string;
  book_isbn: string;
  book_call_number: string;
  book_shelf_location?: string;
  book_cover_url?: string;
  borrower_name?: string;
  borrower_email?: string;
  borrower_student_id?: string | null;
  borrower_type?: MemberType;
}

export interface ReservationRecord {
  id: number;
  book_id: number;
  user_id: number;
  status: 'pending' | 'ready' | 'fulfilled' | 'cancelled';
  reserved_at: string;
  expires_at: string | null;
  book_title: string;
  book_author?: string;
  book_category?: string;
  book_call_number: string;
  book_available_copies: number;
  book_cover_url?: string;
  queue_position?: number | null;
  estimated_availability?: string;
  student_name?: string;
  student_email?: string;
  student_code?: string | null;
}

export interface FineRecord {
  id: number;
  user_id: number;
  loan_id: number | null;
  amount_cents: number;
  reason: string;
  status: 'unpaid' | 'paid' | 'waived';
  created_at: string;
  settled_at: string | null;
  student_name?: string;
  student_email?: string;
  student_code?: string | null;
}

export interface PasswordResetRequest {
  id: number;
  userId: number;
  status: 'requested' | 'issued';
  requestedAt: string;
  expiresAt: number | null;
  fullName: string;
  email: string;
  studentId: string | null;
  role: UserRole;
}

export interface LibrarySettings {
  id: number;
  library_name: string;
  loan_duration_days: number;
  max_books_per_student: number;
  max_renewals: number;
  daily_fine_cents: number;
  reservation_hold_days: number;
  allow_self_registration: number;
  max_failed_logins: number;
  lockout_minutes: number;
}

export interface AuditLogEntry {
  id: number;
  actorLabel: string;
  action: string;
  target: string;
  severity: 'info' | 'warning' | 'alert';
  ipAddress: string;
  createdAt: string;
}

export interface DigitalResource {
  id: number;
  title: string;
  author: string;
  category: string;
  description: string;
  resource_type: 'pdf' | 'ebook' | 'guide' | 'journal';
  file_path: string;
  external_url: string;
  access_level: 'all' | 'student' | 'faculty' | 'admin';
  created_at: string;
  has_file?: boolean;
}

export interface Announcement {
  id: number;
  title: string;
  message: string;
  priority: 'normal' | 'important' | 'urgent';
  target_role: 'all' | 'student' | 'faculty' | 'admin';
  created_at: string;
  created_by_name?: string;
}

export interface RecommendationFeedbackItem {
  book_id: number;
  feedback: 'like' | 'dislike';
  note: string;
}

export interface AiPendingAction {
  actionId: string;
  actionType: string;
  summary: string;
  details: Record<string, string | number | boolean>;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expiresAt: number;
}

export interface AiRecommendedBookCard {
  id: number;
  title: string;
  author: string;
  category: string;
  call_number: string;
  available_copies: number;
  total_copies: number;
  cover_url?: string;
  reason?: string;
}

export interface AiMessageMetadata {
  recommendedBooks?: AiRecommendedBookCard[];
  pendingAction?: AiPendingAction;
  tables?: Array<{
    title: string;
    columns: string[];
    rows: Array<Array<string | number>>;
  }>;
  model?: string;
  tokensUsed?: number;
}

export interface AiChatMessage {
  id: number;
  conversationId: string;
  sender: 'user' | 'assistant';
  content: string;
  metadata?: AiMessageMetadata;
  createdAt: string;
}

export interface AiConversation {
  id: string;
  title: string;
  roleScope: 'student' | 'admin';
  createdAt: string;
  updatedAt: string;
}
