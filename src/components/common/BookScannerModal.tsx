import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, ScanLine, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { Book } from '../../types';

interface BookScannerModalProps {
  books?: Book[];
  title?: string;
  subtitle?: string;
  placeholder?: string;
  onScanResult?: (book: Book) => void;
  onScanBarcode?: (barcode: string) => void;
  onClose: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export function BookScannerModal({
  books = [],
  title = 'Book Barcode & QR Scanner',
  subtitle = 'Scan physical barcode sticker or select volume',
  placeholder = 'Scan or enter barcode (e.g. BC-984210, ISBN)...',
  onScanResult,
  onScanBarcode,
  onClose,
  onNotify,
}: BookScannerModalProps) {
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Attempt camera stream on mount if supported
    async function startCamera() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
          });
          mediaStreamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            setCameraActive(true);
          }
        }
      } catch {
        setCameraActive(false);
      }
    }
    void startCamera();

    return () => {
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

  function handleSelectBook(book: Book) {
    setScanning(false);
    onNotify('success', `Scanned & matched: ${book.title}`);
    if (onScanResult) onScanResult(book);
    if (onScanBarcode) onScanBarcode(book.isbn);
    onClose();
  }

  function handleDirectBarcode(code: string) {
    setScanning(false);
    onNotify('success', `Barcode detected: ${code}`);
    if (onScanBarcode) {
      onScanBarcode(code);
      onClose();
      return;
    }
    // Fallback: match book
    const matched = books.find(
      (b) =>
        b.isbn.toLowerCase().includes(code.toLowerCase()) ||
        b.call_number.toLowerCase().includes(code.toLowerCase()) ||
        b.title.toLowerCase().includes(code.toLowerCase())
    );
    if (matched && onScanResult) {
      onScanResult(matched);
      onClose();
    } else {
      onNotify('error', `No catalog book matched barcode "${code}".`);
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = manualCode.trim();
    if (!query) return;

    if (onScanBarcode) {
      handleDirectBarcode(query);
      return;
    }

    const matched = books.find(
      (b) =>
        b.isbn.toLowerCase().includes(query.toLowerCase()) ||
        b.call_number.toLowerCase().includes(query.toLowerCase()) ||
        b.title.toLowerCase().includes(query.toLowerCase())
    );

    if (matched) {
      handleSelectBook(matched);
    } else {
      onNotify('error', `No book found matching barcode / ISBN "${manualCode}".`);
    }
  }

  function simulateQuickScan() {
    if (onScanBarcode && (!books || books.length === 0)) {
      handleDirectBarcode(`BC-${Math.floor(100000 + Math.random() * 900000)}`);
      return;
    }
    if (books.length > 0) {
      const randomBook = books[Math.floor(Math.random() * books.length)];
      if (onScanBarcode) {
        handleDirectBarcode(`BC-${Math.floor(100000 + Math.random() * 900000)}`);
      } else {
        handleSelectBook(randomBook);
      }
      return;
    }
    handleDirectBarcode(`BC-${Math.floor(100000 + Math.random() * 900000)}`);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="w-full max-w-lg rounded-3xl border border-[#A78BFA]/30 bg-[#0F1326]/95 p-6 shadow-2xl space-y-6 text-[#F8FAFC]"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-[#8B5CF6]/20 border border-[#A78BFA]/40 text-[#A78BFA] flex items-center justify-center">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <p className="text-xs text-[#94A3B8]">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/12 p-2 text-[#94A3B8] hover:text-white hover:border-white/30 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewfinder / Camera Feed */}
        <div className="relative h-56 w-full rounded-2xl bg-black/90 border border-white/15 overflow-hidden flex items-center justify-center">
          {cameraActive ? (
            <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover opacity-80" muted playsInline />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#94A3B8] p-4 text-center">
              <Camera className="w-8 h-8 text-[#A78BFA] animate-pulse" />
              <p className="text-xs">Camera stream unavailable or permission denied. Use manual scan or quick demo simulate below.</p>
            </div>
          )}

          {/* Laser scanning beam overlay */}
          {scanning && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.8)] animate-pulse" />
          )}

          <div className="absolute inset-8 border-2 border-dashed border-[#A78BFA]/60 rounded-xl pointer-events-none flex items-center justify-center">
            <span className="bg-black/60 px-3 py-1 rounded-full text-[10px] font-mono text-[#A78BFA] backdrop-blur-sm">
              Align Barcode in Frame
            </span>
          </div>
        </div>

        {/* Quick Demo Simulate Button */}
        <div className="flex items-center justify-between gap-3 bg-[#171C36] rounded-2xl p-4 border border-white/10">
          <div>
            <div className="text-xs font-semibold text-white">Quick Barcode Simulator</div>
            <div className="text-[11px] text-[#94A3B8]">Instantly test scanning with a sample barcode</div>
          </div>
          <button
            type="button"
            onClick={simulateQuickScan}
            className="rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 transition-all cursor-pointer shadow-md shadow-[#7C3AED]/25 whitespace-nowrap"
          >
            Simulate Scan
          </button>
        </div>

        {/* Manual Barcode / ISBN Entry */}
        <form onSubmit={handleManualSubmit} className="space-y-3">
          <label className="block text-xs font-medium text-[#CBD5E1]">Or enter barcode sticker / ISBN manually</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder={placeholder}
              className="dark-glass-input obsidian-input-focus flex-1 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
            />
            <button
              type="submit"
              className="rounded-xl border border-[#A78BFA]/40 bg-[#8B5CF6]/20 px-4 py-2.5 text-xs font-semibold text-[#A78BFA] hover:bg-[#8B5CF6]/30 transition-colors cursor-pointer shrink-0"
            >
              Lookup
            </button>
          </div>
        </form>

        {/* Quick Catalog List for Testing */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">Or Select from Catalog:</div>
          <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
            {books.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => handleSelectBook(b)}
                className="w-full text-left rounded-xl border border-white/10 bg-[#12162A]/80 px-3 py-2 text-xs flex items-center justify-between gap-2 hover:border-[#A78BFA]/50 hover:bg-[#8B5CF6]/15 transition-all cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-medium text-white truncate">{b.title}</div>
                  <div className="text-[10px] font-mono text-[#94A3B8]">{b.isbn} · {b.call_number}</div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-[#34D399] shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
