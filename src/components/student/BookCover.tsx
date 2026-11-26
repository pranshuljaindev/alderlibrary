import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

interface BookCoverProps {
  title: string;
  author?: string;
  category?: string;
  callNumber?: string;
  coverUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const COVER_ASSETS = {
  computing: '/src/assets/images/book_cover_computing_1795566178120.jpg',
  science: '/src/assets/images/book_cover_science_1795566178378.jpg',
  humanities: '/src/assets/images/book_cover_humanities_1795566178078.jpg',
  architecture: '/src/assets/images/book_cover_architecture_1795566178291.jpg',
} as const;

function pickCoverAsset(category = ''): string {
  const c = category.toLowerCase();
  if (c.includes('computer') || c.includes('data') || c.includes('software') || c.includes('math')) {
    return COVER_ASSETS.computing;
  }
  if (c.includes('physics') || c.includes('science') || c.includes('chem') || c.includes('bio') || c.includes('philosoph')) {
    return COVER_ASSETS.science;
  }
  if (c.includes('arch') || c.includes('econ') || c.includes('design') || c.includes('engineer')) {
    return COVER_ASSETS.architecture;
  }
  return COVER_ASSETS.humanities;
}

export function BookCover({
  title,
  author,
  category = 'General',
  callNumber,
  coverUrl,
  size = 'md',
  className = '',
}: BookCoverProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = coverUrl && coverUrl.trim() ? coverUrl : pickCoverAsset(category);

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const dims =
    size === 'xs'
      ? 'w-11 h-16 rounded-md'
      : size === 'sm'
        ? 'w-16 h-24 rounded-lg'
        : size === 'lg'
          ? 'w-56 sm:w-64 aspect-[3/4] rounded-xl'
          : 'w-full aspect-[3/4] rounded-xl';

  return (
    <div
      className={`relative overflow-hidden shrink-0 border border-[#A78BFA]/30 bg-[#0A0D1A] shadow-[0_14px_30px_-10px_rgba(0,0,0,0.85)] select-none ${dims} ${className}`}
    >
      {!imgFailed ? (
        <img
          src={src}
          alt={`${title} hardcover artwork`}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1B1F44] via-[#111631] to-[#0A0D1A] flex items-center justify-center">
          <BookOpen className="w-8 h-8 text-[#A78BFA]/45" aria-hidden="true" />
        </div>
      )}

      {/* Hardcover spine crease & foil edge highlight */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-2.5 bg-gradient-to-r from-black/55 via-white/10 to-transparent border-r border-[#A78BFA]/20"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-[#070913]/95 via-[#070913]/40 to-[#070913]/20"
      />

      {size !== 'xs' && size !== 'sm' ? (
        <div className="relative z-10 h-full p-4 pl-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 text-[10px] font-medium tracking-wider text-[#A78BFA] uppercase">
            <span className="truncate">{category}</span>
            {callNumber && <span className="font-mono text-[#F8FAFC]/65 shrink-0">{callNumber}</span>}
          </div>

          <div className="space-y-1.5">
            <div className="h-px w-10 bg-[#A78BFA]/65" />
            <h4
              className={`font-serif font-semibold text-[#F8FAFC] leading-snug line-clamp-3 drop-shadow ${
                size === 'lg' ? 'text-lg sm:text-xl' : 'text-sm'
              }`}
            >
              {title}
            </h4>
            {author && (
              <p className="text-[11px] text-[#F8FAFC]/80 truncate">
                {author}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="relative z-10 h-full p-1.5 pl-2 flex flex-col justify-end">
          <span className="font-serif text-[8px] leading-tight font-semibold text-[#F8FAFC] line-clamp-2">
            {title}
          </span>
        </div>
      )}
    </div>
  );
}
