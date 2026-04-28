// frontend/src/components/Logo.jsx
// Company logomark — used in Navbar, AuthPage, HomePage.
// Replace the SVG path data here to swap in a custom brand asset.

// ── Logomark SVG ─────────────────────────────────────────────────────────────
export function LogoMark({ size = 32 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background */}
      <rect width="40" height="40" rx="10" fill="url(#logoGrad)" />

      {/* "C" arc */}
      <path
        d="M27 13.5C24.8 11.3 21.5 10 18 10C11.4 10 6 15.4 6 22C6 28.6 11.4 34 18 34C21.5 34 24.8 32.7 27 30.5"
        stroke="white"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.95"
      />

      {/* Rising trend line inside C */}
      <polyline
        points="11,26 15,21 19,23 24,16"
        stroke="#60a5fa"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Dot at tip */}
      <circle cx="24" cy="16" r="1.8" fill="#93c5fd" />

      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Full lockup (mark + wordmark) ─────────────────────────────────────────────
export function LogoFull({ size = 32 }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <div className="leading-none">
        <span className="text-white font-bold tracking-wide"
              style={{ fontSize: size * 0.44 }}>
          Chase
        </span>
        <span className="text-blue-400 font-semibold tracking-widest uppercase block"
              style={{ fontSize: size * 0.28, letterSpacing: '0.18em', marginTop: 1 }}>
          Dashboard
        </span>
      </div>
    </div>
  );
}

export default LogoMark;
