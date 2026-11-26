import { useState, type CSSProperties } from 'react';

interface DustMote {
  id: number;
  left: string;
  top: string;
  size: number;
  duration: string;
  delay: string;
}

const DUST_MOTES: DustMote[] = [
  { id: 1, left: '8%', top: '76%', size: 3, duration: '9s', delay: '0s' },
  { id: 2, left: '15%', top: '54%', size: 2, duration: '11s', delay: '1.5s' },
  { id: 3, left: '22%', top: '82%', size: 4, duration: '10s', delay: '3s' },
  { id: 4, left: '31%', top: '26%', size: 2.5, duration: '12s', delay: '0.8s' },
  { id: 5, left: '42%', top: '86%', size: 2, duration: '8.5s', delay: '2.2s' },
  { id: 6, left: '58%', top: '18%', size: 3, duration: '11.5s', delay: '4s' },
  { id: 7, left: '68%', top: '78%', size: 2.5, duration: '9.5s', delay: '1.1s' },
  { id: 8, left: '77%', top: '44%', size: 3.5, duration: '10.5s', delay: '2.7s' },
  { id: 9, left: '84%', top: '72%', size: 2, duration: '12.5s', delay: '0.4s' },
  { id: 10, left: '91%', top: '34%', size: 3, duration: '9.8s', delay: '3.6s' },
  { id: 11, left: '12%', top: '32%', size: 2, duration: '13s', delay: '5s' },
  { id: 12, left: '88%', top: '86%', size: 3, duration: '10.2s', delay: '4.4s' },
  { id: 13, left: '27%', top: '65%', size: 2, duration: '11.2s', delay: '2.9s' },
  { id: 14, left: '74%', top: '24%', size: 2.5, duration: '9.2s', delay: '1.9s' },
];

export function LibraryAtmosphere() {
  const [backdropFailed, setBackdropFailed] = useState(false);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden bg-[#0B1220] select-none"
    >
      {/* Layer 1: Realistic Illustrated Library Interior */}
      {!backdropFailed ? (
        <img
          src="/src/assets/images/smart_library_interior_1795565655575.jpg"
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBackdropFailed(true)}
          className="absolute inset-0 h-full w-full object-cover object-center opacity-55 scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#111C32] via-[#0B1220] to-[#070B14]" />
      )}

      {/* Layer 2: Deep Navy & Midnight Vignette Gradients for Atmospheric Depth */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 75% 70% at 50% 45%, rgba(17, 28, 50, 0.35) 0%, rgba(11, 18, 32, 0.78) 58%, rgba(7, 11, 20, 0.96) 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(11, 18, 32, 0.78) 0%, rgba(11, 18, 32, 0.25) 35%, rgba(11, 18, 32, 0.48) 70%, rgba(7, 11, 20, 0.94) 100%)',
        }}
      />

      {/* Layer 3: Warm Golden Library Lamp Glow Halos */}
      <div
        className="animate-lamp-glow absolute -top-24 left-[14%] h-[420px] w-[420px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(214, 173, 96, 0.16) 0%, rgba(214, 173, 96, 0.04) 45%, transparent 72%)',
        }}
      />
      <div
        className="animate-lamp-glow absolute -bottom-24 right-[12%] h-[460px] w-[460px] rounded-full"
        style={{
          animationDelay: '2.5s',
          background:
            'radial-gradient(circle, rgba(214, 173, 96, 0.15) 0%, rgba(49, 92, 154, 0.12) 45%, transparent 74%)',
        }}
      />
      <div
        className="absolute top-[22%] right-[18%] h-[340px] w-[340px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(49, 92, 154, 0.22) 0%, transparent 70%)',
        }}
      />

      {/* Layer 4: Subtle Bookshelf Silhouettes (Left & Right Architectural Framing) */}
      <svg
        viewBox="0 0 220 800"
        fill="none"
        className="hidden lg:block absolute left-0 top-0 h-full w-44 opacity-25"
        preserveAspectRatio="none"
      >
        <rect x="0" y="0" width="16" height="800" fill="#070B14" />
        <rect x="16" y="130" width="170" height="8" fill="#0D1628" />
        <rect x="16" y="310" width="170" height="8" fill="#0D1628" />
        <rect x="16" y="490" width="170" height="8" fill="#0D1628" />
        <rect x="16" y="670" width="170" height="8" fill="#0D1628" />
        {/* Book spines */}
        <rect x="24" y="40" width="18" height="90" rx="2" fill="#172542" />
        <rect x="45" y="54" width="14" height="76" rx="1.5" fill="#1E3156" />
        <rect x="62" y="36" width="20" height="94" rx="2" fill="#142038" />
        <rect x="86" y="48" width="15" height="82" rx="1.5" fill="#2A4068" />
        <rect x="106" y="60" width="16" height="70" rx="1.5" fill="#172542" />
        <rect x="24" y="218" width="16" height="92" rx="2" fill="#1E3156" />
        <rect x="44" y="230" width="22" height="80" rx="2" fill="#142038" />
        <rect x="70" y="214" width="15" height="96" rx="1.5" fill="#253A60" />
        <rect x="92" y="226" width="18" height="84" rx="2" fill="#172542" />
        <rect x="24" y="404" width="20" height="86" rx="2" fill="#142038" />
        <rect x="48" y="395" width="14" height="95" rx="1.5" fill="#253A60" />
        <rect x="66" y="410" width="18" height="80" rx="2" fill="#1B2C4D" />
        <rect x="24" y="582" width="16" height="88" rx="2" fill="#1B2C4D" />
        <rect x="43" y="576" width="19" height="94" rx="2" fill="#142038" />
        <rect x="66" y="592" width="14" height="78" rx="1.5" fill="#253A60" />
      </svg>

      <svg
        viewBox="0 0 220 800"
        fill="none"
        className="hidden lg:block absolute right-0 top-0 h-full w-44 opacity-25 scale-x-[-1]"
        preserveAspectRatio="none"
      >
        <rect x="0" y="0" width="16" height="800" fill="#070B14" />
        <rect x="16" y="130" width="170" height="8" fill="#0D1628" />
        <rect x="16" y="310" width="170" height="8" fill="#0D1628" />
        <rect x="16" y="490" width="170" height="8" fill="#0D1628" />
        <rect x="16" y="670" width="170" height="8" fill="#0D1628" />
        <rect x="24" y="46" width="18" height="84" rx="2" fill="#172542" />
        <rect x="46" y="36" width="15" height="94" rx="1.5" fill="#253A60" />
        <rect x="65" y="52" width="20" height="78" rx="2" fill="#142038" />
        <rect x="24" y="220" width="17" height="90" rx="2" fill="#1E3156" />
        <rect x="45" y="212" width="20" height="98" rx="2" fill="#142038" />
        <rect x="69" y="232" width="15" height="78" rx="1.5" fill="#2A4068" />
        <rect x="24" y="400" width="18" height="90" rx="2" fill="#142038" />
        <rect x="46" y="410" width="16" height="80" rx="1.5" fill="#253A60" />
        <rect x="24" y="582" width="20" height="88" rx="2" fill="#1B2C4D" />
        <rect x="48" y="590" width="15" height="80" rx="1.5" fill="#142038" />
      </svg>

      {/* Layer 5: Delicate Golden Geometric Arch & Celestial Astrolabe Rings */}
      <svg
        viewBox="0 0 1200 800"
        fill="none"
        className="absolute inset-0 h-full w-full opacity-[0.09]"
        preserveAspectRatio="xMidYMid slice"
      >
        <circle cx="600" cy="400" r="355" stroke="#D6AD60" strokeWidth="0.9" strokeDasharray="4 8" />
        <circle cx="600" cy="400" r="460" stroke="#D6AD60" strokeWidth="0.6" />
        <path d="M210 800V360C210 144.6 384.6 -30 600 -30C815.4 -30 990 144.6 990 360V800" stroke="#315C9A" strokeWidth="1" />
        <line x1="600" y1="0" x2="600" y2="800" stroke="#D6AD60" strokeWidth="0.5" strokeDasharray="2 10" />
      </svg>

      {/* Layer 6: Floating 3D Hardcover Books, Open Book with Page Sway & Graduation Cap */}
      {/* Top-Left: Floating 3D Hardcover Book */}
      <div className="hidden md:block absolute left-[6%] lg:left-[8%] top-[16%] animate-float-slow opacity-75">
        <svg viewBox="0 0 120 100" fill="none" className="w-24 lg:w-28 h-auto drop-shadow-[0_18px_28px_rgba(0,0,0,0.65)]">
          {/* Bottom 3D Stack Book */}
          <path d="M18 54L62 38L104 54L60 70L18 54Z" fill="#1B2D52" stroke="#D6AD60" strokeWidth="1.1" />
          <path d="M18 54V66L60 82V70L18 54Z" fill="#315C9A" />
          <path d="M60 70V82L104 66V54L60 70Z" fill="#EAE4D7" />
          <path d="M63 72.5L101 58.5M63 76L101 62" stroke="#B7A991" strokeWidth="0.8" />
          {/* Top 3D Hardcover Book */}
          <path d="M24 32L66 16L106 31L64 47L24 32Z" fill="#233A68" stroke="#D6AD60" strokeWidth="1.2" />
          <path d="M24 32V43L64 58V47L24 32Z" fill="#111C32" stroke="#D6AD60" strokeWidth="0.9" />
          <path d="M64 47V58L106 42V31L64 47Z" fill="#F5F3EE" />
          {/* Gilt bookmark ribbon */}
          <path d="M78 52V66L82 62L86 66V49" fill="#D6AD60" />
          {/* Subtle gold cover embossing */}
          <path d="M46 31L66 23.5L84 30.5L64 38L46 31Z" stroke="#D6AD60" strokeOpacity="0.65" strokeWidth="0.9" />
        </svg>
      </div>

      {/* Bottom-Left: Floating Open Book with Subtle Page Animation */}
      <div className="hidden xl:block absolute left-[7%] bottom-[14%] animate-float-reverse opacity-75">
        <svg viewBox="0 0 140 100" fill="none" className="w-32 h-auto drop-shadow-[0_20px_30px_rgba(0,0,0,0.65)]">
          {/* Leather cover base */}
          <path d="M14 34L68 46L124 34V74L68 86L14 74V34Z" fill="#172747" stroke="#D6AD60" strokeWidth="1.2" />
          {/* Left Folio */}
          <path d="M18 30C36 26 54 31 68 42V76C54 67 36 63 18 66V30Z" fill="#F5F3EE" />
          {/* Right Folio */}
          <path d="M120 30C102 26 84 31 68 42V76C84 67 102 63 120 66V30Z" fill="#E6E1D6" />
          {/* Animated Fluttering Page */}
          <g className="animate-page-flutter">
            <path d="M68 42C82 30 98 24 114 27V62C98 60 82 65 68 75V42Z" fill="#FAF8F3" stroke="#D6AD60" strokeOpacity="0.45" strokeWidth="0.8" />
            <line x1="77" y1="42" x2="104" y2="36" stroke="#CBD5E1" strokeWidth="1" />
            <line x1="77" y1="49" x2="104" y2="43" stroke="#CBD5E1" strokeWidth="1" />
            <line x1="77" y1="56" x2="98" y2="51" stroke="#CBD5E1" strokeWidth="1" />
          </g>
          {/* Left Page lines */}
          <line x1="27" y1="39" x2="56" y2="44" stroke="#CBD5E1" strokeWidth="1" />
          <line x1="27" y1="46" x2="56" y2="51" stroke="#CBD5E1" strokeWidth="1" />
          <line x1="27" y1="53" x2="50" y2="57" stroke="#CBD5E1" strokeWidth="1" />
          {/* Golden bookmark */}
          <path d="M66 42L62 84L68 78L74 84L70 42" fill="#D6AD60" />
        </svg>
      </div>

      {/* Top-Right: Floating Academic Graduation Cap */}
      <div className="hidden md:block absolute right-[6%] lg:right-[8%] top-[18%] animate-float-reverse opacity-75">
        <svg viewBox="0 0 120 100" fill="none" className="w-24 lg:w-28 h-auto drop-shadow-[0_18px_28px_rgba(0,0,0,0.65)]">
          {/* Mortarboard diamond */}
          <path d="M60 16L108 36L60 56L12 36L60 16Z" fill="#1C2E54" stroke="#D6AD60" strokeWidth="1.3" strokeLinejoin="round" />
          {/* Inner gold trim */}
          <path d="M60 22L97 36L60 50L23 36L60 22Z" stroke="#D6AD60" strokeOpacity="0.4" strokeWidth="0.8" />
          {/* Cap skull crown */}
          <path d="M32 45V60C32 66.5 44.5 72 60 72C75.5 72 88 66.5 88 60V45L60 56L32 45Z" fill="#111C32" stroke="#315C9A" strokeWidth="1.1" />
          {/* Center brass button & tassel */}
          <circle cx="60" cy="36" r="2.6" fill="#D6AD60" />
          <path d="M60 36L92 43V65" stroke="#D6AD60" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M89 65H95L97 76H87L89 65Z" fill="#D6AD60" />
        </svg>
      </div>

      {/* Bottom-Right: Warm Brass Reading Lamp & Compass Academic Silhouette */}
      <div className="hidden xl:block absolute right-[7%] bottom-[14%] animate-float-slow opacity-70">
        <svg viewBox="0 0 120 110" fill="none" className="w-28 h-auto drop-shadow-[0_18px_30px_rgba(0,0,0,0.65)]">
          {/* Soft warm light cone */}
          <path d="M36 46L14 96H82L62 46H36Z" fill="url(#lampCone)" opacity="0.55" />
          {/* Lamp Shade */}
          <path d="M28 44C28 34 38 28 50 28C62 28 70 34 70 44H28Z" fill="#1D4D4F" stroke="#D6AD60" strokeWidth="1.2" />
          {/* Brass stem & base */}
          <path d="M58 28C66 20 78 24 78 36V88" stroke="#D6AD60" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="78" cy="90" rx="18" ry="5" fill="#111C32" stroke="#D6AD60" strokeWidth="1.3" />
          {/* Small resting volume */}
          <rect x="20" y="84" width="38" height="9" rx="1.5" fill="#315C9A" stroke="#D6AD60" strokeWidth="0.9" />
          <defs>
            <linearGradient id="lampCone" x1="48" y1="44" x2="48" y2="96" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#D6AD60" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#D6AD60" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Layer 7: Slowly Floating Golden Dust Particles */}
      {DUST_MOTES.map((mote) => (
        <span
          key={mote.id}
          className="animate-mote-rise absolute rounded-full bg-[#D6AD60]"
          style={
            {
              left: mote.left,
              top: mote.top,
              width: `${mote.size}px`,
              height: `${mote.size}px`,
              boxShadow: '0 0 8px 1px rgba(214, 173, 96, 0.65)',
              '--mote-duration': mote.duration,
              '--mote-delay': mote.delay,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
