import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Users, FolderOpen, Zap, Cpu, TrendingUp, Shield, Crown,
  RefreshCw, Trash2, ChevronDown, BarChart3, Activity,
  Globe, Key, Calendar, ArrowLeft
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import AppLayout from "@/components/AppLayout";

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = "primary" }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  const colorMap: Record<string, string> = {
    primary: "text-primary bg-primary/10",
    amber: "text-amber-400 bg-amber-400/10",
    emerald: "text-emerald-400 bg-emerald-400/10",
    rose: "text-rose-400 bg-rose-400/10",
    violet: "text-violet-400 bg-violet-400/10",
    cyan: "text-cyan-400 bg-cyan-400/10",
  };
  return (
    <div className="rounded-xl border border-border/40 bg-card/60 backdrop-blur p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg ${colorMap[color] || colorMap.primary}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground">{value.toLocaleString()}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Role Badge ───────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  if (role === "ultra") return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">⚡ Ultra</Badge>;
  if (role === "admin") return <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 text-xs">Admin</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">User</Badge>;
}

function PlanBadge({ plan }: { plan: string }) {
  const map: Record<string, string> = {
    agency: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    pro: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    creator: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    free: "bg-muted/30 text-muted-foreground border-border/40",
  };
  return (
    <Badge className={`text-xs capitalize ${map[plan] || map.free}`}>{plan}</Badge>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function UltraDashboard() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "projects">("overview");

  // Guard
  useEffect(() => {
    if (!loading && user && user.role !== "ultra") {
      navigate("/dashboard");
    }
  }, [user, loading, navigate]);

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.admin.getUltraStats.useQuery(undefined, {
    enabled: user?.role === "ultra",
  });

  const { data: allUsers, isLoading: usersLoading } = trpc.admin.getAllUsers.useQuery(undefined, {
    enabled: user?.role === "ultra" && activeTab === "users",
  });

  const { data: allProjects, isLoading: projectsLoading } = trpc.admin.getAllProjects.useQuery(undefined, {
    enabled: user?.role === "ultra" && activeTab === "projects",
  });

  const setRole = trpc.admin.setUserRole.useMutation({
    onSuccess: () => {
      toast.success("Rôle mis à jour");
      utils.admin.getAllUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setPlan = trpc.admin.setUserPlan.useMutation({
    onSuccess: () => {
      toast.success("Plan mis à jour");
      utils.admin.getAllUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resetGen = trpc.admin.resetUserGenerations.useMutation({
    onSuccess: () => {
      toast.success("Générations réinitialisées");
      utils.admin.getAllUsers.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteProject = trpc.admin.deleteProject.useMutation({
    onSuccess: () => {
      toast.success("Projet supprimé");
      utils.admin.getAllProjects.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading || !user) return null;
  if (user.role !== "ultra") return null;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="p-2 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                <h1 className="text-xl font-bold text-foreground">Tableau de bord Ultra</h1>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">⚡ Accès exclusif</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">Contrôle total de la plateforme Maria</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-border/50 text-muted-foreground hover:text-foreground"
            onClick={() => {
              utils.admin.getUltraStats.invalidate();
              utils.admin.getAllUsers.invalidate();
              utils.admin.getAllProjects.invalidate();
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Actualiser
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border/40">
          {[
            { id: "overview", label: "Vue d'ensemble", icon: BarChart3 },
            { id: "users", label: "Utilisateurs", icon: Users },
            { id: "projects", label: "Projets", icon: FolderOpen },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ─── Overview ─────────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {statsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-xl bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : stats ? (
              <>
                {/* Totaux */}
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Totaux plateforme</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={Users} label="Utilisateurs" value={stats.totals.users} color="primary" />
                    <StatCard icon={FolderOpen} label="Projets" value={stats.totals.projects} color="emerald" />
                    <StatCard icon={Zap} label="Versions générées" value={stats.totals.versions} color="amber" />
                    <StatCard icon={Key} label="Clés API" value={stats.totals.apiKeys} color="violet" />
                  </div>
                </div>

                {/* Activité */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-primary" /> Ce mois-ci
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-2xl font-bold text-foreground">{stats.monthly.generations.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">Générations</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-foreground">{(stats.monthly.tokens / 1000).toFixed(1)}k</div>
                        <div className="text-xs text-muted-foreground">Tokens utilisés</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" /> Cette semaine
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-2xl font-bold text-foreground">{stats.weekly.generations.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">Générations</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-foreground">{(stats.weekly.tokens / 1000).toFixed(1)}k</div>
                        <div className="text-xs text-muted-foreground">Tokens utilisés</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Répartition par plan */}
                <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-violet-400" /> Répartition par plan
                  </h3>
                  <div className="flex flex-wrap gap-4">
                    {stats.usersByPlan.map((p) => (
                      <div key={p.plan} className="flex items-center gap-2">
                        <PlanBadge plan={p.plan} />
                        <span className="text-sm font-semibold text-foreground">{p.count}</span>
                        <span className="text-xs text-muted-foreground">utilisateurs</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Activité récente */}
                <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" /> Activité récente (50 dernières actions)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Action</th>
                          <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Statut</th>
                          <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Tokens</th>
                          <th className="text-left py-2 text-muted-foreground font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.recentActivity.map((log) => (
                          <tr key={log.id} className="border-b border-border/20 hover:bg-muted/10">
                            <td className="py-2 pr-4 font-mono text-foreground">{log.action}</td>
                            <td className="py-2 pr-4">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                log.status === "success"
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-rose-500/10 text-rose-400"
                              }`}>{log.status}</span>
                            </td>
                            <td className="py-2 pr-4 text-muted-foreground">{log.tokensUsed?.toLocaleString() || 0}</td>
                            <td className="py-2 text-muted-foreground">
                              {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: fr })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">Impossible de charger les statistiques.</div>
            )}
          </div>
        )}

        {/* ─── Users ────────────────────────────────────────────────────────── */}
        {activeTab === "users" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Tous les utilisateurs ({allUsers?.length || 0})
              </h2>
            </div>
            {usersLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-border/40 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 border-b border-border/40">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Utilisateur</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Rôle</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Plan</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Générations</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Inscrit</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers?.map((u) => (
                      <tr key={u.id} className="border-b border-border/20 hover:bg-muted/10">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{u.name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{u.email || "—"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadge role={u.role} />
                        </td>
                        <td className="px-4 py-3">
                          <PlanBadge plan={u.plan} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-foreground">{u.generationsUsed}</span>
                          <span className="text-muted-foreground">/{u.generationsLimit === 999999 ? "∞" : u.generationsLimit}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true, locale: fr })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* Changer le plan */}
                            <select
                              defaultValue={u.plan}
                              onChange={(e) => setPlan.mutate({ userId: u.id, plan: e.target.value as "free" | "creator" | "pro" | "agency" })}
                              className="text-xs bg-muted/30 border border-border/50 rounded px-2 py-1 text-foreground focus:outline-none"
                            >
                              <option value="free">Free</option>
                              <option value="creator">Creator</option>
                              <option value="pro">Pro</option>
                              <option value="agency">Agency</option>
                            </select>
                            {/* Reset générations */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => resetGen.mutate({ userId: u.id })}
                              title="Réinitialiser les générations"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </Button>
                            {/* Changer le rôle */}
                            {u.role !== "ultra" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-amber-400"
                                onClick={() => setRole.mutate({ userId: u.id, role: u.role === "admin" ? "user" : "admin" })}
                                title={u.role === "admin" ? "Rétrograder en user" : "Promouvoir en admin"}
                              >
                                <Shield className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── Projects ─────────────────────────────────────────────────────── */}
        {activeTab === "projects" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Tous les projets ({allProjects?.length || 0})
            </h2>
            {projectsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-border/40 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 border-b border-border/40">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Projet</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Statut</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Framework</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Déployé</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Créé</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allProjects?.map((p) => (
                      <tr key={p.id} className="border-b border-border/20 hover:bg-muted/10">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{p.name}</div>
                          <div className="text-xs text-muted-foreground">ID #{p.id} · User #{p.userId}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.status === "ready" ? "bg-emerald-500/10 text-emerald-400" :
                            p.status === "published" ? "bg-blue-500/10 text-blue-400" :
                            p.status === "generating" ? "bg-amber-500/10 text-amber-400" :
                            "bg-muted/30 text-muted-foreground"
                          }`}>{p.status}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground uppercase">{p.framework}</td>
                        <td className="px-4 py-3">
                          {p.deployedUrl ? (
                            <a href={p.deployedUrl} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-primary hover:underline">
                              <Globe className="w-3 h-3" /> Voir
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(p.createdAt), { addSuffix: true, locale: fr })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-400"
                            onClick={() => {
                              if (confirm(`Supprimer le projet "${p.name}" ? Cette action est irréversible.`)) {
                                deleteProject.mutate({ projectId: p.id });
                              }
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
