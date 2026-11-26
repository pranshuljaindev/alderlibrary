import fs from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Response } from 'express';
import { buildMinimalValidPdf, db, getSettings, resourcesUploadDir, writeAuditLog } from '../db.ts';
import {
  getClientIp,
  requireAuth,
  requireRole,
  sanitizeUser,
  type AuthenticatedRequest,
  type AuthUserRecord,
} from '../security.ts';

export const studentRouter = Router();

studentRouter.use(requireAuth, requireRole('student'));

async function refreshStudentOverdue(userId: number): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.run(
    `UPDATE loans
     SET status = 'overdue'
     WHERE user_id = ? AND status = 'active' AND due_date < ?`,
    userId,
    nowIso
  );
}

studentRouter.get('/overview', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    await refreshStudentOverdue(student.id);
    const settings = await getSettings();

    const activeLoans = await db.all<{ due_date: string; status: string }>(
      `SELECT
         l.*,
         b.title as book_title,
         b.author as book_author,
         b.category as book_category,
         b.isbn as book_isbn,
         b.call_number as book_call_number,
         b.shelf_location as book_shelf_location,
         b.cover_url as book_cover_url
       FROM loans l
       JOIN books b ON b.id = l.book_id
       WHERE l.user_id = ? AND l.status IN ('active', 'overdue')
       ORDER BY l.due_date ASC`,
      student.id
    );

    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const dueSoonCount = activeLoans.filter((l) => {
      const dueMs = new Date(l.due_date).getTime();
      return l.status === 'overdue' || dueMs - now <= threeDaysMs;
    }).length;

    const activeResRow = await db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM reservations WHERE user_id = ? AND status IN ('pending', 'ready')`,
      student.id
    );
    const readyResRow = await db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM reservations WHERE user_id = ? AND status = 'ready'`,
      student.id
    );
    const unpaidFinesRow = await db.get<{ total: number | string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM fines WHERE user_id = ? AND status = 'unpaid'`,
      student.id
    );
    const totalBorrowedRow = await db.get<{ count: number | string }>(
      `SELECT COUNT(*) as count FROM loans WHERE user_id = ?`,
      student.id
    );

    const maxBooksAllowed = Number(student.max_loans_override ?? settings.max_books_per_student);

    res.json({
      summary: {
        activeLoansCount: activeLoans.length,
        dueSoonCount,
        activeReservationsCount: Number(activeResRow?.count ?? 0),
        readyReservationsCount: Number(readyResRow?.count ?? 0),
        unpaidFinesCents: Number(unpaidFinesRow?.total ?? 0),
        totalBorrowedCount: Number(totalBorrowedRow?.count ?? 0),
        maxBooksAllowed,
        maxRenewalsAllowed: Number(settings.max_renewals),
      },
      activeLoans,
    });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/books', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const availableOnly = req.query.availableOnly === 'true';

    let query = `
      SELECT
        b.*,
        CAST((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS INTEGER) as borrow_count,
        CAST((SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending', 'ready')) AS INTEGER) as active_reservation_count
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
    if (availableOnly) {
      query += ' AND b.available_copies > 0';
    }
    query += ' ORDER BY b.title ASC';

    const books = await db.all(query, ...params);
    const categories = await db.all<{ category: string }>('SELECT DISTINCT category FROM books ORDER BY category ASC');

    res.json({
      books,
      categories: categories.map((c) => c.category),
    });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/loans', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    await refreshStudentOverdue(student.id);
    const settings = await getSettings();

    const loans = await db.all(
      `SELECT
         l.*,
         b.title as book_title,
         b.author as book_author,
         b.category as book_category,
         b.isbn as book_isbn,
         b.call_number as book_call_number,
         b.shelf_location as book_shelf_location,
         b.cover_url as book_cover_url
       FROM loans l
       JOIN books b ON b.id = l.book_id
       WHERE l.user_id = ?
       ORDER BY
         CASE l.status WHEN 'overdue' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
         l.issued_at DESC`,
      student.id
    );

    res.json({ loans, maxRenewals: Number(settings.max_renewals) });
  } catch (err) {
    next(err);
  }
});

studentRouter.post('/loans/:id/request-renewal', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const loanId = Number(req.params.id);
    if (!Number.isInteger(loanId)) {
      res.status(400).json({ error: 'Invalid loan identifier.' });
      return;
    }

    const settings = await getSettings();

    const loan = await db.get<{
      id: number;
      status: string;
      renewal_count: number;
      renewal_requested: number;
      book_title: string;
    }>(
      `SELECT l.*, b.title as book_title
       FROM loans l
       JOIN books b ON b.id = l.book_id
       WHERE l.id = ? AND l.user_id = ?`,
      loanId,
      student.id
    );

    if (!loan) {
      res.status(404).json({ error: 'Loan record not found.' });
      return;
    }
    if (loan.status === 'returned') {
      res.status(400).json({ error: 'Returned books cannot be renewed.' });
      return;
    }
    if (loan.status === 'overdue') {
      res.status(409).json({ error: 'Overdue loans cannot be renewed online. Please visit the circulation desk.' });
      return;
    }
    if (Number(loan.renewal_count) >= Number(settings.max_renewals)) {
      res.status(409).json({ error: `You have reached the maximum of ${settings.max_renewals} renewals for this volume.` });
      return;
    }
    if (Number(loan.renewal_requested) === 1) {
      res.status(409).json({ error: 'A renewal request is already pending librarian review.' });
      return;
    }

    await db.run('UPDATE loans SET renewal_requested = 1 WHERE id = ? AND user_id = ?', loanId, student.id);

    await writeAuditLog({
      actorId: student.id,
      actorLabel: student.email,
      action: 'Requested Loan Renewal',
      target: loan.book_title,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, message: 'Renewal request submitted for librarian approval.' });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/reservations', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const reservations = await db.all<{
      id: number;
      book_id: number;
      status: string;
      book_available_copies: number;
    }>(
      `SELECT
         r.*,
         b.title as book_title,
         b.author as book_author,
         b.category as book_category,
         b.call_number as book_call_number,
         b.available_copies as book_available_copies,
         b.cover_url as book_cover_url
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       WHERE r.user_id = ?
       ORDER BY r.reserved_at DESC`,
      student.id
    );

    const enriched = await Promise.all(
      reservations.map(async (r) => {
        let queuePosition: number | null = null;
        let estimatedAvailability = '';

        if (r.status === 'ready') {
          queuePosition = 1;
          estimatedAvailability = 'Ready at Circulation Desk';
        } else if (r.status === 'pending') {
          const posRow = await db.get<{ pos: number | string }>(
            `SELECT COUNT(*) as pos FROM reservations
             WHERE book_id = ? AND status IN ('pending', 'ready') AND id <= ?`,
            r.book_id,
            r.id
          );
          queuePosition = Number(posRow?.pos ?? 1);

          if (Number(r.book_available_copies) > 0 && queuePosition <= Number(r.book_available_copies)) {
            estimatedAvailability = 'Copy on shelf — awaiting desk hold confirmation';
          } else {
            const nextDue = await db.get<{ due_date: string }>(
              `SELECT due_date FROM loans
               WHERE book_id = ? AND status IN ('active', 'overdue')
               ORDER BY due_date ASC LIMIT 1`,
              r.book_id
            );

            if (nextDue) {
              const d = new Date(nextDue.due_date);
              estimatedAvailability = `Est. return by ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            } else {
              estimatedAvailability = 'Estimated 2–4 business days';
            }
          }
        }

        return {
          ...r,
          queue_position: queuePosition,
          estimated_availability: estimatedAvailability,
        };
      })
    );

    res.json({ reservations: enriched });
  } catch (err) {
    next(err);
  }
});

studentRouter.post('/reservations', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const bookId = Number(req.body?.bookId);

    if (!Number.isInteger(bookId)) {
      res.status(400).json({ error: 'Invalid catalog book selected.' });
      return;
    }

    const book = await db.get<{ id: number; title: string }>('SELECT id, title FROM books WHERE id = ?', bookId);
    if (!book) {
      res.status(404).json({ error: 'Book not found in catalog.' });
      return;
    }

    const existingRes = await db.get(
      `SELECT id FROM reservations WHERE user_id = ? AND book_id = ? AND status IN ('pending', 'ready')`,
      student.id,
      bookId
    );
    if (existingRes) {
      res.status(409).json({ error: 'You already have an active reservation for this book.' });
      return;
    }

    const existingLoan = await db.get(
      `SELECT id FROM loans WHERE user_id = ? AND book_id = ? AND status IN ('active', 'overdue')`,
      student.id,
      bookId
    );
    if (existingLoan) {
      res.status(409).json({ error: 'You currently have this book checked out.' });
      return;
    }

    const unpaidRow = await db.get<{ total: number | string }>(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM fines WHERE user_id = ? AND status = 'unpaid'",
      student.id
    );
    if (Number(unpaidRow?.total ?? 0) >= 2500) {
      res.status(403).json({ error: 'Reservations are paused when unpaid fines reach $25.00 or more.' });
      return;
    }

    const now = new Date().toISOString();
    const reservationId = await db.insert(
      `INSERT INTO reservations (book_id, user_id, status, reserved_at, expires_at)
       VALUES (?, ?, 'pending', ?, NULL)`,
      bookId,
      student.id,
      now
    );

    await writeAuditLog({
      actorId: student.id,
      actorLabel: student.email,
      action: 'Reserved Book',
      target: book.title,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ reservationId });
  } catch (err) {
    next(err);
  }
});

studentRouter.delete('/reservations/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const reservationId = Number(req.params.id);
    if (!Number.isInteger(reservationId)) {
      res.status(400).json({ error: 'Invalid reservation identifier.' });
      return;
    }

    const existing = await db.get<{ id: number; status: string; book_title: string }>(
      `SELECT r.id, r.status, b.title as book_title
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       WHERE r.id = ? AND r.user_id = ?`,
      reservationId,
      student.id
    );

    if (!existing) {
      res.status(404).json({ error: 'Reservation not found.' });
      return;
    }
    if (!['pending', 'ready'].includes(existing.status)) {
      res.status(400).json({ error: 'Only pending or ready reservations can be cancelled.' });
      return;
    }

    await db.run("UPDATE reservations SET status = 'cancelled' WHERE id = ? AND user_id = ?", reservationId, student.id);

    await writeAuditLog({
      actorId: student.id,
      actorLabel: student.email,
      action: 'Cancelled Reservation',
      target: existing.book_title,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/fines', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const fines = await db.all('SELECT * FROM fines WHERE user_id = ? ORDER BY created_at DESC', student.id);

    const unpaidRow = await db.get<{ total: number | string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM fines WHERE user_id = ? AND status = 'unpaid'`,
      student.id
    );

    res.json({ fines, totalUnpaidCents: Number(unpaidRow?.total ?? 0) });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/recommendations', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const feedbackRows = await db.all<{ book_id: number; feedback: 'like' | 'dislike'; note: string; category: string }>(
      `SELECT rf.book_id, rf.feedback, rf.note, b.category
       FROM recommendation_feedback rf
       JOIN books b ON b.id = rf.book_id
       WHERE rf.user_id = ?`,
      student.id
    );

    const feedbackMap: Record<number, 'like' | 'dislike'> = {};
    const dislikedIds = new Set<number>();
    const likedCats = new Set<string>();

    for (const row of feedbackRows) {
      feedbackMap[Number(row.book_id)] = row.feedback;
      if (row.feedback === 'dislike') dislikedIds.add(Number(row.book_id));
      if (row.feedback === 'like') likedCats.add(row.category);
    }

    const loanCats = await db.all<{ category: string }>(
      `SELECT b.category FROM loans l JOIN books b ON b.id = l.book_id WHERE l.user_id = ?`,
      student.id
    );
    const preferredCats = new Set([...loanCats.map((c) => c.category), ...likedCats]);

    const books = await db.all<{
      id: number;
      category: string;
      available_copies: number;
      borrow_count: number | string;
    }>(
      `SELECT b.*,
              CAST((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS INTEGER) as borrow_count,
              CAST((SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending','ready')) AS INTEGER) as active_reservation_count
       FROM books b`
    );

    const ranked = books
      .filter((b) => !dislikedIds.has(Number(b.id)))
      .map((b) => {
        let score = Number(b.borrow_count) * 2 + (Number(b.available_copies) > 0 ? 3 : 0);
        if (preferredCats.has(b.category)) score += 7;
        if (feedbackMap[Number(b.id)] === 'like') score += 4;
        return { ...b, borrow_count: Number(b.borrow_count), score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    res.json({ recommendations: ranked, feedbackMap });
  } catch (err) {
    next(err);
  }
});

studentRouter.post('/recommendations/feedback', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const bookId = Number(req.body?.bookId);
    const feedback = req.body?.feedback;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';

    if (!Number.isInteger(bookId) || !['like', 'dislike', 'clear'].includes(feedback)) {
      res.status(400).json({ error: 'Invalid recommendation feedback payload.' });
      return;
    }

    if (feedback === 'clear') {
      await db.run('DELETE FROM recommendation_feedback WHERE user_id = ? AND book_id = ?', student.id, bookId);
      res.json({ ok: true, feedback: null });
      return;
    }

    await db.run(
      `INSERT INTO recommendation_feedback (user_id, book_id, feedback, note, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, book_id) DO UPDATE SET feedback = excluded.feedback, note = excluded.note, created_at = excluded.created_at`,
      student.id,
      bookId,
      feedback,
      note,
      new Date().toISOString()
    );

    res.json({ ok: true, feedback });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/digital-resources', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const allowedLevels = student.member_type === 'faculty' ? ['all', 'student', 'faculty'] : ['all', 'student'];
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

    let sql = `
      SELECT id, title, author, category, description, resource_type, file_path, external_url, access_level, created_at,
             CASE WHEN file_path != '' OR file_data != '' THEN 1 ELSE 0 END as has_file
      FROM digital_resources
      WHERE access_level IN (${allowedLevels.map(() => '?').join(',')})
    `;
    const params: string[] = [...allowedLevels];

    if (q) {
      sql += ' AND (LOWER(title) LIKE LOWER(?) OR LOWER(author) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?))';
      const pat = `%${q}%`;
      params.push(pat, pat, pat, pat);
    }
    if (category && category !== 'all') {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY created_at DESC';

    const resources = await db.all(sql, ...params);
    res.json({ resources });
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/digital-resources/:id/file', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid resource identifier.' });
      return;
    }

    const allowedLevels = student.member_type === 'faculty' ? ['all', 'student', 'faculty'] : ['all', 'student'];

    const resource = await db.get<{
      id: number;
      title: string;
      author: string;
      category: string;
      description: string;
      file_path: string;
      file_data: string;
      access_level: string;
    }>(
      `SELECT id, title, author, category, description, file_path, file_data, access_level
       FROM digital_resources
       WHERE id = ? AND access_level IN (${allowedLevels.map(() => '?').join(',')})`,
      id,
      ...allowedLevels
    );

    if (!resource || (!resource.file_path && !resource.file_data)) {
      res.status(404).json({ error: 'Authorized digital document not found.' });
      return;
    }

    const safeDownloadName = resource.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64) + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeDownloadName}"`);

    if (resource.file_data) {
      res.send(Buffer.from(resource.file_data, 'base64'));
      return;
    }

    if (!process.env.VERCEL && resource.file_path) {
      const safePath = path.resolve(resourcesUploadDir, resource.file_path);
      if (safePath.startsWith(resourcesUploadDir + path.sep) && fs.existsSync(safePath)) {
        res.sendFile(safePath);
        return;
      }
    }

    // Dynamic fallback PDF from metadata if seeded resource lacks disk file in serverless
    const fallbackPdf = buildMinimalValidPdf(
      resource.title,
      resource.author,
      resource.category,
      [resource.description || 'Authorized Smart Library Digital Study Resource.']
    );
    res.send(fallbackPdf);
  } catch (err) {
    next(err);
  }
});

studentRouter.get('/announcements', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;
    const targets = student.member_type === 'faculty' ? ['all', 'faculty', 'student'] : ['all', 'student'];
    const announcements = await db.all(
      `SELECT id, title, message, priority, target_role, created_at
       FROM announcements
       WHERE target_role IN (${targets.map(() => '?').join(',')})
       ORDER BY id DESC
       LIMIT 20`,
      ...targets
    );
    res.json({ announcements });
  } catch (err) {
    next(err);
  }
});

studentRouter.patch('/profile', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const student = req.authUser!;

    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : student.full_name;
    const department = typeof req.body?.department === 'string' ? req.body.department.trim() : student.department;
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : student.phone;

    if (fullName.length < 2 || fullName.length > 100) {
      res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
      return;
    }
    if (department.length < 2 || department.length > 80) {
      res.status(400).json({ error: 'Department must be between 2 and 80 characters.' });
      return;
    }
    if (phone.length > 30) {
      res.status(400).json({ error: 'Phone number is too long.' });
      return;
    }

    await db.run(`UPDATE users SET full_name = ?, department = ?, phone = ? WHERE id = ?`, fullName, department, phone, student.id);

    const updated = (await db.get<AuthUserRecord>(
      `SELECT id, full_name, email, student_id, member_type, role, department, phone, status, max_loans_override, token_version, last_login_at, created_at
       FROM users WHERE id = ?`,
      student.id
    ))!;

    await writeAuditLog({
      actorId: student.id,
      actorLabel: student.email,
      action: 'Updated Student Profile',
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    next(err);
  }
});
