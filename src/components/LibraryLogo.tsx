import { motion } from 'motion/react';

interface LibraryLogoProps {
  variant?: 'light' | 'dark' | 'gold';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showSubtitle?: boolean;
  name?: string;
  subtitle?: string;
  serifTitle?: boolean;
}

export function LibraryLogo({
  variant = 'dark',
  size = 'md',
  showSubtitle = false,
  name = 'Alderbrook Library',
  subtitle = 'Academic Circulation & Archives',
  serifTitle = false,
}: LibraryLogoProps) {
  const iconDims =
    size === 'sm'
      ? 'w-8 h-8'
      : size === 'lg'
        ? 'w-12 h-12'
        : size === 'xl'
          ? 'w-14 h-14'
          : 'w-9 h-9';

  const titleClasses =
    variant === 'gold'
      ? 'text-[#F5F3EE]'
      : variant === 'light'
        ? 'text-white'
        : 'text-slate-900';

  const subtitleClasses =
    variant === 'gold'
      ? 'text-[#D6AD60]'
      : variant === 'light'
        ? 'text-blue-200/85'
        : 'text-blue-700';

  const badgeClasses =
    variant === 'gold'
      ? 'bg-gradient-to-br from-[#1B2B4B] via-[#111C32] to-[#0B1220] ring-1 ring-[#D6AD60]/60 shadow-lg shadow-black/50 group-hover:ring-[#D6AD60]'
      : variant === 'light'
        ? 'bg-gradient-to-br from-[#315C9A] to-[#111C32] ring-1 ring-[#D6AD60]/50 shadow-md shadow-black/40 group-hover:ring-[#D6AD60]'
        : 'bg-gradient-to-br from-blue-600 to-indigo-800 ring-1 ring-blue-500/30 shadow-sm shadow-blue-900/15 group-hover:ring-blue-500';

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="inline-flex items-center gap-3.5 select-none group cursor-default"
    >
      <div
        className={`${iconDims} relative rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 ${badgeClasses}`}
      >
        {/* Combined Open Book + Graduation Cap Emblem */}
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-[74%] h-[74%]"
          aria-hidden="true"
        >
          {/* Graduation cap mortarboard */}
          <path
            d="M20 5L34 11.2L20 17.4L6 11.2L20 5Z"
            fill="#D6AD60"
            stroke="#F5F3EE"
            strokeWidth="0.9"
            strokeLinejoin="round"
          />
          {/* Cap crown base */}
          <path
            d="M12.5 14.3V17.6C12.5 19.2 15.85 20.5 20 20.5C24.15 20.5 27.5 19.2 27.5 17.6V14.3L20 17.4L12.5 14.3Z"
            fill="#B78D42"
          />
          {/* Tassel */}
          <path
            d="M31.5 12.4V18.8"
            stroke="#D6AD60"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx="31.5" cy="19.6" r="1.35" fill="#F5F3EE" />

          {/* Open Book Left Page */}
          <path
            d="M7.5 21.8C11.4 20.4 15.8 21.1 20 23.8V33.6C16.2 31.3 11.8 30.8 7.5 32.1V21.8Z"
            fill="#F5F3EE"
          />
          {/* Open Book Right Page */}
          <path
            d="M32.5 21.8C28.6 20.4 24.2 21.1 20 23.8V33.6C23.8 31.3 28.2 30.8 32.5 32.1V21.8Z"
            fill="#DBEAFE"
          />
          {/* Spine & Golden Crest Base */}
          <path
            d="M6.2 33.4C10.8 31.9 15.6 32.4 20 35C24.4 32.4 29.2 31.9 33.8 33.4"
            stroke="#D6AD60"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <line
            x1="20"
            y1="23.8"
            x2="20"
            y2="34.5"
            stroke="#315C9A"
            strokeWidth="1.1"
          />
        </svg>
      </div>

      <div className="min-w-0">
        <div
          className={`${serifTitle ? 'font-serif tracking-wide' : 'font-display tracking-tight'} font-semibold whitespace-nowrap truncate ${
            size === 'xl'
              ? 'text-2xl sm:text-[26px]'
              : size === 'lg'
                ? 'text-lg'
                : size === 'sm'
                  ? 'text-sm'
                  : 'text-base'
          } ${titleClasses}`}
        >
          {name}
        </div>
        {showSubtitle && (
          <div
            className={`${
              size === 'xl' ? 'text-xs sm:text-[13px]' : 'text-[11px]'
            } font-medium tracking-wide whitespace-nowrap ${subtitleClasses}`}
          >
            {subtitle}
          </div>
        )}
      </div>
    </motion.div>
  );
}
