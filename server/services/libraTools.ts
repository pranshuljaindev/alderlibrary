import crypto from 'node:crypto';
import { Type, type FunctionDeclaration } from '@google/genai';
import { db, getSettings } from '../db.ts';
import type { AuthUserRecord } from '../security.ts';
import type { AiMessageMetadata, AiPendingAction, AiRecommendedBookCard } from '../../src/types.ts';

export interface ToolExecutionContext {
  user: AuthUserRecord;
  collectedBooks: AiRecommendedBookCard[];
  collectedTables: NonNullable<AiMessageMetadata['tables']>;
  pendingAction?: AiPendingAction;
}

export const STUDENT_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'searchCatalog',
    description:
      'Search the real library book catalog by title, author, subject category, ISBN, or call number. Returns real inventory availability.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Keywords for title, author, ISBN, or topic.' },
        category: { type: Type.STRING, description: 'Optional category filter.' },
        availableOnly: { type: Type.BOOLEAN, description: 'Set true to show only currently available titles.' },
      },
    },
  },
  {
    name: 'getMyLoansAndDeadlines',
    description: 'Fetch the signed-in student/faculty member active, overdue, and past loans with exact due dates and renewal eligibility.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'getMyReservations',
    description: 'Fetch the signed-in member reservations, queue position, and pickup readiness.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'getMyFines',
    description: 'Fetch the signed-in member unpaid, paid, and waived library fines.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'getPersonalizedRecommendations',
    description:
      'Generate catalog book recommendations grounded in the member borrowing history, liked/disliked feedback, and optional topic.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING, description: 'Optional subject or learning goal.' },
      },
    },
  },
  {
    name: 'searchDigitalResources',
    description: 'Search authorized PDF study guides, journals, and e-books in the Digital Library.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Keywords or subject area.' },
      },
    },
  },
];

export const ADMIN_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'getLibraryOverviewStats',
    description:
      'Get real-time library KPIs: books, physical copies, active/overdue loans, reservations, member counts, fines collected/unpaid, and low-stock counts.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'getOverdueAndDelinquentLoans',
    description: 'List currently overdue loans, pending renewal requests, and members with unpaid fines.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'getInventoryIntelligence',
    description:
      'Analyze inventory health: low-stock books, zero-availability titles, rarely borrowed titles, damaged/maintenance physical copies, and historical vs projected demand.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'searchMembers',
    description: 'Search library students, faculty, and staff accounts by name, email, ID, or status.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Name, email, student ID, or department.' },
        memberType: { type: Type.STRING, description: 'Optional filter: student, faculty, librarian, admin.' },
        status: { type: Type.STRING, description: 'Optional filter: active, pending, disabled.' },
      },
    },
  },
  {
    name: 'generateOperationalReport',
    description:
      'Generate a structured data report table from the real database for circulation, fines, popular_books, overdue, or inventory.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reportType: {
          type: Type.STRING,
          description: 'One of: circulation, fines, popular_books, overdue, inventory',
        },
      },
      required: ['reportType'],
    },
  },
  {
    name: 'proposeAdminAction',
    description:
      'Propose an administrative database mutation for explicit Admin confirmation. Never alters data immediately; creates a confirmation card for the admin to approve.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        actionType: {
          type: Type.STRING,
          description: 'One of: waive_fine, mark_reservation_ready, approve_renewal, update_book_stock, create_announcement',
        },
        targetId: {
          type: Type.INTEGER,
          description: 'ID of fine, reservation, loan, or book (required except for create_announcement).',
        },
        newTotalCopies: {
          type: Type.INTEGER,
          description: 'Required when actionType is update_book_stock.',
        },
        title: {
          type: Type.STRING,
          description: 'Announcement title when actionType is create_announcement.',
        },
        message: {
          type: Type.STRING,
          description: 'Announcement message when actionType is create_announcement.',
        },
        priority: {
          type: Type.STRING,
          description: 'Optional priority for announcement: normal, important, or urgent.',
        },
        note: {
          type: Type.STRING,
          description: 'Short human-readable rationale for the proposed action.',
        },
      },
      required: ['actionType', 'note'],
    },
  },
];

function pushRecommendedBooks(
  ctx: ToolExecutionContext,
  rows: Array<{
    id: number;
    title: string;
    author: string;
    category: string;
    call_number: string;
    available_copies: number;
    total_copies: number;
    cover_url?: string;
    reason?: string;
  }>
) {
  for (const b of rows) {
    const id = Number(b.id);
    if (!ctx.collectedBooks.some((existing) => existing.id === id) && ctx.collectedBooks.length < 6) {
      ctx.collectedBooks.push({
        id,
        title: b.title,
        author: b.author,
        category: b.category,
        call_number: b.call_number,
        available_copies: Number(b.available_copies),
        total_copies: Number(b.total_copies),
        cover_url: b.cover_url || '',
        reason: b.reason,
      });
    }
  }
}

export async function executeLibraTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<Record<string, unknown>> {
  const user = ctx.user;

  const studentTools = new Set(STUDENT_TOOL_DECLARATIONS.map((t) => t.name));
  const adminTools = new Set(ADMIN_TOOL_DECLARATIONS.map((t) => t.name));

  if (user.role !== 'admin' && adminTools.has(name)) {
    return { error: 'Access denied: administrative tools are restricted to authorized library administrators.' };
  }
  if (user.role === 'student' && !studentTools.has(name)) {
    return { error: `Unknown or unauthorized tool: ${name}` };
  }

  // --- STUDENT TOOLS ---
  if (name === 'searchCatalog') {
    const q = typeof args.query === 'string' ? args.query.trim() : '';
    const category = typeof args.category === 'string' ? args.category.trim() : '';
    const availableOnly = Boolean(args.availableOnly);

    let sql = `
      SELECT id, isbn, title, author, category, published_year, call_number, shelf_location,
             total_copies, available_copies, cover_url, description
      FROM books
      WHERE 1=1
    `;
    const params: string[] = [];
    if (q) {
      sql += ' AND (LOWER(title) LIKE LOWER(?) OR LOWER(author) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?) OR LOWER(isbn) LIKE LOWER(?) OR LOWER(call_number) LIKE LOWER(?))';
      const pat = `%${q}%`;
      params.push(pat, pat, pat, pat, pat, pat);
    }
    if (category && category.toLowerCase() !== 'all') {
      sql += ' AND LOWER(category) LIKE LOWER(?)';
      params.push(`%${category}%`);
    }
    if (availableOnly) {
      sql += ' AND available_copies > 0';
    }
    sql += ' ORDER BY available_copies DESC, title ASC LIMIT 12';

    const matches = await db.all<{
      id: number;
      isbn: string;
      title: string;
      author: string;
      category: string;
      published_year: number;
      call_number: string;
      shelf_location: string;
      total_copies: number;
      available_copies: number;
      cover_url: string;
      description: string;
    }>(sql, ...params);

    pushRecommendedBooks(
      ctx,
      matches.slice(0, 4).map((m) => ({
        ...m,
        reason:
          Number(m.available_copies) > 0
            ? `${m.available_copies} copy/copies on shelf (${m.shelf_location})`
            : 'Waitlist open',
      }))
    );

    return { count: matches.length, books: matches };
  }

  if (name === 'getMyLoansAndDeadlines') {
    const loans = await db.all<{
      id: number;
      title: string;
      author: string;
      call_number: string;
      issued_at: string;
      due_date: string;
      returned_at: string | null;
      status: string;
      renewal_count: number;
      renewal_requested: number;
    }>(
      `SELECT l.id, b.title, b.author, b.call_number, l.issued_at, l.due_date, l.returned_at,
              l.status, l.renewal_count, l.renewal_requested
       FROM loans l
       JOIN books b ON b.id = l.book_id
       WHERE l.user_id = ?
       ORDER BY CASE l.status WHEN 'overdue' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, l.due_date ASC
       LIMIT 25`,
      user.id
    );
    const settings = await getSettings();
    const limit = Number(user.max_loans_override ?? settings.max_books_per_student);
    const maxRenewals = Number(settings.max_renewals);
    const enriched = loans.map((l) => ({
      ...l,
      renewalEligible:
        l.status === 'active' &&
        Number(l.renewal_count) < maxRenewals &&
        Number(l.renewal_requested) === 0,
    }));
    return { loans: enriched, maxBooksAllowed: limit, maxRenewalsAllowed: maxRenewals };
  }

  if (name === 'getMyReservations') {
    const reservations = await db.all<{
      id: number;
      book_id: number;
      title: string;
      call_number: string;
      available_copies: number;
      status: string;
      reserved_at: string;
      expires_at: string | null;
    }>(
      `SELECT r.id, r.book_id, b.title, b.call_number, b.available_copies, r.status, r.reserved_at, r.expires_at
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       WHERE r.user_id = ?
       ORDER BY r.reserved_at DESC
       LIMIT 20`,
      user.id
    );

    const enriched = await Promise.all(
      reservations.map(async (r) => {
        let queuePosition: number | null = null;
        if (r.status === 'pending') {
          const row = await db.get<{ pos: number | string }>(
            `SELECT COUNT(*) as pos FROM reservations
             WHERE book_id = ? AND status IN ('pending', 'ready') AND id <= ?`,
            r.book_id,
            r.id
          );
          queuePosition = Number(row?.pos ?? 1);
        }
        return { ...r, queuePosition };
      })
    );

    return { reservations: enriched };
  }

  if (name === 'getMyFines') {
    const fines = await db.all<{
      id: number;
      amount_cents: number;
      reason: string;
      status: string;
      created_at: string;
      settled_at: string | null;
    }>('SELECT id, amount_cents, reason, status, created_at, settled_at FROM fines WHERE user_id = ? ORDER BY created_at DESC', user.id);

    const unpaidRow = await db.get<{ total: number | string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM fines WHERE user_id = ? AND status = 'unpaid'`,
      user.id
    );
    const totalUnpaidCents = Number(unpaidRow?.total ?? 0);
    return { fines, totalUnpaidCents, totalUnpaidDollars: (totalUnpaidCents / 100).toFixed(2) };
  }

  if (name === 'getPersonalizedRecommendations') {
    const topic = typeof args.topic === 'string' ? args.topic.trim() : '';

    const borrowedCategories = await db.all<{ category: string; cnt: number | string }>(
      `SELECT b.category, COUNT(*) as cnt
       FROM loans l
       JOIN books b ON b.id = l.book_id
       WHERE l.user_id = ?
       GROUP BY b.category
       ORDER BY cnt DESC`,
      user.id
    );

    const feedbackRows = await db.all<{ book_id: number; feedback: 'like' | 'dislike'; category: string }>(
      `SELECT rf.book_id, rf.feedback, b.category
       FROM recommendation_feedback rf
       JOIN books b ON b.id = rf.book_id
       WHERE rf.user_id = ?`,
      user.id
    );

    const dislikedIds = new Set(feedbackRows.filter((f) => f.feedback === 'dislike').map((f) => Number(f.book_id)));
    const likedCategories = new Set(feedbackRows.filter((f) => f.feedback === 'like').map((f) => f.category));
    const preferredCats = new Set([...borrowedCategories.map((c) => c.category), ...likedCategories]);

    const activeLoanRows = await db.all<{ book_id: number }>(
      "SELECT book_id FROM loans WHERE user_id = ? AND status IN ('active','overdue')",
      user.id
    );
    const activeLoanBookIds = new Set(activeLoanRows.map((x) => Number(x.book_id)));

    const allBooks = await db.all<{
      id: number;
      title: string;
      author: string;
      category: string;
      call_number: string;
      shelf_location: string;
      available_copies: number;
      total_copies: number;
      cover_url: string;
      description: string;
      borrow_count: number | string;
    }>(
      `SELECT b.*, (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) as borrow_count
       FROM books b
       ORDER BY borrow_count DESC, available_copies DESC`
    );

    const scored = allBooks
      .filter((b) => !dislikedIds.has(Number(b.id)) && !activeLoanBookIds.has(Number(b.id)))
      .map((b) => {
        const borrowCount = Number(b.borrow_count ?? 0);
        const avail = Number(b.available_copies);
        let score = borrowCount * 2 + (avail > 0 ? 3 : 0);
        const reasons: string[] = [];
        if (topic && `${b.title} ${b.category} ${b.description} ${b.author}`.toLowerCase().includes(topic.toLowerCase())) {
          score += 12;
          reasons.push(`Matches "${topic}"`);
        }
        if (preferredCats.has(b.category)) {
          score += 6;
          reasons.push(`Aligns with your ${b.category} reading interest`);
        }
        if (reasons.length === 0) {
          reasons.push(borrowCount > 0 ? 'Popular across department peers' : 'Available on shelf now');
        }
        return { ...b, id: Number(b.id), available_copies: avail, total_copies: Number(b.total_copies), score, reason: reasons.join(' · ') };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    pushRecommendedBooks(ctx, scored);
    return {
      recommendations: scored.map((s) => ({
        id: s.id,
        title: s.title,
        author: s.author,
        category: s.category,
        call_number: s.call_number,
        available_copies: s.available_copies,
        total_copies: s.total_copies,
        reason: s.reason,
      })),
    };
  }

  if (name === 'searchDigitalResources') {
    const q = typeof args.query === 'string' ? args.query.trim() : '';
    const allowedAccess = user.member_type === 'faculty' ? ['all', 'faculty', 'student'] : ['all', 'student'];
    let sql = `
      SELECT id, title, author, category, description, resource_type, access_level, created_at
      FROM digital_resources
      WHERE access_level IN (${allowedAccess.map(() => '?').join(',')})
    `;
    const params: string[] = [...allowedAccess];
    if (q) {
      sql += ' AND (LOWER(title) LIKE LOWER(?) OR LOWER(author) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))';
      const pat = `%${q}%`;
      params.push(pat, pat, pat, pat);
    }
    sql += ' ORDER BY created_at DESC LIMIT 12';
    const resources = await db.all(sql, ...params);
    return { count: resources.length, resources };
  }

  // --- ADMIN TOOLS ---
  if (name === 'getLibraryOverviewStats') {
    const booksRaw = (await db.get<Record<string, number | string | null>>(`
      SELECT COUNT(*) as "uniqueTitles",
             COALESCE(SUM(total_copies), 0) as "totalCopies",
             COALESCE(SUM(available_copies), 0) as "availableCopies",
             COALESCE(SUM(CASE WHEN available_copies <= low_stock_threshold THEN 1 ELSE 0 END), 0) as "lowStockTitles"
      FROM books
    `))!;

    const loansRaw = (await db.get<Record<string, number | string | null>>(`
      SELECT COALESCE(SUM(CASE WHEN status IN ('active','overdue') THEN 1 ELSE 0 END), 0) as "issuedBooks",
             COALESCE(SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END), 0) as "overdueBooks",
             COALESCE(SUM(CASE WHEN renewal_requested = 1 AND status IN ('active','overdue') THEN 1 ELSE 0 END), 0) as "pendingRenewals"
      FROM loans
    `))!;

    const usersRaw = (await db.get<Record<string, number | string | null>>(`
      SELECT COALESCE(SUM(CASE WHEN member_type = 'student' THEN 1 ELSE 0 END), 0) as "totalStudents",
             COALESCE(SUM(CASE WHEN member_type = 'faculty' THEN 1 ELSE 0 END), 0) as "totalFaculty",
             COALESCE(SUM(CASE WHEN status = 'active' AND role = 'student' THEN 1 ELSE 0 END), 0) as "activeMembers",
             COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as "pendingApprovals"
      FROM users
    `))!;

    const reservationsRaw = (await db.get<Record<string, number | string | null>>(`
      SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as "pendingReservations",
             COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) as "readyReservations"
      FROM reservations
    `))!;

    const finesRaw = (await db.get<Record<string, number | string | null>>(`
      SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) as "collectedFinesCents",
             COALESCE(SUM(CASE WHEN status = 'unpaid' THEN amount_cents ELSE 0 END), 0) as "unpaidFinesCents",
             COALESCE(SUM(CASE WHEN status = 'waived' THEN amount_cents ELSE 0 END), 0) as "waivedFinesCents"
      FROM fines
    `))!;

    const collectedCents = Number(finesRaw.collectedFinesCents ?? 0);
    const unpaidCents = Number(finesRaw.unpaidFinesCents ?? 0);
    const waivedCents = Number(finesRaw.waivedFinesCents ?? 0);

    return {
      books: {
        uniqueTitles: Number(booksRaw.uniqueTitles ?? 0),
        totalCopies: Number(booksRaw.totalCopies ?? 0),
        availableCopies: Number(booksRaw.availableCopies ?? 0),
        lowStockTitles: Number(booksRaw.lowStockTitles ?? 0),
      },
      loans: {
        issuedBooks: Number(loansRaw.issuedBooks ?? 0),
        overdueBooks: Number(loansRaw.overdueBooks ?? 0),
        pendingRenewals: Number(loansRaw.pendingRenewals ?? 0),
      },
      members: {
        totalStudents: Number(usersRaw.totalStudents ?? 0),
        totalFaculty: Number(usersRaw.totalFaculty ?? 0),
        activeMembers: Number(usersRaw.activeMembers ?? 0),
        pendingApprovals: Number(usersRaw.pendingApprovals ?? 0),
      },
      reservations: {
        pendingReservations: Number(reservationsRaw.pendingReservations ?? 0),
        readyReservations: Number(reservationsRaw.readyReservations ?? 0),
      },
      fines: {
        collectedFinesDollars: (collectedCents / 100).toFixed(2),
        unpaidFinesDollars: (unpaidCents / 100).toFixed(2),
        waivedFinesDollars: (waivedCents / 100).toFixed(2),
      },
    };
  }

  if (name === 'getOverdueAndDelinquentLoans') {
    const overdueLoans = await db.all<{
      loanId: number;
      title: string;
      call_number: string;
      userId: number;
      full_name: string;
      email: string;
      student_id: string | null;
      due_date: string;
    }>(
      `SELECT l.id as "loanId", b.title, b.call_number, u.id as "userId", u.full_name, u.email, u.student_id, l.due_date
       FROM loans l
       JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = l.user_id
       WHERE l.status = 'overdue' OR (l.status = 'active' AND l.due_date < ?)
       ORDER BY l.due_date ASC
       LIMIT 25`,
      new Date().toISOString()
    );

    const pendingRenewals = await db.all(`
      SELECT l.id as "loanId", b.title, u.full_name, u.email, l.due_date, l.renewal_count
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN users u ON u.id = l.user_id
      WHERE l.renewal_requested = 1 AND l.status IN ('active','overdue')
    `);

    const unpaidFines = await db.all<{
      fineId: number;
      amount_cents: number;
      reason: string;
      full_name: string;
      email: string;
      student_id: string | null;
    }>(`
      SELECT f.id as "fineId", f.amount_cents, f.reason, u.full_name, u.email, u.student_id
      FROM fines f
      JOIN users u ON u.id = f.user_id
      WHERE f.status = 'unpaid'
      ORDER BY f.amount_cents DESC
      LIMIT 20
    `);

    if (overdueLoans.length > 0) {
      ctx.collectedTables.push({
        title: 'Overdue Loans',
        columns: ['Loan ID', 'Title', 'Borrower', 'Due Date'],
        rows: overdueLoans.slice(0, 8).map((o) => [
          Number(o.loanId),
          o.title,
          `${o.full_name} (${o.student_id || o.email})`,
          o.due_date.slice(0, 10),
        ]),
      });
    }

    return { overdueLoans, pendingRenewals, unpaidFines };
  }

  if (name === 'getInventoryIntelligence') {
    const lowStock = await db.all<{
      id: number;
      title: string;
      author: string;
      category: string;
      available_copies: number;
      total_copies: number;
      low_stock_threshold: number;
      shelf_location: string;
    }>(`
      SELECT id, title, author, category, available_copies, total_copies, low_stock_threshold, shelf_location
      FROM books
      WHERE available_copies <= low_stock_threshold
      ORDER BY available_copies ASC, total_copies DESC
    `);

    const rarelyBorrowed = await db.all(`
      SELECT b.id, b.title, b.category, b.total_copies, b.available_copies,
             CAST((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS INTEGER) as total_loans
      FROM books b
      ORDER BY total_loans ASC, b.created_at ASC
      LIMIT 8
    `);

    const damagedCopies = await db.all(`
      SELECT bc.copy_code, bc.condition_status, bc.availability_status, b.title
      FROM book_copies bc
      JOIN books b ON b.id = bc.book_id
      WHERE bc.condition_status IN ('damaged','repair') OR bc.availability_status IN ('lost','maintenance')
    `);

    const demandRows = await db.all<{
      id: number;
      title: string;
      category: string;
      total_copies: number;
      available_copies: number;
      historical_loans: number | string;
      active_holds: number | string;
    }>(`
      SELECT b.id, b.title, b.category, b.total_copies, b.available_copies,
             (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) as historical_loans,
             (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending','ready')) as active_holds
      FROM books b
    `);

    const demandPrediction = demandRows
      .map((d) => {
        const total = Number(d.total_copies);
        const avail = Number(d.available_copies);
        const hist = Number(d.historical_loans ?? 0);
        const holds = Number(d.active_holds ?? 0);
        const utilization = total > 0 ? (total - avail) / total : 0;
        const projectedDemandScore = Math.round((hist * 1.4 + holds * 3 + utilization * 4) * 10) / 10;
        const recommendedExtraCopies =
          avail === 0 && holds > 0 ? Math.max(2, holds) : avail <= 1 && hist >= 2 ? 1 : 0;
        return {
          bookId: Number(d.id),
          title: d.title,
          category: d.category,
          historicalLoans: hist,
          activeHolds: holds,
          availableCopies: avail,
          totalCopies: total,
          projectedDemandScore,
          recommendedExtraCopies,
        };
      })
      .sort((a, b) => b.projectedDemandScore - a.projectedDemandScore)
      .slice(0, 6);

    if (lowStock.length > 0) {
      ctx.collectedTables.push({
        title: 'Low-Stock & Restock Candidates',
        columns: ['ID', 'Title', 'Available / Total', 'Shelf'],
        rows: lowStock.slice(0, 8).map((b) => [Number(b.id), b.title, `${b.available_copies}/${b.total_copies}`, b.shelf_location]),
      });
    }

    return {
      lowStock,
      rarelyBorrowed,
      damagedCopies,
      demandPredictionNote:
        'Projected demand is algorithmically derived from historical checkout frequency, active waitlist holds, and current stock utilization.',
      demandPrediction,
    };
  }

  if (name === 'searchMembers') {
    const q = typeof args.query === 'string' ? args.query.trim() : '';
    const memberType = typeof args.memberType === 'string' ? args.memberType.trim() : '';
    const status = typeof args.status === 'string' ? args.status.trim() : '';

    let sql = `
      SELECT id, full_name, email, student_id, member_type, role, department, status, max_loans_override, last_login_at
      FROM users
      WHERE 1=1
    `;
    const params: string[] = [];
    if (q) {
      sql += ' AND (LOWER(full_name) LIKE LOWER(?) OR LOWER(email) LIKE LOWER(?) OR LOWER(COALESCE(student_id, \'\')) LIKE LOWER(?) OR LOWER(department) LIKE LOWER(?))';
      const pat = `%${q}%`;
      params.push(pat, pat, pat, pat);
    }
    if (memberType) {
      sql += ' AND member_type = ?';
      params.push(memberType);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT 20';

    const members = await db.all(sql, ...params);
    return { count: members.length, members };
  }

  if (name === 'generateOperationalReport') {
    const reportType = String(args.reportType || 'circulation');

    if (reportType === 'fines') {
      const rows = await db.all<{
        id: number;
        full_name: string;
        amount_cents: number;
        reason: string;
        status: string;
        created_at: string;
      }>(`
        SELECT f.id, u.full_name, f.amount_cents, f.reason, f.status, f.created_at
        FROM fines f JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC LIMIT 15
      `);

      ctx.collectedTables.push({
        title: 'Fine Collection Ledger Report',
        columns: ['Fine ID', 'Member', 'Amount', 'Status', 'Reason'],
        rows: rows.map((r) => [Number(r.id), r.full_name, `$${(Number(r.amount_cents) / 100).toFixed(2)}`, r.status, r.reason]),
      });
      return { reportType, rowCount: rows.length, rows };
    }

    if (reportType === 'popular_books') {
      const rows = await db.all<{
        id: number;
        title: string;
        category: string;
        available_copies: number;
        total_copies: number;
        checkouts: number | string;
      }>(`
        SELECT b.id, b.title, b.category, b.available_copies, b.total_copies,
               CAST((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS INTEGER) as checkouts
        FROM books b
        ORDER BY checkouts DESC, b.title ASC LIMIT 12
      `);

      ctx.collectedTables.push({
        title: 'Popular Books Circulation Report',
        columns: ['ID', 'Title', 'Category', 'Checkouts', 'Stock'],
        rows: rows.map((r) => [Number(r.id), r.title, r.category, Number(r.checkouts), `${r.available_copies}/${r.total_copies}`]),
      });
      return { reportType, rowCount: rows.length, rows };
    }

    if (reportType === 'overdue') {
      const rows = await db.all<{
        id: number;
        title: string;
        full_name: string;
        student_id: string | null;
        due_date: string;
      }>(
        `SELECT l.id, b.title, u.full_name, u.student_id, l.due_date
         FROM loans l
         JOIN books b ON b.id = l.book_id
         JOIN users u ON u.id = l.user_id
         WHERE l.status = 'overdue' OR (l.status = 'active' AND l.due_date < ?)
         ORDER BY l.due_date ASC LIMIT 15`,
        new Date().toISOString()
      );

      ctx.collectedTables.push({
        title: 'Overdue Circulation Report',
        columns: ['Loan ID', 'Book', 'Member', 'Due Date'],
        rows: rows.map((r) => [
          Number(r.id),
          r.title,
          `${r.full_name}${r.student_id ? ` (${r.student_id})` : ''}`,
          r.due_date.slice(0, 10),
        ]),
      });
      return { reportType, rowCount: rows.length, rows };
    }

    if (reportType === 'inventory') {
      const rows = await db.all<{
        id: number;
        title: string;
        category: string;
        call_number: string;
        shelf_location: string;
        available_copies: number;
        total_copies: number;
      }>(`
        SELECT id, title, category, call_number, shelf_location, available_copies, total_copies
        FROM books ORDER BY available_copies ASC, title ASC LIMIT 15
      `);

      ctx.collectedTables.push({
        title: 'Catalog Inventory Snapshot',
        columns: ['ID', 'Title', 'Call #', 'Available / Total', 'Shelf'],
        rows: rows.map((r) => [Number(r.id), r.title, r.call_number, `${r.available_copies}/${r.total_copies}`, r.shelf_location]),
      });
      return { reportType, rowCount: rows.length, rows };
    }

    const rows = await db.all<{
      id: number;
      title: string;
      full_name: string;
      status: string;
      issued_at: string;
      due_date: string;
    }>(`
      SELECT l.id, b.title, u.full_name, l.status, l.issued_at, l.due_date
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN users u ON u.id = l.user_id
      ORDER BY l.issued_at DESC LIMIT 15
    `);

    ctx.collectedTables.push({
      title: 'Recent Circulation Transactions',
      columns: ['Loan ID', 'Book', 'Member', 'Status', 'Due Date'],
      rows: rows.map((r) => [Number(r.id), r.title, r.full_name, r.status, r.due_date.slice(0, 10)]),
    });
    return { reportType: 'circulation', rowCount: rows.length, rows };
  }

  if (name === 'proposeAdminAction') {
    const actionType = String(args.actionType || '');
    const note = typeof args.note === 'string' ? args.note.trim() : '';
    const targetId = args.targetId !== undefined ? Number(args.targetId) : undefined;

    const allowed = ['waive_fine', 'mark_reservation_ready', 'approve_renewal', 'update_book_stock', 'create_announcement'];
    if (!allowed.includes(actionType)) {
      return { error: 'Unsupported administrative action requested.' };
    }

    let summary = '';
    const payload: Record<string, string | number | boolean> = { actionType, note };

    if (actionType === 'waive_fine') {
      if (!targetId || !Number.isInteger(targetId)) return { error: 'Valid fine targetId is required.' };
      const fine = await db.get<{ id: number; amount_cents: number; reason: string; status: string; full_name: string }>(
        `SELECT f.id, f.amount_cents, f.reason, f.status, u.full_name
         FROM fines f JOIN users u ON u.id = f.user_id WHERE f.id = ?`,
        targetId
      );
      if (!fine || fine.status !== 'unpaid') return { error: 'Unpaid fine record not found.' };
      summary = `Waive unpaid fine #${fine.id} ($${(Number(fine.amount_cents) / 100).toFixed(2)}) for ${fine.full_name}`;
      payload.targetId = Number(fine.id);
      payload.memberName = fine.full_name;
      payload.amountDollars = (Number(fine.amount_cents) / 100).toFixed(2);
    } else if (actionType === 'mark_reservation_ready') {
      if (!targetId || !Number.isInteger(targetId)) return { error: 'Valid reservation targetId is required.' };
      const resRow = await db.get<{ id: number; status: string; title: string; full_name: string }>(
        `SELECT r.id, r.status, b.title, u.full_name
         FROM reservations r JOIN books b ON b.id = r.book_id JOIN users u ON u.id = r.user_id
         WHERE r.id = ?`,
        targetId
      );
      if (!resRow || resRow.status !== 'pending') return { error: 'Pending reservation not found.' };
      summary = `Mark reservation #${resRow.id} ready for pickup (${resRow.title} → ${resRow.full_name})`;
      payload.targetId = Number(resRow.id);
      payload.bookTitle = resRow.title;
      payload.memberName = resRow.full_name;
    } else if (actionType === 'approve_renewal') {
      if (!targetId || !Number.isInteger(targetId)) return { error: 'Valid loan targetId is required.' };
      const loan = await db.get<{ id: number; status: string; title: string; full_name: string }>(
        `SELECT l.id, l.status, b.title, u.full_name
         FROM loans l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.user_id
         WHERE l.id = ?`,
        targetId
      );
      if (!loan || loan.status === 'returned') return { error: 'Active loan not found.' };
      summary = `Approve renewal for loan #${loan.id} (${loan.title} · ${loan.full_name})`;
      payload.targetId = Number(loan.id);
      payload.bookTitle = loan.title;
      payload.memberName = loan.full_name;
    } else if (actionType === 'update_book_stock') {
      const newTotalCopies = Number(args.newTotalCopies);
      if (!targetId || !Number.isInteger(targetId) || !Number.isInteger(newTotalCopies) || newTotalCopies < 1 || newTotalCopies > 500) {
        return { error: 'Valid book targetId and newTotalCopies (1..500) are required.' };
      }
      const book = await db.get<{ id: number; title: string; total_copies: number; available_copies: number }>(
        'SELECT id, title, total_copies, available_copies FROM books WHERE id = ?',
        targetId
      );
      if (!book) return { error: 'Catalog book not found.' };
      const loanedOut = Number(book.total_copies) - Number(book.available_copies);
      if (newTotalCopies < loanedOut) {
        return { error: `Cannot reduce total copies below loaned out count (${loanedOut}).` };
      }
      summary = `Update stock for "${book.title}" from ${book.total_copies} to ${newTotalCopies} copies`;
      payload.targetId = Number(book.id);
      payload.bookTitle = book.title;
      payload.previousTotal = Number(book.total_copies);
      payload.newTotalCopies = newTotalCopies;
    } else if (actionType === 'create_announcement') {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const message = typeof args.message === 'string' ? args.message.trim() : '';
      const priority = ['normal', 'important', 'urgent'].includes(String(args.priority)) ? String(args.priority) : 'normal';
      if (!title || !message) return { error: 'Announcement title and message are required.' };
      summary = `Publish ${priority} library announcement: "${title}"`;
      payload.title = title;
      payload.message = message;
      payload.priority = priority;
    }

    const actionId = crypto.randomUUID();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    await db.run(
      `INSERT INTO ai_pending_actions (id, user_id, action_type, summary, payload_json, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      actionId,
      user.id,
      actionType,
      summary,
      JSON.stringify(payload),
      expiresAt,
      new Date().toISOString()
    );

    ctx.pendingAction = {
      actionId,
      actionType,
      summary,
      details: payload,
      status: 'pending',
      expiresAt,
    };

    return {
      proposed: true,
      actionId,
      summary,
      instruction: 'Inform the administrator that this action is queued for their explicit confirmation using the action card below.',
    };
  }

  return { error: `Tool "${name}" is not implemented.` };
}
