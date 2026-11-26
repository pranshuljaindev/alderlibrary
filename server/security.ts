import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db.ts';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SECRET;
}

export function hasPersistentJwtSecret(): boolean {
  const configured = process.env.JWT_SECRET?.trim();
  return Boolean(configured && configured.length >= 16);
}

export interface AuthUserRecord {
  id: number;
  full_name: string;
  email: string;
  student_id: string | null;
  member_type: 'admin' | 'librarian' | 'student' | 'faculty';
  role: 'admin' | 'student';
  department: string;
  phone: string;
  status: 'active' | 'pending' | 'disabled';
  max_loans_override?: number | null;
  token_version: number;
  last_login_at: string | null;
  created_at: string;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUserRecord;
}

interface JwtPayload {
  sub: number;
  role: 'admin' | 'student';
  ver: number;
  iat?: number;
  exp?: number;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexKey] = parts;
  if (!salt || !hexKey) return false;

  const expected = Buffer.from(hexKey, 'hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function signAccessToken(user: { id: number; role: 'admin' | 'student'; token_version: number }): string {
  return jwt.sign(
    { sub: user.id, role: user.role, ver: user.token_version },
    getJwtSecret(),
    { expiresIn: '2h' }
  );
}

export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as unknown as JwtPayload;
    if (typeof decoded?.sub !== 'number' || (decoded.role !== 'admin' && decoded.role !== 'student')) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, and numeric characters.';
  }
  return null;
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export const REFRESH_COOKIE_NAME = 'alderbrook_refresh';

function isHttpsRequest(req?: Request): boolean {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return true;
  if (!req) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return req.secure || proto === 'https';
}

export function setRefreshCookie(res: Response, rawToken: string, rememberMe: boolean, req?: Request): void {
  const secure = isHttpsRequest(req);
  const cookieParts = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure', 'SameSite=None', 'Partitioned'] : ['SameSite=Lax']),
  ];
  if (rememberMe) {
    cookieParts.push(`Max-Age=${7 * 24 * 60 * 60}`);
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

export function clearRefreshCookie(res: Response, req?: Request): void {
  const secure = isHttpsRequest(req);
  const cookieParts = [
    `${REFRESH_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure', 'SameSite=None', 'Partitioned'] : ['SameSite=Lax']),
    'Max-Age=0',
  ];
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

export function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>();
  const addOrigin = (raw?: string) => {
    if (!raw) return;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        const normalized = trimmed.startsWith('http') ? new URL(trimmed).origin : `https://${trimmed}`;
        allowed.add(normalized);
      } catch {
        // Ignore malformed entry
      }
    }
  };
  addOrigin(process.env.ALLOWED_ORIGINS);
  addOrigin(process.env.APP_URL);
  addOrigin(process.env.VERCEL_URL);
  addOrigin(process.env.VERCEL_BRANCH_URL);
  addOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  return allowed;
}

export function verifySameOriginOrHeader(req: Request): boolean {
  const xRequestedWith = req.headers['x-requested-with'];
  if (xRequestedWith === 'XMLHttpRequest') {
    return true;
  }
  const origin = req.headers.origin;
  if (!origin) return false;

  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) {
        return true;
      }
      if (getAllowedOrigins().has(originUrl.origin)) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(options: { windowMs: number; maxRequests: number; keyPrefix: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const timestamps = (rateBuckets.get(key) ?? []).filter((t) => t > cutoff);

    if (timestamps.length >= options.maxRequests) {
      const retryAfterSec = Math.ceil((timestamps[0] + options.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
      res.status(429).json({
        error: `Too many requests. Please wait ${Math.max(1, retryAfterSec)} seconds before trying again.`,
      });
      return;
    }

    timestamps.push(now);
    rateBuckets.set(key, timestamps);
    next();
  };
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyAccessToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expired or invalid. Please sign in again.', code: 'SESSION_EXPIRED' });
      return;
    }

    const user = await db.get<AuthUserRecord>(
      `SELECT id, full_name, email, student_id, member_type, role, department, phone, status, max_loans_override, token_version, last_login_at, created_at
       FROM users
       WHERE id = ?`,
      payload.sub
    );

    if (!user) {
      res.status(401).json({ error: 'Account no longer exists.', code: 'SESSION_EXPIRED' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'Your account is currently inactive or awaiting approval.' });
      return;
    }

    if (Number(user.token_version) !== payload.ver) {
      res.status(401).json({ error: 'Your session has been revoked. Please sign in again.', code: 'SESSION_EXPIRED' });
      return;
    }

    // Independent DB role check — never trust client claims alone
    if (user.role !== payload.role) {
      res.status(401).json({ error: 'Role mismatch detected. Please sign in again.', code: 'SESSION_EXPIRED' });
      return;
    }

    req.authUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(expectedRole: 'admin' | 'student') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.authUser.role !== expectedRole) {
      res.status(403).json({
        error: expectedRole === 'admin'
          ? 'Access denied. Administrator privileges are required for this action.'
          : 'Access denied. This endpoint is restricted to student portal accounts.',
      });
      return;
    }
    next();
  };
}

export function sanitizeUser(user: AuthUserRecord) {
  return {
    id: Number(user.id),
    fullName: user.full_name,
    email: user.email,
    studentId: user.student_id,
    memberType: user.member_type,
    role: user.role,
    department: user.department,
    phone: user.phone,
    status: user.status,
    maxLoansOverride: user.max_loans_override !== null && user.max_loans_override !== undefined ? Number(user.max_loans_override) : null,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}
