import fs from 'node:fs';
import path from 'node:path';
import type { Pool as PgPoolType, PoolClient } from 'pg';

export class DatabaseConfigurationError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
    this.status = 503;
  }
}

export interface DbExecutor {
  driver: 'postgres' | 'sqlite';
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  insert(sql: string, ...params: unknown[]): Promise<number>;
  exec(sql: string): Promise<void>;
}

/**
 * Translates SQLite-style `?` positional parameters into PostgreSQL `$1, $2, ...`
 * while skipping `?` characters inside single-quoted string literals.
 */
function toPostgresPlaceholders(sql: string): string {
  let out = '';
  let idx = 1;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }
    if (ch === '?' && !inSingleQuote) {
      out += `$${idx++}`;
      continue;
    }
    out += ch;
  }
  return out;
}

const isVercelEnv = Boolean(process.env.VERCEL);
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim() || '';

let pgPool: PgPoolType | null = null;
let sqliteDb: import('better-sqlite3').Database | null = null;
let initPromise: Promise<void> | null = null;

// Local directories only used when running on a local Node filesystem with SQLite
const dataDir = path.resolve(process.cwd(), 'data');
export const uploadsBaseDir = path.join(dataDir, 'uploads');
export const coversUploadDir = path.join(uploadsBaseDir, 'covers');
export const resourcesUploadDir = path.join(uploadsBaseDir, 'resources');

function getActiveDriver(): 'postgres' | 'sqlite' {
  if (configuredDatabaseUrl) return 'postgres';
  if (isVercelEnv) {
    throw new DatabaseConfigurationError(
      'Database is not configured for serverless deployment. Set DATABASE_URL (PostgreSQL) in Vercel Environment Variables.'
    );
  }
  return 'sqlite';
}

async function getPgPool(): Promise<PgPoolType> {
  if (!configuredDatabaseUrl) {
    throw new DatabaseConfigurationError('DATABASE_URL environment variable is not set.');
  }
  if (!pgPool) {
    const { Pool } = await import('pg');
    const isLocalHost =
      configuredDatabaseUrl.includes('localhost') || configuredDatabaseUrl.includes('127.0.0.1');
    const disableSsl = configuredDatabaseUrl.includes('sslmode=disable') || isLocalHost;

    pgPool = new Pool({
      connectionString: configuredDatabaseUrl,
      ssl: disableSsl ? false : { rejectUnauthorized: false },
      max: isVercelEnv ? 5 : 10,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pgPool;
}

async function getSqliteDb(): Promise<import('better-sqlite3').Database> {
  if (isVercelEnv) {
    throw new DatabaseConfigurationError(
      'SQLite filesystem storage is unsupported in Vercel serverless functions. Configure DATABASE_URL for PostgreSQL.'
    );
  }
  if (!sqliteDb) {
    for (const dir of [dataDir, uploadsBaseDir, coversUploadDir, resourcesUploadDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    sqliteDb = new Database(path.join(dataDir, 'library.db'));
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
  }
  return sqliteDb;
}

function createPgExecutor(runner: PoolClient | PgPoolType): DbExecutor {
  return {
    driver: 'postgres',
    async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const res = await runner.query(toPostgresPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const res = await runner.query(toPostgresPlaceholders(sql), params);
      return res.rows as T[];
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const res = await runner.query(toPostgresPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async insert(sql: string, ...params: unknown[]): Promise<number> {
      const trimmed = sql.trim().replace(/;$/, '');
      const hasReturning = /\bRETURNING\b/i.test(trimmed);
      const finalSql = hasReturning ? trimmed : `${trimmed} RETURNING id`;
      const res = await runner.query(toPostgresPlaceholders(finalSql), params);
      return Number((res.rows[0] as { id?: number | string } | undefined)?.id ?? 0);
    },
    async exec(sql: string): Promise<void> {
      await runner.query(sql);
    },
  };
}

function createSqliteExecutor(instance: import('better-sqlite3').Database): DbExecutor {
  return {
    driver: 'sqlite',
    async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      return instance.prepare(sql).get(...params) as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return instance.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const info = instance.prepare(sql).run(...params);
      return { changes: info.changes };
    },
    async insert(sql: string, ...params: unknown[]): Promise<number> {
      const info = instance.prepare(sql).run(...params);
      return Number(info.lastInsertRowid);
    },
    async exec(sql: string): Promise<void> {
      instance.exec(sql);
    },
  };
}

export const db = {
  get driver(): 'postgres' | 'sqlite' {
    return getActiveDriver();
  },

  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    if (getActiveDriver() === 'postgres') {
      const pool = await getPgPool();
      return createPgExecutor(pool).get<T>(sql, ...params);
    }
    const sq = await getSqliteDb();
    return createSqliteExecutor(sq).get<T>(sql, ...params);
  },

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    if (getActiveDriver() === 'postgres') {
      const pool = await getPgPool();
      return createPgExecutor(pool).all<T>(sql, ...params);
    }
    const sq = await getSqliteDb();
    return createSqliteExecutor(sq).all<T>(sql, ...params);
  },

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    if (getActiveDriver() === 'postgres') {
      const pool = await getPgPool();
      return createPgExecutor(pool).run(sql, ...params);
    }
    const sq = await getSqliteDb();
    return createSqliteExecutor(sq).run(sql, ...params);
  },

  async insert(sql: string, ...params: unknown[]): Promise<number> {
    if (getActiveDriver() === 'postgres') {
      const pool = await getPgPool();
      return createPgExecutor(pool).insert(sql, ...params);
    }
    const sq = await getSqliteDb();
    return createSqliteExecutor(sq).insert(sql, ...params);
  },

  async exec(sql: string): Promise<void> {
    if (getActiveDriver() === 'postgres') {
      const pool = await getPgPool();
      await createPgExecutor(pool).exec(sql);
      return;
    }
    const sq = await getSqliteDb();
    await createSqliteExecutor(sq).exec(sql);
  },

  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    if (getActiveDriver() === 'postgres') {
      const pool = await getPgPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(createPgExecutor(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    const sq = await getSqliteDb();
    sq.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(createSqliteExecutor(sq));
      sq.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        sq.exec('ROLLBACK');
      } catch {
        // Ignore rollback failure if already rolled back
      }
      throw err;
    }
  },

  async ping(): Promise<{ ok: boolean; driver: 'postgres' | 'sqlite'; error?: string }> {
    try {
      const drv = getActiveDriver();
      if (drv === 'postgres') {
        const pool = await getPgPool();
        await pool.query('SELECT 1');
        return { ok: true, driver: 'postgres' };
      }
      const sq = await getSqliteDb();
      sq.prepare('SELECT 1').get();
      return { ok: true, driver: 'sqlite' };
    } catch (err) {
      return {
        ok: false,
        driver: configuredDatabaseUrl ? 'postgres' : 'sqlite',
        error: err instanceof Error ? err.message : 'Database connection failed',
      };
    }
  },
};

export function buildMinimalValidPdf(title: string, author: string, category: string, bodyLines: string[]): Buffer {
  const escapePdfText = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, ' ');

  const lines: string[] = [
    'BT',
    '/F1 18 Tf',
    '54 740 Td',
    `(${escapePdfText(title)}) Tj`,
    '/F1 11 Tf',
    '0 -24 Td',
    `(Author: ${escapePdfText(author)} | Subject: ${escapePdfText(category)}) Tj`,
    '0 -28 Td',
  ];

  for (const line of bodyLines) {
    lines.push(`(${escapePdfText(line)}) Tj`);
    lines.push('0 -18 Td');
  }
  lines.push('ET');

  const contentStream = lines.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

async function ensureSqliteColumn(tableName: string, columnName: string, columnDefinition: string): Promise<void> {
  const columns = await db.all<{ name: string }>(`PRAGMA table_info(${tableName})`);
  if (!columns.some((c) => c.name === columnName)) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

export async function syncBookCopiesForBook(bookId: number, executor: DbExecutor = db): Promise<void> {
  const book = await executor.get<{
    id: number;
    total_copies: number;
    available_copies: number;
    shelf_location: string;
  }>('SELECT id, total_copies, available_copies, shelf_location FROM books WHERE id = ?', bookId);

  if (!book) return;

  const existingCopies = await executor.all<{
    id: number;
    copy_code: string;
    availability_status: string;
  }>(
    `SELECT id, copy_code, availability_status
     FROM book_copies
     WHERE book_id = ?
     ORDER BY id ASC`,
    bookId
  );

  if (existingCopies.length >= book.total_copies) return;

  const now = new Date().toISOString();
  const currentAvailable = existingCopies.filter((c) => c.availability_status === 'available').length;
  let availableNeeded = Math.max(0, book.available_copies - currentAvailable);

  for (let i = existingCopies.length + 1; i <= book.total_copies; i++) {
    const paddedBook = String(book.id).padStart(4, '0');
    const paddedCopy = String(i).padStart(2, '0');
    const copyCode = `LIB-${paddedBook}-C${paddedCopy}`;
    const qrToken = `SMARTLIB:${copyCode}`;
    const status = availableNeeded > 0 ? 'available' : 'issued';
    if (availableNeeded > 0) availableNeeded--;

    await executor.run(
      `INSERT INTO book_copies (
         book_id, copy_code, qr_token, condition_status, availability_status, rack_location, notes, created_at
       ) VALUES (?, ?, ?, 'good', ?, ?, '', ?)
       ON CONFLICT (copy_code) DO NOTHING`,
      book.id,
      copyCode,
      qrToken,
      status,
      book.shelf_location,
      now
    );
  }
}

async function createPostgresSchema(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      student_id TEXT UNIQUE,
      member_type TEXT NOT NULL DEFAULT 'student' CHECK (member_type IN ('admin', 'librarian', 'student', 'faculty')),
      role TEXT NOT NULL CHECK (role IN ('admin', 'student')),
      department TEXT NOT NULL DEFAULT 'General Studies',
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'disabled')),
      max_loans_override INTEGER,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until BIGINT,
      token_version INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      remember_me INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'issued', 'used', 'cancelled')),
      expires_at BIGINT,
      requested_at TEXT NOT NULL,
      issued_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      isbn TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      publisher TEXT NOT NULL,
      published_year INTEGER NOT NULL,
      call_number TEXT NOT NULL,
      shelf_location TEXT NOT NULL,
      rack_code TEXT NOT NULL DEFAULT '',
      low_stock_threshold INTEGER NOT NULL DEFAULT 2,
      cover_url TEXT NOT NULL DEFAULT '',
      total_copies INTEGER NOT NULL,
      available_copies INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS book_copies (
      id SERIAL PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      copy_code TEXT NOT NULL UNIQUE,
      qr_token TEXT NOT NULL UNIQUE,
      condition_status TEXT NOT NULL DEFAULT 'good' CHECK (condition_status IN ('new', 'good', 'fair', 'damaged', 'repair')),
      availability_status TEXT NOT NULL DEFAULT 'available' CHECK (availability_status IN ('available', 'issued', 'reserved', 'lost', 'maintenance')),
      rack_location TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id SERIAL PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id),
      copy_id INTEGER REFERENCES book_copies(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      issued_by INTEGER REFERENCES users(id),
      issued_at TEXT NOT NULL,
      due_date TEXT NOT NULL,
      returned_at TEXT,
      renewal_count INTEGER NOT NULL DEFAULT 0,
      renewal_requested INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'overdue')),
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES books(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'fulfilled', 'cancelled')),
      reserved_at TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fines (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      loan_id INTEGER REFERENCES loans(id),
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'waived')),
      created_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS library_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      library_name TEXT NOT NULL DEFAULT 'Alderbrook Library',
      loan_duration_days INTEGER NOT NULL DEFAULT 14,
      max_books_per_student INTEGER NOT NULL DEFAULT 5,
      max_renewals INTEGER NOT NULL DEFAULT 2,
      daily_fine_cents INTEGER NOT NULL DEFAULT 100,
      reservation_hold_days INTEGER NOT NULL DEFAULT 3,
      allow_self_registration INTEGER NOT NULL DEFAULT 1,
      max_failed_logins INTEGER NOT NULL DEFAULT 5,
      lockout_minutes INTEGER NOT NULL DEFAULT 15
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_label TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'alert')),
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS digital_resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      resource_type TEXT NOT NULL DEFAULT 'pdf' CHECK (resource_type IN ('pdf', 'ebook', 'guide', 'journal')),
      file_path TEXT NOT NULL DEFAULT '',
      file_data TEXT NOT NULL DEFAULT '',
      external_url TEXT NOT NULL DEFAULT '',
      access_level TEXT NOT NULL DEFAULT 'all' CHECK (access_level IN ('all', 'student', 'faculty', 'admin')),
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stored_files (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
      target_role TEXT NOT NULL DEFAULT 'all' CHECK (target_role IN ('all', 'student', 'faculty', 'admin')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendation_feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      feedback TEXT NOT NULL CHECK (feedback IN ('like', 'dislike')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_scope TEXT NOT NULL CHECK (role_scope IN ('student', 'admin')),
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id SERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant')),
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_scope TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_pending_actions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
      expires_at BIGINT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`ALTER TABLE digital_resources ADD COLUMN IF NOT EXISTS file_data TEXT NOT NULL DEFAULT ''`);
}

async function createSqliteSchema(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      student_id TEXT UNIQUE,
      member_type TEXT NOT NULL DEFAULT 'student' CHECK (member_type IN ('admin', 'librarian', 'student', 'faculty')),
      role TEXT NOT NULL CHECK (role IN ('admin', 'student')),
      department TEXT NOT NULL DEFAULT 'General Studies',
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'disabled')),
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      token_version INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      remember_me INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'issued', 'used', 'cancelled')),
      expires_at INTEGER,
      requested_at TEXT NOT NULL,
      issued_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      publisher TEXT NOT NULL,
      published_year INTEGER NOT NULL,
      call_number TEXT NOT NULL,
      shelf_location TEXT NOT NULL,
      total_copies INTEGER NOT NULL,
      available_copies INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS book_copies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      copy_code TEXT NOT NULL UNIQUE,
      qr_token TEXT NOT NULL UNIQUE,
      condition_status TEXT NOT NULL DEFAULT 'good' CHECK (condition_status IN ('new', 'good', 'fair', 'damaged', 'repair')),
      availability_status TEXT NOT NULL DEFAULT 'available' CHECK (availability_status IN ('available', 'issued', 'reserved', 'lost', 'maintenance')),
      rack_location TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      issued_by INTEGER REFERENCES users(id),
      issued_at TEXT NOT NULL,
      due_date TEXT NOT NULL,
      returned_at TEXT,
      renewal_count INTEGER NOT NULL DEFAULT 0,
      renewal_requested INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'overdue')),
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'fulfilled', 'cancelled')),
      reserved_at TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      loan_id INTEGER REFERENCES loans(id),
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'waived')),
      created_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS library_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      library_name TEXT NOT NULL DEFAULT 'Alderbrook Library',
      loan_duration_days INTEGER NOT NULL DEFAULT 14,
      max_books_per_student INTEGER NOT NULL DEFAULT 5,
      max_renewals INTEGER NOT NULL DEFAULT 2,
      daily_fine_cents INTEGER NOT NULL DEFAULT 100,
      reservation_hold_days INTEGER NOT NULL DEFAULT 3,
      allow_self_registration INTEGER NOT NULL DEFAULT 1,
      max_failed_logins INTEGER NOT NULL DEFAULT 5,
      lockout_minutes INTEGER NOT NULL DEFAULT 15
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_label TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'alert')),
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS digital_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      resource_type TEXT NOT NULL DEFAULT 'pdf' CHECK (resource_type IN ('pdf', 'ebook', 'guide', 'journal')),
      file_path TEXT NOT NULL DEFAULT '',
      file_data TEXT NOT NULL DEFAULT '',
      external_url TEXT NOT NULL DEFAULT '',
      access_level TEXT NOT NULL DEFAULT 'all' CHECK (access_level IN ('all', 'student', 'faculty', 'admin')),
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stored_files (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
      target_role TEXT NOT NULL DEFAULT 'all' CHECK (target_role IN ('all', 'student', 'faculty', 'admin')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendation_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      feedback TEXT NOT NULL CHECK (feedback IN ('like', 'dislike')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_scope TEXT NOT NULL CHECK (role_scope IN ('student', 'admin')),
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('user', 'assistant')),
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_scope TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_pending_actions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await ensureSqliteColumn('users', 'max_loans_override', 'INTEGER');
  await ensureSqliteColumn('books', 'cover_url', "TEXT NOT NULL DEFAULT ''");
  await ensureSqliteColumn('books', 'rack_code', "TEXT NOT NULL DEFAULT ''");
  await ensureSqliteColumn('books', 'low_stock_threshold', 'INTEGER NOT NULL DEFAULT 2');
  await ensureSqliteColumn('loans', 'copy_id', 'INTEGER REFERENCES book_copies(id) ON DELETE SET NULL');
  await ensureSqliteColumn('digital_resources', 'file_data', "TEXT NOT NULL DEFAULT ''");
}

async function seedInitialCatalogAndSettings(): Promise<void> {
  await db.run(`
    INSERT INTO library_settings (
      id, library_name, loan_duration_days, max_books_per_student, max_renewals,
      daily_fine_cents, reservation_hold_days, allow_self_registration, max_failed_logins, lockout_minutes
    ) VALUES (1, 'Alderbrook Library', 14, 5, 2, 100, 3, 1, 5, 15)
    ON CONFLICT (id) DO NOTHING
  `);

  const bookCountRow = await db.get<{ count: number | string }>('SELECT COUNT(*) as count FROM books');
  const bookCount = Number(bookCountRow?.count ?? 0);

  if (bookCount === 0) {
    const now = new Date().toISOString();
    const seedBooks = [
      {
        isbn: '978-0262033848',
        title: 'Introduction to Algorithms',
        author: 'Thomas H. Cormen, Charles E. Leiserson',
        category: 'Computer Science',
        publisher: 'MIT Press',
        published_year: 2022,
        call_number: 'QA76.6 .C662',
        shelf_location: 'East Wing · Stack 3A',
        rack_code: 'EW-3A',
        total_copies: 6,
        available_copies: 6,
        description: 'Comprehensive textbook covering data structures, graph algorithms, dynamic programming, and computational complexity.',
      },
      {
        isbn: '978-0131103627',
        title: 'The C Programming Language',
        author: 'Brian W. Kernighan, Dennis M. Ritchie',
        category: 'Computer Science',
        publisher: 'Prentice Hall',
        published_year: 1988,
        call_number: 'QA76.73 .C15',
        shelf_location: 'East Wing · Stack 3B',
        rack_code: 'EW-3B',
        total_copies: 4,
        available_copies: 4,
        description: 'Foundational systems programming monograph detailing ANSI C syntax, pointers, and standard library architecture.',
      },
      {
        isbn: '978-0691167503',
        title: 'The Architecture of Happiness',
        author: 'Alain de Botton',
        category: 'Architecture',
        publisher: 'Princeton University Press',
        published_year: 2016,
        call_number: 'NA2500 .D43',
        shelf_location: 'North Hall · Stack 1C',
        rack_code: 'NH-1C',
        total_copies: 3,
        available_copies: 3,
        description: 'An exploration of how architectural proportions, materials, and civic space shape intellectual and emotional life.',
      },
      {
        isbn: '978-0674979857',
        title: 'Capital and Ideology',
        author: 'Thomas Piketty',
        category: 'Economics',
        publisher: 'Harvard University Press',
        published_year: 2020,
        call_number: 'HB523 .P545',
        shelf_location: 'South Wing · Stack 2A',
        rack_code: 'SW-2A',
        total_copies: 4,
        available_copies: 4,
        description: 'Historical and comparative study of inequality regimes, fiscal policy, and educational access across centuries.',
      },
      {
        isbn: '978-0226458120',
        title: 'The Structure of Scientific Revolutions',
        author: 'Thomas S. Kuhn',
        category: 'Philosophy of Science',
        publisher: 'University of Chicago Press',
        published_year: 2012,
        call_number: 'Q175 .K95',
        shelf_location: 'West Atrium · Stack 4A',
        rack_code: 'WA-4A',
        total_copies: 5,
        available_copies: 5,
        description: 'Landmark analysis of paradigm shifts, normal science, and epistemic revolutions in physics and chemistry.',
      },
      {
        isbn: '978-0300251487',
        title: 'The Printed Book in the Renaissance',
        author: 'Andrew Pettegree',
        category: 'History',
        publisher: 'Yale University Press',
        published_year: 2019,
        call_number: 'Z124 .P48',
        shelf_location: 'Archive Mezzanine · Stack 1A',
        rack_code: 'AM-1A',
        total_copies: 2,
        available_copies: 2,
        description: 'Documentary history of early European publishing houses, scholarly libraries, and typographic craft.',
      },
      {
        isbn: '978-0387948423',
        title: 'Linear Algebra Done Right',
        author: 'Sheldon Axler',
        category: 'Mathematics',
        publisher: 'Springer',
        published_year: 2024,
        call_number: 'QA184.2 .A95',
        shelf_location: 'East Wing · Stack 2C',
        rack_code: 'EW-2C',
        total_copies: 5,
        available_copies: 5,
        description: 'Rigorous determinant-free approach to vector spaces, eigenvalues, inner product spaces, and spectral theorems.',
      },
      {
        isbn: '978-0198840732',
        title: 'Principles of Quantum Mechanics',
        author: 'P. A. M. Dirac',
        category: 'Physics',
        publisher: 'Oxford University Press',
        published_year: 2019,
        call_number: 'QC174.12 .D57',
        shelf_location: 'East Wing · Stack 4D',
        rack_code: 'EW-4D',
        total_copies: 3,
        available_copies: 3,
        description: 'Classic formulation of quantum theory introducing bra-ket notation, linear operators, and relativistic electron theory.',
      },
      {
        isbn: '978-0143127741',
        title: 'Invisible Cities',
        author: 'Italo Calvino',
        category: 'Literature',
        publisher: 'Penguin Classics',
        published_year: 2013,
        call_number: 'PQ4809 .A45',
        shelf_location: 'North Hall · Stack 5B',
        rack_code: 'NH-5B',
        total_copies: 4,
        available_copies: 4,
        description: 'Poetic dialogues between Marco Polo and Kublai Khan meditating on memory, language, and urban imagination.',
      },
      {
        isbn: '978-0521799423',
        title: 'Information Theory, Inference, and Learning Algorithms',
        author: 'David J. C. MacKay',
        category: 'Computer Science',
        publisher: 'Cambridge University Press',
        published_year: 2003,
        call_number: 'Q360 .M23',
        shelf_location: 'East Wing · Stack 3D',
        rack_code: 'EW-3D',
        total_copies: 4,
        available_copies: 4,
        description: 'Unified treatment of Shannon information theory, error-correcting codes, Bayesian inference, and neural networks.',
      },
      {
        isbn: '978-0674986725',
        title: 'A Theory of Justice',
        author: 'John Rawls',
        category: 'Philosophy',
        publisher: 'Belknap Press',
        published_year: 2005,
        call_number: 'JC578 .R38',
        shelf_location: 'West Atrium · Stack 2B',
        rack_code: 'WA-2B',
        total_copies: 3,
        available_copies: 3,
        description: 'Foundational work in political philosophy formulating justice as fairness and the veil of ignorance.',
      },
      {
        isbn: '978-1491950357',
        title: 'Designing Data-Intensive Applications',
        author: 'Martin Kleppmann',
        category: 'Computer Science',
        publisher: "O'Reilly Media",
        published_year: 2017,
        call_number: 'QA76.9 .D32',
        shelf_location: 'East Wing · Stack 3A',
        rack_code: 'EW-3A',
        total_copies: 5,
        available_copies: 5,
        description: 'Deep dive into distributed consensus, replication, stream processing, and reliable database internals.',
      },
    ];

    await db.transaction(async (tx) => {
      for (const item of seedBooks) {
        await tx.run(
          `INSERT INTO books (
            isbn, title, author, category, publisher, published_year,
            call_number, shelf_location, rack_code, low_stock_threshold,
            total_copies, available_copies, description, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?)
          ON CONFLICT (isbn) DO NOTHING`,
          item.isbn,
          item.title,
          item.author,
          item.category,
          item.publisher,
          item.published_year,
          item.call_number,
          item.shelf_location,
          item.rack_code,
          item.total_copies,
          item.available_copies,
          item.description,
          now
        );
      }
    });
  }

  const allBooks = await db.all<{ id: number; shelf_location: string; rack_code: string }>(
    'SELECT id, shelf_location, rack_code FROM books'
  );
  for (const b of allBooks) {
    if (!b.rack_code && b.shelf_location) {
      const generatedRack = b.shelf_location.split('·').pop()?.trim().slice(0, 12) || `RK-${b.id}`;
      await db.run('UPDATE books SET rack_code = ? WHERE id = ?', generatedRack, b.id);
    }
    await syncBookCopiesForBook(b.id);
  }

  const resCountRow = await db.get<{ count: number | string }>('SELECT COUNT(*) as count FROM digital_resources');
  if (Number(resCountRow?.count ?? 0) === 0) {
    const now = new Date().toISOString();
    const seedDigital = [
      {
        filename: 'algorithms_complexity_companion.pdf',
        title: 'Asymptotic Analysis & Graph Algorithms Study Guide',
        author: 'Alderbrook CS Faculty Collective',
        category: 'Computer Science',
        resource_type: 'guide',
        access_level: 'all',
        description: 'Concise reference covering Big-O recurrences, Dijkstra, Bellman-Ford, and dynamic programming patterns.',
        lines: [
          '1. Master Theorem & Recurrence Relations: T(n) = aT(n/b) + f(n).',
          '2. Shortest Paths: BFS for unweighted graphs, Dijkstra for non-negative weights.',
          '3. Dynamic Programming: Optimal substructure and overlapping subproblems.',
          '4. Recommended Print Companion: Introduction to Algorithms (QA76.6 .C662).',
        ],
      },
      {
        filename: 'linear_algebra_spectral_notes.pdf',
        title: 'Vector Spaces & Spectral Decomposition Notes',
        author: 'Department of Mathematics',
        category: 'Mathematics',
        resource_type: 'pdf',
        access_level: 'all',
        description: 'Lecture compendium on inner products, orthogonal projections, eigenvalues, and self-adjoint operators.',
        lines: [
          '1. Rank-Nullity Theorem: dim(V) = dim(null T) + dim(range T).',
          '2. Gram-Schmidt Process: Constructing orthonormal bases in inner product spaces.',
          '3. Complex & Real Spectral Theorems for normal and self-adjoint operators.',
          '4. Print Companion: Linear Algebra Done Right (QA184.2 .A95).',
        ],
      },
      {
        filename: 'distributed_systems_reading_packet.pdf',
        title: 'Consensus & Fault-Tolerant Storage Seminar Packet',
        author: 'Systems Engineering Lab',
        category: 'Computer Science',
        resource_type: 'journal',
        access_level: 'all',
        description: 'Annotated seminar syllabus on Raft consensus, linearizability, write-ahead logs, and replication.',
        lines: [
          '1. Replication Trade-offs: Single-leader vs. multi-leader vs. leaderless.',
          '2. Consensus Guarantees: Safety under network partitions, liveness assumptions.',
          '3. Storage Engines: LSM-Trees vs. B-Trees and WAL durability.',
          '4. Print Companion: Designing Data-Intensive Applications (QA76.9 .D32).',
        ],
      },
      {
        filename: 'academic_citation_research_handbook.pdf',
        title: 'University Research & Citation Style Handbook',
        author: 'Smart Library Reference Desk',
        category: 'Research Methods',
        resource_type: 'ebook',
        access_level: 'all',
        description: 'Institutional guide to archival discovery, IEEE/Chicago/APA citations, and primary source verification.',
        lines: [
          '1. Navigating Call Numbers: Library of Congress classification overview.',
          '2. Evaluating Peer-Reviewed Literature and Institutional Repositories.',
          '3. Citation Hygiene: Attributing monographs, datasets, and technical reports.',
          '4. Consult the Reference Desk or LIBRA AI for personalized reading paths.',
        ],
      },
    ];

    for (const item of seedDigital) {
      const pdfBuf = buildMinimalValidPdf(item.title, item.author, item.category, item.lines);
      const pdfBase64 = pdfBuf.toString('base64');

      if (!isVercelEnv && !configuredDatabaseUrl) {
        const targetPath = path.join(resourcesUploadDir, item.filename);
        if (!fs.existsSync(targetPath)) {
          fs.writeFileSync(targetPath, pdfBuf);
        }
      }

      await db.run(
        `INSERT INTO digital_resources (
          title, author, category, description, resource_type, file_path, file_data, external_url, access_level, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, NULL, ?)`,
        item.title,
        item.author,
        item.category,
        item.description,
        item.resource_type,
        item.filename,
        pdfBase64,
        item.access_level,
        now
      );
    }
  }

  const annCountRow = await db.get<{ count: number | string }>('SELECT COUNT(*) as count FROM announcements');
  if (Number(annCountRow?.count ?? 0) === 0) {
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO announcements (title, message, priority, target_role, created_by, created_at)
       VALUES
         ('LIBRA AI Assistant & Smart QR Desk Live', 'Use LIBRA AI in your portal for instant catalog guidance, due-date summaries, and subject study paths. Physical books now include QR copy codes for rapid desk checkouts.', 'important', 'all', NULL, ?),
         ('Extended Quiet Study Hours', 'Main Reading Room and East Wing stacks remain open until 11:30 PM Monday through Saturday during the academic term.', 'normal', 'all', NULL, ?)`,
      now,
      now
    );
  }
}

export async function initializeDatabase(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const driver = getActiveDriver();
    if (driver === 'postgres') {
      await createPostgresSchema();
    } else {
      await createSqliteSchema();
    }
    await seedInitialCatalogAndSettings();
  })().catch((err) => {
    initPromise = null;
    throw err;
  });

  return initPromise;
}

export async function getSettings() {
  return (await db.get<{
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
  }>('SELECT * FROM library_settings WHERE id = 1'))!;
}

export async function writeAuditLog(params: {
  actorId?: number | null;
  actorLabel: string;
  action: string;
  target?: string;
  severity?: 'info' | 'warning' | 'alert';
  ipAddress?: string;
}): Promise<void> {
  await db.run(
    `INSERT INTO audit_logs (actor_id, actor_label, action, target, severity, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params.actorId ?? null,
    params.actorLabel,
    params.action,
    params.target ?? '',
    params.severity ?? 'info',
    params.ipAddress ?? '',
    new Date().toISOString()
  );
}
