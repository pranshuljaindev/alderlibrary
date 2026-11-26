import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  FileText,
  FileUp,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  ScanLine,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { ApiError, apiRequest } from '../../lib/api';
import type { Book, BookCopy, DigitalResource } from '../../types';
import { BookCover } from '../student/BookCover';

interface AdminInventorySectionProps {
  mode: 'books' | 'inventory';
  books: Book[];
  copies: BookCopy[];
  digitalResources: DigitalResource[];
  categories: string[];
  busyAction: string | null;
  onRefresh: () => Promise<void>;
  onOpenAddBook: () => void;
  onOpenEditBook: (book: Book) => void;
  onDeleteBook: (book: Book) => void;
  onOpenBulkImport: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export function AdminInventorySection({
  mode,
  books,
  copies,
  digitalResources,
  categories,
  busyAction,
  onRefresh,
  onOpenAddBook,
  onOpenEditBook,
  onDeleteBook,
  onOpenBulkImport,
  onNotify,
}: AdminInventorySectionProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [bookSubTab, setBookSubTab] = useState<'catalog' | 'digital'>('catalog');
  const [copySearch, setCopySearch] = useState('');
  const [qrModalCopy, setQrModalCopy] = useState<BookCopy | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [uploadingBookId, setUploadingBookId] = useState<number | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const targetBookIdRef = useRef<number | null>(null);

  // Digital resource form
  const [digitalFormOpen, setDigitalFormOpen] = useState(false);
  const [digitalForm, setDigitalForm] = useState({
    title: '',
    author: '',
    category: 'Computer Science',
    description: '',
    resourceType: 'pdf' as 'pdf' | 'ebook' | 'guide' | 'journal',
    accessLevel: 'all' as 'all' | 'student' | 'faculty' | 'admin',
    externalUrl: '',
    fileBase64: '',
    fileName: '',
  });
  const [savingDigital, setSavingDigital] = useState(false);

  // QR Desk quick lookup
  const [qrScanInput, setQrScanInput] = useState('');
  const [qrScanResult, setQrScanResult] = useState<{
    copy: BookCopy & { book_title: string; book_author: string; book_call_number: string; shelf_location: string };
    activeLoan: { id: number; borrower_name: string; borrower_email: string; due_date: string } | null;
  } | null>(null);
  const [lookingUpQr, setLookingUpQr] = useState(false);

  useEffect(() => {
    if (!qrModalCopy) {
      setQrDataUrl('');
      return;
    }
    void QRCode.toDataURL(qrModalCopy.qr_token, {
      width: 240,
      margin: 2,
      color: { dark: '#0A0D1A', light: '#F8FAFC' },
    }).then(setQrDataUrl);
  }, [qrModalCopy]);

  const filteredBooks = books.filter((b) => {
    if (category !== 'all' && b.category !== category) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q) ||
      b.isbn.toLowerCase().includes(q) ||
      b.call_number.toLowerCase().includes(q)
    );
  });

  const filteredCopies = copies.filter((c) => {
    const q = copySearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.copy_code.toLowerCase().includes(q) ||
      c.qr_token.toLowerCase().includes(q) ||
      (c.book_title || '').toLowerCase().includes(q) ||
      c.rack_location.toLowerCase().includes(q)
    );
  });

  const lowStockBooks = books.filter((b) => b.available_copies <= (b.low_stock_threshold ?? 2));

  function triggerCoverUpload(bookId: number) {
    targetBookIdRef.current = bookId;
    coverInputRef.current?.click();
  }

  async function handleCoverFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const bookId = targetBookIdRef.current;
    e.target.value = '';
    if (!file || !bookId) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      onNotify('error', 'Please select a PNG, JPG, or WebP cover image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onNotify('error', 'Cover image must be under 5 MB.');
      return;
    }

    setUploadingBookId(bookId);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });

      await apiRequest(`/api/admin/books/${bookId}/cover`, {
        method: 'POST',
        body: JSON.stringify({ dataBase64, mimeType: file.type }),
      });
      onNotify('success', 'Book cover uploaded.');
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setUploadingBookId(null);
    }
  }

  async function handleAddPhysicalCopy(bookId: number) {
    try {
      await apiRequest('/api/admin/copies', {
        method: 'POST',
        body: JSON.stringify({ bookId }),
      });
      onNotify('success', 'New physical copy & QR label generated.');
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    }
  }

  async function handleUpdateCopy(copyId: number, patch: { conditionStatus?: string; availabilityStatus?: string }) {
    try {
      await apiRequest(`/api/admin/copies/${copyId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onNotify('success', 'Physical copy status updated.');
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    }
  }

  async function handleQrLookup(e: FormEvent) {
    e.preventDefault();
    const code = qrScanInput.trim();
    if (!code) return;
    setLookingUpQr(true);
    try {
      const res = await apiRequest<{
        copy: BookCopy & { book_title: string; book_author: string; book_call_number: string; shelf_location: string };
        activeLoan: { id: number; borrower_name: string; borrower_email: string; due_date: string } | null;
      }>(`/api/admin/qr/${encodeURIComponent(code)}`);
      setQrScanResult(res);
    } catch (err) {
      setQrScanResult(null);
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setLookingUpQr(false);
    }
  }

  async function handleDigitalPdfSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      onNotify('error', 'Only PDF files are allowed for digital document uploads.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onNotify('error', 'PDF must be under 10 MB.');
      return;
    }
    const b64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read PDF.'));
      reader.readAsDataURL(file);
    });
    setDigitalForm((f) => ({ ...f, fileBase64: b64, fileName: file.name }));
  }

  async function handleSaveDigitalResource(e: FormEvent) {
    e.preventDefault();
    setSavingDigital(true);
    try {
      await apiRequest('/api/admin/digital-resources', {
        method: 'POST',
        body: JSON.stringify(digitalForm),
      });
      onNotify('success', 'Digital resource published to Digital Library.');
      setDigitalFormOpen(false);
      setDigitalForm({
        title: '',
        author: '',
        category: 'Computer Science',
        description: '',
        resourceType: 'pdf',
        accessLevel: 'all',
        externalUrl: '',
        fileBase64: '',
        fileName: '',
      });
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    } finally {
      setSavingDigital(false);
    }
  }

  async function handleDeleteDigitalResource(id: number) {
    try {
      await apiRequest(`/api/admin/digital-resources/${id}`, { method: 'DELETE' });
      onNotify('info', 'Digital resource removed.');
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiError) onNotify('error', err.message);
    }
  }

  return (
    <div className="space-y-6">
      <input
        ref={coverInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleCoverFileSelected}
      />

      {mode === 'books' ? (
        <>
          {/* Book Management Sub-Tabs & Toolbar */}
          <div className="student-glass-card rounded-2xl p-4 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBookSubTab('catalog')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  bookSubTab === 'catalog'
                    ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white'
                    : 'border border-white/15 text-[#CBD5E1] hover:border-[#A78BFA]/60'
                }`}
              >
                Print Catalog ({books.length})
              </button>
              <button
                type="button"
                onClick={() => setBookSubTab('digital')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  bookSubTab === 'digital'
                    ? 'bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white'
                    : 'border border-white/15 text-[#CBD5E1] hover:border-[#A78BFA]/60'
                }`}
              >
                Digital Library ({digitalResources.length})
              </button>
            </div>

            {bookSubTab === 'catalog' ? (
              <div className="flex flex-wrap items-center gap-2.5 flex-1 justify-end">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="w-4 h-4 text-[#A78BFA]/80 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search title, author, ISBN, call #..."
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm"
                  />
                </div>
                <select
                  aria-label="Filter by category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="dark-glass-input obsidian-input-focus rounded-xl px-3 py-2 text-xs sm:text-sm"
                >
                  <option value="all">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onOpenBulkImport}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#A78BFA]/35 bg-[#12162A] px-3.5 py-2 text-xs font-medium text-[#A78BFA] hover:border-[#A78BFA] cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  <span>Bulk CSV Import</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenAddBook}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Book</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDigitalFormOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer self-end"
              >
                <Upload className="w-4 h-4" />
                <span>Add Digital Resource</span>
              </button>
            )}
          </div>

          {bookSubTab === 'catalog' ? (
            <div className="student-glass-card rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-[#080B16]/85 text-xs font-medium text-[#A78BFA]">
                      <th className="py-3 px-4">Volume</th>
                      <th className="py-3 px-4">ISBN &amp; Call #</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Shelf / Rack</th>
                      <th className="py-3 px-4 text-right">Stock</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-xs">
                    {filteredBooks.map((book) => {
                      const isLow = book.available_copies <= (book.low_stock_threshold ?? 2);
                      return (
                        <tr key={book.id} className="student-row-hover">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <BookCover
                                title={book.title}
                                category={book.category}
                                coverUrl={book.cover_url}
                                size="xs"
                              />
                              <div className="min-w-0">
                                <div className="font-serif text-sm font-semibold text-[#F5F3EE]">
                                  {book.title}
                                </div>
                                <div className="text-[#F5F3EE]/65">{book.author}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-[#F5F3EE]/80">
                            <div>{book.isbn}</div>
                            <div className="text-[#A78BFA]">{book.call_number}</div>
                          </td>
                          <td className="py-3 px-4 text-[#E2E8F0]">{book.category}</td>
                          <td className="py-3 px-4 text-[#CBD5E1]">
                            <div>{book.shelf_location}</div>
                            {book.rack_code && (
                              <div className="font-mono text-[11px] text-[#38BDF8]">Rack {book.rack_code}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            <div className={isLow ? 'text-amber-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                              {book.available_copies} / {book.total_copies}
                            </div>
                            {isLow && <div className="text-[10px] text-amber-400">Low Stock</div>}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={uploadingBookId === book.id}
                                onClick={() => triggerCoverUpload(book.id)}
                                title="Upload Cover Image"
                                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-[#CBD5E1] hover:border-[#A78BFA] hover:text-[#A78BFA] cursor-pointer"
                              >
                                {uploadingBookId === book.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <ImagePlus className="w-3.5 h-3.5" />
                                )}
                                <span>Cover</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenEditBook(book)}
                                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-[#E2E8F0] hover:border-[#38BDF8] hover:text-[#38BDF8] cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                disabled={busyAction === `delete-book-${book.id}`}
                                onClick={() => onDeleteBook(book)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-400/25 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="student-glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10">
                <h3 className="text-base font-semibold text-white">
                  Digital Repository &amp; Academic Guides
                </h3>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  Authorized PDFs, study guides, and external scholarly resources accessible in the Student Portal.
                </p>
              </div>
              <div className="divide-y divide-white/10">
                {digitalResources.map((res) => (
                  <div key={res.id} className="p-4 sm:px-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-[#A78BFA]">
                        <FileText className="w-3.5 h-3.5" />
                        <span className="uppercase font-mono">{res.resource_type}</span>
                        <span>·</span>
                        <span>{res.category}</span>
                        <span>·</span>
                        <span className="text-[#38BDF8]">Access: {res.access_level}</span>
                      </div>
                      <div className="text-sm font-semibold text-white">{res.title}</div>
                      <div className="text-xs text-[#94A3B8]">{res.author} — {res.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteDigitalResource(res.id)}
                      className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* INVENTORY MANAGEMENT: Physical Copies, QR Codes, Rack Locations, Low-Stock Alerts */
        <div className="space-y-6">
          {/* Low-Stock Alerts & Smart QR Lookup */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section className="lg:col-span-5 student-glass-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[#A78BFA]">
                  <ScanLine className="w-4 h-4" />
                  <h3 className="text-base font-semibold text-white">
                    Smart QR Copy Lookup
                  </h3>
                </div>
              </div>
              <p className="text-xs text-[#94A3B8]">
                Enter or scan a copy QR token (e.g. <code className="font-mono text-[#A78BFA]">SMARTLIB:LIB-0001-C01</code>) to inspect its shelf rack and loan status.
              </p>
              <form onSubmit={handleQrLookup} className="flex gap-2">
                <input
                  type="text"
                  value={qrScanInput}
                  onChange={(e) => setQrScanInput(e.target.value)}
                  placeholder="SMARTLIB:LIB-0001-C01"
                  className="dark-glass-input obsidian-input-focus flex-1 rounded-xl px-3 py-2 text-xs font-mono"
                />
                <button
                  type="submit"
                  disabled={lookingUpQr}
                  className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                >
                  {lookingUpQr ? 'Checking...' : 'Lookup'}
                </button>
              </form>

              {qrScanResult && (
                <div className="rounded-xl border border-[#A78BFA]/30 bg-[#0A0D1A]/85 p-3.5 text-xs space-y-1.5">
                  <div className="text-sm font-semibold text-white">
                    {qrScanResult.copy.book_title}
                  </div>
                  <div className="font-mono text-[#A78BFA]">
                    {qrScanResult.copy.copy_code} · {qrScanResult.copy.book_call_number}
                  </div>
                  <div className="text-[#CBD5E1]">
                    Status: <span className="capitalize font-semibold text-[#38BDF8]">{qrScanResult.copy.availability_status}</span> · Rack: {qrScanResult.copy.rack_location}
                  </div>
                  {qrScanResult.activeLoan && (
                    <div className="text-amber-300 pt-1 border-t border-white/10">
                      Checked out to {qrScanResult.activeLoan.borrower_name} (Due {qrScanResult.activeLoan.due_date.slice(0, 10)})
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="lg:col-span-7 student-glass-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-300">
                  <AlertTriangle className="w-4 h-4" />
                  <h3 className="text-base font-semibold text-white">
                    Low-Stock Threshold Alerts ({lowStockBooks.length})
                  </h3>
                </div>
              </div>
              {lowStockBooks.length === 0 ? (
                <p className="text-xs text-[#94A3B8]">All catalog titles are above their configured stock thresholds.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
                  {lowStockBooks.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-xl border border-amber-400/25 bg-[#0A0D1A]/75 px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{b.title}</div>
                        <div className="text-[11px] font-mono text-amber-300 tabular-nums">
                          {b.available_copies}/{b.total_copies} avail (min {b.low_stock_threshold ?? 2})
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAddPhysicalCopy(b.id)}
                        className="shrink-0 rounded-lg border border-[#A78BFA]/40 px-2.5 py-1 text-[11px] text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
                      >
                        + Copy
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Physical Book Copies & QR Tags Ledger */}
          <section className="student-glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-white">
                  Physical Book Copies &amp; Rack Tracking ({copies.length})
                </h3>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  Individual barcode/QR tracking, shelf rack assignment, and physical condition audits.
                </p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-[#A78BFA]/80 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={copySearch}
                  onChange={(e) => setCopySearch(e.target.value)}
                  placeholder="Filter by copy code, QR, title, rack..."
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl pl-9 pr-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-[#080B16]/85 text-[#A78BFA]">
                    <th className="py-3 px-4">Copy Code</th>
                    <th className="py-3 px-4">Book Title</th>
                    <th className="py-3 px-4">Rack Location</th>
                    <th className="py-3 px-4">Condition</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">QR Label</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredCopies.slice(0, 80).map((copy) => (
                    <tr key={copy.id} className="student-row-hover">
                      <td className="py-2.5 px-4 font-mono text-[#A78BFA] whitespace-nowrap">{copy.copy_code}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-white">{copy.book_title}</div>
                        {copy.borrower_name && (
                          <div className="text-[11px] text-[#38BDF8]">Issued to {copy.borrower_name}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-[#CBD5E1]">{copy.rack_location}</td>
                      <td className="py-2.5 px-4">
                        <select
                          aria-label={`Condition for ${copy.copy_code}`}
                          value={copy.condition_status}
                          onChange={(e) => void handleUpdateCopy(copy.id, { conditionStatus: e.target.value })}
                          className="dark-glass-input rounded-lg px-2 py-1 text-xs capitalize"
                        >
                          <option value="new">New</option>
                          <option value="good">Good</option>
                          <option value="fair">Fair</option>
                          <option value="damaged">Damaged</option>
                          <option value="repair">Repair</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-4">
                        <select
                          aria-label={`Availability for ${copy.copy_code}`}
                          value={copy.availability_status}
                          disabled={copy.availability_status === 'issued'}
                          onChange={(e) => void handleUpdateCopy(copy.id, { availabilityStatus: e.target.value })}
                          className="dark-glass-input rounded-lg px-2 py-1 text-xs capitalize disabled:opacity-60"
                        >
                          <option value="available">Available</option>
                          <option value="issued">Issued</option>
                          <option value="reserved">Reserved</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="lost">Lost</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setQrModalCopy(copy)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#A78BFA]/35 px-2.5 py-1.5 text-xs text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>QR Tag</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* QR Code Modal */}
      {qrModalCopy && (
        <div className="fixed inset-0 z-50 bg-[#040610]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-sm w-full p-6 text-center space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-[#A78BFA]">Smart QR Copy Tag</span>
              <button type="button" onClick={() => setQrModalCopy(null)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            {qrDataUrl && (
              <div className="bg-[#F8FAFC] rounded-xl p-4 inline-block mx-auto">
                <img src={qrDataUrl} alt={`QR code for ${qrModalCopy.copy_code}`} className="w-48 h-48 mx-auto" />
              </div>
            )}
            <div className="space-y-1">
              <div className="text-base font-semibold text-white">{qrModalCopy.book_title}</div>
              <div className="font-mono text-xs text-[#A78BFA]">{qrModalCopy.qr_token}</div>
              <div className="text-xs text-[#94A3B8]">{qrModalCopy.rack_location}</div>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(qrModalCopy.qr_token);
                  onNotify('info', `Copied ${qrModalCopy.qr_token}`);
                }}
                className="rounded-xl border border-[#A78BFA]/35 px-4 py-2 text-xs font-medium text-[#A78BFA] hover:bg-[#8B5CF6]/15 cursor-pointer"
              >
                Copy Token
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
              >
                Print Label
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Digital Resource Modal */}
      {digitalFormOpen && (
        <div className="fixed inset-0 z-50 bg-[#040610]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="obsidian-modal-panel rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Add Digital Library Resource</h3>
              <button type="button" onClick={() => setDigitalFormOpen(false)} className="text-[#94A3B8] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveDigitalResource} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#CBD5E1] mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={digitalForm.title}
                  onChange={(e) => setDigitalForm((f) => ({ ...f, title: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Author / Department</label>
                  <input
                    type="text"
                    required
                    value={digitalForm.author}
                    onChange={(e) => setDigitalForm((f) => ({ ...f, author: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Category</label>
                  <input
                    type="text"
                    required
                    value={digitalForm.category}
                    onChange={(e) => setDigitalForm((f) => ({ ...f, category: e.target.value }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Resource Type</label>
                  <select
                    value={digitalForm.resourceType}
                    onChange={(e) => setDigitalForm((f) => ({ ...f, resourceType: e.target.value as typeof f.resourceType }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="pdf">PDF Document</option>
                    <option value="guide">Study Guide</option>
                    <option value="ebook">E-Book</option>
                    <option value="journal">Journal Packet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[#CBD5E1] mb-1">Access Level</label>
                  <select
                    value={digitalForm.accessLevel}
                    onChange={(e) => setDigitalForm((f) => ({ ...f, accessLevel: e.target.value as typeof f.accessLevel }))}
                    className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="all">All Library Members</option>
                    <option value="student">Students Only</option>
                    <option value="faculty">Faculty Only</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={digitalForm.description}
                  onChange={(e) => setDigitalForm((f) => ({ ...f, description: e.target.value }))}
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Upload PDF (max 10 MB)</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleDigitalPdfSelect}
                  className="dark-glass-input w-full rounded-xl px-3 py-2 text-xs"
                />
                {digitalForm.fileName && <p className="text-emerald-300 mt-1">Selected: {digitalForm.fileName}</p>}
              </div>
              <div>
                <label className="block text-[#CBD5E1] mb-1">Or External HTTPS Link (Optional)</label>
                <input
                  type="url"
                  value={digitalForm.externalUrl}
                  onChange={(e) => setDigitalForm((f) => ({ ...f, externalUrl: e.target.value }))}
                  placeholder="https://..."
                  className="dark-glass-input obsidian-input-focus w-full rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDigitalFormOpen(false)}
                  className="rounded-xl border border-white/15 px-4 py-2 text-xs text-[#CBD5E1] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDigital}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] cursor-pointer"
                >
                  {savingDigital ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                  <span>Publish Resource</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
