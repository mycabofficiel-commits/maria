import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import {
  Sparkles, FolderOpen, Zap, Key, ArrowRight, Plus,
  Globe, Clock, CheckCircle2, AlertCircle, Loader2, LayoutTemplate
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Brouillon", color: "text-muted-foreground", icon: Clock },
  generating: { label: "Génération…", color: "text-amber-400", icon: Loader2 },
  ready: { label: "Prêt", color: "text-emerald-400", icon: CheckCircle2 },
  published: { label: "Publié", color: "text-primary", icon: Globe },
  archived: { label: "Archivé", color: "text-muted-foreground", icon: Clock },
  error: { label: "Erreur", color: "text-destructive", icon: AlertCircle },
};

const PLAN_COLORS: Record<string, string> = {
  free: "border-border/60 text-muted-foreground",
  creator: "border-primary/40 text-primary bg-primary/5",
  pro: "border-cyan-400/40 text-cyan-400 bg-cyan-400/5",
  agency: "border-amber-400/40 text-amber-400 bg-amber-400/5",
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = trpc.user.getUsageStats.useQuery();
  const { data: projects, isLoading: projectsLoading } = trpc.projects.list.useQuery();
  const { data: apiKey } = trpc.user.getApiKey.useQuery();
  const [, navigate] = useLocation();

  const recentProjects = projects?.slice(0, 4) || [];
  const plan = (user as any)?.plan || "free";

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-6 max-w-6xl">
        {/* Welcome */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground">
              Bonjour, {user?.name?.split(" ")[0] || "là"} 👋
            </h2>
            <p className="text-muted-foreground mt-1">Voici un aperçu de votre activité.</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`capitalize ${PLAN_COLORS[plan]}`}>
              Plan {plan}
            </Badge>
            <Link href="/projects">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau projet
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Projets",
              value: statsLoading ? "—" : stats?.projectsCount || 0,
              icon: FolderOpen,
              color: "text-primary",
              bg: "bg-primary/10",
              sub: `/ ${plan === "agency" ? "∞" : plan === "pro" ? 20 : plan === "creator" ? 5 : 1} max`,
            },
            {
              label: "Générations",
              value: statsLoading ? "—" : stats?.generationsUsed || 0,
              icon: Sparkles,
              color: "text-cyan-400",
              bg: "bg-cyan-400/10",
              sub: `/ ${stats?.generationsLimit || 3} ce mois`,
            },
            {
              label: "Tokens utilisés",
              value: statsLoading ? "—" : ((stats?.tokensTotal || 0) / 1000).toFixed(1) + "k",
              icon: Zap,
              color: "text-amber-400",
              bg: "bg-amber-400/10",
              sub: "total",
            },
            {
              label: "Clé API",
              value: apiKey ? "Connectée" : "Non configurée",
              icon: Key,
              color: apiKey ? "text-emerald-400" : "text-muted-foreground",
              bg: apiKey ? "bg-emerald-400/10" : "bg-muted",
              sub: apiKey ? `…${apiKey.keyHint}` : "Configurer",
            },
          ].map((stat) => (
            <div key={stat.label} className="p-5 rounded-xl border border-border/60 bg-card">
              <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
              </div>
              <div className="text-2xl font-display font-bold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stat.label} {stat.sub}</div>
            </div>
          ))}
        </div>

        {/* API Key warning */}
        {!apiKey && (
          <div className="flex items-center justify-between p-4 rounded-xl border border-amber-400/20 bg-amber-400/5">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-foreground">Clé API Anthropic requise</div>
                <div className="text-xs text-muted-foreground">Connectez votre clé pour commencer à générer des sites.</div>
              </div>
            </div>
            <Link href="/api-keys">
              <Button size="sm" variant="outline" className="border-amber-400/30 text-amber-400 hover:bg-amber-400/10 flex-shrink-0">
                Configurer
                <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        )}

        {/* Recent projects */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-foreground">Projets récents</h3>
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                Voir tout
                <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>

          {projectsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-dashed border-border/60">
              <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">Aucun projet pour l'instant.</p>
              <Link href="/projects">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Plus className="w-4 h-4 mr-2" />
                  Créer mon premier site
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {recentProjects.map((project: any) => {
                const statusConf = STATUS_CONFIG[project.status] || STATUS_CONFIG.draft;
                return (
                  <div
                    key={project.id}
                    className="p-5 rounded-xl border border-border/60 bg-card card-hover cursor-pointer"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-foreground truncate">{project.name}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{project.description || project.siteType || "Site web"}</p>
                      </div>
                      <Badge variant="outline" className={`ml-2 flex-shrink-0 text-xs ${statusConf.color} border-current/20`}>
                        <statusConf.icon className="w-3 h-3 mr-1" />
                        {statusConf.label}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="capitalize">{project.framework || "html"}</span>
                      <span>{formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true, locale: fr })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div>
          <h3 className="font-display font-semibold text-foreground mb-4">Actions rapides</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { href: "/projects", icon: Plus, label: "Nouveau projet", desc: "Créer un site avec l'IA", color: "text-primary", bg: "bg-primary/10" },
              { href: "/templates", icon: LayoutTemplate, label: "Templates", desc: "Partir d'un template prêt", color: "text-violet-400", bg: "bg-violet-400/10" },
              { href: "/api-keys", icon: Key, label: "Clés API", desc: "Gérer votre clé Anthropic", color: "text-cyan-400", bg: "bg-cyan-400/10" },
              { href: "/billing", icon: Zap, label: "Billing", desc: "Gérer votre abonnement", color: "text-amber-400", bg: "bg-amber-400/10" },
            ].map((action) => (
              <Link key={action.href} href={action.href}>
                <div className="flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-card card-hover cursor-pointer">
                  <div className={`w-9 h-9 rounded-lg ${action.bg} flex items-center justify-center flex-shrink-0`}>
                    <action.icon className={`w-4.5 h-4.5 ${action.color}`} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.desc}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
