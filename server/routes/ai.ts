import crypto from 'node:crypto';
import { Router, type NextFunction, type Response } from 'express';
import { db, getSettings, writeAuditLog } from '../db.ts';
import {
  createRateLimiter,
  getClientIp,
  requireAuth,
  type AuthenticatedRequest,
} from '../security.ts';
import {
  AiProviderError,
  LIBRA_MODEL_ID,
  isAiProviderConfigured,
  runLibraChatTurn,
} from '../services/aiProvider.ts';

export const aiRouter = Router();

aiRouter.use(requireAuth);

const aiChatRateLimit = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 25, keyPrefix: 'ai-chat' });

aiRouter.get('/status', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.authUser!;
    const usageRow = await db.get<{ requests: number | string; totalTokens: number | string }>(
      `SELECT COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as "totalTokens"
       FROM ai_usage_logs
       WHERE user_id = ?`,
      user.id
    );

    let globalUsage: { requests: number; totalTokens: number } | undefined;
    if (user.role === 'admin') {
      const globalRow = await db.get<{ requests: number | string; totalTokens: number | string }>(
        `SELECT COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as "totalTokens"
         FROM ai_usage_logs`
      );
      globalUsage = {
        requests: Number(globalRow?.requests ?? 0),
        totalTokens: Number(globalRow?.totalTokens ?? 0),
      };
    }

    res.json({
      assistantName: 'LIBRA AI',
      subtitle: 'Your Intelligent Library Assistant',
      tagline: 'Your Library. Your Intelligence.',
      model: LIBRA_MODEL_ID,
      configured: isAiProviderConfigured(),
      roleScope: user.role,
      userUsage: {
        requests: Number(usageRow?.requests ?? 0),
        totalTokens: Number(usageRow?.totalTokens ?? 0),
      },
      ...(globalUsage ? { globalUsage } : {}),
    });
  } catch (err) {
    next(err);
  }
});

aiRouter.get('/conversations', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.authUser!;
    const conversations = await db.all<{
      id: string;
      title: string;
      roleScope: 'student' | 'admin';
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, title, role_scope as "roleScope", created_at as "createdAt", updated_at as "updatedAt"
       FROM ai_conversations
       WHERE user_id = ? AND role_scope = ?
       ORDER BY updated_at DESC
       LIMIT 15`,
      user.id,
      user.role
    );

    const activeConvId = typeof req.query.conversationId === 'string' ? req.query.conversationId : conversations[0]?.id;

    let messages: Array<{
      id: number;
      conversationId: string;
      sender: 'user' | 'assistant';
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }> = [];

    if (activeConvId && conversations.some((c) => c.id === activeConvId)) {
      const rawMsgs = await db.all<{
        id: number;
        conversationId: string;
        sender: 'user' | 'assistant';
        content: string;
        metadata_json: string;
        createdAt: string;
      }>(
        `SELECT id, conversation_id as "conversationId", sender, content, metadata_json, created_at as "createdAt"
         FROM ai_messages
         WHERE conversation_id = ?
         ORDER BY id ASC
         LIMIT 80`,
        activeConvId
      );

      messages = rawMsgs.map((m) => {
        let parsedMeta: Record<string, unknown> = {};
        try {
          parsedMeta = JSON.parse(m.metadata_json || '{}');
        } catch {
          parsedMeta = {};
        }
        return {
          id: Number(m.id),
          conversationId: m.conversationId,
          sender: m.sender,
          content: m.content,
          metadata: parsedMeta,
          createdAt: m.createdAt,
        };
      });
    }

    res.json({ conversations, activeConversationId: activeConvId || null, messages });
  } catch (err) {
    next(err);
  }
});

aiRouter.delete('/conversations/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.authUser!;
    const convId = String(req.params.id);
    const existing = await db.get('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?', convId, user.id);
    if (!existing) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    await db.run('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?', convId, user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

aiRouter.post('/chat', aiChatRateLimit, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.authUser!;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const requestedConvId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';

    if (!message || message.length > 2000) {
      res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
      return;
    }

    let conversationId = requestedConvId;
    if (conversationId) {
      const owned = await db.get(
        'SELECT id FROM ai_conversations WHERE id = ? AND user_id = ? AND role_scope = ?',
        conversationId,
        user.id,
        user.role
      );
      if (!owned) {
        conversationId = '';
      }
    }

    const now = new Date().toISOString();
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      const title = message.length > 48 ? `${message.slice(0, 48)}...` : message;
      await db.run(
        `INSERT INTO ai_conversations (id, user_id, role_scope, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        conversationId,
        user.id,
        user.role,
        title,
        now,
        now
      );
    }

    const history = await db.all<{ sender: 'user' | 'assistant'; content: string }>(
      `SELECT sender, content
       FROM ai_messages
       WHERE conversation_id = ?
       ORDER BY id DESC
       LIMIT 10`,
      conversationId
    );
    history.reverse();

    const result = await runLibraChatTurn({
      user,
      history,
      prompt: message,
    });

    const userMsgTime = new Date().toISOString();
    const assistantMsgTime = new Date().toISOString();

    const assistantMsgId = await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO ai_messages (conversation_id, sender, content, metadata_json, created_at)
         VALUES (?, 'user', ?, '{}', ?)`,
        conversationId,
        message,
        userMsgTime
      );

      const insertedId = await tx.insert(
        `INSERT INTO ai_messages (conversation_id, sender, content, metadata_json, created_at)
         VALUES (?, 'assistant', ?, ?, ?)`,
        conversationId,
        result.replyText,
        JSON.stringify(result.metadata),
        assistantMsgTime
      );

      await tx.run('UPDATE ai_conversations SET updated_at = ? WHERE id = ?', assistantMsgTime, conversationId);
      return insertedId;
    });

    res.json({
      conversationId,
      userMessage: {
        id: Date.now(),
        conversationId,
        sender: 'user',
        content: message,
        createdAt: userMsgTime,
      },
      assistantMessage: {
        id: assistantMsgId,
        conversationId,
        sender: 'assistant',
        content: result.replyText,
        metadata: result.metadata,
        createdAt: assistantMsgTime,
      },
    });
  } catch (err) {
    if (err instanceof AiProviderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

aiRouter.post('/confirm-action', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.authUser!;
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'Only authorized administrators can confirm administrative AI actions.' });
      return;
    }

    const actionId = typeof req.body?.actionId === 'string' ? req.body.actionId.trim() : '';
    const decision = req.body?.decision === 'cancel' ? 'cancel' : 'confirm';

    const pending = await db.get<{
      id: string;
      user_id: number;
      action_type: string;
      summary: string;
      payload_json: string;
      status: string;
      expires_at: number | string;
    }>(`SELECT * FROM ai_pending_actions WHERE id = ? AND user_id = ?`, actionId, user.id);

    if (!pending) {
      res.status(404).json({ error: 'Pending AI action not found.' });
      return;
    }
    if (pending.status !== 'pending') {
      res.status(409).json({ error: `This action was already ${pending.status}.` });
      return;
    }
    if (Date.now() > Number(pending.expires_at)) {
      await db.run("UPDATE ai_pending_actions SET status = 'expired' WHERE id = ?", actionId);
      res.status(410).json({ error: 'This action confirmation expired. Ask LIBRA AI to propose it again.' });
      return;
    }

    if (decision === 'cancel') {
      await db.run("UPDATE ai_pending_actions SET status = 'cancelled' WHERE id = ?", actionId);
      res.json({ ok: true, status: 'cancelled', message: 'Proposed action cancelled.' });
      return;
    }

    const payload = JSON.parse(pending.payload_json) as Record<string, unknown>;
    const settings = await getSettings();
    let executionMessage = '';

    await db.transaction(async (tx) => {
      if (pending.action_type === 'waive_fine') {
        const fineId = Number(payload.targetId);
        const fine = await tx.get("SELECT id FROM fines WHERE id = ? AND status = 'unpaid'", fineId);
        if (!fine) throw new Error('Fine is no longer unpaid.');
        await tx.run("UPDATE fines SET status = 'waived', settled_at = ? WHERE id = ?", new Date().toISOString(), fineId);
        executionMessage = `Waived fine #${fineId}.`;
      } else if (pending.action_type === 'mark_reservation_ready') {
        const resId = Number(payload.targetId);
        const expiresAt = new Date(Date.now() + Number(settings.reservation_hold_days) * 24 * 60 * 60 * 1000).toISOString();
        const upd = await tx.run(
          "UPDATE reservations SET status = 'ready', expires_at = ? WHERE id = ? AND status = 'pending'",
          expiresAt,
          resId
        );
        if (upd.changes === 0) throw new Error('Reservation is no longer pending.');
        executionMessage = `Marked reservation #${resId} ready for pickup.`;
      } else if (pending.action_type === 'approve_renewal') {
        const loanId = Number(payload.targetId);
        const loan = await tx.get<{ id: number; due_date: string; renewal_count: number; status: string }>(
          "SELECT id, due_date, renewal_count, status FROM loans WHERE id = ? AND status != 'returned'",
          loanId
        );
        if (!loan) throw new Error('Loan is no longer active.');
        const baseDate = Math.max(Date.now(), new Date(loan.due_date).getTime());
        const nextDue = new Date(baseDate + Number(settings.loan_duration_days) * 24 * 60 * 60 * 1000).toISOString();
        await tx.run(
          "UPDATE loans SET due_date = ?, renewal_count = renewal_count + 1, renewal_requested = 0, status = 'active' WHERE id = ?",
          nextDue,
          loanId
        );
        executionMessage = `Approved renewal for loan #${loanId} (new due date ${nextDue.slice(0, 10)}).`;
      } else if (pending.action_type === 'update_book_stock') {
        const bookId = Number(payload.targetId);
        const newTotal = Number(payload.newTotalCopies);
        const book = await tx.get<{ id: number; total_copies: number; available_copies: number }>(
          'SELECT id, total_copies, available_copies FROM books WHERE id = ?',
          bookId
        );
        if (!book) throw new Error('Book not found.');
        const loanedOut = Number(book.total_copies) - Number(book.available_copies);
        if (newTotal < loanedOut) throw new Error(`Cannot reduce stock below ${loanedOut} loaned copies.`);
        await tx.run('UPDATE books SET total_copies = ?, available_copies = ? WHERE id = ?', newTotal, newTotal - loanedOut, bookId);
        executionMessage = `Updated book #${bookId} stock to ${newTotal} copies.`;
      } else if (pending.action_type === 'create_announcement') {
        const title = String(payload.title || '').slice(0, 120);
        const message = String(payload.message || '').slice(0, 1000);
        const priority = ['normal', 'important', 'urgent'].includes(String(payload.priority))
          ? String(payload.priority)
          : 'normal';
        await tx.run(
          `INSERT INTO announcements (title, message, priority, target_role, created_by, created_at)
           VALUES (?, ?, ?, 'all', ?, ?)`,
          title,
          message,
          priority,
          user.id,
          new Date().toISOString()
        );
        executionMessage = `Published announcement "${title}".`;
      } else {
        throw new Error('Unsupported AI action type.');
      }

      await tx.run("UPDATE ai_pending_actions SET status = 'confirmed' WHERE id = ?", actionId);
    });

    await writeAuditLog({
      actorId: user.id,
      actorLabel: user.email,
      action: `LIBRA AI Confirmed Action (${pending.action_type})`,
      target: pending.summary,
      severity: 'info',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, status: 'confirmed', message: executionMessage });
  } catch (err) {
    if (err instanceof Error) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});
