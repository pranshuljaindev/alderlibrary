import { GoogleGenAI, type Content } from '@google/genai';
import { db, getSettings } from '../db.ts';
import type { AuthUserRecord } from '../security.ts';
import type { AiMessageMetadata } from '../../src/types.ts';
import {
  ADMIN_TOOL_DECLARATIONS,
  STUDENT_TOOL_DECLARATIONS,
  executeLibraTool,
  type ToolExecutionContext,
} from './libraTools.ts';

export const LIBRA_MODEL_ID = 'gemini-4-hydrogen';

export class AiProviderError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'AiProviderError';
    this.status = status;
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new AiProviderError(
      'Natural-language Gemini AI is unavailable because GEMINI_API_KEY is not configured. You can still use all built-in /slash commands (e.g. /find-book, /my-books, /dashboard) powered directly by the library database.',
      503
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildSystemInstruction(user: AuthUserRecord): string {
  if (user.role === 'admin') {
    return [
      'You are LIBRA AI — Your Intelligent Library Assistant ("Your Library. Your Intelligence."), operating inside the Admin & Librarian Portal.',
      `Authenticated Administrator: ${user.full_name} (${user.member_type}, ${user.email}).`,
      'Rules:',
      '1. ALWAYS call the provided database tools for real numbers, overdue loans, inventory health, demand predictions, or operational reports. NEVER invent book titles, borrower names, IDs, or statistics.',
      '2. Clearly distinguish historical database facts from algorithmically projected demand.',
      '3. When the admin asks to execute a state-changing action (waive fine, mark reservation ready, approve renewal, update book stock, publish announcement), use proposeAdminAction so the admin gets an explicit Confirm/Cancel card. Never claim a mutation happened until confirmed.',
      '4. Format answers clearly with concise Markdown headings, bullet lists, and exact IDs/dates.',
    ].join('\n');
  }

  return [
    'You are LIBRA AI — Your Intelligent Library Assistant ("Your Library. Your Intelligence."), assisting an authenticated university library member.',
    `Authenticated Member: ${user.full_name} (${user.member_type}, Department: ${user.department}).`,
    'Rules:',
    '1. ALWAYS call the provided catalog, loan, reservation, fine, digital library, or recommendation tools before stating catalog availability, due dates, holds, or fines. NEVER invent books or account records.',
    '2. Strict privacy boundary: You can only view the catalog, digital library, and THIS member’s own loans, reservations, fines, and recommendations. Refuse any request to inspect other students, admin analytics, or mutate inventory.',
    '3. When recommending books or answering study-path questions, call getPersonalizedRecommendations or searchCatalog so interactive book cards appear automatically.',
    '4. Be concise, scholarly, encouraging, and accurate with call numbers and shelf locations.',
  ].join('\n');
}

const ADMIN_COMMANDS = new Set([
  '/dashboard',
  '/inventory',
  '/low-stock',
  '/overdue',
  '/students',
  '/popular-books',
  '/fine-report',
  '/analytics',
  '/report',
  '/help',
]);

const STUDENT_COMMANDS = new Set([
  '/find-book',
  '/recommend',
  '/my-books',
  '/due-dates',
  '/my-history',
  '/my-fines',
  '/reserve',
  '/renew',
  '/library-help',
]);

async function tryRunSlashCommand(
  user: AuthUserRecord,
  prompt: string,
  ctx: ToolExecutionContext
): Promise<string | null> {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  // Strict RBAC check on slash commands
  if (ADMIN_COMMANDS.has(cmd) && user.role !== 'admin') {
    return `### Access Restricted\n\nThe \`${cmd}\` command is restricted to authorized **library administrators**. Switch to student commands such as \`/find-book\`, \`/recommend\`, \`/my-books\`, \`/due-dates\`, \`/my-history\`, \`/my-fines\`, \`/reserve\`, \`/renew\`, or \`/library-help\`.`;
  }

  // --- STUDENT SLASH COMMANDS ---
  if (user.role === 'student' && STUDENT_COMMANDS.has(cmd)) {
    if (cmd === '/library-help') {
      const s = await getSettings();
      return [
        `### ${s.library_name} — Student Command & Policy Guide`,
        '',
        `- **Borrowing Limit:** Up to **${user.max_loans_override ?? s.max_books_per_student}** simultaneous books for **${s.loan_duration_days} days** per loan.`,
        `- **Renewals:** Up to **${s.max_renewals}** renewals per loan (active non-overdue books only).`,
        `- **Reservations & Holds:** Ready holds are kept at the Circulation Desk for **${s.reservation_hold_days} days**.`,
        `- **Overdue Fines:** **$${(Number(s.daily_fine_cents) / 100).toFixed(2)}/day** after the return deadline.`,
        '',
        '**Available Student Commands:**',
        '- `/find-book <keywords>` — Search catalog by title, author, subject, or ISBN',
        '- `/recommend <topic>` — Personalized book recommendations',
        '- `/my-books` — Currently issued & overdue books',
        '- `/due-dates` — Upcoming return deadlines',
        '- `/my-history` — Complete borrowing history',
        '- `/my-fines` — Outstanding & settled fines',
        '- `/reserve <book>` — Find available titles and place a hold',
        '- `/renew` — Check renewal eligibility on active loans',
        '- `/library-help` — Display this help guide',
      ].join('\n');
    }

    if (cmd === '/find-book') {
      const res = (await executeLibraTool('searchCatalog', { query: arg }, ctx)) as {
        count: number;
        books: Array<{ title: string; author: string; call_number: string; shelf_location: string; available_copies: number; total_copies: number }>;
      };
      if (res.count === 0) {
        return arg
          ? `No catalog volumes matched **"${arg}"**. Try searching with broader keywords, author surname, or subject category.`
          : 'No books are currently listed in the catalog.';
      }
      const lines = res.books.slice(0, 6).map(
        (b) => `- **${b.title}** by ${b.author} · \`${b.call_number}\` (${b.shelf_location}) — **${b.available_copies}/${b.total_copies} available**`
      );
      return `### Catalog Search Results${arg ? ` for "${arg}"` : ''}\n\nFound **${res.count}** matching volume(s):\n\n${lines.join('\n')}`;
    }

    if (cmd === '/recommend') {
      const res = (await executeLibraTool('getPersonalizedRecommendations', { topic: arg }, ctx)) as {
        recommendations: Array<{ title: string; author: string; category: string; available_copies: number; total_copies: number; reason: string }>;
      };
      if (res.recommendations.length === 0) {
        return 'No additional catalog recommendations are available right now.';
      }
      const lines = res.recommendations.map(
        (b) => `- **${b.title}** (${b.category}) — ${b.reason} · *${b.available_copies}/${b.total_copies} available*`
      );
      return `### Recommended Reading${arg ? ` · ${arg}` : ''}\n\n${lines.join('\n')}`;
    }

    if (cmd === '/my-books' || cmd === '/due-dates' || cmd === '/my-history' || cmd === '/renew') {
      const data = (await executeLibraTool('getMyLoansAndDeadlines', {}, ctx)) as {
        loans: Array<{
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
          renewalEligible: boolean;
        }>;
        maxBooksAllowed: number;
        maxRenewalsAllowed: number;
      };

      const active = data.loans.filter((l) => l.status === 'active' || l.status === 'overdue');

      if (cmd === '/my-books') {
        if (active.length === 0) {
          return `You currently have **0 issued books** (allowance: ${data.maxBooksAllowed} active volumes). Use \`/find-book\` or \`/recommend\` to discover titles.`;
        }
        const lines = active.map(
          (l) => `- **${l.title}** (\`${l.call_number}\`) — Status: **${l.status.toUpperCase()}** · Due: **${l.due_date.slice(0, 10)}**`
        );
        return `### Currently Issued Books (${active.length}/${data.maxBooksAllowed})\n\n${lines.join('\n')}`;
      }

      if (cmd === '/due-dates') {
        if (active.length === 0) {
          return 'You have **no upcoming return deadlines** — all borrowed books have been returned.';
        }
        const now = Date.now();
        const lines = active.map((l) => {
          const daysLeft = Math.ceil((new Date(l.due_date).getTime() - now) / 86400000);
          const timing = daysLeft < 0 ? `**OVERDUE by ${Math.abs(daysLeft)} day(s)**` : daysLeft === 0 ? '**Due Today**' : `Due in ${daysLeft} day(s)`;
          return `- **${l.title}** — Due **${l.due_date.slice(0, 10)}** (${timing})`;
        });
        return `### Upcoming Book Return Deadlines\n\n${lines.join('\n')}`;
      }

      if (cmd === '/my-history') {
        if (data.loans.length === 0) {
          return 'Your borrowing history is currently empty.';
        }
        ctx.collectedTables.push({
          title: 'Your Borrowing History',
          columns: ['Title', 'Status', 'Issued', 'Due / Returned'],
          rows: data.loans.slice(0, 12).map((l) => [
            l.title,
            l.status,
            l.issued_at.slice(0, 10),
            l.returned_at ? `Ret ${l.returned_at.slice(0, 10)}` : `Due ${l.due_date.slice(0, 10)}`,
          ]),
        });
        return `### Borrowing History (${data.loans.length} records)\n\nSee the table below for your issued, overdue, and returned library records.`;
      }

      // /renew
      if (active.length === 0) {
        return 'You have no active loans eligible for renewal.';
      }
      const lines = active.map((l) => {
        if (l.renewalEligible) {
          return `- **${l.title}** (Loan #${l.id}) — **Eligible** (${l.renewal_count}/${data.maxRenewalsAllowed} renewals used). Open **My Loans** in the sidebar to submit a renewal request.`;
        }
        const reason =
          l.status === 'overdue'
            ? 'Overdue loans require returning/desk review'
            : l.renewal_requested
              ? 'Renewal request already pending librarian approval'
              : `Maximum renewals (${data.maxRenewalsAllowed}) reached`;
        return `- **${l.title}** (Loan #${l.id}) — **Not eligible**: ${reason}.`;
      });
      return `### Renewal Eligibility Check\n\n${lines.join('\n')}`;
    }

    if (cmd === '/my-fines') {
      const res = (await executeLibraTool('getMyFines', {}, ctx)) as {
        fines: Array<{ id: number; amount_cents: number; reason: string; status: string; created_at: string }>;
        totalUnpaidDollars: string;
      };
      if (res.fines.length === 0) {
        return '### Library Fines\n\nGood standing! You have **$0.00** in unpaid fines and no fine history.';
      }
      ctx.collectedTables.push({
        title: 'Your Fine Ledger',
        columns: ['ID', 'Amount', 'Status', 'Reason', 'Date'],
        rows: res.fines.slice(0, 10).map((f) => [
          f.id,
          `$${(Number(f.amount_cents) / 100).toFixed(2)}`,
          f.status,
          f.reason,
          f.created_at.slice(0, 10),
        ]),
      });
      return `### Library Fines Summary\n\nTotal unpaid balance: **$${res.totalUnpaidDollars}** across **${res.fines.length}** record(s).`;
    }

    if (cmd === '/reserve') {
      const searchRes = (await executeLibraTool('searchCatalog', { query: arg, availableOnly: true }, ctx)) as {
        count: number;
        books: Array<{ id: number; title: string; author: string; available_copies: number; shelf_location: string }>;
      };
      const existingRes = (await executeLibraTool('getMyReservations', {}, ctx)) as {
        reservations: Array<{ title: string; status: string; queuePosition: number | null }>;
      };
      const holdSummary =
        existingRes.reservations.length > 0
          ? `\n\n**Your Current Reservations:**\n${existingRes.reservations
              .slice(0, 5)
              .map((r) => `- **${r.title}** — Status: **${r.status}**${r.queuePosition ? ` (Queue #${r.queuePosition})` : ''}`)
              .join('\n')}`
          : '';
      if (searchRes.count === 0) {
        return `No currently available books matched **"${arg || 'your query'}"**. Try \`/find-book\` without availability filter to join a waitlist.${holdSummary}`;
      }
      return `### Reserve an Available Book${arg ? ` · "${arg}"` : ''}\n\nClick **Reserve** on any book card below to place an official reservation with the circulation desk.${holdSummary}`;
    }
  }

  // --- ADMIN SLASH COMMANDS ---
  if (user.role === 'admin' && ADMIN_COMMANDS.has(cmd)) {
    if (cmd === '/help') {
      return [
        '### LIBRA AI — Administrator Command Reference',
        '',
        '- `/dashboard` — Live summary of library KPIs',
        '- `/inventory` — Total, available, and issued book inventory',
        '- `/low-stock` — Books at or below low-stock threshold & demand restock suggestions',
        '- `/overdue` — Overdue loans, pending renewals & unpaid fines',
        '- `/students` — Student & faculty membership statistics',
        '- `/popular-books` — Most frequently borrowed books report',
        '- `/fine-report` — Collected, unpaid & waived fine summary',
        '- `/analytics` — Comprehensive performance & circulation summary',
        '- `/report [circulation|fines|popular_books|overdue|inventory]` — Structured database report',
        '- `/help` — Show this command list',
      ].join('\n');
    }

    if (cmd === '/dashboard' || cmd === '/analytics') {
      const stats = (await executeLibraTool('getLibraryOverviewStats', {}, ctx)) as {
        books: { uniqueTitles: number; totalCopies: number; availableCopies: number; lowStockTitles: number };
        loans: { issuedBooks: number; overdueBooks: number; pendingRenewals: number };
        members: { totalStudents: number; totalFaculty: number; activeMembers: number; pendingApprovals: number };
        reservations: { pendingReservations: number; readyReservations: number };
        fines: { collectedFinesDollars: string; unpaidFinesDollars: string; waivedFinesDollars: string };
      };
      if (cmd === '/analytics') {
        await executeLibraTool('generateOperationalReport', { reportType: 'popular_books' }, ctx);
        await executeLibraTool('getInventoryIntelligence', {}, ctx);
      }
      const utilization =
        stats.books.totalCopies > 0
          ? Math.round(((stats.books.totalCopies - stats.books.availableCopies) / stats.books.totalCopies) * 100)
          : 0;
      return [
        `### ${cmd === '/analytics' ? 'Library Performance & Analytics Summary' : 'Library Executive Dashboard Summary'}`,
        '',
        `- **Catalog Holdings:** ${stats.books.uniqueTitles} unique titles · **${stats.books.totalCopies}** total copies (**${stats.books.availableCopies}** available, **${utilization}%** utilization)`,
        `- **Active Circulation:** **${stats.loans.issuedBooks}** issued volumes (**${stats.loans.overdueBooks}** overdue, **${stats.loans.pendingRenewals}** pending renewals)`,
        `- **Reservations Queue:** **${stats.reservations.pendingReservations}** pending · **${stats.reservations.readyReservations}** ready for pickup`,
        `- **Members:** **${stats.members.activeMembers}** active borrowers (**${stats.members.totalStudents}** students, **${stats.members.totalFaculty}** faculty, **${stats.members.pendingApprovals}** pending approvals)`,
        `- **Fine Ledger:** **$${stats.fines.collectedFinesDollars}** collected · **$${stats.fines.unpaidFinesDollars}** unpaid · **${stats.books.lowStockTitles}** low-stock alert(s)`,
      ].join('\n');
    }

    if (cmd === '/inventory') {
      const stats = (await executeLibraTool('getLibraryOverviewStats', {}, ctx)) as {
        books: { uniqueTitles: number; totalCopies: number; availableCopies: number; lowStockTitles: number };
        loans: { issuedBooks: number };
      };
      await executeLibraTool('generateOperationalReport', { reportType: 'inventory' }, ctx);
      return [
        '### Catalog Inventory Overview',
        '',
        `- **Unique Titles:** ${stats.books.uniqueTitles}`,
        `- **Total Physical Copies:** ${stats.books.totalCopies}`,
        `- **Available on Shelf:** ${stats.books.availableCopies}`,
        `- **Currently Issued:** ${stats.loans.issuedBooks}`,
        `- **Low-Stock Alerts:** ${stats.books.lowStockTitles}`,
      ].join('\n');
    }

    if (cmd === '/low-stock') {
      const intel = (await executeLibraTool('getInventoryIntelligence', {}, ctx)) as {
        lowStock: Array<{ title: string; available_copies: number; total_copies: number; low_stock_threshold: number }>;
        damagedCopies: Array<{ copy_code: string; title: string; condition_status: string; availability_status: string }>;
      };
      if (intel.lowStock.length === 0 && intel.damagedCopies.length === 0) {
        return '### Low-Stock Inventory Check\n\nAll catalog titles are currently above their configured low-stock thresholds, with zero damaged/lost copies flagged.';
      }
      return `### Low-Stock & Inventory Health\n\nDetected **${intel.lowStock.length}** low-stock title(s) and **${intel.damagedCopies.length}** copy condition/maintenance alert(s). Inspect the table below for details.`;
    }

    if (cmd === '/overdue') {
      const data = (await executeLibraTool('getOverdueAndDelinquentLoans', {}, ctx)) as {
        overdueLoans: Array<unknown>;
        pendingRenewals: Array<unknown>;
        unpaidFines: Array<unknown>;
      };
      return [
        '### Overdue & Delinquency Summary',
        '',
        `- **Overdue Loans:** ${data.overdueLoans.length}`,
        `- **Pending Renewal Requests:** ${data.pendingRenewals.length}`,
        `- **Unpaid Fine Records:** ${data.unpaidFines.length}`,
      ].join('\n');
    }

    if (cmd === '/students') {
      const stats = (await executeLibraTool('getLibraryOverviewStats', {}, ctx)) as {
        members: { totalStudents: number; totalFaculty: number; activeMembers: number; pendingApprovals: number };
      };
      const membersRes = (await executeLibraTool('searchMembers', { query: arg }, ctx)) as {
        members: Array<{ id: number; full_name: string; student_id: string | null; member_type: string; department: string; status: string }>;
      };
      ctx.collectedTables.push({
        title: 'Registered Members Snapshot',
        columns: ['ID', 'Name', 'Member ID', 'Type', 'Department', 'Status'],
        rows: membersRes.members.slice(0, 12).map((m) => [
          Number(m.id),
          m.full_name,
          m.student_id || 'Staff',
          m.member_type,
          m.department,
          m.status,
        ]),
      });
      return [
        '### Student & Member Statistics',
        '',
        `- **Total Students:** ${stats.members.totalStudents}`,
        `- **Total Faculty:** ${stats.members.totalFaculty}`,
        `- **Active Borrowers:** ${stats.members.activeMembers}`,
        `- **Pending Approvals:** ${stats.members.pendingApprovals}`,
      ].join('\n');
    }

    if (cmd === '/popular-books') {
      const rep = (await executeLibraTool('generateOperationalReport', { reportType: 'popular_books' }, ctx)) as {
        rowCount: number;
      };
      return `### Frequently Borrowed Books Report\n\nCompiled top **${rep.rowCount}** catalog titles ranked by total historical checkouts.`;
    }

    if (cmd === '/fine-report') {
      const stats = (await executeLibraTool('getLibraryOverviewStats', {}, ctx)) as {
        fines: { collectedFinesDollars: string; unpaidFinesDollars: string; waivedFinesDollars: string };
      };
      await executeLibraTool('generateOperationalReport', { reportType: 'fines' }, ctx);
      return [
        '### Library Fine Collection Report',
        '',
        `- **Collected (Paid):** $${stats.fines.collectedFinesDollars}`,
        `- **Outstanding (Unpaid):** $${stats.fines.unpaidFinesDollars}`,
        `- **Waived:** $${stats.fines.waivedFinesDollars}`,
      ].join('\n');
    }

    if (cmd === '/report') {
      const validTypes = ['circulation', 'fines', 'popular_books', 'overdue', 'inventory'];
      const chosen = validTypes.includes(arg.toLowerCase()) ? arg.toLowerCase() : 'circulation';
      const rep = (await executeLibraTool('generateOperationalReport', { reportType: chosen }, ctx)) as {
        reportType: string;
        rowCount: number;
      };
      return `### Operational Report · \`${rep.reportType}\`\n\nGenerated **${rep.rowCount}** row(s) directly from live database records. Available types: \`circulation\`, \`fines\`, \`popular_books\`, \`overdue\`, \`inventory\`.`;
    }
  }

  return null;
}

export async function runLibraChatTurn(params: {
  user: AuthUserRecord;
  history: Array<{ sender: 'user' | 'assistant'; content: string }>;
  prompt: string;
}): Promise<{
  replyText: string;
  metadata: AiMessageMetadata;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}> {
  const ctx: ToolExecutionContext = {
    user: params.user,
    collectedBooks: [],
    collectedTables: [],
  };

  // Fast deterministic slash-command execution grounded directly in real database records
  const slashReply = await tryRunSlashCommand(params.user, params.prompt, ctx);
  if (slashReply !== null) {
    return {
      replyText: slashReply,
      metadata: {
        model: 'libra-db-command',
        tokensUsed: 0,
        ...(ctx.collectedBooks.length > 0 ? { recommendedBooks: ctx.collectedBooks } : {}),
        ...(ctx.collectedTables.length > 0 ? { tables: ctx.collectedTables } : {}),
        ...(ctx.pendingAction ? { pendingAction: ctx.pendingAction } : {}),
      },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  const ai = getGeminiClient();
  const declarations = params.user.role === 'admin' ? ADMIN_TOOL_DECLARATIONS : STUDENT_TOOL_DECLARATIONS;

  const contents: Content[] = params.history.slice(-10).map((msg) => ({
    role: msg.sender === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));
  contents.push({
    role: 'user',
    parts: [{ text: params.prompt }],
  });

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let finalReply = '';

  try {
    for (let step = 0; step < 5; step++) {
      const response = await ai.models.generateContent({
        model: LIBRA_MODEL_ID,
        contents,
        config: {
          systemInstruction: buildSystemInstruction(params.user),
          tools: [{ functionDeclarations: declarations }],
        },
      });

      const usageMeta = response.usageMetadata;
      if (usageMeta) {
        totalPromptTokens += usageMeta.promptTokenCount ?? 0;
        totalCompletionTokens += usageMeta.candidatesTokenCount ?? 0;
        totalTokens += usageMeta.totalTokenCount ?? 0;
      }

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const functionResponseParts = await Promise.all(
          functionCalls.map(async (fc) => {
            const result = await executeLibraTool(
              fc.name ?? '',
              (fc.args as Record<string, unknown>) ?? {},
              ctx
            );
            return {
              functionResponse: {
                id: fc.id,
                name: fc.name ?? '',
                response: { output: result },
              },
            };
          })
        );

        contents.push({
          role: 'user',
          parts: functionResponseParts,
        });
        continue;
      }

      finalReply = (response.text ?? '').trim();
      break;
    }

    if (!finalReply) {
      finalReply =
        'I gathered the latest library records for you, though no additional summary text was returned. Please refine your question or inspect the cards below.';
    }

    await db.run(
      `INSERT INTO ai_usage_logs (user_id, role_scope, model, prompt_tokens, completion_tokens, total_tokens, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'success', ?)`,
      params.user.id,
      params.user.role,
      LIBRA_MODEL_ID,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      new Date().toISOString()
    );

    const metadata: AiMessageMetadata = {
      model: LIBRA_MODEL_ID,
      tokensUsed: totalTokens,
      ...(ctx.collectedBooks.length > 0 ? { recommendedBooks: ctx.collectedBooks } : {}),
      ...(ctx.collectedTables.length > 0 ? { tables: ctx.collectedTables } : {}),
      ...(ctx.pendingAction ? { pendingAction: ctx.pendingAction } : {}),
    };

    return {
      replyText: finalReply,
      metadata,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens,
      },
    };
  } catch (err) {
    await db
      .run(
        `INSERT INTO ai_usage_logs (user_id, role_scope, model, prompt_tokens, completion_tokens, total_tokens, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'error', ?)`,
        params.user.id,
        params.user.role,
        LIBRA_MODEL_ID,
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        new Date().toISOString()
      )
      .catch(() => {});

    if (err instanceof AiProviderError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : 'Unexpected AI provider error.';
    throw new AiProviderError(
      `LIBRA AI could not reach the Gemini model (${msg}). You can still use built-in /slash commands like ${
        params.user.role === 'admin' ? '/dashboard, /inventory, /overdue' : '/find-book, /my-books, /due-dates'
      }.`,
      502
    );
  }
}

export function isAiProviderConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}
