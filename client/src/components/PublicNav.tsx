import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Sparkles, Menu, X } from "lucide-react";
import { useState } from "react";

export default function PublicNav() {
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const navLinks = [
    { href: "/pricing", label: "Tarifs" },
    { href: "/faq", label: "FAQ" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
      <div className="container flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-brand">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-xl text-foreground">Maria</span>
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

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          {isAuthenticated ? (
            <Link href="/dashboard">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Dashboard
              </Button>
            </Link>
          ) : (
            <>
              <a href={getLoginUrl()}>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                  Connexion
                </Button>
              </a>
              <a href={getLoginUrl()}>
                <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground glow-brand">
                  Essai gratuit
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
