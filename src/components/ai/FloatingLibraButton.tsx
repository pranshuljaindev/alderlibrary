import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { UserRole } from '../../types';
import { LibraAiChat } from './LibraAiChat';

interface FloatingLibraButtonProps {
  role: UserRole;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onReserveBook?: (bookId: number) => void;
  onOpenBookDetails?: (bookId: number) => void;
  onDataChanged?: () => void;
}

export function FloatingLibraButton({
  role,
  onNotify,
  onReserveBook,
  onOpenBookDetails,
  onDataChanged,
}: FloatingLibraButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open LIBRA AI Assistant"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2.5 rounded-2xl border border-[#A78BFA]/45 bg-gradient-to-r from-[#12172E] to-[#0A0D1A] px-4 py-3 text-xs sm:text-sm font-semibold text-white shadow-[0_18px_40px_-10px_rgba(0,0,0,0.85)] hover:border-[#A78BFA] hover:shadow-[0_0_28px_-4px_rgba(139,92,246,0.45)] transition-all cursor-pointer"
      >
        <span className="h-7 w-7 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#4F46E5] text-white flex items-center justify-center">
          <Sparkles className="w-4 h-4" aria-hidden="true" />
        </span>
        <span className="tracking-wide text-[#E2E8F0]">LIBRA AI</span>
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex justify-end bg-[#04060E]/65 backdrop-blur-xs">
            <div className="flex-1" onClick={() => setOpen(false)} />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="w-full max-w-xl h-full bg-[#090C18] border-l border-[#A78BFA]/25 p-3 sm:p-4 flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between pb-2.5 px-1">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#A78BFA]">
                  Quick Assistant Drawer
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close LIBRA AI drawer"
                  className="rounded-lg border border-white/15 p-1.5 text-[#94A3B8] hover:text-white hover:border-[#A78BFA]/40 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <LibraAiChat
                  role={role}
                  compact
                  onNotify={onNotify}
                  onReserveBook={onReserveBook}
                  onOpenBookDetails={(bookId) => {
                    setOpen(false);
                    onOpenBookDetails?.(bookId);
                  }}
                  onDataChanged={onDataChanged}
                />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
