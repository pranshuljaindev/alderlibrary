import type { CSSProperties } from 'react';

interface StudentPortalBackdropProps {
  showParticles?: boolean;
}

const PORTAL_MOTES = [
  { id: 1, left: '12%', top: '80%', size: 2.5, duration: '12s', delay: '0s' },
  { id: 2, left: '26%', top: '38%', size: 2, duration: '14s', delay: '1.8s' },
  { id: 3, left: '47%', top: '74%', size: 2.5, duration: '11s', delay: '3.2s' },
  { id: 4, left: '68%', top: '26%', size: 2, duration: '13s', delay: '0.9s' },
  { id: 5, left: '84%', top: '66%', size: 3, duration: '12.5s', delay: '2.4s' },
  { id: 6, left: '91%', top: '44%', size: 2, duration: '14.5s', delay: '4.1s' },
];

export function StudentPortalBackdrop({ showParticles = true }: StudentPortalBackdropProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden bg-[#070913] select-none"
    >
      {/* Flowing Obsidian-Violet & Indigo Atmospheric Glow */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 75% 60% at 15% 15%, rgba(109, 40, 217, 0.22) 0%, rgba(49, 46, 129, 0.10) 45%, transparent 72%), radial-gradient(ellipse 80% 55% at 80% 85%, rgba(124, 58, 237, 0.24) 0%, rgba(56, 189, 248, 0.08) 42%, transparent 72%), linear-gradient(160deg, #070913 0%, #090C19 55%, #060811 100%)',
        }}
      />

      {/* Ambient Violet Silk Light Pools */}
      <div
        className="animate-lamp-glow absolute -top-36 left-[8%] h-[460px] w-[460px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(139, 92, 246, 0.16) 0%, rgba(139, 92, 246, 0.03) 48%, transparent 74%)',
        }}
      />
      <div
        className="animate-lamp-glow absolute -bottom-44 right-[10%] h-[540px] w-[540px] rounded-full"
        style={{
          animationDelay: '3s',
          background:
            'radial-gradient(circle, rgba(124, 58, 237, 0.18) 0%, rgba(56, 189, 248, 0.06) 50%, transparent 76%)',
        }}
      />

      {/* Sweeping Violet-Indigo Light Waves */}
      <svg
        viewBox="0 0 1440 900"
        fill="none"
        className="absolute inset-0 h-full w-full opacity-40"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="obsidianWave1" x1="0" y1="0" x2="1440" y2="900" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.18" />
            <stop offset="50%" stopColor="#A78BFA" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <path
          d="M-80 680 C 260 540, 560 760, 960 620 C 1220 530, 1360 590, 1520 520"
          stroke="url(#obsidianWave1)"
          strokeWidth="1.5"
        />
        <path
          d="M-60 740 C 320 620, 640 820, 1040 670 C 1280 580, 1400 640, 1540 580"
          stroke="url(#obsidianWave1)"
          strokeWidth="1"
          opacity="0.7"
        />
      </svg>

      {/* Subtle Floating Lavender Motes */}
      {showParticles &&
        PORTAL_MOTES.map((mote) => (
          <span
            key={mote.id}
            className="animate-mote-rise absolute rounded-full bg-[#A78BFA]"
            style={
              {
                left: mote.left,
                top: mote.top,
                width: `${mote.size}px`,
                height: `${mote.size}px`,
                boxShadow: '0 0 8px 1px rgba(167, 139, 250, 0.45)',
                '--mote-duration': mote.duration,
                '--mote-delay': mote.delay,
              } as CSSProperties
            }
          />
        ))}
    </div>
  );
}
