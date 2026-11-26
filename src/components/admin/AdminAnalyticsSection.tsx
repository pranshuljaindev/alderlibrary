import { useState } from 'react';
import { Download, FileSpreadsheet, TrendingUp } from 'lucide-react';
import { jsPDF } from 'jspdf';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface AnalyticsPayload {
  monthlyCirculation: Array<{ month: string; issued: number; returned: number; overdue: number }>;
  dailyCirculation: Array<{ day: string; issued: number; returned: number }>;
  popularBooks: Array<{
    id: number;
    isbn: string;
    title: string;
    author: string;
    category: string;
    call_number: string;
    total_copies: number;
    available_copies: number;
    checkoutCount: number;
    holdCount: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    titles: number;
    totalCopies: number;
    availableCopies: number;
    totalCheckouts: number;
  }>;
  studentActivity: Array<{
    id: number;
    fullName: string;
    email: string;
    studentId: string | null;
    memberType: string;
    department: string;
    status: string;
    totalLoans: number;
    activeLoans: number;
    overdueLoans: number;
    unpaidFinesCents: number;
  }>;
  overdueLoans: Array<{
    id: number;
    issued_at: string;
    due_date: string;
    book_title: string;
    call_number: string;
    borrower_name: string;
    borrower_email: string;
    borrower_student_id: string | null;
  }>;
  fineSummary: {
    paidCents: number;
    unpaidCents: number;
    waivedCents: number;
    totalRecords: number;
  };
  demandPrediction: Array<{
    bookId: number;
    title: string;
    author: string;
    category: string;
    totalCopies: number;
    availableCopies: number;
    historicalLoans: number;
    recentLoans30d: number;
    activeHolds: number;
    projectedDemandScore: number;
    recommendedExtraCopies: number;
  }>;
}

interface AdminAnalyticsSectionProps {
  libraryName: string;
  analytics: AnalyticsPayload | null;
}

type ReportKind =
  | 'daily'
  | 'monthly'
  | 'fines'
  | 'inventory'
  | 'students'
  | 'popular'
  | 'overdue'
  | 'demand';

const REPORT_LABELS: Record<ReportKind, string> = {
  daily: 'Daily Circulation Report',
  monthly: 'Monthly Library Summary',
  fines: 'Fine Collection Report',
  inventory: 'Category & Inventory Report',
  students: 'Student & Faculty Activity Report',
  popular: 'Most Popular Books Report',
  overdue: 'Overdue Books Report',
  demand: 'Smart Demand Prediction (Projected)',
};

export function AdminAnalyticsSection({ libraryName, analytics }: AdminAnalyticsSectionProps) {
  const [reportKind, setReportKind] = useState<ReportKind>('monthly');

  if (!analytics) {
    return (
      <div className="student-glass-card rounded-2xl p-10 text-center text-sm text-[#F5F3EE]/60">
        Loading analytics and reporting datasets...
      </div>
    );
  }

  function getReportTable(): { columns: string[]; rows: Array<Array<string | number>> } {
    if (!analytics) return { columns: [], rows: [] };
    switch (reportKind) {
      case 'daily':
        return {
          columns: ['Date', 'Issued', 'Returned'],
          rows: analytics.dailyCirculation.map((d) => [d.day, d.issued, d.returned]),
        };
      case 'monthly':
        return {
          columns: ['Month', 'Issued', 'Returned', 'Overdue'],
          rows: analytics.monthlyCirculation.map((m) => [m.month, m.issued, m.returned, m.overdue]),
        };
      case 'fines':
        return {
          columns: ['Metric', 'Amount (USD)'],
          rows: [
            ['Collected Fines (Paid)', `$${(analytics.fineSummary.paidCents / 100).toFixed(2)}`],
            ['Outstanding Fines (Unpaid)', `$${(analytics.fineSummary.unpaidCents / 100).toFixed(2)}`],
            ['Waived Fines', `$${(analytics.fineSummary.waivedCents / 100).toFixed(2)}`],
            ['Total Fine Assessments', analytics.fineSummary.totalRecords],
          ],
        };
      case 'inventory':
        return {
          columns: ['Category', 'Titles', 'Total Copies', 'Available', 'Checkouts'],
          rows: analytics.categoryBreakdown.map((c) => [c.category, c.titles, c.totalCopies, c.availableCopies, c.totalCheckouts]),
        };
      case 'students':
        return {
          columns: ['Member', 'ID', 'Type', 'Total Loans', 'Active', 'Overdue', 'Unpaid Fines'],
          rows: analytics.studentActivity.map((s) => [
            s.fullName,
            s.studentId || s.email,
            s.memberType,
            s.totalLoans,
            s.activeLoans,
            s.overdueLoans,
            `$${(s.unpaidFinesCents / 100).toFixed(2)}`,
          ]),
        };
      case 'popular':
        return {
          columns: ['Title', 'Author', 'Category', 'Checkouts', 'Active Holds', 'Stock'],
          rows: analytics.popularBooks.map((b) => [
            b.title,
            b.author,
            b.category,
            b.checkoutCount,
            b.holdCount,
            `${b.available_copies}/${b.total_copies}`,
          ]),
        };
      case 'overdue':
        return {
          columns: ['Loan ID', 'Book Title', 'Borrower', 'Issued', 'Due Date'],
          rows: analytics.overdueLoans.map((o) => [
            o.id,
            o.book_title,
            `${o.borrower_name} (${o.borrower_student_id || o.borrower_email})`,
            o.issued_at.slice(0, 10),
            o.due_date.slice(0, 10),
          ]),
        };
      case 'demand':
        return {
          columns: ['Title', 'Historical Loans', '30d Velocity', 'Active Holds', 'Projected Score', 'Suggested Restock'],
          rows: analytics.demandPrediction.map((d) => [
            d.title,
            d.historicalLoans,
            d.recentLoans30d,
            d.activeHolds,
            d.projectedDemandScore,
            d.recommendedExtraCopies > 0 ? `+${d.recommendedExtraCopies} copies` : 'Sufficient',
          ]),
        };
    }
  }

  const table = getReportTable();

  function exportCsv() {
    const escape = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
    const lines = [table.columns.map(escape).join(','), ...table.rows.map((r) => r.map(escape).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportKind}_report_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(`${libraryName} — ${REPORT_LABELS[reportKind]}`, 40, 48);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, 40, 66);

    let y = 92;
    doc.setFont('helvetica', 'bold');
    doc.text(table.columns.join('  |  ').slice(0, 110), 40, y);
    y += 14;
    doc.setDrawColor(180);
    doc.line(40, y - 6, 555, y - 6);

    doc.setFont('helvetica', 'normal');
    for (const row of table.rows) {
      if (y > 760) {
        doc.addPage();
        y = 48;
      }
      const line = row.map((v) => String(v)).join('  |  ').slice(0, 115);
      doc.text(line, 40, y);
      y += 16;
    }

    doc.save(`${reportKind}_report_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return (
    <div className="space-y-6">
      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-7 student-glass-card rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white">
              Monthly Issue &amp; Return Trends (Historical)
            </h3>
            <p className="text-xs text-[#94A3B8]">Actual recorded circulation across academic months</p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.monthlyCirculation}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0A0D1A',
                    borderColor: 'rgba(167,139,250,0.4)',
                    borderRadius: 12,
                    color: '#F8FAFC',
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="issued" name="Issued" stroke="#A78BFA" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="returned" name="Returned" stroke="#38BDF8" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="overdue" name="Overdue" stroke="#FB7185" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="xl:col-span-5 student-glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#A78BFA]" />
                <span>Smart Demand Forecast</span>
              </h3>
              <p className="text-xs text-[#94A3B8]">Projected score (historical velocity + holds)</p>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.demandPrediction.slice(0, 6)} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                <YAxis
                  type="category"
                  dataKey="title"
                  width={130}
                  stroke="#cbd5e1"
                  fontSize={10}
                  tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 18)}…` : v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0A0D1A',
                    borderColor: 'rgba(167,139,250,0.4)',
                    borderRadius: 12,
                    color: '#F8FAFC',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="projectedDemandScore" name="Projected Demand Score" radius={[0, 6, 6, 0]}>
                  {analytics.demandPrediction.slice(0, 6).map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#A78BFA' : i === 1 ? '#38BDF8' : '#4F46E5'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Interactive Report Generator & Export */}
      <section className="student-glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              {REPORT_LABELS[reportKind]}
            </h3>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              {reportKind === 'demand'
                ? 'Projected demand is computed from historical checkout frequency, active holds, and stock utilization.'
                : 'Verified real-time export from the library SQLite database.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select report dataset"
              value={reportKind}
              onChange={(e) => setReportKind(e.target.value as ReportKind)}
              className="dark-glass-input obsidian-input-focus rounded-xl px-3 py-2 text-xs"
            >
              {(Object.keys(REPORT_LABELS) as ReportKind[]).map((key) => (
                <option key={key} value={key}>
                  {REPORT_LABELS[key]}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#A78BFA]/35 px-3.5 py-2 text-xs font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#8B5CF6] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#7C3AED] cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-[#0A0D1A]/75 text-[#A78BFA]">
                {table.columns.map((col) => (
                  <th key={col} className="py-3 px-4 font-medium whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {table.rows.length === 0 ? (
                <tr>
                  <td colSpan={table.columns.length} className="py-8 text-center text-[#94A3B8]">
                    No records available for this report.
                  </td>
                </tr>
              ) : (
                table.rows.map((row, idx) => (
                  <tr key={idx} className="student-row-hover">
                    {row.map((val, cIdx) => (
                      <td key={cIdx} className="py-2.5 px-4 text-[#E2E8F0] font-mono tabular-nums whitespace-nowrap">
                        {String(val)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
