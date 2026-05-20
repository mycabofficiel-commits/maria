import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles, LayoutDashboard, FolderOpen, Key, CreditCard,
  User, LogOut, Settings, ChevronRight, Menu, X, Shield, Crown, Zap, LayoutTemplate
} from "lucide-react";
import { useState } from "react";
import { Loader2 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projets", icon: FolderOpen },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/api-keys", label: "Clés API", icon: Key },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AppLayout({ children, title }: AppLayoutProps) {
  const { user, isAuthenticated, loading, logout } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  const initials = user?.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  const isUltra = (user as any)?.role === "ultra";

  const planColors: Record<string, string> = {
    free: "text-muted-foreground",
    creator: "text-primary",
    pro: "text-cyan-400",
    agency: "text-amber-400",
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-lg text-foreground">Maria</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                  {active && <ChevronRight className="ml-auto w-3.5 h-3.5 opacity-50" />}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Ultra quick access */}
        {isUltra && (
          <div className="px-3 pb-2">
            <Link href="/ultra">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 cursor-pointer hover:bg-amber-500/20 transition-colors">
                <Crown className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold text-amber-400">Tableau de bord Ultra</span>
                <Zap className="w-3 h-3 text-amber-400 ml-auto" />
              </div>
            </Link>
          </div>
        )}

        {/* User */}
        <div className="px-3 py-4 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors">
                <Avatar className="w-7 h-7">
                  <AvatarFallback className={`text-xs font-bold ${isUltra ? "bg-amber-500/20 text-amber-400" : "bg-primary/20 text-primary"}`}>{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground truncate">{user?.name || "Utilisateur"}</span>
                    {isUltra && <Crown className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                  </div>
                  <div className={`text-xs ${isUltra ? "text-amber-400 font-semibold" : `capitalize ${planColors[(user as any)?.plan || "free"]}`}`}>
                    {isUltra ? "⚡ Ultra" : `Plan ${(user as any)?.plan || "free"}`}
                  </div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link href="/profile" className="flex items-center gap-2 cursor-pointer">
                  <User className="w-4 h-4" /> Profil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/billing" className="flex items-center gap-2 cursor-pointer">
                  <CreditCard className="w-4 h-4" /> Billing
                </Link>
              </DropdownMenuItem>
              {(user as any)?.role === "admin" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/admin" className="flex items-center gap-2 cursor-pointer">
                      <Shield className="w-4 h-4" /> Admin
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
              {isUltra && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/ultra" className="flex items-center gap-2 cursor-pointer text-amber-400">
                      <Crown className="w-4 h-4" /> Tableau Ultra
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" /> Déconnexion
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="h-16 border-b border-border/50 flex items-center justify-between px-4 lg:px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            {title && (
              <h1 className="font-display font-semibold text-foreground">{title}</h1>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/projects">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground hidden sm:flex">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Nouveau site
              </Button>
            </Link>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
