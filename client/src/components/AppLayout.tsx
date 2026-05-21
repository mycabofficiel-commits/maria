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
  LayoutDashboard, FolderOpen, Key, CreditCard,
  User, LogOut, ChevronRight, Menu, X, Shield, Crown, Zap, LayoutTemplate,
  PanelLeftClose, PanelLeftOpen, Sparkles
} from "lucide-react";
import LogoBrand from "@/components/LogoBrand";
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
  const [navCollapsed, setNavCollapsed] = useState(false);

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
        className={`fixed inset-y-0 left-0 z-50 bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 ${navCollapsed ? "lg:w-14" : "lg:w-64"} w-64`}
      >
        {/* Logo */}
        <div className="flex items-center justify-center px-3 h-16 border-b border-sidebar-border overflow-hidden">
          <Link href="/">
            <LogoBrand
              size={navCollapsed ? "sm" : "sm"}
              className="cursor-pointer hover:opacity-80 transition-opacity"
            />
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map((item) => {
            const active = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}>
                <div
                  title={navCollapsed ? item.label : undefined}
                  className={`flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <span className={`transition-all duration-300 whitespace-nowrap overflow-hidden ${navCollapsed ? "lg:w-0 lg:opacity-0" : "lg:w-auto lg:opacity-100"}`}>
                    {item.label}
                  </span>
                  {active && !navCollapsed && <ChevronRight className="ml-auto w-3.5 h-3.5 opacity-50 flex-shrink-0" />}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Ultra quick access */}
        {isUltra && (
          <div className="px-2 pb-2">
            <Link href="/ultra">
              <div title={navCollapsed ? "Tableau Ultra" : undefined} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 cursor-pointer hover:bg-amber-500/20 transition-colors overflow-hidden">
                <Crown className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span className={`text-xs font-semibold text-amber-400 whitespace-nowrap transition-all duration-300 ${navCollapsed ? "lg:w-0 lg:opacity-0 overflow-hidden" : "lg:w-auto lg:opacity-100"}`}>
                  Tableau de bord Ultra
                </span>
                {!navCollapsed && <Zap className="w-3 h-3 text-amber-400 ml-auto flex-shrink-0" />}
              </div>
            </Link>
          </div>
        )}

        {/* User */}
        <div className="px-2 py-4 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button title={navCollapsed ? (user?.name || "Utilisateur") : undefined} className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors overflow-hidden">
                <Avatar className="w-7 h-7 flex-shrink-0">
                  <AvatarFallback className={`text-xs font-bold ${isUltra ? "bg-amber-500/20 text-amber-400" : "bg-primary/20 text-primary"}`}>{initials}</AvatarFallback>
                </Avatar>
                <div className={`flex-1 text-left min-w-0 transition-all duration-300 ${navCollapsed ? "lg:w-0 lg:opacity-0 overflow-hidden" : "lg:w-auto lg:opacity-100"}`}>
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
      <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ease-in-out ${navCollapsed ? "lg:ml-14" : "lg:ml-64"}`}>
        {/* Top bar */}
        <header className="h-16 border-b border-border/50 flex items-center justify-between px-4 lg:px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              className="lg:hidden text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            {/* Desktop collapse button */}
            <button
              className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => setNavCollapsed(v => !v)}
              title={navCollapsed ? "Ouvrir le menu" : "Réduire le menu"}
            >
              {navCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
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
