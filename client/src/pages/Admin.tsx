import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import {
  Users, FolderOpen, Zap, TrendingUp, Shield, Loader2, ArrowLeft
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr, enUS, es } from "date-fns/locale";
import { useLang } from "@/i18n/LangContext";

const ADM_DF_LOCALE = { fr, en: enUS, es } as const;

export default function Admin() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const dfLocale = ADM_DF_LOCALE[lang] || enUS;
  const [, navigate] = useLocation();
  const { data: adminStats, isLoading } = trpc.admin.getStats.useQuery();
  const { data: recentUsers } = trpc.admin.getRecentUsers.useQuery();

  if ((user as any)?.role !== "admin") {
    return (
      <AppLayout title="Admin">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Shield className="w-12 h-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-display font-bold text-foreground mb-2">{t("adm_denied_title")}</h2>
          <p className="text-muted-foreground mb-6">{t("adm_denied_desc")}</p>
          <Link href="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" /> {t("adm_back_dashboard")}
            </Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={t("adm_title")}>
      <div className="max-w-5xl space-y-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-1">{t("adm_title")}</h2>
          <p className="text-muted-foreground">{t("adm_overview")}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: t("adm_users"), value: adminStats?.totalUsers || 0, icon: Users, color: "text-primary", bg: "bg-primary/10" },
                { label: t("adm_projects"), value: adminStats?.totalProjects || 0, icon: FolderOpen, color: "text-cyan-400", bg: "bg-cyan-400/10" },
                { label: t("adm_generations"), value: adminStats?.totalGenerations || 0, icon: Zap, color: "text-amber-400", bg: "bg-amber-400/10" },
                { label: t("adm_total_tokens"), value: `${((adminStats?.totalTokens || 0) / 1000).toFixed(0)}k`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-400/10" },
              ].map((stat) => (
                <div key={stat.label} className="p-5 rounded-xl border border-border/60 bg-card">
                  <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                    <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
                  </div>
                  <div className="text-2xl font-display font-bold text-foreground">{stat.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Recent users */}
            <div className="p-5 rounded-xl border border-border/60 bg-card">
              <h3 className="font-display font-semibold text-foreground mb-4">{t("adm_recent_users")}</h3>
              {!recentUsers || recentUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("adm_no_users")}</p>

              ) : (
                <div className="space-y-3">
                  {recentUsers.map((u: any) => (
                    <div key={u.id} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                      <div>
                        <div className="text-sm font-medium text-foreground">{u.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.email || "—"}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize border-border/40 text-muted-foreground">
                          {u.plan || "free"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true, locale: dfLocale })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
