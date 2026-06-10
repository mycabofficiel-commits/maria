/**
 * LogoBrand — Mar-ia.net — horizontal logo (dark/transparent background)
 * Matches the official banner: M gradient icon + "Mar-ia.net" + optional slogan
 */
import { useLang } from "@/i18n/LangContext";

interface LogoBrandProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  /** show slogan below the name */
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
  const { t } = useLang();
  const iw = ICON_W[size];
  const ih = ICON_H[size];

  return (
    <span className={`inline-flex items-center ${GAP[size]} ${className}`}>

      {/* ── M icon ────────────────────────────────────── */}
      <img
        src="/logo-icon.png"
        alt="Mar-ia"
        width={iw}
        height={ih}
        className="flex-shrink-0 object-contain"
        draggable={false}
      />

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
              {t("slogan")}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
