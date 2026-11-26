import { ArrowLeft, BookMarked, BookOpen, Building2, CheckCircle2, Clock, Hash, MapPin, ThumbsDown, ThumbsUp } from 'lucide-react';
import { motion } from 'motion/react';
import type { Book, ReservationRecord } from '../../types';
import { BookCover } from './BookCover';

interface BookDetailsViewProps {
  book: Book;
  relatedBooks: Book[];
  alreadyBorrowed: boolean;
  activeReservation?: ReservationRecord;
  currentFeedback?: 'like' | 'dislike';
  busyAction: string | null;
  onBack: () => void;
  onSelectBook: (book: Book) => void;
  onReserve: (book: Book) => void;
  onCancelReservation: (reservationId: number) => void;
  onFeedback?: (bookId: number, feedback: 'like' | 'dislike' | 'clear') => void;
}

export function BookDetailsView({
  book,
  relatedBooks,
  alreadyBorrowed,
  activeReservation,
  currentFeedback,
  busyAction,
  onBack,
  onSelectBook,
  onReserve,
  onCancelReservation,
  onFeedback,
}: BookDetailsViewProps) {
  const isAvailable = book.available_copies > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-8"
    >
      {/* Back navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-[#A78BFA]/25 bg-[#12162A]/80 px-3.5 py-2 text-xs font-medium text-white hover:border-[#A78BFA] hover:text-[#A78BFA] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Catalog</span>
        </button>

        <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
          <span>{book.category}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[#A78BFA]">{book.call_number}</span>
        </div>
      </div>

      {/* Main Book Showcase Card */}
      <section className="student-glass-card rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Hardcover Volume Presentation */}
          <div className="mx-auto lg:mx-0 shrink-0">
            <BookCover
              title={book.title}
              author={book.author}
              category={book.category}
              callNumber={book.call_number}
              coverUrl={book.cover_url}
              size="lg"
            />
          </div>

          {/* Complete Book Information */}
          <div className="flex-1 min-w-0 space-y-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="text-[#A78BFA]">{book.category}</span>
                <span className="text-white/25" aria-hidden="true">·</span>
                <span className={isAvailable ? 'text-emerald-400' : 'text-amber-300'}>
                  {isAvailable
                    ? `${book.available_copies} of ${book.total_copies} Copies Available`
                    : 'All Copies Checked Out (Waitlist Open)'}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white [text-wrap:balance]">
                {book.title}
              </h1>
              <p className="text-sm sm:text-base text-[#CBD5E1]">
                by <span className="text-white font-medium">{book.author}</span>
              </p>
            </div>

            <p className="text-sm text-[#CBD5E1] leading-relaxed max-w-prose">
              {book.description || 'Archival scholarly volume cataloged in the Smart Library collection.'}
            </p>

            {/* Structured Accession & Location Metadata */}
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-white/10 text-xs">
              <div className="space-y-1">
                <dt className="text-[#94A3B8] flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                  <span>ISBN-13</span>
                </dt>
                <dd className="font-mono text-sm text-white tabular-nums">{book.isbn}</dd>
              </div>

              <div className="space-y-1">
                <dt className="text-[#94A3B8] flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                  <span>Call Number</span>
                </dt>
                <dd className="font-mono text-sm text-white">{book.call_number}</dd>
              </div>

              <div className="space-y-1">
                <dt className="text-[#94A3B8] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                  <span>Shelf Location</span>
                </dt>
                <dd className="text-sm text-white">{book.shelf_location}</dd>
              </div>

              <div className="space-y-1">
                <dt className="text-[#94A3B8] flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                  <span>Publisher &amp; Year</span>
                </dt>
                <dd className="text-sm text-white">
                  {book.publisher} · <span className="font-mono tabular-nums">{book.published_year}</span>
                </dd>
              </div>

              <div className="space-y-1">
                <dt className="text-[#94A3B8] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                  <span>Circulation Activity</span>
                </dt>
                <dd className="font-mono text-sm text-white tabular-nums">
                  {book.borrow_count ?? 0} recorded checkouts
                </dd>
              </div>

              <div className="space-y-1">
                <dt className="text-[#94A3B8] flex items-center gap-1.5">
                  <BookMarked className="w-3.5 h-3.5 text-[#A78BFA]" aria-hidden="true" />
                  <span>Active Holds</span>
                </dt>
                <dd className="font-mono text-sm text-white tabular-nums">
                  {book.active_reservation_count ?? 0} in queue
                </dd>
              </div>
            </dl>

            {/* Primary Action Bar */}
            <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {alreadyBorrowed ? (
                  <div className="inline-flex items-center gap-2 rounded-xl border border-[#38BDF8]/40 bg-[#38BDF8]/15 px-4 py-2.5 text-sm font-medium text-[#38BDF8]">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>Currently Checked Out to Your Account</span>
                  </div>
                ) : activeReservation ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-950/40 px-4 py-2.5 text-sm font-medium text-emerald-300">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      <span>
                        {activeReservation.status === 'ready'
                          ? 'Ready for Pickup at Desk'
                          : `Reservation Active (Queue #${activeReservation.queue_position ?? 1})`}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busyAction === `cancel-res-${activeReservation.id}`}
                      onClick={() => onCancelReservation(activeReservation.id)}
                      className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-medium text-[#CBD5E1] hover:border-rose-400/60 hover:text-rose-300 transition-colors cursor-pointer"
                    >
                      {busyAction === `cancel-res-${activeReservation.id}` ? 'Cancelling...' : 'Cancel Hold'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busyAction === `reserve-${book.id}`}
                    onClick={() => onReserve(book)}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-6 py-3 text-sm font-semibold text-white hover:from-[#9F7AEA] hover:to-[#7C3AED] disabled:opacity-60 transition-all shadow-lg shadow-[#7C3AED]/25 cursor-pointer"
                  >
                    <BookMarked className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {busyAction === `reserve-${book.id}`
                        ? 'Submitting Reservation...'
                        : isAvailable
                          ? 'Reserve Volume for Pickup'
                          : 'Join Waitlist Queue'}
                    </span>
                  </button>
                )}
              </div>

              {onFeedback && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onFeedback(book.id, currentFeedback === 'like' ? 'clear' : 'like')}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-colors cursor-pointer ${
                      currentFeedback === 'like'
                        ? 'border-emerald-400/50 bg-emerald-950/40 text-emerald-300'
                        : 'border-white/15 text-[#94A3B8] hover:border-[#A78BFA]'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Relevant</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onFeedback(book.id, currentFeedback === 'dislike' ? 'clear' : 'dislike')}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-colors cursor-pointer ${
                      currentFeedback === 'dislike'
                        ? 'border-rose-400/50 bg-rose-950/40 text-rose-300'
                        : 'border-white/15 text-[#94A3B8] hover:border-rose-400/40'
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>Not Interested</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Related / Same-Subject Volumes */}
      {relatedBooks.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Related Volumes in Catalog
            </h2>
            <span className="text-xs text-[#94A3B8]">{book.category} &amp; neighboring shelves</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {relatedBooks.map((rel) => (
              <button
                key={rel.id}
                type="button"
                onClick={() => onSelectBook(rel)}
                className="student-glass-card rounded-xl p-4 text-left flex items-center gap-4 cursor-pointer group"
              >
                <BookCover title={rel.title} category={rel.category} coverUrl={rel.cover_url} size="sm" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-[11px] text-[#A78BFA] truncate">{rel.category}</div>
                  <div className="text-sm font-semibold text-white group-hover:text-[#A78BFA] transition-colors line-clamp-2">
                    {rel.title}
                  </div>
                  <div className="text-xs text-[#94A3B8] truncate">{rel.author}</div>
                  <div className="text-[11px] font-mono tabular-nums text-[#CBD5E1]">
                    {rel.available_copies}/{rel.total_copies} available
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
}
