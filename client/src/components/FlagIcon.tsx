import type { Lang } from "@/i18n/translations";

interface FlagIconProps {
  code: Lang;
  className?: string;
}

/**
 * Drapeaux en SVG inline. On évite les emojis drapeaux (🇫🇷🇬🇧🇪🇸) car
 * plusieurs constructeurs Android (notamment Samsung/One UI) ne les
 * affichent pas du tout — le texte apparaît sans aucune icône.
 * Une icône SVG s'affiche de façon identique sur tous les appareils.
 */
export default function FlagIcon({ code, className = "" }: FlagIconProps) {
  const baseClass = `inline-block rounded-[2px] align-middle ${className || "w-4 h-3"}`;

  if (code === "fr") {
    return (
      <svg viewBox="0 0 3 2" className={baseClass} aria-hidden="true">
        <rect width="1" height="2" x="0" fill="#0055A4" />
        <rect width="1" height="2" x="1" fill="#FFFFFF" />
        <rect width="1" height="2" x="2" fill="#EF4135" />
      </svg>
    );
  }

  if (code === "es") {
    return (
      <svg viewBox="0 0 3 2" className={baseClass} aria-hidden="true">
        <rect width="3" height="2" fill="#AA151B" />
        <rect width="3" height="1" y="0.5" fill="#F1BF00" />
      </svg>
    );
  }

  // "en" -> drapeau du Royaume-Uni (Union Jack simplifié)
  return (
    <svg viewBox="0 0 60 30" className={baseClass} aria-hidden="true">
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 60,30 M60,0 0,30" stroke="#FFFFFF" strokeWidth="6" />
      <path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30,0 30,30 M0,15 60,15" stroke="#FFFFFF" strokeWidth="10" />
      <path d="M30,0 30,30 M0,15 60,15" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}
