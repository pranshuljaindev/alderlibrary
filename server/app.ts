import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  DatabaseConfigurationError,
  coversUploadDir,
  db,
  initializeDatabase,
} from './db.ts';
import { adminRouter } from './routes/admin.ts';
import { aiRouter } from './routes/ai.ts';
import { authRouter } from './routes/auth.ts';
import { studentRouter } from './routes/student.ts';
import { getAllowedOrigins, hasPersistentJwtSecret } from './security.ts';
import { isAiProviderConfigured } from './services/aiProvider.ts';

let initPromise: Promise<void> | null = null;

export function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeDatabase().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

function isOriginAllowed(origin: string, req: Request): boolean {
  const allowed = getAllowedOrigins();
  if (allowed.has(origin)) return true;

  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
    } catch {
      return false;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    if (origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000') {
      return true;
    }
  }

  return false;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin, req)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // Health endpoint is intentionally mounted before ensureInitialized() so diagnostics stay reachable
  app.get('/api/health', async (_req: Request, res: Response) => {
    const ping = await db.ping();
    const aiConfigured = isAiProviderConfigured();
    const persistentJwt = hasPersistentJwtSecret();

    if (!ping.ok) {
      res.status(503).json({
        ok: false,
        status: 'server_unavailable',
        timestamp: new Date().toISOString(),
        environment: process.env.VERCEL ? 'vercel' : 'node',
        error: ping.error || 'Database connection check failed.',
        services: {
          database: {
            ok: false,
            driver: ping.driver,
            error: ping.error || 'Unavailable',
          },
          ai: {
            configured: aiConfigured,
            mode: aiConfigured ? 'gemini+commands' : 'commands_only',
          },
          auth: {
            persistentJwtSecret: persistentJwt,
          },
        },
      });
      return;
    }

    try {
      await ensureInitialized();
      res.status(200).json({
        ok: true,
        status: 'connected',
        timestamp: new Date().toISOString(),
        environment: process.env.VERCEL ? 'vercel' : 'node',
        services: {
          database: {
            ok: true,
            driver: ping.driver,
          },
          ai: {
            configured: aiConfigured,
            mode: aiConfigured ? 'gemini+commands' : 'commands_only',
          },
          auth: {
            persistentJwtSecret: persistentJwt,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Database initialization failed.';
      res.status(503).json({
        ok: false,
        status: 'server_unavailable',
        timestamp: new Date().toISOString(),
        environment: process.env.VERCEL ? 'vercel' : 'node',
        error: message,
        services: {
          database: {
            ok: false,
            driver: ping.driver,
            error: message,
          },
          ai: {
            configured: aiConfigured,
            mode: aiConfigured ? 'gemini+commands' : 'commands_only',
          },
          auth: {
            persistentJwtSecret: persistentJwt,
          },
        },
      });
    }
  });

  // Lazy single-flight schema & seed initialization for serverless cold starts
  app.use('/api', async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      await ensureInitialized();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/student', studentRouter);
  app.use('/api/ai', aiRouter);

  // Serve uploaded book covers from database storage (serverless-safe), with local disk fallback
  app.get('/api/files/covers/:filename', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filename = String(req.params.filename || '');
      if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/i.test(filename)) {
        res.status(400).json({ error: 'Invalid cover filename.' });
        return;
      }

      const stored = await db.get<{ mime_type: string; data_base64: string }>(
        'SELECT mime_type, data_base64 FROM stored_files WHERE filename = ?',
        filename
      );

      if (stored?.data_base64) {
        const buffer = Buffer.from(stored.data_base64, 'base64');
        res.setHeader('Content-Type', stored.mime_type || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
        return;
      }

      if (!process.env.VERCEL) {
        const resolved = path.resolve(coversUploadDir, filename);
        if (resolved.startsWith(coversUploadDir + path.sep) && fs.existsSync(resolved)) {
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.sendFile(resolved);
          return;
        }
      }

      res.status(404).json({ error: 'Cover image not found.' });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  // Global JSON error handler so API errors never return HTML or silent hangs
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;

    if (err instanceof DatabaseConfigurationError) {
      res.status(503).json({
        error: err.message,
        code: 'DB_NOT_CONFIGURED',
      });
      return;
    }

    const anyErr = err as { type?: string; status?: number; statusCode?: number; message?: string };
    if (anyErr?.type === 'entity.too.large' || anyErr?.status === 413) {
      res.status(413).json({ error: 'Request payload is too large.' });
      return;
    }

    const status =
      typeof anyErr?.status === 'number' && anyErr.status >= 400 && anyErr.status < 600
        ? anyErr.status
        : typeof anyErr?.statusCode === 'number' && anyErr.statusCode >= 400 && anyErr.statusCode < 600
          ? anyErr.statusCode
          : 500;

    console.error('[API Error]', anyErr?.message || err);
    res.status(status).json({
      error: status >= 500 ? 'Internal server error. Please verify backend & database configuration.' : anyErr?.message || 'Request failed.',
    });
  });

  return app;
}
