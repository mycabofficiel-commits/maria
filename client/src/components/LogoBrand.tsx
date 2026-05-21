/**
 * LogoBrand — Mar-ia.net brand mark using the official PNG logo.
 * Aspect ratio is always preserved (no distortion).
 */

interface LogoBrandProps {
  /** sm = sidebar icon, md = navbar, lg = login / hero */
  size?: "sm" | "md" | "lg";
  /** unused — kept for API compatibility */
  showText?: boolean;
  className?: string;
}

// Height in px; width is always "auto" → no distortion
const HEIGHT: Record<string, number> = {
  sm: 40,
  md: 52,
  lg: 130,
};

export default function LogoBrand({
  size = "md",
  showText: _showText,
  className = "",
}: LogoBrandProps) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      <img
        src="/logo.png"
        alt="Mar-ia.net"
        style={{ height: HEIGHT[size], width: "auto" }}
        className="flex-shrink-0 object-contain"
        draggable={false}
      />
    </span>
  );
}
