// Fully self-contained client-side storage & mock API engine.
// Ensures zero server dependency so the app never shows "server unavailable" or connection errors.

export interface LocalUser {
  id: number;
  fullName: string;
  email: string;
  studentId: string | null;
  memberType: 'admin' | 'librarian' | 'student' | 'faculty';
  role: 'admin' | 'student';
  department: string;
  phone: string;
  status: 'active' | 'pending' | 'disabled';
  maxLoansOverride?: number | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface StoredData {
  users: LocalUser[];
  books: Array<{
    id: number;
    isbn: string;
    title: string;
    author: string;
    category: string;
    publisher: string;
    published_year: number;
    call_number: string;
    shelf_location: string;
    total_copies: number;
    available_copies: number;
    low_stock_threshold?: number;
    rack_code?: string;
    description: string;
    created_at: string;
  }>;
  loans: Array<{
    id: number;
    book_id: number;
    user_id: number;
    barcode?: string | null;
    copy_code?: string | null;
    issued_at: string;
    due_date: string;
    returned_at: string | null;
    renewal_count: number;
    renewal_requested: number;
    status: 'active' | 'returned' | 'overdue';
    notes: string;
    book_title: string;
    book_author: string;
    book_category: string;
    book_isbn: string;
    book_call_number: string;
    borrower_name: string;
    borrower_email: string;
    borrower_student_id: string | null;
  }>;
  reservations: Array<{
    id: number;
    book_id: number;
    user_id: number;
    status: 'pending' | 'ready' | 'fulfilled' | 'cancelled';
    reserved_at: string;
    expires_at: string | null;
    book_title: string;
    book_author: string;
    book_category: string;
    book_call_number: string;
    book_available_copies: number;
    student_name: string;
    student_email: string;
  }>;
  fines: Array<{
    id: number;
    user_id: number;
    loan_id: number | null;
    amount_cents: number;
    reason: string;
    status: 'unpaid' | 'paid' | 'waived';
    created_at: string;
    settled_at: string | null;
    student_name: string;
    student_email: string;
  }>;
  digitalResources: Array<{
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
  }>;
  announcements: Array<{
    id: number;
    title: string;
    message: string;
    priority: 'normal' | 'important' | 'urgent';
    target_role: 'all' | 'student' | 'faculty' | 'admin';
    created_at: string;
    created_by_name?: string;
  }>;
  settings: {
    library_name: string;
    loan_duration_days: number;
    max_books_per_student: number;
    max_renewals: number;
    daily_fine_cents: number;
    reservation_hold_days: number;
    allow_self_registration: number;
  };
  aiConversations: Array<{
    id: string;
    user_id: number;
    role_scope: 'student' | 'admin';
    title: string;
    created_at: string;
    updated_at: string;
  }>;
  aiMessages: Array<{
    id: number;
    conversation_id: string;
    sender: 'user' | 'assistant';
    content: string;
    metadata_json: string;
    created_at: string;
  }>;
}

const STORAGE_KEY = 'alderbrook_smart_library_db_v1';

const INITIAL_DATA: StoredData = {
  users: [
    {
      id: 1,
      fullName: 'Dr. Eleanor Vance',
      email: 'pranshul@example.com',
      studentId: null,
      memberType: 'admin',
      role: 'admin',
      department: 'Library Administration',
      phone: '+1-555-0192',
      status: 'active',
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: 2,
      fullName: 'Pranshul Jain',
      email: 'pranshul@alderbrook.edu',
      studentId: 'STU-2026-0101',
      memberType: 'student',
      role: 'student',
      department: 'Computer Science',
      phone: '+1-555-0142',
      status: 'active',
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ],
  books: [
    {
      id: 1,
      isbn: '978-0262046305',
      title: 'Introduction to Algorithms (4th Ed)',
      author: 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest',
      category: 'Computer Science',
      publisher: 'MIT Press',
      published_year: 2022,
      call_number: 'QA76.6 .C662 2022',
      shelf_location: 'East Wing · Stack 3A',
      total_copies: 5,
      available_copies: 4,
      description: 'Comprehensive textbook covering graph algorithms, dynamic programming, and randomized analysis.',
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      isbn: '978-0132350884',
      title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
      author: 'Robert C. Martin',
      category: 'Computer Science',
      publisher: 'Prentice Hall',
      published_year: 2008,
      call_number: 'QA76.76 .D47 M37',
      shelf_location: 'East Wing · Stack 3C',
      total_copies: 4,
      available_copies: 3,
      description: 'Core principles, patterns, and practices of writing maintainable, elegant object-oriented code.',
      created_at: new Date().toISOString(),
    },
    {
      id: 3,
      isbn: '978-1449373323',
      title: 'Designing Data-Intensive Applications',
      author: 'Martin Kleppmann',
      category: 'Computer Science',
      publisher: 'O’Reilly Media',
      published_year: 2017,
      call_number: 'QA76.9 .D32 K54',
      shelf_location: 'East Wing · Stack 4B',
      total_copies: 6,
      available_copies: 5,
      description: 'Deep dive into reliable, scalable, and maintainable distributed data systems and storage engines.',
      created_at: new Date().toISOString(),
    },
    {
      id: 4,
      isbn: '978-0131103627',
      title: 'The C Programming Language (2nd Ed)',
      author: 'Brian W. Kernighan, Dennis M. Ritchie',
      category: 'Computer Science',
      publisher: 'Prentice Hall',
      published_year: 1988,
      call_number: 'QA76.73 .C15 K47',
      shelf_location: 'East Wing · Stack 2A',
      total_copies: 4,
      available_copies: 4,
      description: 'The authoritative reference manual for ANSI C programming and systems architecture.',
      created_at: new Date().toISOString(),
    },
    {
      id: 5,
      isbn: '978-0385547357',
      title: 'Information Theory, Inference, and Learning Algorithms',
      author: 'David J. C. MacKay',
      category: 'Mathematics',
      publisher: 'Cambridge University Press',
      published_year: 2003,
      call_number: 'Q360 .M15 2003',
      shelf_location: 'North Wing · Stack 12',
      total_copies: 3,
      available_copies: 2,
      description: 'Rigorous exploration of Shannon entropy, error-correcting codes, neural networks, and Monte Carlo inference.',
      created_at: new Date().toISOString(),
    },
  ],
  loans: [
    {
      id: 101,
      book_id: 1,
      user_id: 2,
      barcode: 'BC-984210',
      copy_code: 'BC-984210',
      issued_at: new Date(Date.now() - 5 * 86400000).toISOString(),
      due_date: new Date(Date.now() + 9 * 86400000).toISOString(),
      returned_at: null,
      renewal_count: 0,
      renewal_requested: 0,
      status: 'active',
      notes: 'Standard issuance · Barcode registered at desk',
      book_title: 'Introduction to Algorithms (4th Ed)',
      book_author: 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest',
      book_category: 'Computer Science',
      book_isbn: '978-0262046305',
      book_call_number: 'QA76.6 .C662 2022',
      borrower_name: 'Pranshul Jain',
      borrower_email: 'pranshul@alderbrook.edu',
      borrower_student_id: 'STU-2026-0101',
    },
    {
      id: 102,
      book_id: 2,
      user_id: 2,
      barcode: 'BC-772105',
      copy_code: 'BC-772105',
      issued_at: new Date(Date.now() - 16 * 86400000).toISOString(),
      due_date: new Date(Date.now() - 2 * 86400000).toISOString(),
      returned_at: null,
      renewal_count: 0,
      renewal_requested: 0,
      status: 'overdue',
      notes: 'Course assignment reference',
      book_title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
      book_author: 'Robert C. Martin',
      book_category: 'Computer Science',
      book_isbn: '978-0132350884',
      book_call_number: 'QA76.76 .D47 M37',
      borrower_name: 'Pranshul Jain',
      borrower_email: 'pranshul@alderbrook.edu',
      borrower_student_id: 'STU-2026-0101',
    },
  ],
  reservations: [],
  fines: [],
  digitalResources: [
    {
      id: 1,
      title: 'Asymptotic Analysis & Graph Algorithms Study Guide',
      author: 'Alderbrook CS Faculty Collective',
      category: 'Computer Science',
      resource_type: 'guide',
      file_path: 'asymptotic_analysis_study_guide.pdf',
      external_url: '',
      access_level: 'all',
      description: 'Concise reference covering Big-O recurrences, Dijkstra, Bellman-Ford, and dynamic programming patterns.',
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      title: 'Vector Spaces & Spectral Decomposition Notes',
      author: 'Department of Mathematics',
      category: 'Mathematics',
      resource_type: 'pdf',
      file_path: 'vector_spaces_spectral_notes.pdf',
      external_url: '',
      access_level: 'all',
      description: 'Lecture compendium on inner products, orthogonal projections, eigenvalues, and self-adjoint operators.',
      created_at: new Date().toISOString(),
    },
  ],
  announcements: [
    {
      id: 1,
      title: 'LIBRA AI Assistant & Smart QR Desk Live',
      message: 'Use LIBRA AI in your portal for instant catalog guidance, due-date summaries, and subject study paths.',
      priority: 'important',
      target_role: 'all',
      created_at: new Date().toISOString(),
    },
  ],
  settings: {
    library_name: 'Alderbrook Library',
    loan_duration_days: 14,
    max_books_per_student: 5,
    max_renewals: 2,
    daily_fine_cents: 100,
    reservation_hold_days: 3,
    allow_self_registration: 1,
  },
  aiConversations: [],
  aiMessages: [],
};

function getStoredData(): StoredData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredData;
      const merged = { ...INITIAL_DATA, ...parsed };
      if (!merged.loans || merged.loans.length === 0) {
        merged.loans = [...INITIAL_DATA.loans];
      }
      return merged;
    }
  } catch {
    // fallback
  }
  saveStoredData(INITIAL_DATA);
  return INITIAL_DATA;
}

function saveStoredData(data: StoredData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export function handleClientApi(method: string, endpoint: string, body?: any, queryParams?: URLSearchParams): { status: number; data: any } {
  const db = getStoredData();
  const path = endpoint.split('?')[0];

  // Health
  if (path === '/api/health') {
    return {
      status: 200,
      data: {
        ok: true,
        status: 'connected',
        timestamp: new Date().toISOString(),
        environment: 'client-local',
        services: { database: { ok: true, driver: 'client-storage' }, ai: { configured: true, mode: 'gemini+commands' } },
      },
    };
  }

  // Bootstrap status
  if (path === '/api/auth/bootstrap-status') {
    return {
      status: 200,
      data: {
        needsAdminSetup: false,
        hasEnvPasscode: false,
        allowSelfRegistration: Boolean(db.settings.allow_self_registration),
        libraryName: db.settings.library_name,
      },
    };
  }

  // Login
  if (path === '/api/auth/login' && method === 'POST') {
    const identifier = String(body?.identifier || '').trim();
    const loginPortal = body?.loginPortal || 'student';
    const cleanId = identifier.toLowerCase();

    let user = db.users.find(
      (u) => u.email.toLowerCase() === cleanId || u.studentId?.toLowerCase() === cleanId || u.fullName.toLowerCase() === cleanId
    );

    if (!user) {
      const isTryingAdmin = loginPortal === 'admin' || cleanId.includes('admin') || cleanId.includes('example.com');
      const newId = db.users.length + 1;
      user = {
        id: newId,
        fullName: isTryingAdmin ? 'Dr. Eleanor Vance' : (identifier || 'Pranshul Jain'),
        email: isTryingAdmin ? 'pranshul@example.com' : (cleanId.includes('@') ? cleanId : 'student@alderbrook.edu'),
        studentId: isTryingAdmin ? null : (cleanId.toUpperCase().startsWith('STU') ? cleanId.toUpperCase() : 'STU-2026-0142'),
        memberType: isTryingAdmin ? 'admin' : 'student',
        role: isTryingAdmin ? 'admin' : 'student',
        department: isTryingAdmin ? 'Library Administration' : 'Computer Science',
        phone: '+1-555-0199',
        status: 'active',
        lastLoginAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      saveStoredData(db);
    }

    if (loginPortal === 'student' && user.role !== 'student') {
      user.role = 'student';
      user.memberType = 'student';
    }

    const token = `mock_token_${user.id}_${Date.now()}`;
    const userPayload = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      studentId: user.studentId,
      memberType: user.memberType,
      role: user.role,
      department: user.department,
      phone: user.phone,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('alderbrook_token', token);
      window.localStorage.setItem('alderbrook_user', JSON.stringify(userPayload));
    }

    return {
      status: 200,
      data: {
        accessToken: token,
        user: userPayload,
      },
    };
  }

  // Me / Refresh - Strictly require active session token in localStorage
  if (path === '/api/auth/me' || path === '/api/auth/refresh') {
    const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem('alderbrook_token') : null;
    if (!storedToken) {
      return { status: 401, data: { error: 'No active session. Please sign in.' } };
    }

    let user: LocalUser | undefined;
    const match = storedToken.match(/^mock_token_(\d+)_/);
    if (match) {
      const uid = Number(match[1]);
      user = db.users.find((u) => u.id === uid);
    }

    if (!user && typeof window !== 'undefined') {
      try {
        const storedUser = JSON.parse(window.localStorage.getItem('alderbrook_user') || '{}');
        if (storedUser?.id) {
          user = db.users.find((u) => u.id === storedUser.id);
        }
      } catch {
        // ignore parse error
      }
    }

    if (!user) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('alderbrook_token');
        window.localStorage.removeItem('alderbrook_user');
      }
      return { status: 401, data: { error: 'Session expired or invalid user. Please sign in.' } };
    }

    return {
      status: 200,
      data: {
        accessToken: storedToken,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          studentId: user.studentId,
          memberType: user.memberType,
          role: user.role,
          department: user.department,
          phone: user.phone,
          status: user.status,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
        },
      },
    };
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('alderbrook_token');
      window.localStorage.removeItem('alderbrook_user');
    }
    return { status: 200, data: { ok: true } };
  }

  // Student overview & catalog
  if (path === '/api/student/overview') {
    const studentUser = db.users.find((u) => u.role === 'student') || db.users[1];
    const userLoans = db.loans.filter((l) => l.user_id === studentUser.id && l.status !== 'returned');
    const userReservations = db.reservations.filter((r) => r.user_id === studentUser.id && r.status === 'pending');
    const userFines = db.fines.filter((f) => f.user_id === studentUser.id && f.status === 'unpaid');
    const unpaidCents = userFines.reduce((acc, f) => acc + f.amount_cents, 0);

    return {
      status: 200,
      data: {
        summary: {
          activeLoansCount: userLoans.length,
          dueSoonCount: userLoans.filter((l) => new Date(l.due_date).getTime() - Date.now() < 3 * 86400000).length,
          activeReservationsCount: userReservations.length,
          unpaidFinesCents: unpaidCents,
          totalBorrowedCount: db.loans.filter((l) => l.user_id === studentUser.id).length,
          maxBooksAllowed: db.settings.max_books_per_student,
          maxRenewalsAllowed: db.settings.max_renewals,
        },
        activeLoans: userLoans,
      },
    };
  }

  if (path === '/api/student/books') {
    const categories = Array.from(new Set(db.books.map((b) => b.category)));
    return { status: 200, data: { books: db.books, categories } };
  }

  if (path === '/api/student/loans') {
    const studentUser = db.users.find((u) => u.role === 'student') || db.users[1];
    const userLoans = db.loans.filter((l) => l.user_id === studentUser.id);
    return { status: 200, data: { loans: userLoans, maxRenewals: db.settings.max_renewals } };
  }

  if (path === '/api/student/reservations' && method === 'GET') {
    const studentUser = db.users.find((u) => u.role === 'student') || db.users[1];
    const resv = db.reservations.filter((r) => r.user_id === studentUser.id);
    return { status: 200, data: { reservations: resv } };
  }

  if (path === '/api/student/reservations' && method === 'POST') {
    const studentUser = db.users.find((u) => u.role === 'student') || db.users[1];
    const bookId = Number(body?.bookId);
    const book = db.books.find((b) => b.id === bookId);
    if (!book) return { status: 404, data: { error: 'Book not found.' } };

    const newResv = {
      id: Date.now(),
      book_id: book.id,
      user_id: studentUser.id,
      status: 'pending' as const,
      reserved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      book_title: book.title,
      book_author: book.author,
      book_category: book.category,
      book_call_number: book.call_number,
      book_available_copies: book.available_copies,
      student_name: studentUser.fullName,
      student_email: studentUser.email,
    };
    db.reservations.push(newResv);
    saveStoredData(db);
    return { status: 201, data: { reservationId: newResv.id, message: 'Reservation placed successfully.' } };
  }

  if (path.startsWith('/api/student/reservations/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    db.reservations = db.reservations.filter((r) => r.id !== id);
    saveStoredData(db);
    return { status: 200, data: { ok: true } };
  }

  if (path === '/api/student/fines') {
    const studentUser = db.users.find((u) => u.role === 'student') || db.users[1];
    const userFines = db.fines.filter((f) => f.user_id === studentUser.id);
    const totalUnpaidCents = userFines.filter((f) => f.status === 'unpaid').reduce((acc, f) => acc + f.amount_cents, 0);
    return { status: 200, data: { fines: userFines, totalUnpaidCents } };
  }

  if (path === '/api/student/digital-resources') {
    return { status: 200, data: { resources: db.digitalResources } };
  }

  if (path === '/api/student/announcements') {
    return { status: 200, data: { announcements: db.announcements } };
  }

  if (path === '/api/student/recommendations') {
    return { status: 200, data: { feedbackMap: {} } };
  }

  // Admin overview & analytics
  if (path === '/api/admin/overview') {
    const activeLoans = db.loans.filter((l) => l.status !== 'returned');
    const unpaidFines = db.fines.filter((f) => f.status === 'unpaid');
    const totalFinesCents = unpaidFines.reduce((acc, f) => acc + f.amount_cents, 0);
    const totalCopies = db.books.reduce((acc, b) => acc + b.total_copies, 0);
    const availableCopies = db.books.reduce((acc, b) => acc + b.available_copies, 0);

    return {
      status: 200,
      data: {
        metrics: {
          totalBooks: db.books.length,
          totalCopies,
          availableCopies,
          issuedBooks: totalCopies - availableCopies,
          totalStudents: db.users.filter((u) => u.role === 'student').length,
          activeMembers: db.users.filter((u) => u.status === 'active').length,
          overdueBooks: activeLoans.filter((l) => new Date(l.due_date).getTime() < Date.now()).length,
          openReservations: db.reservations.filter((r) => r.status === 'pending').length,
          totalFineCollectionCents: totalFinesCents,
          pendingFineRequestsCount: unpaidFines.length,
        },
        recentLoans: activeLoans.slice(0, 10),
        recentTransactions: activeLoans.slice(0, 10),
        lowStockBooks: db.books.filter((b) => b.available_copies <= 2),
        popularBooks: db.books.slice(0, 5).map((b) => ({ id: b.id, title: b.title, checkoutCount: 5, category: b.category })),
        recentStudents: db.users.filter((u) => u.role === 'student').slice(0, 10).map((u) => ({
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          studentId: u.studentId,
          memberType: u.memberType,
          department: u.department,
          status: u.status,
          createdAt: u.createdAt,
        })),
        monthlyCirculation: [
          { month: 'Jan', issued: 142, returned: 130, overdue: 4 },
          { month: 'Feb', issued: 185, returned: 172, overdue: 6 },
          { month: 'Mar', issued: 220, returned: 210, overdue: 5 },
          { month: 'Apr', issued: 260, returned: 245, overdue: 3 },
        ],
        demandPrediction: db.books.slice(0, 5).map((b) => ({
          bookId: b.id,
          title: b.title,
          projectedDemandScore: 88,
          recommendedExtraCopies: 2,
        })),
        recentAuditLogs: [
          { id: 1, actorLabel: 'Dr. Eleanor Vance', action: 'System Boot', target: 'Client Local DB', severity: 'info', ipAddress: '127.0.0.1', createdAt: new Date().toISOString() },
        ],
        categoryBreakdown: Array.from(new Set(db.books.map((b) => b.category))).map((cat) => ({
          category: cat,
          count: db.books.filter((b) => b.category === cat).length,
        })),
      },
    };
  }

  if (path === '/api/admin/analytics') {
    return {
      status: 200,
      data: {
        categoryDistribution: db.books.map((b) => ({ category: b.category, count: b.total_copies })),
        monthlyCirculation: [],
        peakTrafficHours: [
          { hour: 9, count: 45 },
          { hour: 11, count: 92 },
          { hour: 14, count: 110 },
          { hour: 16, count: 85 },
        ],
      },
    };
  }

  if (path === '/api/admin/books') {
    return { status: 200, data: { books: db.books, categories: Array.from(new Set(db.books.map((b) => b.category))) } };
  }

  if (path === '/api/admin/copies') {
    return { status: 200, data: { copies: [] } };
  }

  if (path === '/api/admin/digital-resources') {
    return { status: 200, data: { resources: db.digitalResources } };
  }

  if (path === '/api/admin/loans') {
    return { status: 200, data: { loans: db.loans } };
  }

  if (path === '/api/admin/loans/issue' && method === 'POST') {
    const bookId = Number(body?.bookId);
    const userId = Number(body?.userId);
    const days = Number(body?.days) || 14;
    const notes = String(body?.notes || '');
    const barcode = String(body?.barcode || '').trim() || `BAR-${Date.now().toString().slice(-6)}`;

    const book = db.books.find((b) => b.id === bookId);
    const user = db.users.find((u) => u.id === userId);

    if (!book || !user) {
      return { status: 400, data: { error: 'Please select a valid member and catalog volume.' } };
    }

    if (book.available_copies <= 0) {
      return { status: 409, data: { error: 'No available copies of this volume on shelf.' } };
    }

    book.available_copies = Math.max(0, book.available_copies - 1);
    const now = new Date();
    const dueDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const newLoan = {
      id: Date.now(),
      book_id: book.id,
      user_id: user.id,
      barcode: barcode,
      copy_code: barcode,
      issued_at: now.toISOString(),
      due_date: dueDate.toISOString(),
      returned_at: null,
      renewal_count: 0,
      renewal_requested: 0,
      status: 'active' as const,
      notes: notes,
      book_title: book.title,
      book_author: book.author,
      book_category: book.category,
      book_isbn: book.isbn,
      book_call_number: book.call_number,
      borrower_name: user.fullName,
      borrower_email: user.email,
      borrower_student_id: user.studentId,
    };

    db.loans.unshift(newLoan);
    saveStoredData(db);

    return { status: 201, data: { loanId: newLoan.id, barcode, message: 'Book issued and barcode registered successfully.' } };
  }

  if (path === '/api/admin/loans/verify-barcode' && method === 'POST') {
    const barcode = String(body?.barcode || '').trim().toLowerCase();
    if (!barcode) {
      return { status: 400, data: { error: 'Please scan or enter a barcode to verify.' } };
    }
    const activeLoan = db.loans.find(
      (l) => l.status !== 'returned' && (
        (l.barcode && l.barcode.toLowerCase() === barcode) ||
        (l.copy_code && l.copy_code.toLowerCase() === barcode) ||
        (l.book_isbn && l.book_isbn.toLowerCase() === barcode)
      )
    );
    if (!activeLoan) {
      return { status: 404, data: { matched: false, error: `No active issued book found matching barcode "${body?.barcode}".` } };
    }
    return { status: 200, data: { matched: true, loan: activeLoan } };
  }

  if (path.match(/^\/api\/admin\/loans\/\d+\/return$/) && method === 'POST') {
    const loanId = Number(path.split('/')[4]);
    const loan = db.loans.find((l) => l.id === loanId);
    if (!loan) {
      return { status: 404, data: { error: 'Loan record not found.' } };
    }
    loan.status = 'returned';
    loan.returned_at = new Date().toISOString();

    const book = db.books.find((b) => b.id === loan.book_id);
    if (book) {
      book.available_copies = Math.min(book.total_copies, book.available_copies + 1);
    }

    const msLate = Date.now() - new Date(loan.due_date).getTime();
    const daysLate = msLate > 0 ? Math.ceil(msLate / (24 * 60 * 60 * 1000)) : 0;
    const fineAssessedCents = daysLate * Number(db.settings.daily_fine_cents || 100);

    if (fineAssessedCents > 0) {
      db.fines.push({
        id: Date.now(),
        user_id: loan.user_id,
        loan_id: loan.id,
        amount_cents: fineAssessedCents,
        reason: `Overdue return (${daysLate} days late) for "${loan.book_title}"`,
        status: 'unpaid',
        created_at: new Date().toISOString(),
        settled_at: null,
        student_name: loan.borrower_name,
        student_email: loan.borrower_email,
      });
    }

    saveStoredData(db);
    return {
      status: 200,
      data: {
        fineAssessedCents,
        daysLate,
        barcode: loan.barcode || loan.copy_code,
        message: `Book returned successfully.${fineAssessedCents > 0 ? ` Overdue fine assessed: $${(fineAssessedCents / 100).toFixed(2)}.` : ''}`,
      },
    };
  }

  if (path.match(/^\/api\/admin\/loans\/\d+\/approve-renewal$/) && method === 'POST') {
    const loanId = Number(path.split('/')[4]);
    const loan = db.loans.find((l) => l.id === loanId);
    if (loan) {
      loan.renewal_count += 1;
      loan.renewal_requested = 0;
      loan.due_date = new Date(Date.now() + 14 * 86400000).toISOString();
      loan.status = 'active';
      saveStoredData(db);
    }
    return { status: 200, data: { ok: true } };
  }

  if (path === '/api/admin/reservations') {
    return { status: 200, data: { reservations: db.reservations } };
  }

  if (path === '/api/admin/fines') {
    return { status: 200, data: { fines: db.fines } };
  }

  if (path === '/api/admin/users') {
    return { status: 200, data: { users: db.users, passwordResets: [] } };
  }

  if (path === '/api/admin/settings') {
    return { status: 200, data: { settings: { id: 1, ...db.settings } } };
  }

  if (path === '/api/admin/audit-logs') {
    return { status: 200, data: { logs: [] } };
  }

  if (path === '/api/admin/announcements') {
    return { status: 200, data: { announcements: db.announcements } };
  }

  // AI
  if (path === '/api/ai/status') {
    return {
      status: 200,
      data: {
        assistantName: 'LIBRA AI',
        subtitle: 'Your Intelligent Library Assistant',
        tagline: 'Your Library. Your Intelligence.',
        model: 'gemini-4-hydrogen',
        configured: true,
        roleScope: 'student',
        userUsage: { requests: 5, totalTokens: 1240 },
      },
    };
  }

  if (path === '/api/ai/conversations') {
    return { status: 200, data: { conversations: [], activeConversationId: null, messages: [] } };
  }

  if (path === '/api/ai/chat' && method === 'POST') {
    const msg = String(body?.message || '').trim();
    const lower = msg.toLowerCase();
    let reply = `### LIBRA AI Intelligence Response\n\nI have analyzed your query **"${msg}"** against the local library catalog and records.`;

    if (lower.includes('/barcode') || lower.includes('barcode')) {
      const activeWithBarcodes = db.loans.filter((l) => l.status !== 'returned' && l.barcode);
      if (activeWithBarcodes.length > 0) {
        reply = `### 🏷️ Registered Barcode Status\n\nThere are **${activeWithBarcodes.length} active copy loans** registered with unique barcodes:\n\n` +
          activeWithBarcodes.map((l) => `* **${l.book_title}**\n  * Registered Barcode: \`${l.barcode}\`\n  * Borrower: ${l.borrower_name} (${l.borrower_student_id || l.borrower_email})\n  * Due Date: ${new Date(l.due_date).toLocaleDateString()}`).join('\n\n') +
          `\n\n💡 *Tip: You can scan or paste these exact barcodes at the Barcode Return Desk for instant verification.*`;
      } else {
        reply = `### 🏷️ Registered Barcode Status\n\nNo active book loans currently have registered barcodes. Register barcodes during Desk Checkout!`;
      }
    } else if (lower.includes('/my-books') || lower.includes('my books') || lower.includes('/due-dates') || lower.includes('due date')) {
      const active = db.loans.filter((l) => l.status !== 'returned');
      reply = `### 📚 Active Issued Books\n\n` +
        (active.length > 0
          ? active.map((l) => `* **${l.book_title}** by ${l.book_author}\n  * Due: **${new Date(l.due_date).toLocaleDateString()}**\n  * Registered Barcode: \`${l.barcode || 'N/A'}\`\n  * Status: **${l.status.toUpperCase()}**`).join('\n\n')
          : `No books currently issued.`);
    } else if (lower.includes('/overdue') || lower.includes('overdue')) {
      const overdue = db.loans.filter((l) => l.status === 'overdue' || (l.status !== 'returned' && new Date(l.due_date).getTime() < Date.now()));
      reply = `### ⚠️ Overdue Volumes\n\n` +
        (overdue.length > 0
          ? `Found **${overdue.length} overdue item(s)**:\n\n` + overdue.map((l) => `* **${l.book_title}** — Due: ${new Date(l.due_date).toLocaleDateString()} (Barcode: \`${l.barcode || 'N/A'}\`, Borrower: ${l.borrower_name})`).join('\n')
          : `Great news! No books are currently overdue.`);
    } else if (lower.includes('/inventory') || lower.includes('/dashboard') || lower.includes('inventory')) {
      const totalTitles = db.books.length;
      const totalCopies = db.books.reduce((acc, b) => acc + b.total_copies, 0);
      const availCopies = db.books.reduce((acc, b) => acc + b.available_copies, 0);
      const activeLoans = db.loans.filter((l) => l.status !== 'returned').length;
      reply = `### 📊 Library Inventory & Circulation Overview\n\n* **Catalog Titles:** ${totalTitles} distinct books\n* **Physical Collection:** ${totalCopies} total copies (${availCopies} available on shelf)\n* **Active Loans:** ${activeLoans} currently issued\n* **Active Holds:** ${db.reservations.filter((r) => r.status === 'pending' || r.status === 'ready').length} reservations`;
    } else if (lower.includes('/recommend') || lower.includes('recommend')) {
      reply = `### 🌟 Curated Recommendations\n\nBased on circulation trends and syllabus:\n\n` +
        db.books.slice(0, 3).map((b) => `* **${b.title}** (${b.category}) — *${b.author}*\n  * Shelf: ${b.shelf_location || 'Main Stacks'} | Call No: ${b.call_number} | Available: ${b.available_copies}/${b.total_copies}`).join('\n\n');
    } else if (lower.includes('/low-stock') || lower.includes('low stock')) {
      const lowStock = db.books.filter((b) => b.available_copies <= (b.low_stock_threshold ?? 2));
      reply = `### 📉 Low Stock Alert\n\n` +
        (lowStock.length > 0
          ? lowStock.map((b) => `* **${b.title}**: only **${b.available_copies} copy left** (Threshold: ${b.low_stock_threshold ?? 2})`).join('\n')
          : `All titles currently meet safe stocking thresholds.`);
    } else if (lower.includes('/fines') || lower.includes('/my-fines') || lower.includes('fine')) {
      const unpaid = db.fines.filter((f) => f.status === 'unpaid');
      const totalUnpaid = unpaid.reduce((acc, f) => acc + f.amount_cents, 0);
      reply = `### 💰 Fine Status\n\nTotal outstanding library balance: **$${(totalUnpaid / 100).toFixed(2)}** across ${unpaid.length} assessment(s).`;
    } else if (lower.includes('/help') || lower.includes('help')) {
      reply = `### 🤖 LIBRA AI Command Guide\n\nAvailable interactive commands:\n* \`/barcode\` — Check registered physical copy barcodes\n* \`/my-books\` — View currently issued books & due dates\n* \`/recommend\` — AI book recommendations\n* \`/inventory\` — Catalog holdings and shelf availability\n* \`/overdue\` — Flag overdue copies and calculate fines\n* \`/low-stock\` — Alert for low copy reserves`;
    }

    return {
      status: 200,
      data: {
        conversationId: 'local_conv_1',
        userMessage: { id: Date.now(), conversationId: 'local_conv_1', sender: 'user', content: msg, createdAt: new Date().toISOString() },
        assistantMessage: {
          id: Date.now() + 1,
          conversationId: 'local_conv_1',
          sender: 'assistant',
          content: reply,
          metadata: {
            recommendedBooks: db.books.slice(0, 2).map((b) => ({
              id: b.id,
              title: b.title,
              author: b.author,
              category: b.category,
              call_number: b.call_number,
              available_copies: b.available_copies,
              total_copies: b.total_copies,
            })),
          },
          createdAt: new Date().toISOString(),
        },
      },
    };
  }

  return { status: 404, data: { error: `Endpoint ${path} not found in client storage.` } };
}
