import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Response } from 'express';
import {
  coversUploadDir,
  db,
  getSettings,
  resourcesUploadDir,
  syncBookCopiesForBook,
  writeAuditLog,
} from '../db.ts';
import {
  getClientIp,
  hashPassword,
  hashToken,
  requireAuth,
  requireRole,
  validatePasswordStrength,
  type AuthenticatedRequest,
} from '../security.ts';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

async function refreshOverdueStatuses(): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE loans
     SET status = 'overdue'
     WHERE status = 'active' AND due_date < ?`,
    nowIso
  );
}

function isValidIsbn(rawIsbn: string): boolean {
  const cleaned = rawIsbn.replace(/[-\s]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(cleaned)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const val = cleaned[i] === 'X' ? 10 : Number(cleaned[i]);
      sum += val * (10 - i);
    }
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(cleaned)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      sum += Number(cleaned[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }
  return false;
}

function parseCsvLines(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"' && normalized[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((v) => v !== '')) rows.push(row);
  }
  return rows;
}

async function computeDemandPrediction() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.all<{
    id: number;
    title: string;
    author: string;
    category: string;
    total_copies: number;
    available_copies: number;
    low_stock_threshold: number;
    historical_loans: number | string;
    recent_loans_30d: number | string;
    active_holds: number | string;
  }>(
    `SELECT b.id, b.title, b.author, b.category, b.total_copies, b.available_copies, b.low_stock_threshold,
            (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) as historical_loans,
            (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.issued_at >= ?) as recent_loans_30d,
            (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending', 'ready')) as active_holds
     FROM books b`,
    thirtyDaysAgo
  );

  return rows
    .map((r) => {
      const totalCopies = Number(r.total_copies);
      const availableCopies = Number(r.available_copies);
      const lowStockThreshold = Number(r.low_stock_threshold);
      const historicalLoans = Number(r.historical_loans ?? 0);
      const recentLoans30d = Number(r.recent_loans_30d ?? 0);
      const activeHolds = Number(r.active_holds ?? 0);
      const utilization = totalCopies > 0 ? (totalCopies - availableCopies) / totalCopies : 0;
      const projectedScore =
        Math.round((recentLoans30d * 2.2 + historicalLoans * 1.1 + activeHolds * 3.5 + utilization * 4) * 10) / 10;
      const restockRecommendation =
        availableCopies === 0 && activeHolds > 0
          ? Math.max(2, activeHolds)
          : availableCopies <= lowStockThreshold && historicalLoans >= 1
            ? 1
            : 0;
      return {
        bookId: Number(r.id),
        title: r.title,
        author: r.author,
        category: r.category,
        totalCopies,
        availableCopies,
        historicalLoans,
        recentLoans30d,
        activeHolds,
        projectedDemandScore: projectedScore,
        recommendedExtraCopies: restockRecommendation,
      };
    })
    .sort((a, b) => b.projectedDemandScore - a.projectedDemandScore);
}

adminRouter.get('/overview', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await refreshOverdueStatuses();

    const bookStats = (await db.get<Record<string, number | string | null>>(`
      SELECT
        COUNT(*) as "uniqueTitles",
        COALESCE(SUM(total_copies), 0) as "totalCopies",
        COALESCE(SUM(available_copies), 0) as "availableCopies",
        COALESCE(SUM(CASE WHEN available_copies <= low_stock_threshold THEN 1 ELSE 0 END), 0) as "lowStockCount"
      FROM books
    `))!;

    const loanStats = (await db.get<Record<string, number | string | null>>(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('active', 'overdue') THEN 1 ELSE 0 END), 0) as "activeLoans",
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END), 0) as "overdueLoans",
        COALESCE(SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END), 0) as "returnedLoans",
        COALESCE(SUM(CASE WHEN renewal_requested = 1 AND status IN ('active', 'overdue') THEN 1 ELSE 0 END), 0) as "pendingRenewals"
      FROM loans
    `))!;

    const reservationRow = await db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM reservations WHERE status IN ('pending', 'ready')`
    );

    const fineStats = (await db.get<Record<string, number | string | null>>(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'unpaid' THEN amount_cents ELSE 0 END), 0) as "unpaidFinesCents",
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) as "collectedFinesCents",
        COALESCE(SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END), 0) as "pendingFineRequestsCount"
      FROM fines
    `))!;

    const memberStats = (await db.get<Record<string, number | string | null>>(`
      SELECT
        COALESCE(SUM(CASE WHEN member_type = 'student' THEN 1 ELSE 0 END), 0) as "totalStudents",
        COALESCE(SUM(CASE WHEN member_type = 'faculty' THEN 1 ELSE 0 END), 0) as "totalFaculty",
        COALESCE(SUM(CASE WHEN role = 'student' AND status = 'active' THEN 1 ELSE 0 END), 0) as "activeStudents",
        COALESCE(SUM(CASE WHEN role = 'student' AND status = 'pending' THEN 1 ELSE 0 END), 0) as "pendingApprovals",
        COALESCE(SUM(CASE WHEN role = 'admin' AND status = 'active' THEN 1 ELSE 0 END), 0) as "activeAdmins"
      FROM users
    `))!;

    const pendingResetsRow = await db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM password_resets WHERE status = 'requested'`
    );

    const categoryBreakdownRaw = await db.all<Record<string, unknown>>(`
      SELECT category,
             CAST(COUNT(*) AS INTEGER) as titles,
             CAST(COALESCE(SUM(total_copies), 0) AS INTEGER) as "totalCopies",
             CAST(COALESCE(SUM(available_copies), 0) AS INTEGER) as "availableCopies"
      FROM books
      GROUP BY category
      ORDER BY "totalCopies" DESC
    `);

    const popularBooksRaw = await db.all<Record<string, unknown>>(`
      SELECT b.id, b.title, b.author, b.category,
             b.available_copies as "availableCopies",
             b.total_copies as "totalCopies",
             CAST((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS INTEGER) as "checkoutCount"
      FROM books b
      ORDER BY "checkoutCount" DESC, b.title ASC
      LIMIT 6
    `);

    const lowStockBooks = await db.all(`
      SELECT id, title, author, category, available_copies, total_copies, low_stock_threshold, shelf_location
      FROM books
      WHERE available_copies <= low_stock_threshold
      ORDER BY available_copies ASC, title ASC
      LIMIT 8
    `);

    const recentTransactions = await db.all(`
      SELECT l.id, l.status, l.issued_at, l.due_date, l.returned_at,
             b.title as book_title, b.call_number as book_call_number,
             u.full_name as borrower_name, u.student_id as borrower_student_id, u.member_type as borrower_type
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC
      LIMIT 8
    `);

    const recentStudents = await db.all(`
      SELECT id, full_name as "fullName", email, student_id as "studentId", member_type as "memberType",
             department, status, created_at as "createdAt"
      FROM users
      WHERE role = 'student'
      ORDER BY id DESC
      LIMIT 6
    `);

    const monthlyCirculationRaw = await db.all<Record<string, unknown>>(`
      SELECT substr(issued_at, 1, 7) as month,
             CAST(COUNT(*) AS INTEGER) as issued,
             CAST(COALESCE(SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END), 0) AS INTEGER) as returned,
             CAST(COALESCE(SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END), 0) AS INTEGER) as overdue
      FROM loans
      GROUP BY substr(issued_at, 1, 7)
      ORDER BY month ASC
      LIMIT 12
    `);

    const recentAuditLogs = await db.all(`
      SELECT id, actor_label as "actorLabel", action, target, severity, ip_address as "ipAddress", created_at as "createdAt"
      FROM audit_logs
      ORDER BY id DESC
      LIMIT 15
    `);

    const demandPrediction = (await computeDemandPrediction()).slice(0, 6);

    res.json({
      metrics: {
        uniqueTitles: Number(bookStats.uniqueTitles ?? 0),
        totalCopies: Number(bookStats.totalCopies ?? 0),
        availableCopies: Number(bookStats.availableCopies ?? 0),
        lowStockCount: Number(bookStats.lowStockCount ?? 0),
        activeLoans: Number(loanStats.activeLoans ?? 0),
        overdueLoans: Number(loanStats.overdueLoans ?? 0),
        returnedLoans: Number(loanStats.returnedLoans ?? 0),
        pendingRenewals: Number(loanStats.pendingRenewals ?? 0),
        openReservations: Number(reservationRow?.count ?? 0),
        unpaidFinesCents: Number(fineStats.unpaidFinesCents ?? 0),
        collectedFinesCents: Number(fineStats.collectedFinesCents ?? 0),
        pendingFineRequestsCount: Number(fineStats.pendingFineRequestsCount ?? 0),
        totalStudents: Number(memberStats.totalStudents ?? 0),
        totalFaculty: Number(memberStats.totalFaculty ?? 0),
        activeStudents: Number(memberStats.activeStudents ?? 0),
        pendingApprovals: Number(memberStats.pendingApprovals ?? 0),
        activeAdmins: Number(memberStats.activeAdmins ?? 0),
        pendingResets: Number(pendingResetsRow?.count ?? 0),
      },
      categoryBreakdown: categoryBreakdownRaw.map((c) => ({
        category: String(c.category),
        titles: Number(c.titles ?? 0),
        totalCopies: Number(c.totalCopies ?? 0),
        availableCopies: Number(c.availableCopies ?? 0),
      })),
      popularBooks: popularBooksRaw.map((p) => ({
        ...p,
        id: Number(p.id),
        availableCopies: Number(p.availableCopies ?? 0),
        totalCopies: Number(p.totalCopies ?? 0),
        checkoutCount: Number(p.checkoutCount ?? 0),
      })),
      lowStockBooks,
      recentTransactions,
      recentStudents,
      monthlyCirculation: monthlyCirculationRaw.map((m) => ({
        month: String(m.month),
        issued: Number(m.issued ?? 0),
        returned: Number(m.returned ?? 0),
        overdue: Number(m.overdue ?? 0),
      })),
      demandPrediction,
      recentAuditLogs,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/analytics', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await refreshOverdueStatuses();

    const monthlyCirculationRaw = await db.all<Record<string, unknown>>(`
      SELECT substr(issued_at, 1, 7) as month,
             CAST(COUNT(*) AS INTEGER) as issued,
             CAST(COALESCE(SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END), 0) AS INTEGER) as returned,
             CAST(COALESCE(SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END), 0) AS INTEGER) as overdue
      FROM loans
      GROUP BY substr(issued_at, 1, 7)
      ORDER BY month ASC
      LIMIT 12
    `);

    const dailyCirculationRaw = await db.all<Record<string, unknown>>(`
      SELECT substr(issued_at, 1, 10) as day,
             CAST(COUNT(*) AS INTEGER) as issued,
             CAST(COALESCE(SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END), 0) AS INTEGER) as returned
      FROM loans
      GROUP BY substr(issued_at, 1, 10)
      ORDER BY day DESC
      LIMIT 14
    `);

    const popularBooksRaw = await db.all<Record<string, unknown>>(`
      SELECT b.id, b.isbn, b.title, b.author, b.category, b.call_number,
             b.total_copies, b.available_copies,
             CAST((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS INTEGER) as "checkoutCount",
             CAST((SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending','ready')) AS INTEGER) as "holdCount"
      FROM books b
      ORDER BY "checkoutCount" DESC, "holdCount" DESC, b.title ASC
    `);

    const categoryBreakdownRaw = await db.all<Record<string, unknown>>(`
      SELECT b.category,
             CAST(COUNT(DISTINCT b.id) AS INTEGER) as titles,
             CAST(COALESCE(SUM(b.total_copies), 0) AS INTEGER) as "totalCopies",
             CAST(COALESCE(SUM(b.available_copies), 0) AS INTEGER) as "availableCopies",
             CAST((SELECT COUNT(*) FROM loans l JOIN books b2 ON b2.id = l.book_id WHERE b2.category = b.category) AS INTEGER) as "totalCheckouts"
      FROM books b
      GROUP BY b.category
      ORDER BY "totalCopies" DESC
    `);

    const studentActivityRaw = await db.all<Record<string, unknown>>(`
      SELECT u.id, u.full_name as "fullName", u.email, u.student_id as "studentId", u.member_type as "memberType",
             u.department, u.status,
             CAST((SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id) AS INTEGER) as "totalLoans",
             CAST((SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.status IN ('active','overdue')) AS INTEGER) as "activeLoans",
             CAST((SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.status = 'overdue') AS INTEGER) as "overdueLoans",
             CAST((SELECT COALESCE(SUM(amount_cents), 0) FROM fines f WHERE f.user_id = u.id AND f.status = 'unpaid') AS INTEGER) as "unpaidFinesCents"
      FROM users u
      WHERE u.role = 'student'
      ORDER BY "totalLoans" DESC, u.full_name ASC
    `);

    const overdueLoans = await db.all(`
      SELECT l.id, l.issued_at, l.due_date, b.title as book_title, b.call_number,
             u.full_name as borrower_name, u.email as borrower_email, u.student_id as borrower_student_id
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN users u ON u.id = l.user_id
      WHERE l.status = 'overdue'
      ORDER BY l.due_date ASC
    `);

    const fineSummaryRaw = (await db.get<Record<string, unknown>>(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) as "paidCents",
        COALESCE(SUM(CASE WHEN status = 'unpaid' THEN amount_cents ELSE 0 END), 0) as "unpaidCents",
        COALESCE(SUM(CASE WHEN status = 'waived' THEN amount_cents ELSE 0 END), 0) as "waivedCents",
        CAST(COUNT(*) AS INTEGER) as "totalRecords"
      FROM fines
    `))!;

    const demandPrediction = await computeDemandPrediction();

    res.json({
      monthlyCirculation: monthlyCirculationRaw.map((m) => ({
        month: String(m.month),
        issued: Number(m.issued ?? 0),
        returned: Number(m.returned ?? 0),
        overdue: Number(m.overdue ?? 0),
      })),
      dailyCirculation: dailyCirculationRaw.map((d) => ({
        day: String(d.day),
        issued: Number(d.issued ?? 0),
        returned: Number(d.returned ?? 0),
      })),
      popularBooks: popularBooksRaw.map((p) => ({
        ...p,
        id: Number(p.id),
        checkoutCount: Number(p.checkoutCount ?? 0),
        holdCount: Number(p.holdCount ?? 0),
      })),
      categoryBreakdown: categoryBreakdownRaw.map((c) => ({
        category: String(c.category),
        titles: Number(c.titles ?? 0),
        totalCopies: Number(c.totalCopies ?? 0),
        availableCopies: Number(c.availableCopies ?? 0),
        totalCheckouts: Number(c.totalCheckouts ?? 0),
      })),
      studentActivity: studentActivityRaw.map((s) => ({
        ...s,
        id: Number(s.id),
        totalLoans: Number(s.totalLoans ?? 0),
        activeLoans: Number(s.activeLoans ?? 0),
        overdueLoans: Number(s.overdueLoans ?? 0),
        unpaidFinesCents: Number(s.unpaidFinesCents ?? 0),
      })),
      overdueLoans,
      fineSummary: {
        paidCents: Number(fineSummaryRaw.paidCents ?? 0),
        unpaidCents: Number(fineSummaryRaw.unpaidCents ?? 0),
        waivedCents: Number(fineSummaryRaw.waivedCents ?? 0),
        totalRecords: Number(fineSummaryRaw.totalRecords ?? 0),
      },
      demandPrediction,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/books', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

    let query = `
      SELECT b.*,
             CAST((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS INTEGER) as borrow_count,
             CAST((SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending','ready')) AS INTEGER) as active_reservation_count
      FROM books b
      WHERE 1=1
    `;
    const params: string[] = [];

    if (search) {
      query += ' AND (LOWER(b.title) LIKE LOWER(?) OR LOWER(b.author) LIKE LOWER(?) OR LOWER(b.isbn) LIKE LOWER(?) OR LOWER(b.call_number) LIKE LOWER(?))';
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    if (category && category !== 'all') {
      query += ' AND b.category = ?';
      params.push(category);
    }
    query += ' ORDER BY b.title ASC';

    const books = await db.all(query, ...params);
    res.json({ books });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/books', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const isbn = typeof req.body?.isbn === 'string' ? req.body.isbn.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const author = typeof req.body?.author === 'string' ? req.body.author.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const publisher = typeof req.body?.publisher === 'string' ? req.body.publisher.trim() : '';
    const publishedYear = Number(req.body?.publishedYear);
    const callNumber = typeof req.body?.callNumber === 'string' ? req.body.callNumber.trim() : '';
    const shelfLocation = typeof req.body?.shelfLocation === 'string' ? req.body.shelfLocation.trim() : '';
    const rackCode = typeof req.body?.rackCode === 'string' ? req.body.rackCode.trim() : '';
    const lowStockThreshold = req.body?.lowStockThreshold !== undefined ? Number(req.body.lowStockThreshold) : 2;
    const totalCopies = Number(req.body?.totalCopies);
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';

    if (!isbn || !title || !author || !category || !callNumber || !shelfLocation) {
      res.status(400).json({ error: 'ISBN, Title, Author, Category, Call Number, and Shelf Location are required.' });
      return;
    }
    if (!isValidIsbn(isbn)) {
      res.status(400).json({ error: 'Please enter a valid ISBN-10 or ISBN-13 checksum.' });
      return;
    }
    if (!Number.isInteger(publishedYear) || publishedYear < 1400 || publishedYear > 2100) {
      res.status(400).json({ error: 'Please enter a valid publication year.' });
      return;
    }
    if (!Number.isInteger(totalCopies) || totalCopies < 1 || totalCopies > 500) {
      res.status(400).json({ error: 'Total copies must be an integer between 1 and 500.' });
      return;
    }
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > 50) {
      res.status(400).json({ error: 'Low stock threshold must be between 0 and 50.' });
      return;
    }

    const normalizedIsbn = isbn.replace(/\s+/g, '');
    const dup = await db.get("SELECT id FROM books WHERE REPLACE(isbn, '-', '') = REPLACE(?, '-', '')", normalizedIsbn);
    if (dup) {
      res.status(409).json({ error: 'A book with this ISBN already exists in the catalog.' });
      return;
    }

    const now = new Date().toISOString();
    const newBookId = await db.insert(
      `INSERT INTO books (
        isbn, title, author, category, publisher, published_year,
        call_number, shelf_location, rack_code, low_stock_threshold,
        total_copies, available_copies, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      normalizedIsbn,
      title,
      author,
      category,
      publisher || 'Academic Press',
      publishedYear,
      callNumber,
      shelfLocation,
      rackCode || shelfLocation.slice(0, 12),
      lowStockThreshold,
      totalCopies,
      totalCopies,
      description,
      now
    );

    await syncBookCopiesForBook(newBookId);

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Added Book to Catalog',
      target: `${title} (${normalizedIsbn})`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    const book = await db.get('SELECT * FROM books WHERE id = ?', newBookId);
    res.status(201).json({ book });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/books/bulk-import', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
    if (!csvText.trim()) {
      res.status(400).json({ error: 'CSV content is empty.' });
      return;
    }

    const parsed = parseCsvLines(csvText);
    if (parsed.length < 2) {
      res.status(400).json({ error: 'CSV must include a header row and at least one book row.' });
      return;
    }

    const headers = parsed[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
    const colIndex = (name: string) => headers.indexOf(name);

    const requiredCols = ['isbn', 'title', 'author', 'category', 'call_number', 'shelf_location'];
    const missingCols = requiredCols.filter((c) => colIndex(c) === -1);
    if (missingCols.length > 0) {
      res.status(400).json({ error: `Missing required CSV columns: ${missingCols.join(', ')}` });
      return;
    }

    const imported: string[] = [];
    const skipped: Array<{ row: number; isbn: string; reason: string }> = [];
    const now = new Date().toISOString();

    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      const getVal = (key: string) => {
        const idx = colIndex(key);
        return idx >= 0 && idx < r.length ? r[idx].trim() : '';
      };

      const isbn = getVal('isbn');
      const title = getVal('title');
      const author = getVal('author');
      const category = getVal('category');
      const publisher = getVal('publisher') || 'Academic Press';
      const publishedYear = Number(getVal('published_year') || 2024);
      const callNumber = getVal('call_number');
      const shelfLocation = getVal('shelf_location');
      const totalCopies = Number(getVal('total_copies') || 2);
      const description = getVal('description');

      if (!isbn || !title || !author || !category || !callNumber || !shelfLocation) {
        skipped.push({ row: i + 1, isbn, reason: 'Missing required fields' });
        continue;
      }
      if (!isValidIsbn(isbn)) {
        skipped.push({ row: i + 1, isbn, reason: 'Invalid ISBN-10/ISBN-13 format or checksum' });
        continue;
      }
      if (!Number.isInteger(publishedYear) || publishedYear < 1400 || publishedYear > 2100) {
        skipped.push({ row: i + 1, isbn, reason: 'Invalid publication year' });
        continue;
      }
      if (!Number.isInteger(totalCopies) || totalCopies < 1 || totalCopies > 200) {
        skipped.push({ row: i + 1, isbn, reason: 'Total copies must be 1–200' });
        continue;
      }

      const dup = await db.get("SELECT id FROM books WHERE REPLACE(isbn, '-', '') = REPLACE(?, '-', '')", isbn);
      if (dup) {
        skipped.push({ row: i + 1, isbn, reason: 'Duplicate ISBN already in catalog' });
        continue;
      }

      const newId = await db.insert(
        `INSERT INTO books (
          isbn, title, author, category, publisher, published_year,
          call_number, shelf_location, rack_code, low_stock_threshold,
          total_copies, available_copies, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?)`,
        isbn,
        title,
        author,
        category,
        publisher,
        publishedYear,
        callNumber,
        shelfLocation,
        shelfLocation.slice(0, 12),
        totalCopies,
        totalCopies,
        description,
        now
      );
      await syncBookCopiesForBook(newId);
      imported.push(`${title} (${isbn})`);
    }

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Bulk CSV Book Import',
      target: `${imported.length} imported, ${skipped.length} skipped`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ importedCount: imported.length, imported, skipped });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/books/:id/cover', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const bookId = Number(req.params.id);
    const book = await db.get<{ id: number; title: string }>('SELECT id, title FROM books WHERE id = ?', bookId);
    if (!book) {
      res.status(404).json({ error: 'Book not found.' });
      return;
    }

    const dataBase64 = typeof req.body?.dataBase64 === 'string' ? req.body.dataBase64.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim().toLowerCase() : '';

    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/webp': '.webp',
    };
    const ext = extMap[mimeType];
    if (!ext || !dataBase64) {
      res.status(400).json({ error: 'Please upload a valid PNG, JPG, or WebP cover image.' });
      return;
    }

    const cleanB64 = dataBase64.replace(/^data:image\/[a-z+]+;base64,/, '');
    const buffer = Buffer.from(cleanB64, 'base64');
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'Cover image must be non-empty and under 5 MB.' });
      return;
    }

    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isPng && !isJpg && !isWebp) {
      res.status(400).json({ error: 'Uploaded file signature does not match a valid PNG, JPEG, or WebP image.' });
      return;
    }

    const filename = `${crypto.randomUUID()}${ext}`;
    const storedMime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    // Store persistently in DB so serverless deployments without local filesystem work cleanly
    await db.run(
      `INSERT INTO stored_files (filename, mime_type, data_base64, created_at)
       VALUES (?, ?, ?, ?)`,
      filename,
      storedMime,
      buffer.toString('base64'),
      new Date().toISOString()
    );

    if (!process.env.VERCEL && !process.env.DATABASE_URL) {
      const targetPath = path.resolve(coversUploadDir, filename);
      if (targetPath.startsWith(coversUploadDir + path.sep)) {
        fs.writeFileSync(targetPath, buffer);
      }
    }

    const coverUrl = `/api/files/covers/${filename}`;
    await db.run('UPDATE books SET cover_url = ? WHERE id = ?', coverUrl, bookId);

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Uploaded Book Cover',
      target: book.title,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ coverUrl });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/books/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const bookId = Number(req.params.id);
    const existing = await db.get<{
      id: number;
      title: string;
      total_copies: number;
      available_copies: number;
      rack_code: string;
      low_stock_threshold: number;
    }>('SELECT * FROM books WHERE id = ?', bookId);

    if (!existing) {
      res.status(404).json({ error: 'Book not found.' });
      return;
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : existing.title;
    const author = typeof req.body?.author === 'string' ? req.body.author.trim() : undefined;
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : undefined;
    const publisher = typeof req.body?.publisher === 'string' ? req.body.publisher.trim() : undefined;
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : undefined;
    const shelfLocation = typeof req.body?.shelfLocation === 'string' ? req.body.shelfLocation.trim() : undefined;
    const callNumber = typeof req.body?.callNumber === 'string' ? req.body.callNumber.trim() : undefined;
    const rackCode = typeof req.body?.rackCode === 'string' ? req.body.rackCode.trim() : undefined;
    const lowStockThreshold =
      req.body?.lowStockThreshold !== undefined ? Number(req.body.lowStockThreshold) : Number(existing.low_stock_threshold);
    const totalCopies = req.body?.totalCopies !== undefined ? Number(req.body.totalCopies) : Number(existing.total_copies);

    const loanedOut = Number(existing.total_copies) - Number(existing.available_copies);
    if (!Number.isInteger(totalCopies) || totalCopies < loanedOut) {
      res.status(400).json({ error: `Total copies cannot be less than currently loaned copies (${loanedOut}).` });
      return;
    }

    const nextAvailable = totalCopies - loanedOut;

    await db.run(
      `UPDATE books
       SET title = COALESCE(?, title),
           author = COALESCE(?, author),
           category = COALESCE(?, category),
           publisher = COALESCE(?, publisher),
           description = COALESCE(?, description),
           shelf_location = COALESCE(?, shelf_location),
           call_number = COALESCE(?, call_number),
           rack_code = COALESCE(?, rack_code),
           low_stock_threshold = ?,
           total_copies = ?,
           available_copies = ?
       WHERE id = ?`,
      title || null,
      author || null,
      category || null,
      publisher || null,
      description ?? null,
      shelfLocation || null,
      callNumber || null,
      rackCode || null,
      Number.isInteger(lowStockThreshold) && lowStockThreshold >= 0 ? lowStockThreshold : Number(existing.low_stock_threshold),
      totalCopies,
      nextAvailable,
      bookId
    );

    await syncBookCopiesForBook(bookId);

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Updated Catalog Book',
      target: title,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    const book = await db.get('SELECT * FROM books WHERE id = ?', bookId);
    res.json({ book });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/books/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const bookId = Number(req.params.id);
    const existing = await db.get<{ id: number; title: string }>('SELECT id, title FROM books WHERE id = ?', bookId);
    if (!existing) {
      res.status(404).json({ error: 'Book not found.' });
      return;
    }

    const activeRow = await db.get<{ count: number | string }>(
      "SELECT COUNT(*) as count FROM loans WHERE book_id = ? AND status IN ('active', 'overdue')",
      bookId
    );
    if (Number(activeRow?.count ?? 0) > 0) {
      res.status(409).json({ error: 'Cannot delete a book with active or overdue loans.' });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM recommendation_feedback WHERE book_id = ?', bookId);
      await tx.run('DELETE FROM reservations WHERE book_id = ?', bookId);
      await tx.run('DELETE FROM loans WHERE book_id = ?', bookId);
      await tx.run('DELETE FROM book_copies WHERE book_id = ?', bookId);
      await tx.run('DELETE FROM books WHERE id = ?', bookId);
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Removed Book from Catalog',
      target: existing.title,
      severity: 'warning',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/copies', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const bookId = req.query.bookId ? Number(req.query.bookId) : null;

    let sql = `
      SELECT bc.*,
             b.title as book_title, b.author as book_author, b.isbn as book_isbn,
             b.call_number as book_call_number, b.category as book_category,
             (SELECT l.id FROM loans l WHERE l.copy_id = bc.id AND l.status IN ('active','overdue') LIMIT 1) as active_loan_id,
             (SELECT u.full_name FROM loans l JOIN users u ON u.id = l.user_id WHERE l.copy_id = bc.id AND l.status IN ('active','overdue') LIMIT 1) as borrower_name,
             (SELECT u.email FROM loans l JOIN users u ON u.id = l.user_id WHERE l.copy_id = bc.id AND l.status IN ('active','overdue') LIMIT 1) as borrower_email
      FROM book_copies bc
      JOIN books b ON b.id = bc.book_id
      WHERE 1=1
    `;
    const params: Array<string | number> = [];

    if (bookId && Number.isInteger(bookId)) {
      sql += ' AND bc.book_id = ?';
      params.push(bookId);
    }
    if (q) {
      sql += ' AND (LOWER(bc.copy_code) LIKE LOWER(?) OR LOWER(bc.qr_token) LIKE LOWER(?) OR LOWER(b.title) LIKE LOWER(?) OR LOWER(b.isbn) LIKE LOWER(?) OR LOWER(bc.rack_location) LIKE LOWER(?))';
      const pat = `%${q}%`;
      params.push(pat, pat, pat, pat, pat);
    }
    sql += ' ORDER BY b.title ASC, bc.copy_code ASC';

    const copies = await db.all(sql, ...params);
    res.json({ copies });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/copies', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const bookId = Number(req.body?.bookId);
    const rackLocation = typeof req.body?.rackLocation === 'string' ? req.body.rackLocation.trim() : '';
    const conditionStatus = ['new', 'good', 'fair', 'damaged', 'repair'].includes(String(req.body?.conditionStatus))
      ? String(req.body.conditionStatus)
      : 'good';

    const book = await db.get<{ id: number; title: string; shelf_location: string }>(
      'SELECT id, title, shelf_location FROM books WHERE id = ?',
      bookId
    );
    if (!book) {
      res.status(404).json({ error: 'Book not found.' });
      return;
    }

    const existingCountRow = await db.get<{ c: number | string }>('SELECT COUNT(*) as c FROM book_copies WHERE book_id = ?', bookId);
    const suffix = String(Number(existingCountRow?.c ?? 0) + 1).padStart(2, '0');
    const copyCode = `LIB-${String(bookId).padStart(4, '0')}-C${suffix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const qrToken = `SMARTLIB:${copyCode}`;

    const copyId = await db.transaction(async (tx) => {
      const id = await tx.insert(
        `INSERT INTO book_copies (
          book_id, copy_code, qr_token, condition_status, availability_status, rack_location, notes, created_at
        ) VALUES (?, ?, ?, ?, 'available', ?, '', ?)`,
        bookId,
        copyCode,
        qrToken,
        conditionStatus,
        rackLocation || book.shelf_location,
        new Date().toISOString()
      );
      await tx.run('UPDATE books SET total_copies = total_copies + 1, available_copies = available_copies + 1 WHERE id = ?', bookId);
      return id;
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Added Physical Copy',
      target: `${book.title} (${copyCode})`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    const copy = await db.get('SELECT * FROM book_copies WHERE id = ?', copyId);
    res.status(201).json({ copy });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/copies/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const copyId = Number(req.params.id);
    const existing = await db.get<{
      id: number;
      book_id: number;
      copy_code: string;
      availability_status: string;
      condition_status: string;
      rack_location: string;
    }>('SELECT * FROM book_copies WHERE id = ?', copyId);

    if (!existing) {
      res.status(404).json({ error: 'Physical copy not found.' });
      return;
    }

    const conditionStatus = ['new', 'good', 'fair', 'damaged', 'repair'].includes(String(req.body?.conditionStatus))
      ? String(req.body.conditionStatus)
      : existing.condition_status;
    const availabilityStatus = ['available', 'issued', 'reserved', 'lost', 'maintenance'].includes(String(req.body?.availabilityStatus))
      ? String(req.body.availabilityStatus)
      : existing.availability_status;
    const rackLocation = typeof req.body?.rackLocation === 'string' ? req.body.rackLocation.trim() : existing.rack_location;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';

    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE book_copies
         SET condition_status = ?, availability_status = ?, rack_location = ?, notes = ?
         WHERE id = ?`,
        conditionStatus,
        availabilityStatus,
        rackLocation,
        notes,
        copyId
      );

      const availRow = await tx.get<{ c: number | string }>(
        "SELECT COUNT(*) as c FROM book_copies WHERE book_id = ? AND availability_status = 'available'",
        existing.book_id
      );
      const totalRow = await tx.get<{ c: number | string }>(
        "SELECT COUNT(*) as c FROM book_copies WHERE book_id = ? AND availability_status != 'lost'",
        existing.book_id
      );
      const avail = Number(availRow?.c ?? 0);
      const total = Number(totalRow?.c ?? 0);
      await tx.run('UPDATE books SET available_copies = ?, total_copies = ? WHERE id = ?', avail, Math.max(avail, total), existing.book_id);
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Updated Physical Book Copy',
      target: `${existing.copy_code} (${conditionStatus} / ${availabilityStatus})`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/qr/:code', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const raw = decodeURIComponent(String(req.params.code || '')).trim();
    const normalized = raw.startsWith('SMARTLIB:') ? raw : `SMARTLIB:${raw}`;

    const copy = await db.get<{
      id: number;
      book_id: number;
      copy_code: string;
      qr_token: string;
      availability_status: string;
      book_title: string;
    }>(
      `SELECT bc.*, b.title as book_title, b.author as book_author, b.isbn as book_isbn,
              b.call_number as book_call_number, b.category as book_category,
              b.available_copies, b.total_copies, b.shelf_location, b.cover_url
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       WHERE UPPER(bc.qr_token) = UPPER(?) OR UPPER(bc.copy_code) = UPPER(?)
       LIMIT 1`,
      normalized,
      raw
    );

    if (!copy) {
      res.status(404).json({ error: `No physical copy matched QR / Copy Code "${raw}".` });
      return;
    }

    const activeLoan = await db.get(
      `SELECT l.*, u.full_name as borrower_name, u.email as borrower_email, u.student_id as borrower_student_id
       FROM loans l
       JOIN users u ON u.id = l.user_id
       WHERE (l.copy_id = ? OR (l.copy_id IS NULL AND l.book_id = ?)) AND l.status IN ('active', 'overdue')
       ORDER BY l.id DESC
       LIMIT 1`,
      copy.id,
      copy.book_id
    );

    res.json({ copy, activeLoan: activeLoan || null });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/qr/transact', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const rawCode = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const action = req.body?.action === 'return' ? 'return' : 'issue';
    const userId = req.body?.userId ? Number(req.body.userId) : null;

    const normalized = rawCode.startsWith('SMARTLIB:') ? rawCode : `SMARTLIB:${rawCode}`;
    const copy = await db.get<{
      id: number;
      book_id: number;
      copy_code: string;
      availability_status: string;
      book_title: string;
      available_copies: number;
    }>(
      `SELECT bc.*, b.title as book_title, b.available_copies
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       WHERE UPPER(bc.qr_token) = UPPER(?) OR UPPER(bc.copy_code) = UPPER(?)
       LIMIT 1`,
      normalized,
      rawCode
    );

    if (!copy) {
      res.status(404).json({ error: `QR code "${rawCode}" was not recognized.` });
      return;
    }

    const settings = await getSettings();

    if (action === 'issue') {
      if (!userId || !Number.isInteger(userId)) {
        res.status(400).json({ error: 'Select an active student or faculty borrower to complete QR checkout.' });
        return;
      }
      if (copy.availability_status !== 'available') {
        res.status(409).json({ error: `Copy ${copy.copy_code} is currently "${copy.availability_status}" and cannot be issued twice.` });
        return;
      }

      const borrower = await db.get<{
        id: number;
        full_name: string;
        email: string;
        status: string;
        max_loans_override: number | null;
      }>("SELECT id, full_name, email, status, role, max_loans_override FROM users WHERE id = ? AND role = 'student'", userId);

      if (!borrower || borrower.status !== 'active') {
        res.status(400).json({ error: 'Selected member account is not active.' });
        return;
      }

      const existingSameBook = await db.get(
        `SELECT id FROM loans WHERE user_id = ? AND book_id = ? AND status IN ('active', 'overdue')`,
        userId,
        copy.book_id
      );
      if (existingSameBook) {
        res.status(409).json({ error: 'Borrower already has an active checkout for this book title.' });
        return;
      }

      const limit = Number(borrower.max_loans_override ?? settings.max_books_per_student);
      const countRow = await db.get<{ c: number | string }>(
        "SELECT COUNT(*) as c FROM loans WHERE user_id = ? AND status IN ('active','overdue')",
        userId
      );
      if (Number(countRow?.c ?? 0) >= limit) {
        res.status(409).json({ error: `Borrower has reached their borrowing limit (${limit} books).` });
        return;
      }

      const issuedAt = new Date();
      const dueDate = new Date(issuedAt.getTime() + Number(settings.loan_duration_days) * 24 * 60 * 60 * 1000);

      const loanId = await db.transaction(async (tx) => {
        await tx.run(
          "UPDATE book_copies SET availability_status = 'issued' WHERE id = ? AND availability_status = 'available'",
          copy.id
        );
        await tx.run(
          'UPDATE books SET available_copies = CASE WHEN available_copies > 0 THEN available_copies - 1 ELSE 0 END WHERE id = ?',
          copy.book_id
        );
        const id = await tx.insert(
          `INSERT INTO loans (book_id, copy_id, user_id, issued_by, issued_at, due_date, returned_at, renewal_count, renewal_requested, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 'active', ?)`,
          copy.book_id,
          copy.id,
          userId,
          actor.id,
          issuedAt.toISOString(),
          dueDate.toISOString(),
          `QR Checkout (${copy.copy_code})`
        );
        await tx.run(
          "UPDATE reservations SET status = 'fulfilled' WHERE book_id = ? AND user_id = ? AND status IN ('pending','ready')",
          copy.book_id,
          userId
        );
        return id;
      });

      await writeAuditLog({
        actorId: actor.id,
        actorLabel: actor.email,
        action: 'QR Issued Physical Copy',
        target: `${copy.copy_code} (${copy.book_title}) → ${borrower.email}`,
        severity: 'info',
        ipAddress: getClientIp(req),
      });

      res.status(201).json({ ok: true, action: 'issue', loanId, copyCode: copy.copy_code, dueDate: dueDate.toISOString() });
      return;
    }

    const activeLoan = await db.get<{ id: number; user_id: number; due_date: string; borrower_email: string }>(
      `SELECT l.*, u.email as borrower_email
       FROM loans l
       JOIN users u ON u.id = l.user_id
       WHERE (l.copy_id = ? OR (l.copy_id IS NULL AND l.book_id = ?)) AND l.status IN ('active', 'overdue')
       ORDER BY l.id DESC
       LIMIT 1`,
      copy.id,
      copy.book_id
    );

    if (!activeLoan) {
      res.status(409).json({ error: `No active loan found for copy ${copy.copy_code}.` });
      return;
    }

    const now = new Date();
    const msLate = now.getTime() - new Date(activeLoan.due_date).getTime();
    const daysLate = msLate > 0 ? Math.ceil(msLate / (24 * 60 * 60 * 1000)) : 0;
    const fineCents = daysLate * Number(settings.daily_fine_cents);

    await db.transaction(async (tx) => {
      await tx.run("UPDATE loans SET status = 'returned', returned_at = ?, renewal_requested = 0 WHERE id = ?", now.toISOString(), activeLoan.id);
      await tx.run("UPDATE book_copies SET availability_status = 'available' WHERE id = ?", copy.id);
      await tx.run(
        'UPDATE books SET available_copies = CASE WHEN available_copies + 1 < total_copies THEN available_copies + 1 ELSE total_copies END WHERE id = ?',
        copy.book_id
      );
      if (fineCents > 0) {
        await tx.run(
          `INSERT INTO fines (user_id, loan_id, amount_cents, reason, status, created_at, settled_at)
           VALUES (?, ?, ?, ?, 'unpaid', ?, NULL)`,
          activeLoan.user_id,
          activeLoan.id,
          fineCents,
          `Overdue return via QR (${daysLate}d late) — ${copy.book_title}`,
          now.toISOString()
        );
      }
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'QR Returned Physical Copy',
      target: `${copy.copy_code} (${copy.book_title})`,
      severity: fineCents > 0 ? 'warning' : 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, action: 'return', loanId: activeLoan.id, copyCode: copy.copy_code, fineAssessedCents: fineCents, daysLate });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/loans', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await refreshOverdueStatuses();
    const loans = await db.all(`
      SELECT
        l.*,
        b.title as book_title,
        b.isbn as book_isbn,
        b.call_number as book_call_number,
        bc.copy_code as copy_code,
        u.full_name as borrower_name,
        u.email as borrower_email,
        u.student_id as borrower_student_id,
        u.member_type as borrower_type
      FROM loans l
      JOIN books b ON b.id = l.book_id
      LEFT JOIN book_copies bc ON bc.id = l.copy_id
      JOIN users u ON u.id = l.user_id
      ORDER BY
        CASE l.status WHEN 'overdue' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        l.due_date ASC
    `);
    res.json({ loans });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/loans/issue', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const bookId = Number(req.body?.bookId);
    const userId = Number(req.body?.userId);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';

    if (!Number.isInteger(bookId) || !Number.isInteger(userId)) {
      res.status(400).json({ error: 'Please select both a valid borrower and a catalog volume.' });
      return;
    }

    const settings = await getSettings();
    const borrower = await db.get<{
      id: number;
      full_name: string;
      email: string;
      status: string;
      role: string;
      max_loans_override: number | null;
    }>("SELECT id, full_name, email, status, role, max_loans_override FROM users WHERE id = ? AND role = 'student'", userId);

    if (!borrower || borrower.status !== 'active') {
      res.status(400).json({ error: 'Borrower must be an active student or faculty account.' });
      return;
    }

    const existingDuplicate = await db.get(
      "SELECT id FROM loans WHERE user_id = ? AND book_id = ? AND status IN ('active', 'overdue')",
      userId,
      bookId
    );
    if (existingDuplicate) {
      res.status(409).json({ error: 'This member already has an active loan for this volume.' });
      return;
    }

    const maxAllowed = Number(borrower.max_loans_override ?? settings.max_books_per_student);
    const currentLoansRow = await db.get<{ count: number | string }>(
      "SELECT COUNT(*) as count FROM loans WHERE user_id = ? AND status IN ('active', 'overdue')",
      userId
    );
    if (Number(currentLoansRow?.count ?? 0) >= maxAllowed) {
      res.status(409).json({ error: `Borrower has reached their maximum limit of ${maxAllowed} simultaneous books.` });
      return;
    }

    const book = await db.get<{ id: number; title: string; available_copies: number }>(
      'SELECT id, title, available_copies FROM books WHERE id = ?',
      bookId
    );

    if (!book || Number(book.available_copies) < 1) {
      res.status(409).json({ error: 'No available copies of this volume on shelf.' });
      return;
    }

    const customDays = req.body?.days ? Number(req.body.days) : Number(settings.loan_duration_days);
    const loanDays = Number.isInteger(customDays) && customDays >= 1 && customDays <= 90 ? customDays : Number(settings.loan_duration_days);

    const issuedAt = new Date();
    const dueDate = new Date(issuedAt.getTime() + loanDays * 24 * 60 * 60 * 1000);

    const loanId = await db.transaction(async (tx) => {
      const updateRes = await tx.run('UPDATE books SET available_copies = available_copies - 1 WHERE id = ? AND available_copies > 0', bookId);
      if (updateRes.changes === 0) {
        throw new Error('NO_COPIES');
      }

      const availCopy = await tx.get<{ id: number }>(
        "SELECT id FROM book_copies WHERE book_id = ? AND availability_status = 'available' ORDER BY id ASC LIMIT 1",
        bookId
      );
      if (availCopy) {
        await tx.run("UPDATE book_copies SET availability_status = 'issued' WHERE id = ?", availCopy.id);
      }

      const id = await tx.insert(
        `INSERT INTO loans (book_id, copy_id, user_id, issued_by, issued_at, due_date, returned_at, renewal_count, renewal_requested, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 'active', ?)`,
        bookId,
        availCopy?.id ?? null,
        userId,
        actor.id,
        issuedAt.toISOString(),
        dueDate.toISOString(),
        notes
      );

      await tx.run(
        `UPDATE reservations SET status = 'fulfilled'
         WHERE book_id = ? AND user_id = ? AND status IN ('pending', 'ready')`,
        bookId,
        userId
      );

      return id;
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Issued Book',
      target: `${book.title} → ${borrower.email}`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ loanId, dueDate: dueDate.toISOString() });
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_COPIES') {
      res.status(409).json({ error: 'No available copies of this volume on shelf.' });
      return;
    }
    next(err);
  }
});

adminRouter.post('/loans/:id/return', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const loanId = Number(req.params.id);
    const loan = await db.get<{
      id: number;
      book_id: number;
      copy_id: number | null;
      user_id: number;
      due_date: string;
      status: string;
      book_title: string;
      borrower_email: string;
    }>(
      `SELECT l.*, b.title as book_title, u.email as borrower_email
       FROM loans l
       JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = l.user_id
       WHERE l.id = ?`,
      loanId
    );

    if (!loan) {
      res.status(404).json({ error: 'Loan record not found.' });
      return;
    }
    if (loan.status === 'returned') {
      res.status(400).json({ error: 'This loan has already been marked returned.' });
      return;
    }

    const now = new Date();
    const due = new Date(loan.due_date);
    const settings = await getSettings();
    const msLate = now.getTime() - due.getTime();
    const daysLate = msLate > 0 ? Math.ceil(msLate / (24 * 60 * 60 * 1000)) : 0;
    const fineCents = daysLate * Number(settings.daily_fine_cents);

    await db.transaction(async (tx) => {
      await tx.run("UPDATE loans SET status = 'returned', returned_at = ?, renewal_requested = 0 WHERE id = ?", now.toISOString(), loanId);
      if (loan.copy_id) {
        await tx.run("UPDATE book_copies SET availability_status = 'available' WHERE id = ?", loan.copy_id);
      } else {
        const issuedCopy = await tx.get<{ id: number }>(
          "SELECT id FROM book_copies WHERE book_id = ? AND availability_status = 'issued' ORDER BY id ASC LIMIT 1",
          loan.book_id
        );
        if (issuedCopy) {
          await tx.run("UPDATE book_copies SET availability_status = 'available' WHERE id = ?", issuedCopy.id);
        }
      }
      await tx.run(
        'UPDATE books SET available_copies = CASE WHEN available_copies + 1 < total_copies THEN available_copies + 1 ELSE total_copies END WHERE id = ?',
        loan.book_id
      );

      if (fineCents > 0) {
        await tx.run(
          `INSERT INTO fines (user_id, loan_id, amount_cents, reason, status, created_at, settled_at)
           VALUES (?, ?, ?, ?, 'unpaid', ?, NULL)`,
          loan.user_id,
          loanId,
          fineCents,
          `Overdue return (${daysLate} day${daysLate === 1 ? '' : 's'} late) — ${loan.book_title}`,
          now.toISOString()
        );
      }
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Returned Book',
      target: `${loan.book_title} (${loan.borrower_email})${fineCents > 0 ? ` · Fine $${(fineCents / 100).toFixed(2)}` : ''}`,
      severity: fineCents > 0 ? 'warning' : 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, fineAssessedCents: fineCents, daysLate });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/loans/:id/approve-renewal', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const loanId = Number(req.params.id);
    const settings = await getSettings();

    const loan = await db.get<{
      id: number;
      due_date: string;
      renewal_count: number;
      status: string;
      book_title: string;
      borrower_email: string;
    }>(
      `SELECT l.*, b.title as book_title, u.email as borrower_email
       FROM loans l
       JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = l.user_id
       WHERE l.id = ?`,
      loanId
    );

    if (!loan || loan.status === 'returned') {
      res.status(404).json({ error: 'Active loan not found.' });
      return;
    }
    if (Number(loan.renewal_count) >= Number(settings.max_renewals)) {
      res.status(409).json({ error: `Maximum renewal limit (${settings.max_renewals}) reached.` });
      return;
    }

    const baseDate = Math.max(Date.now(), new Date(loan.due_date).getTime());
    const nextDue = new Date(baseDate + Number(settings.loan_duration_days) * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      `UPDATE loans
       SET due_date = ?, renewal_count = renewal_count + 1, renewal_requested = 0, status = 'active'
       WHERE id = ?`,
      nextDue,
      loanId
    );

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Approved Loan Renewal',
      target: `${loan.book_title} (${loan.borrower_email})`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, nextDueDate: nextDue });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/reservations', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const reservations = await db.all<{ id: number; book_id: number; status: string }>(`
      SELECT
        r.*,
        b.title as book_title,
        b.call_number as book_call_number,
        b.available_copies as book_available_copies,
        u.full_name as student_name,
        u.email as student_email,
        u.student_id as student_code
      FROM reservations r
      JOIN books b ON b.id = r.book_id
      JOIN users u ON u.id = r.user_id
      ORDER BY
        CASE r.status WHEN 'pending' THEN 0 WHEN 'ready' THEN 1 ELSE 2 END,
        r.reserved_at ASC
    `);

    const queues = new Map<number, number>();
    const enriched = reservations.map((r) => {
      let queuePosition: number | null = null;
      if (r.status === 'pending' || r.status === 'ready') {
        const next = (queues.get(Number(r.book_id)) ?? 0) + 1;
        queues.set(Number(r.book_id), next);
        queuePosition = next;
      }
      return { ...r, queue_position: queuePosition };
    });

    res.json({ reservations: enriched });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/reservations/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const reservationId = Number(req.params.id);
    const nextStatus = req.body?.status;

    if (!['ready', 'cancelled', 'fulfilled'].includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid reservation status.' });
      return;
    }

    const existing = await db.get<{ id: number; book_title: string; student_email: string }>(
      `SELECT r.*, b.title as book_title, u.email as student_email
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       JOIN users u ON u.id = r.user_id
       WHERE r.id = ?`,
      reservationId
    );

    if (!existing) {
      res.status(404).json({ error: 'Reservation not found.' });
      return;
    }

    const settings = await getSettings();
    const expiresAt =
      nextStatus === 'ready'
        ? new Date(Date.now() + Number(settings.reservation_hold_days) * 24 * 60 * 60 * 1000).toISOString()
        : null;

    await db.run('UPDATE reservations SET status = ?, expires_at = COALESCE(?, expires_at) WHERE id = ?', nextStatus, expiresAt, reservationId);

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: `Reservation Marked ${nextStatus}`,
      target: `${existing.book_title} (${existing.student_email})`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/fines', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const fines = await db.all(`
      SELECT
        f.*,
        u.full_name as student_name,
        u.email as student_email,
        u.student_id as student_code
      FROM fines f
      JOIN users u ON u.id = f.user_id
      ORDER BY
        CASE f.status WHEN 'unpaid' THEN 0 ELSE 1 END,
        f.created_at DESC
    `);
    res.json({ fines });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/fines', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const userId = Number(req.body?.userId);
    const amountDollars = Number(req.body?.amountDollars);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (!Number.isInteger(userId) || !Number.isFinite(amountDollars) || amountDollars <= 0 || amountDollars > 5000 || !reason) {
      res.status(400).json({ error: 'Please provide a valid member, positive fine amount, and reason.' });
      return;
    }

    const amountCents = Math.round(amountDollars * 100);
    const fineId = await db.insert(
      `INSERT INTO fines (user_id, loan_id, amount_cents, reason, status, created_at, settled_at)
       VALUES (?, NULL, ?, ?, 'unpaid', ?, NULL)`,
      userId,
      amountCents,
      reason,
      new Date().toISOString()
    );

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Assessed Manual Fine',
      target: `$${amountDollars.toFixed(2)} — ${reason}`,
      severity: 'warning',
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ fineId });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/fines/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const fineId = Number(req.params.id);
    const action = req.body?.status;

    if (action !== 'paid' && action !== 'waived') {
      res.status(400).json({ error: 'Invalid fine settlement action.' });
      return;
    }

    const fine = await db.get<{ id: number; amount_cents: number; reason: string }>(
      'SELECT id, amount_cents, reason FROM fines WHERE id = ?',
      fineId
    );
    if (!fine) {
      res.status(404).json({ error: 'Fine record not found.' });
      return;
    }

    await db.run('UPDATE fines SET status = ?, settled_at = ? WHERE id = ?', action, new Date().toISOString(), fineId);

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: action === 'paid' ? 'Recorded Fine Payment' : 'Waived Fine',
      target: `$${(Number(fine.amount_cents) / 100).toFixed(2)} — ${fine.reason}`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/users', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const usersRaw = await db.all<Record<string, unknown>>(`
      SELECT
        id, full_name as "fullName", email, student_id as "studentId", member_type as "memberType",
        role, department, phone, status, max_loans_override as "maxLoansOverride",
        failed_attempts as "failedAttempts", locked_until as "lockedUntil",
        last_login_at as "lastLoginAt", created_at as "createdAt"
      FROM users
      ORDER BY
        CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        created_at DESC
    `);

    const passwordResets = await db.all(`
      SELECT
        pr.id, pr.user_id as "userId", pr.status, pr.requested_at as "requestedAt", pr.expires_at as "expiresAt",
        u.full_name as "fullName", u.email, u.student_id as "studentId", u.role
      FROM password_resets pr
      JOIN users u ON u.id = pr.user_id
      WHERE pr.status IN ('requested', 'issued')
      ORDER BY pr.id DESC
    `);

    const users = usersRaw.map((u) => ({
      ...u,
      id: Number(u.id),
      failedAttempts: Number(u.failedAttempts ?? 0),
      lockedUntil: u.lockedUntil !== null && u.lockedUntil !== undefined ? Number(u.lockedUntil) : null,
      maxLoansOverride: u.maxLoansOverride !== null && u.maxLoansOverride !== undefined ? Number(u.maxLoansOverride) : null,
    }));

    res.json({ users, passwordResets });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/users/:id/activity', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = Number(req.params.id);
    const member = await db.get(
      `SELECT id, full_name as "fullName", email, student_id as "studentId", member_type as "memberType",
              role, department, phone, status, max_loans_override as "maxLoansOverride",
              last_login_at as "lastLoginAt", created_at as "createdAt"
       FROM users WHERE id = ?`,
      userId
    );
    if (!member) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }

    const loans = await db.all(
      `SELECT l.*, b.title as book_title, b.call_number as book_call_number, b.isbn as book_isbn
       FROM loans l
       JOIN books b ON b.id = l.book_id
       WHERE l.user_id = ?
       ORDER BY l.issued_at DESC
       LIMIT 40`,
      userId
    );

    const fines = await db.all('SELECT * FROM fines WHERE user_id = ? ORDER BY created_at DESC LIMIT 40', userId);

    const reservations = await db.all(
      `SELECT r.*, b.title as book_title, b.call_number as book_call_number
       FROM reservations r JOIN books b ON b.id = r.book_id
       WHERE r.user_id = ? ORDER BY r.reserved_at DESC LIMIT 20`,
      userId
    );

    res.json({ member, loans, fines, reservations });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/users/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const targetId = Number(req.params.id);
    const target = await db.get<{
      id: number;
      email: string;
      role: string;
      member_type: string;
      full_name: string;
      department: string;
      phone: string;
      max_loans_override: number | null;
    }>('SELECT id, email, role, member_type, full_name, department, phone, max_loans_override FROM users WHERE id = ?', targetId);

    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const fullName =
      typeof req.body?.fullName === 'string' && req.body.fullName.trim().length >= 2
        ? req.body.fullName.trim()
        : target.full_name;
    const department =
      typeof req.body?.department === 'string' && req.body.department.trim()
        ? req.body.department.trim()
        : target.department;
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : target.phone;

    let maxLoansOverride: number | null = target.max_loans_override ?? null;
    if (req.body?.maxLoansOverride === null || req.body?.maxLoansOverride === '') {
      maxLoansOverride = null;
    } else if (req.body?.maxLoansOverride !== undefined) {
      const val = Number(req.body.maxLoansOverride);
      if (!Number.isInteger(val) || val < 1 || val > 50) {
        res.status(400).json({ error: 'Borrowing limit override must be an integer between 1 and 50.' });
        return;
      }
      maxLoansOverride = val;
    }

    let nextMemberType = target.member_type;
    if (target.role === 'student' && (req.body?.memberType === 'student' || req.body?.memberType === 'faculty')) {
      nextMemberType = req.body.memberType;
    }

    await db.run(
      `UPDATE users
       SET full_name = ?, department = ?, phone = ?, member_type = ?, max_loans_override = ?
       WHERE id = ?`,
      fullName,
      department,
      phone,
      nextMemberType,
      maxLoansOverride,
      targetId
    );

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Updated Member Profile & Limits',
      target: `${target.email} (limit: ${maxLoansOverride ?? 'default'})`,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/users', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const memberType = req.body?.memberType;
    const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId.trim().toUpperCase() : '';
    const department = typeof req.body?.department === 'string' ? req.body.department.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const maxLoansOverride =
      req.body?.maxLoansOverride !== undefined && req.body.maxLoansOverride !== ''
        ? Number(req.body.maxLoansOverride)
        : memberType === 'faculty'
          ? 10
          : null;

    if (!['admin', 'librarian', 'student', 'faculty'].includes(memberType)) {
      res.status(400).json({ error: 'Invalid account type.' });
      return;
    }

    const role: 'admin' | 'student' = memberType === 'admin' || memberType === 'librarian' ? 'admin' : 'student';

    if (fullName.length < 2 || fullName.length > 100) {
      res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    if (role === 'student' && !/^[A-Z0-9-]{4,24}$/.test(studentId)) {
      res.status(400).json({ error: 'Student/Faculty ID must be 4–24 alphanumeric characters or hyphens.' });
      return;
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) {
      res.status(400).json({ error: pwError });
      return;
    }

    const dupEmail = await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', email);
    if (dupEmail) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    if (role === 'student') {
      const dupId = await db.get('SELECT id FROM users WHERE UPPER(student_id) = UPPER(?)', studentId);
      if (dupId) {
        res.status(409).json({ error: 'This Student/Faculty ID is already assigned.' });
        return;
      }
    }

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    const userId = await db.insert(
      `INSERT INTO users (
        full_name, email, student_id, member_type, role, department, phone,
        password_hash, status, max_loans_override, failed_attempts, locked_until, token_version, last_login_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, NULL, 1, NULL, ?)`,
      fullName,
      email,
      role === 'student' ? studentId : null,
      memberType,
      role,
      department || (role === 'admin' ? 'Library Administration' : 'General Studies'),
      phone,
      passwordHash,
      maxLoansOverride && Number.isInteger(maxLoansOverride) ? maxLoansOverride : null,
      now
    );

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: `Created ${memberType} Account`,
      target: email,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ userId });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/users/:id/status', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const targetId = Number(req.params.id);
    const nextStatus = req.body?.status;

    if (!['active', 'disabled'].includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid status value.' });
      return;
    }

    if (targetId === actor.id && nextStatus === 'disabled') {
      res.status(400).json({ error: 'You cannot deactivate your own active administrator account.' });
      return;
    }

    const target = await db.get<{ id: number; email: string; role: string; status: string }>(
      'SELECT id, email, role, status FROM users WHERE id = ?',
      targetId
    );

    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE users
         SET status = ?,
             token_version = CASE WHEN ? = 'disabled' THEN token_version + 1 ELSE token_version END,
             failed_attempts = 0,
             locked_until = NULL
         WHERE id = ?`,
        nextStatus,
        nextStatus,
        targetId
      );

      if (nextStatus === 'disabled') {
        await tx.run('DELETE FROM refresh_sessions WHERE user_id = ?', targetId);
      }
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action:
        nextStatus === 'active'
          ? target.status === 'pending'
            ? 'Approved Student Registration'
            : 'Activated Account'
          : 'Deactivated Account',
      target: target.email,
      severity: nextStatus === 'disabled' ? 'warning' : 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/users/:id/unlock', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const targetId = Number(req.params.id);
    const target = await db.get<{ id: number; email: string }>('SELECT id, email FROM users WHERE id = ?', targetId);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    await db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', targetId);

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Unlocked Account',
      target: target.email,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/users/:id/issue-reset-code', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const targetId = Number(req.params.id);

    const target = await db.get<{ id: number; email: string; status: string }>(
      'SELECT id, email, status FROM users WHERE id = ?',
      targetId
    );

    if (!target || target.status === 'disabled') {
      res.status(404).json({ error: 'Active or pending user account not found.' });
      return;
    }

    const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = Date.now() + 30 * 60 * 1000;

    await db.transaction(async (tx) => {
      await tx.run("UPDATE password_resets SET status = 'cancelled' WHERE user_id = ? AND status IN ('requested', 'issued')", targetId);
      await tx.run(
        `INSERT INTO password_resets (user_id, code_hash, status, expires_at, requested_at, issued_by)
         VALUES (?, ?, 'issued', ?, ?, ?)`,
        targetId,
        hashToken(rawCode),
        expiresAt,
        new Date().toISOString(),
        actor.id
      );
    });

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Issued One-Time Password Reset Code',
      target: target.email,
      severity: 'warning',
      ipAddress: getClientIp(req),
    });

    res.json({
      resetCode: rawCode,
      expiresAt,
      email: target.email,
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/digital-resources', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const resources = await db.all(`
      SELECT id, title, author, category, description, resource_type, file_path, external_url, access_level, created_at,
             CASE WHEN file_path != '' OR file_data != '' THEN 1 ELSE 0 END as has_file
      FROM digital_resources
      ORDER BY created_at DESC
    `);
    res.json({ resources });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/digital-resources', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const author = typeof req.body?.author === 'string' ? req.body.author.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const resourceType = ['pdf', 'ebook', 'guide', 'journal'].includes(String(req.body?.resourceType))
      ? String(req.body.resourceType)
      : 'pdf';
    const accessLevel = ['all', 'student', 'faculty', 'admin'].includes(String(req.body?.accessLevel))
      ? String(req.body.accessLevel)
      : 'all';
    const externalUrlRaw = typeof req.body?.externalUrl === 'string' ? req.body.externalUrl.trim() : '';
    const dataBase64 = typeof req.body?.fileBase64 === 'string' ? req.body.fileBase64.trim() : '';

    if (!title || !author || !category) {
      res.status(400).json({ error: 'Title, Author, and Subject Category are required.' });
      return;
    }

    let safeExternalUrl = '';
    if (externalUrlRaw) {
      try {
        const u = new URL(externalUrlRaw);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          res.status(400).json({ error: 'External resource URL must use HTTP or HTTPS.' });
          return;
        }
        safeExternalUrl = u.toString();
      } catch {
        res.status(400).json({ error: 'Invalid external resource URL.' });
        return;
      }
    }

    let storedFilename = '';
    let fileData = '';
    if (dataBase64) {
      const cleanB64 = dataBase64.replace(/^data:application\/pdf;base64,/, '');
      const buffer = Buffer.from(cleanB64, 'base64');
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
        res.status(400).json({ error: 'PDF upload must be non-empty and under 10 MB.' });
        return;
      }
      if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        res.status(400).json({ error: 'Uploaded digital document must be a valid PDF file.' });
        return;
      }
      storedFilename = `${crypto.randomUUID()}.pdf`;
      fileData = buffer.toString('base64');

      if (!process.env.VERCEL && !process.env.DATABASE_URL) {
        const targetPath = path.resolve(resourcesUploadDir, storedFilename);
        if (targetPath.startsWith(resourcesUploadDir + path.sep)) {
          fs.writeFileSync(targetPath, buffer);
        }
      }
    }

    if (!storedFilename && !safeExternalUrl) {
      res.status(400).json({ error: 'Provide either a PDF file upload or a valid HTTPS resource URL.' });
      return;
    }

    const resourceId = await db.insert(
      `INSERT INTO digital_resources (
        title, author, category, description, resource_type, file_path, file_data, external_url, access_level, uploaded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title,
      author,
      category,
      description,
      resourceType,
      storedFilename,
      fileData,
      safeExternalUrl,
      accessLevel,
      actor.id,
      new Date().toISOString()
    );

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Added Digital Library Resource',
      target: title,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ resourceId });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/digital-resources/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const id = Number(req.params.id);
    const existing = await db.get<{ id: number; title: string; file_path: string }>(
      'SELECT id, title, file_path FROM digital_resources WHERE id = ?',
      id
    );
    if (!existing) {
      res.status(404).json({ error: 'Digital resource not found.' });
      return;
    }

    await db.run('DELETE FROM digital_resources WHERE id = ?', id);
    if (!process.env.VERCEL && !process.env.DATABASE_URL && existing.file_path) {
      const resolved = path.resolve(resourcesUploadDir, existing.file_path);
      if (resolved.startsWith(resourcesUploadDir + path.sep) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    }

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Removed Digital Resource',
      target: existing.title,
      severity: 'warning',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/announcements', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const announcements = await db.all(`
      SELECT a.*, u.full_name as created_by_name
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      ORDER BY a.id DESC
      LIMIT 30
    `);
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/announcements', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const priority = ['normal', 'important', 'urgent'].includes(String(req.body?.priority))
      ? String(req.body.priority)
      : 'normal';
    const targetRole = ['all', 'student', 'faculty', 'admin'].includes(String(req.body?.targetRole))
      ? String(req.body.targetRole)
      : 'all';

    if (!title || !message) {
      res.status(400).json({ error: 'Announcement title and message are required.' });
      return;
    }

    const announcementId = await db.insert(
      `INSERT INTO announcements (title, message, priority, target_role, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      title.slice(0, 140),
      message.slice(0, 1200),
      priority,
      targetRole,
      actor.id,
      new Date().toISOString()
    );

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Published Library Announcement',
      target: title,
      severity: priority === 'urgent' ? 'warning' : 'info',
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ announcementId });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/announcements/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await db.run('DELETE FROM announcements WHERE id = ?', id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/settings', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const settings = await getSettings();
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/settings', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const actor = req.authUser!;
    const current = await getSettings();

    const libraryName =
      typeof req.body?.library_name === 'string' && req.body.library_name.trim()
        ? req.body.library_name.trim().slice(0, 80)
        : current.library_name;

    const loanDurationDays = Number(req.body?.loan_duration_days ?? current.loan_duration_days);
    const maxBooksPerStudent = Number(req.body?.max_books_per_student ?? current.max_books_per_student);
    const maxRenewals = Number(req.body?.max_renewals ?? current.max_renewals);
    const dailyFineCents = Number(req.body?.daily_fine_cents ?? current.daily_fine_cents);
    const reservationHoldDays = Number(req.body?.reservation_hold_days ?? current.reservation_hold_days);
    const allowSelfRegistration = req.body?.allow_self_registration ? 1 : 0;
    const maxFailedLogins = Number(req.body?.max_failed_logins ?? current.max_failed_logins);
    const lockoutMinutes = Number(req.body?.lockout_minutes ?? current.lockout_minutes);

    if (
      !Number.isInteger(loanDurationDays) || loanDurationDays < 1 || loanDurationDays > 90 ||
      !Number.isInteger(maxBooksPerStudent) || maxBooksPerStudent < 1 || maxBooksPerStudent > 30 ||
      !Number.isInteger(maxRenewals) || maxRenewals < 0 || maxRenewals > 10 ||
      !Number.isInteger(dailyFineCents) || dailyFineCents < 0 || dailyFineCents > 5000 ||
      !Number.isInteger(reservationHoldDays) || reservationHoldDays < 1 || reservationHoldDays > 14 ||
      !Number.isInteger(maxFailedLogins) || maxFailedLogins < 3 || maxFailedLogins > 15 ||
      !Number.isInteger(lockoutMinutes) || lockoutMinutes < 1 || lockoutMinutes > 120
    ) {
      res.status(400).json({ error: 'One or more settings values are outside allowed operational bounds.' });
      return;
    }

    await db.run(
      `UPDATE library_settings
       SET library_name = ?,
           loan_duration_days = ?,
           max_books_per_student = ?,
           max_renewals = ?,
           daily_fine_cents = ?,
           reservation_hold_days = ?,
           allow_self_registration = ?,
           max_failed_logins = ?,
           lockout_minutes = ?
       WHERE id = 1`,
      libraryName,
      loanDurationDays,
      maxBooksPerStudent,
      maxRenewals,
      dailyFineCents,
      reservationHoldDays,
      allowSelfRegistration,
      maxFailedLogins,
      lockoutMinutes
    );

    await writeAuditLog({
      actorId: actor.id,
      actorLabel: actor.email,
      action: 'Updated Library Policy Settings',
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ settings: await getSettings() });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/audit-logs', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const severity = typeof req.query.severity === 'string' ? req.query.severity.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    let sql = `
      SELECT id, actor_label as "actorLabel", action, target, severity, ip_address as "ipAddress", created_at as "createdAt"
      FROM audit_logs
      WHERE 1=1
    `;
    const params: string[] = [];
    if (severity && ['info', 'warning', 'alert'].includes(severity)) {
      sql += ' AND severity = ?';
      params.push(severity);
    }
    if (q) {
      sql += ' AND (LOWER(actor_label) LIKE LOWER(?) OR LOWER(action) LIKE LOWER(?) OR LOWER(target) LIKE LOWER(?))';
      const pat = `%${q}%`;
      params.push(pat, pat, pat);
    }
    sql += ' ORDER BY id DESC LIMIT 120';

    const logs = await db.all(sql, ...params);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});
