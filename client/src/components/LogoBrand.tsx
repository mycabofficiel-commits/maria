/**
 * LogoBrand — Mar-ia brand mark
 * Exact replica of the Mar-ia.net logo: gradient M + violet dot + "Mar-ia.net" text
 */

interface LogoBrandProps {
  /** sm = sidebar compact, md = nav, lg = login/hero */
  size?: "sm" | "md" | "lg";
  /** show "Mar-ia.net" text next to the icon (default true) */
  showText?: boolean;
  className?: string;
}

// Icon pixel sizes (width × height, preserving 112:86 aspect ratio)
const ICON: Record<string, { w: number; h: number }> = {
  sm: { w: 30, h: 23 },
  md: { w: 42, h: 32 },
  lg: { w: 60, h: 46 },
};

const TEXT_SIZE: Record<string, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
};

export default function LogoBrand({
  size = "md",
  showText = true,
  className = "",
}: LogoBrandProps) {
  const { w, h } = ICON[size];

  return (
    <span className={`inline-flex items-center gap-2 select-none ${className}`}>
      {/* ── M icon ── */}
      <svg
        width={w}
        height={h}
        viewBox="0 0 112 86"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient
            id="mg-brand"
            x1="0"
            y1="0"
            x2="112"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>

        {/*
          M path:
            • bottom-left leg (12,72) → up to (12,38)
            • left arch: (12,38) → over rounded shoulder → (32,8)
            • left arch down: (32,8) → curves down → valley (50,42)
            • right arch up: (50,42) → curves back up → (68,8)
            • right arch: (68,8) → over rounded shoulder → (88,38)
            • right leg down: (88,38) → (88,72)
        */}
        <path
          d="M 12,72 L 12,38 C 12,18 20,8 32,8 C 44,8 50,22 50,42 C 50,22 56,8 68,8 C 80,8 88,18 88,38 L 88,72"
          stroke="url(#mg-brand)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Violet dot — bottom right */}
        <circle cx="99" cy="72" r="8" fill="#7C3AED" />
      </svg>

      {/* ── Text: Mar-ia.net ── */}
      {showText && (
        <span
          className={`font-display font-bold leading-none ${TEXT_SIZE[size]}`}
        >
          <span className="text-foreground">Mar-ia</span>
          <span
            className="text-transparent bg-clip-text"
            style={{
              backgroundImage: "linear-gradient(90deg, #3B82F6, #7C3AED)",
            }}
          >
            .net
          </span>
        </span>
      )}
    </span>
  );
}
