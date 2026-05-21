/**
 * LogoBrand — Mar-ia.net — horizontal logo (dark/transparent background)
 * Matches the official banner: M gradient icon + "Mar-ia.net" + optional slogan
 */

interface LogoBrandProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  /** show "CRÉEZ. PUBLIEZ. INNOVEZ. SANS CODE." below the name */
  showSlogan?: boolean;
  className?: string;
}

// M icon pixel dimensions (viewBox 112×86)
const ICON_H: Record<string, number> = { sm: 28, md: 38, lg: 60 };
const ICON_W: Record<string, number> = { sm: 36, md: 49, lg: 78 };

// Text sizes
const NAME_SIZE: Record<string, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
};
const SLOGAN_SIZE: Record<string, string> = {
  sm: "text-[8px]",
  md: "text-[10px]",
  lg: "text-sm",
};
const GAP: Record<string, string> = { sm: "gap-2", md: "gap-2.5", lg: "gap-3.5" };

export default function LogoBrand({
  size = "md",
  showText = true,
  showSlogan = false,
  className = "",
}: LogoBrandProps) {
  const iw = ICON_W[size];
  const ih = ICON_H[size];

  return (
    <span className={`inline-flex items-center ${GAP[size]} ${className}`}>

      {/* ── M icon ────────────────────────────────────── */}
      <svg
        width={iw}
        height={ih}
        viewBox="0 0 112 86"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id="mg" x1="0" y1="0" x2="112" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        {/*
          M path:
          • (12,72) → up left leg → (12,38)
          • arch over left shoulder   → (32,8)
          • curve down to valley      → (50,42)
          • curve up to right arch    → (68,8)
          • arch over right shoulder  → (88,38)
          • down right leg            → (88,72)
        */}
        <path
          d="M 12,72 L 12,38
             C 12,18 20,8 32,8
             C 44,8 50,22 50,42
             C 50,22 56,8 68,8
             C 80,8 88,18 88,38
             L 88,72"
          stroke="url(#mg)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Violet dot */}
        <circle cx="99" cy="72" r="8" fill="#7C3AED" />
      </svg>

      {/* ── Text ──────────────────────────────────────── */}
      {showText && (
        <span className="flex flex-col leading-none">
          {/* Mar-ia.net */}
          <span className={`font-display font-bold leading-none ${NAME_SIZE[size]}`}>
            <span className="text-white">Mar-ia</span>
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: "linear-gradient(90deg,#3B82F6,#7C3AED)" }}
            >
              .net
            </span>
          </span>

          {/* Slogan */}
          {showSlogan && (
            <span
              className={`mt-1 tracking-widest font-medium text-slate-400 ${SLOGAN_SIZE[size]}`}
            >
              CRÉEZ. PUBLIEZ. INNOVEZ. SANS CODE.
            </span>
          )}
        </span>
      )}
    </span>
  );
}
