/**
 * LogoBrand — reusable Mar-ia brand mark
 * Usage: <LogoBrand size="md" /> or <LogoBrand size="sm" showText />
 */

interface LogoBrandProps {
  /** sm = 24px icon, md = 32px icon, lg = 40px icon */
  size?: "sm" | "md" | "lg";
  /** show the "Mar-ia" text next to the icon (default true) */
  showText?: boolean;
  className?: string;
}

const SIZES = {
  sm: { icon: 24, text: "text-base" },
  md: { icon: 32, text: "text-xl" },
  lg: { icon: 44, text: "text-3xl" },
};

export default function LogoBrand({ size = "md", showText = true, className = "" }: LogoBrandProps) {
  const { icon, text } = SIZES[size];

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* SVG M logo */}
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id="mg-brand" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <path
          d="M8 52 L8 20 Q8 12 16 12 Q20 12 22 16 L32 36 L42 16 Q44 12 48 12 Q56 12 56 20 L56 52"
          stroke="url(#mg-brand)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="54" cy="55" r="5" fill="#8B5CF6" />
      </svg>

      {showText && (
        <span className={`font-display font-bold ${text} leading-none`}>
          <span className="text-foreground">Mar</span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-violet-500">-ia</span>
        </span>
      )}
    </span>
  );
}
