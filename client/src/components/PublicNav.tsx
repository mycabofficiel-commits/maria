import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Menu, X, Globe } from "lucide-react";
import LogoBrand from "@/components/LogoBrand";
import { useState } from "react";
import { useLang } from "@/i18n/LangContext";
import type { Lang } from "@/i18n/translations";

const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: "fr", flag: "🇫🇷", label: "FR" },
  { code: "en", flag: "🇬🇧", label: "EN" },
  { code: "es", flag: "🇪🇸", label: "ES" },
];

export default function PublicNav() {
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const { lang, setLang, t } = useLang();

  const navLinks = [
    { href: "/pricing", label: t("nav_pricing") },
    { href: "/faq", label: t("nav_faq") },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
      <div className="container flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" className="flex items-center group">
          <LogoBrand size="md" />
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-foreground ${
                location === link.href ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* CTA + Lang picker */}
        <div className="hidden md:flex items-center gap-3">
          {/* Language selector */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted/50"
            >
              <Globe className="w-3.5 h-3.5" />
              {LANGS.find(l => l.code === lang)?.flag} {lang.toUpperCase()}
            </button>
            {langOpen && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border/60 rounded-lg shadow-lg overflow-hidden z-50 min-w-[100px]">
                {LANGS.map(l => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setLangOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${lang === l.code ? "text-primary font-medium" : "text-muted-foreground"}`}
                  >
                    {l.flag} {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isAuthenticated ? (
            <Link href="/dashboard">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                {t("nav_dashboard")}
              </Button>
            </Link>
          ) : (
            <>
              <a href={getLoginUrl()}>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  {t("nav_login")}
                </Button>
              </a>
              <a href={getLoginUrl()}>
                <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground glow-brand">
                  {t("nav_trial")}
                </Button>
              </a>
            </>
          )}
        </div>

        {/* Mobile menu */}
        <button
          className="md:hidden text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden glass border-t border-border/50 px-4 py-4 flex flex-col gap-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground py-1"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-border/50 flex flex-col gap-2">
            {isAuthenticated ? (
              <Link href="/dashboard">
                <Button size="sm" className="w-full bg-primary text-primary-foreground">Dashboard</Button>
              </Link>
            ) : (
              <>
                <a href={getLoginUrl()} className="w-full">
                  <Button variant="ghost" size="sm" className="w-full">Connexion</Button>
                </a>
                <a href={getLoginUrl()} className="w-full">
                  <Button size="sm" className="w-full bg-primary text-primary-foreground">Essai gratuit</Button>
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
