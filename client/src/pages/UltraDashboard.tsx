import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Users, FolderOpen, Zap, Cpu, TrendingUp, Shield, Crown,
  RefreshCw, Trash2, BarChart3, Activity, Globe, Key,
  Calendar, ArrowLeft, Plus, Power, PowerOff, Eye, EyeOff,
  Coins, Gauge, DollarSign, Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr, enUS, es } from "date-fns/locale";
import AppLayout from "@/components/AppLayout";
import { useLang } from "@/i18n/LangContext";

const UD_DF_LOCALE = { fr, en: enUS, es } as const;

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = "primary" }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
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
        <div className="text-2xl font-bold text-foreground">{typeof value === "number" ? value.toLocaleString() : value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

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
  return <Badge className={`text-xs capitalize ${map[plan] || map.free}`}>{plan}</Badge>;
}

// Provider display info
const PROVIDERS: { id: "anthropic" | "openai" | "deepseek" | "qwen"; label: string; role: string; color: string }[] = [
  { id: "deepseek",  label: "DeepSeek",  role: "Exécuteur final (tous les plans)",       color: "text-blue-400" },
  { id: "qwen",      label: "Qwen",       role: "Coordinator (Creator / Pro / Agency)",   color: "text-orange-400" },
  { id: "anthropic", label: "Claude",     role: "Architecte (Pro / Agency) + Debug",      color: "text-violet-400" },
  { id: "openai",    label: "GPT-4o",     role: "Stratège (Agency uniquement)",           color: "text-emerald-400" },
];

// ── Pricing reference (mirrors server/streaming.ts COST_PER_M) ───────────────
const LLM_META: Record<string, { label: string; role: string; color: string; plans: string }> = {
  "deepseek-chat":     { label: "DeepSeek Chat",     role: "Exécuteur HTML final",              color: "text-blue-400",    plans: "Tous les plans" },
  "qwen-plus":         { label: "Qwen Plus",          role: "Stratégie contenu & SEO/copy",      color: "text-orange-400",  plans: "Creator · Pro · Agency" },
  "claude-haiku-4-5":  { label: "Claude Haiku 4.5",   role: "Architecture + Debug",              color: "text-violet-400",  plans: "Pro · Agency" },
  "claude-sonnet-4-5": { label: "Claude Sonnet 4.5",  role: "Chat avancé",                       color: "text-violet-400",  plans: "Pro · Agency" },
  "gpt-4o-mini":       { label: "GPT-4o mini",        role: "Stratège business",                 color: "text-emerald-400", plans: "Agency uniquement" },
  "gpt-4o":            { label: "GPT-4o",             role: "Stratège business (premium)",       color: "text-emerald-400", plans: "Agency uniquement" },
};

/** micro-USD (stored as bigint × 1e6) → formatted USD string */
function fmtCost(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  if (usd >= 10)   return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  if (usd >= 0)    return `$${usd.toFixed(6)}`;
  return "$0";
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function UltraDashboard() {
  const { user, loading } = useAuth();
  const { t, lang } = useLang();
  const dfLocale = UD_DF_LOCALE[lang] || enUS;
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "keys" | "tokens" | "projects">("overview");

  useEffect(() => {
    if (!loading && user && user.role !== "ultra") navigate("/dashboard");
  }, [user, loading, navigate]);

  const utils = trpc.useUtils();

  const { data: stats,       isLoading: statsLoading    } = trpc.admin.getUltraStats.useQuery(undefined, { enabled: user?.role === "ultra" });
  const { data: allUsers,    isLoading: usersLoading    } = trpc.admin.getAllUsers.useQuery(undefined, { enabled: user?.role === "ultra" && activeTab === "users" });
  const { data: tokenStats                              } = trpc.admin.getUserTokenStats.useQuery(undefined, { enabled: user?.role === "ultra" && activeTab === "users" });
  const { data: platformKeys, isLoading: keysLoading   } = trpc.admin.getPlatformKeys.useQuery(undefined, { enabled: user?.role === "ultra" && activeTab === "keys" });
  const { data: allProjects,  isLoading: projectsLoading } = trpc.admin.getAllProjects.useQuery(undefined,  { enabled: user?.role === "ultra" && activeTab === "projects" });
  const { data: tokensByLlm, isLoading: tokensLlmLoading } = trpc.admin.getTokensByLlm.useQuery(undefined, { enabled: user?.role === "ultra" && activeTab === "tokens" });

  // ── User mutations ──────────────────────────────────────────────────────────
  const setRole  = trpc.admin.setUserRole.useMutation({ onSuccess: () => { toast.success(t("ud_toast_role")); utils.admin.getAllUsers.invalidate(); }, onError: e => toast.error(e.message) });
  const setPlan  = trpc.admin.setUserPlan.useMutation({ onSuccess: () => { toast.success(t("ud_toast_plan")); utils.admin.getAllUsers.invalidate(); }, onError: e => toast.error(e.message) });
  const resetGen = trpc.admin.resetUserGenerations.useMutation({ onSuccess: () => { toast.success(t("ud_toast_gen_reset")); utils.admin.getAllUsers.invalidate(); }, onError: e => toast.error(e.message) });
  const setTokenLimit = trpc.admin.setUserTokenLimit.useMutation({ onSuccess: () => { toast.success(t("ud_toast_limit")); utils.admin.getAllUsers.invalidate(); }, onError: e => toast.error(e.message) });

  // ── Platform key mutations ──────────────────────────────────────────────────
  const setPlatformKey    = trpc.admin.setPlatformKey.useMutation({ onSuccess: () => { toast.success(t("ud_toast_key_saved")); utils.admin.getPlatformKeys.invalidate(); setNewKey(""); setNewLabel(""); setAddingFor(null); }, onError: e => toast.error(e.message) });
  const togglePlatformKey = trpc.admin.togglePlatformKey.useMutation({ onSuccess: () => { toast.success(t("ud_toast_status")); utils.admin.getPlatformKeys.invalidate(); }, onError: e => toast.error(e.message) });
  const deletePlatformKey = trpc.admin.deletePlatformKey.useMutation({ onSuccess: () => { toast.success(t("ud_toast_key_deleted")); utils.admin.getPlatformKeys.invalidate(); }, onError: e => toast.error(e.message) });
  const deleteProject     = trpc.admin.deleteProject.useMutation({ onSuccess: () => { toast.success(t("ud_toast_project_deleted")); utils.admin.getAllProjects.invalidate(); }, onError: e => toast.error(e.message) });

  // ── Local state ─────────────────────────────────────────────────────────────
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newKey, setNewKey]       = useState("");
  const [newLabel, setNewLabel]   = useState("");
  const [showKey, setShowKey]     = useState(false);
  const [tokenLimitEdits, setTokenLimitEdits] = useState<Record<number, string>>({});

  // Build token stats map
  const tokenMap = new Map((tokenStats || []).map(s => [s.userId, s]));

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
                <h1 className="text-xl font-bold text-foreground">{t("ud_title")}</h1>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">{t("ud_exclusive")}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{t("ud_subtitle")}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2 border-border/50 text-muted-foreground hover:text-foreground"
            onClick={() => { utils.admin.getUltraStats.invalidate(); utils.admin.getAllUsers.invalidate(); utils.admin.getAllProjects.invalidate(); utils.admin.getPlatformKeys.invalidate(); }}>
            <RefreshCw className="w-3.5 h-3.5" /> {t("ud_refresh")}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border/40">
          {[
            { id: "overview",  label: t("ud_tab_overview"),  icon: BarChart3 },
            { id: "users",     label: t("ud_tab_users"),    icon: Users },
            { id: "keys",      label: t("ud_tab_keys"),        icon: Key },
            { id: "tokens",    label: t("ud_tab_tokens"),  icon: DollarSign },
            { id: "projects",  label: t("ud_tab_projects"),         icon: FolderOpen },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id ? "border-amber-400 text-amber-400" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════ OVERVIEW ═══════════════════════════════ */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {statsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted/20 animate-pulse" />)}
              </div>
            ) : stats ? (
              <>
                <div>
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("ud_platform_totals")}</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={Users}      label={t("ud_users")}     value={stats.totals.users}    color="primary" />
                    <StatCard icon={FolderOpen} label={t("ud_projects")}          value={stats.totals.projects} color="emerald" />
                    <StatCard icon={Zap}        label={t("ud_versions_gen")} value={stats.totals.versions} color="amber" />
                    <StatCard icon={Key}        label={t("ud_user_api_keys")}   value={stats.totals.apiKeys}  color="violet" />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> {t("ud_this_month")}</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div><div className="text-2xl font-bold text-foreground">{stats.monthly.generations.toLocaleString()}</div><div className="text-xs text-muted-foreground">{t("ud_generations")}</div></div>
                      <div><div className="text-2xl font-bold text-foreground">{(stats.monthly.tokens / 1000).toFixed(1)}k</div><div className="text-xs text-muted-foreground">{t("ud_tokens_used")}</div></div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" /> {t("ud_this_week")}</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div><div className="text-2xl font-bold text-foreground">{stats.weekly.generations.toLocaleString()}</div><div className="text-xs text-muted-foreground">{t("ud_generations")}</div></div>
                      <div><div className="text-2xl font-bold text-foreground">{(stats.weekly.tokens / 1000).toFixed(1)}k</div><div className="text-xs text-muted-foreground">{t("ud_tokens_used")}</div></div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><Cpu className="w-4 h-4 text-violet-400" /> {t("ud_by_plan")}</h3>
                  <div className="flex flex-wrap gap-4">
                    {stats.usersByPlan.map((p) => (
                      <div key={p.plan} className="flex items-center gap-2"><PlanBadge plan={p.plan} /><span className="text-sm font-semibold text-foreground">{p.count}</span><span className="text-xs text-muted-foreground">{t("ud_users_word")}</span></div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border/40 bg-card/60 p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" /> {t("ud_recent_activity")}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b border-border/40">
                        <th className="text-left py-2 pr-4 text-muted-foreground font-medium">{t("ud_col_action")}</th>
                        <th className="text-left py-2 pr-4 text-muted-foreground font-medium">{t("ud_col_status")}</th>
                        <th className="text-left py-2 pr-4 text-muted-foreground font-medium">{t("ud_col_tokens")}</th>
                        <th className="text-left py-2 text-muted-foreground font-medium">{t("ud_col_date")}</th>
                      </tr></thead>
                      <tbody>
                        {stats.recentActivity.map((log) => (
                          <tr key={log.id} className="border-b border-border/20 hover:bg-muted/10">
                            <td className="py-2 pr-4 font-mono text-foreground">{log.action}</td>
                            <td className="py-2 pr-4"><span className={`px-1.5 py-0.5 rounded text-xs ${log.status === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{log.status}</span></td>
                            <td className="py-2 pr-4 text-muted-foreground">{log.tokensUsed?.toLocaleString() || 0}</td>
                            <td className="py-2 text-muted-foreground">{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: dfLocale })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : <div className="text-center py-12 text-muted-foreground">{t("ud_stats_fail")}</div>}
          </div>
        )}

        {/* ═══════════════════════════ USERS ══════════════════════════════════ */}
        {activeTab === "users" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {t("ud_all_users")} ({allUsers?.length || 0})
            </h2>
            {usersLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted/20 animate-pulse" />)}</div>
            ) : (
              <div className="rounded-xl border border-border/40 overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead className="bg-muted/20 border-b border-border/40">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_user")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_role")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_plan")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_generations")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_tokens_month")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_tokens_total")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_token_limit")}</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers?.map((u) => {
                      const ts = tokenMap.get(u.id);
                      const limitEdit = tokenLimitEdits[u.id];
                      return (
                        <tr key={u.id} className="border-b border-border/20 hover:bg-muted/10">
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{u.name || "—"}</div>
                            <div className="text-xs text-muted-foreground">{u.email || "—"}</div>
                          </td>
                          <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                          <td className="px-4 py-3"><PlanBadge plan={u.plan} /></td>
                          <td className="px-4 py-3">
                            <span className="text-foreground">{u.generationsUsed}</span>
                            <span className="text-muted-foreground">/{u.generationsLimit === 999999 ? "∞" : u.generationsLimit}</span>
                          </td>
                          {/* Tokens ce mois */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Coins className="w-3 h-3 text-amber-400 flex-shrink-0" />
                              <span className="text-foreground font-mono text-xs">
                                {(ts?.monthTokens || 0).toLocaleString()}
                              </span>
                              {u.monthlyTokensLimit && ts?.monthTokens ? (
                                <span className={`text-xs ${ts.monthTokens >= u.monthlyTokensLimit ? "text-rose-400 font-semibold" : "text-muted-foreground"}`}>
                                  /{u.monthlyTokensLimit.toLocaleString()}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          {/* Tokens total */}
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs text-muted-foreground">
                              {((ts?.totalTokens || 0) / 1000).toFixed(1)}k
                            </span>
                          </td>
                          {/* Limite tokens/mois */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <Input
                                className="h-7 w-28 text-xs bg-muted/20 border-border/40 font-mono"
                                placeholder={t("ud_unlimited")}
                                value={limitEdit ?? (u.monthlyTokensLimit?.toString() || "")}
                                onChange={e => setTokenLimitEdits(prev => ({ ...prev, [u.id]: e.target.value }))}
                                onKeyDown={e => {
                                  if (e.key === "Enter") {
                                    const val = tokenLimitEdits[u.id];
                                    setTokenLimit.mutate({ userId: u.id, monthlyTokensLimit: val === "" ? null : parseInt(val) || null });
                                    setTokenLimitEdits(prev => { const n = { ...prev }; delete n[u.id]; return n; });
                                  }
                                }}
                              />
                              <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs"
                                title={t("ud_save_enter")}
                                onClick={() => {
                                  const val = tokenLimitEdits[u.id];
                                  if (val === undefined) return;
                                  setTokenLimit.mutate({ userId: u.id, monthlyTokensLimit: val === "" ? null : parseInt(val) || null });
                                  setTokenLimitEdits(prev => { const n = { ...prev }; delete n[u.id]; return n; });
                                }}>
                                <Gauge className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <select defaultValue={u.plan}
                                onChange={e => setPlan.mutate({ userId: u.id, plan: e.target.value as any })}
                                className="text-xs bg-muted/30 border border-border/50 rounded px-2 py-1 text-foreground focus:outline-none">
                                <option value="free">Free</option>
                                <option value="creator">Creator</option>
                                <option value="pro">Pro</option>
                                <option value="agency">Agency</option>
                              </select>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => resetGen.mutate({ userId: u.id })} title={t("ud_reset_gen")}>
                                <RefreshCw className="w-3 h-3" />
                              </Button>
                              {u.role !== "ultra" && (
                                <Button size="sm" variant="ghost"
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-amber-400"
                                  onClick={() => setRole.mutate({ userId: u.id, role: u.role === "admin" ? "user" : "admin" })}
                                  title={u.role === "admin" ? t("ud_demote") : t("ud_promote")}>
                                  <Shield className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════ CLÉS LLM ═══════════════════════════════ */}
        {activeTab === "keys" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t("ud_keys_h")}</h2>
              <p className="text-xs text-muted-foreground">{t("ud_keys_desc")}</p>
            </div>

            {/* ── Tableau récapitulatif ── */}
            {!keysLoading && (
              <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Key className="w-4 h-4 text-amber-400" />
                    {t("ud_keys_summary")}
                  </span>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                    {platformKeys?.filter(k => k.isActive).length || 0} / {PROVIDERS.length} {t("ud_actives")}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/10 border-b border-border/30">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_llm")}</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_chain_role")}</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_status")}</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_key_hint")}</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_updated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PROVIDERS.map((prov) => {
                      const k = platformKeys?.find(p => p.provider === prov.id);
                      return (
                        <tr key={prov.id} className="border-b border-border/20 hover:bg-muted/10">
                          <td className="px-4 py-3">
                            <span className={`font-semibold ${prov.color}`}>{prov.label}</span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{prov.role}</td>
                          <td className="px-4 py-3">
                            {k ? (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${k.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
                                {k.isActive ? t("ud_active") : t("ud_disabled")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400">
                                {t("ud_missing")}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {k?.keyHint || "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {k?.updatedAt ? formatDistanceToNow(new Date(k.updatedAt), { addSuffix: true, locale: dfLocale }) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {keysLoading ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-muted/20 animate-pulse" />)}</div>
            ) : (
              <div className="grid gap-4">
                {PROVIDERS.map((prov) => {
                  const existing = platformKeys?.find(k => k.provider === prov.id);
                  const isAdding = addingFor === prov.id;
                  return (
                    <div key={prov.id} className="rounded-xl border border-border/40 bg-card/60 p-5">
                      <div className="flex items-start justify-between gap-4">
                        {/* Left: provider info */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-muted/30 flex items-center justify-center flex-shrink-0">
                            <Key className={`w-4 h-4 ${prov.color}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold ${prov.color}`}>{prov.label}</span>
                              {existing ? (
                                <Badge className={existing.isActive
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs"
                                  : "bg-muted/30 text-muted-foreground border-border/40 text-xs"}>
                                  {existing.isActive ? t("ud_active") : t("ud_disabled")}
                                </Badge>
                              ) : (
                                <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/30 text-xs">{t("ud_not_configured")}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{prov.role}</div>
                            {existing && (
                              <div className="text-xs text-muted-foreground/60 mt-0.5 font-mono">
                                {existing.label && <span className="mr-2 text-muted-foreground">{existing.label}</span>}
                                {t("ud_key_word")} {existing.keyHint}
                                {existing.updatedAt && <span className="ml-2">· {t("ud_updated_prefix")}{formatDistanceToNow(new Date(existing.updatedAt), { addSuffix: true, locale: dfLocale })}</span>}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {existing && (
                            <>
                              <Button size="sm" variant="ghost"
                                className={`h-8 px-3 text-xs gap-1.5 ${existing.isActive ? "text-muted-foreground hover:text-amber-400" : "text-muted-foreground hover:text-emerald-400"}`}
                                onClick={() => togglePlatformKey.mutate({ provider: prov.id, isActive: !existing.isActive })}
                                title={existing.isActive ? t("ud_disable") : t("ud_enable")}>
                                {existing.isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                                {existing.isActive ? t("ud_disable") : t("ud_enable")}
                              </Button>
                              <Button size="sm" variant="ghost"
                                className="h-8 px-2 text-muted-foreground hover:text-rose-400"
                                onClick={() => { if (confirm(`${t("ud_confirm_del_key_1")}${prov.label}${t("ud_confirm_del_key_2")}`)) deletePlatformKey.mutate({ provider: prov.id }); }}
                                title={t("ud_delete")}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant={existing ? "outline" : "default"}
                            className={`h-8 px-3 text-xs gap-1.5 ${!existing ? "bg-primary hover:bg-primary/90" : "border-border/50"}`}
                            onClick={() => setAddingFor(isAdding ? null : prov.id)}>
                            <Plus className="w-3.5 h-3.5" />
                            {existing ? t("ud_replace") : t("ud_add")}
                          </Button>
                        </div>
                      </div>

                      {/* Inline add form */}
                      {isAdding && (
                        <div className="mt-4 pt-4 border-t border-border/30 space-y-3">
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground font-medium">{t("ud_api_key_req")}</label>
                              <div className="relative">
                                <Input
                                  type={showKey ? "text" : "password"}
                                  placeholder={`${t("ud_paste_key_prefix")}${prov.label}${t("ud_paste_key_suffix")}`}
                                  value={newKey}
                                  onChange={e => setNewKey(e.target.value)}
                                  className="h-9 text-sm pr-9 bg-muted/20 border-border/50 font-mono"
                                />
                                <button onClick={() => setShowKey(!showKey)}
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground font-medium">{t("ud_label_opt")}</label>
                              <Input
                                placeholder={t("ud_label_ph")}
                                value={newLabel}
                                onChange={e => setNewLabel(e.target.value)}
                                className="h-9 text-sm bg-muted/20 border-border/50"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setAddingFor(null); setNewKey(""); setNewLabel(""); }}>
                              {t("ud_cancel")}
                            </Button>
                            <Button size="sm" className="h-8 text-xs bg-primary hover:bg-primary/90"
                              disabled={!newKey.trim() || setPlatformKey.isPending}
                              onClick={() => setPlatformKey.mutate({ provider: prov.id, rawKey: newKey.trim(), label: newLabel.trim() || undefined })}>
                              {setPlatformKey.isPending ? t("ud_saving") : t("ud_save_key")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Info box */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300/80 space-y-1">
              <p className="font-semibold text-amber-300">{t("ud_security")}</p>
              <p>{t("ud_sec_1")}</p>
              <p>{t("ud_sec_2")}</p>
              <p>{t("ud_sec_3")}</p>
            </div>
          </div>
        )}

        {/* ═══════════════════════════ TOKENS & COÛTS ═════════════════════════ */}
        {activeTab === "tokens" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t("ud_tokens_h")}</h2>
              <p className="text-xs text-muted-foreground">{t("ud_tokens_desc")}</p>
            </div>

            {tokensLlmLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/20 animate-pulse" />)}</div>
            ) : (() => {
              const rows = tokensByLlm || [];
              const totalMonthCost  = rows.reduce((s, r) => s + r.monthCost,  0);
              const totalMonthTokens = rows.reduce((s, r) => s + r.monthTokens, 0);
              const totalCost       = rows.reduce((s, r) => s + r.totalCost,  0);
              const totalTokens     = rows.reduce((s, r) => s + r.totalTokens, 0);
              const maxMonthCost    = Math.max(...rows.map(r => r.monthCost), 1);

              return (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={DollarSign} label={t("ud_cost_month")}        value={fmtCost(totalMonthCost)}                     color="amber" />
                    <StatCard icon={Coins}       label={t("ud_tokens_month")}      value={`${(totalMonthTokens/1000).toFixed(1)}k`}    color="primary" />
                    <StatCard icon={DollarSign} label={t("ud_cost_total")}           value={fmtCost(totalCost)}                          color="rose" />
                    <StatCard icon={Layers}      label={t("ud_tokens_total")}         value={`${(totalTokens/1000).toFixed(1)}k`}         color="violet" />
                  </div>

                  {/* Per-LLM breakdown table */}
                  <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-semibold text-foreground">{t("ud_detail_llm")}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-muted/10 border-b border-border/30">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_model")}</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_role")}</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_plans")}</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_calls_month")}</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_tokens_month2")}</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_cost_month")}</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_tokens_total2")}</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">{t("ud_col_cost_total")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">{t("ud_no_data")}</td></tr>
                        ) : rows.map((r) => {
                          const meta = LLM_META[r.model] || { label: r.model, role: "—", color: "text-foreground", plans: "—" };
                          const barPct = maxMonthCost > 0 ? Math.round((r.monthCost / maxMonthCost) * 100) : 0;
                          return (
                            <tr key={r.model} className="border-b border-border/20 hover:bg-muted/10">
                              <td className="px-4 py-3">
                                <div className={`font-semibold text-sm ${meta.color}`}>{meta.label}</div>
                                <div className="w-full mt-1.5 h-1 rounded-full bg-muted/30">
                                  <div className="h-1 rounded-full bg-amber-400/60" style={{ width: `${barPct}%` }} />
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">{meta.role}</td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">{meta.plans}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{r.monthCalls.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-foreground">{r.monthTokens.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-amber-400 font-semibold">{fmtCost(r.monthCost)}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{r.totalTokens.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{fmtCost(r.totalCost)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {rows.length > 0 && (
                        <tfoot className="bg-muted/10 border-t border-border/30">
                          <tr>
                            <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-foreground">{t("ud_total")}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-foreground">{totalMonthTokens.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-amber-400">{fmtCost(totalMonthCost)}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-muted-foreground">{totalTokens.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-muted-foreground">{fmtCost(totalCost)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>

                  {/* Pipeline legend */}
                  <div className="rounded-xl border border-border/40 bg-card/60 p-5 space-y-3">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Cpu className="w-4 h-4 text-violet-400" /> {t("ud_pipeline_h")}</h3>
                    <div className="space-y-2 text-xs">
                      {[
                        { plan: "Free",    color: "text-muted-foreground",  badge: "bg-muted/30 text-muted-foreground",         chain: ["DeepSeek → HTML"] },
                        { plan: "Creator", color: "text-violet-400",         badge: "bg-violet-500/10 text-violet-400",          chain: ["Qwen (stratégie)", "→ DeepSeek (HTML)"] },
                        { plan: "Pro",     color: "text-blue-400",           badge: "bg-blue-500/10 text-blue-400",              chain: ["Claude (architecture)", "→ Qwen (SEO/copy)", "→ DeepSeek (HTML)"] },
                        { plan: "Agency",  color: "text-emerald-400",        badge: "bg-emerald-500/10 text-emerald-400",        chain: ["GPT-4o (stratégie biz)", "→ Claude (design)", "→ Qwen (copy SEO)", "→ DeepSeek (HTML)"] },
                      ].map(({ plan, color, badge, chain }) => (
                        <div key={plan} className="flex items-center gap-3 flex-wrap">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge}`}>{plan}</span>
                          {chain.map((step, i) => (
                            <span key={i} className={i === 0 ? `font-medium ${color}` : "text-muted-foreground"}>{step}</span>
                          ))}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground/60 pt-1">
                      {t("ud_pipeline_note_1")}<code className="font-mono bg-muted/30 px-1 rounded">usage_logs</code>{t("ud_pipeline_note_2")}<code className="font-mono bg-muted/30 px-1 rounded">:relay</code>{t("ud_pipeline_note_3")}
                    </p>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ═══════════════════════════ PROJECTS ═══════════════════════════════ */}
        {activeTab === "projects" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t("ud_all_projects")} ({allProjects?.length || 0})</h2>
            {projectsLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted/20 animate-pulse" />)}</div>
            ) : (
              <div className="rounded-xl border border-border/40 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 border-b border-border/40">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_project")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_status")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_framework")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_deployed")}</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_created")}</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">{t("ud_col_actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allProjects?.map((p) => (
                      <tr key={p.id} className="border-b border-border/20 hover:bg-muted/10">
                        <td className="px-4 py-3"><div className="font-medium text-foreground">{p.name}</div><div className="text-xs text-muted-foreground">ID #{p.id} · User #{p.userId}</div></td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === "ready" ? "bg-emerald-500/10 text-emerald-400" : p.status === "published" ? "bg-blue-500/10 text-blue-400" : p.status === "generating" ? "bg-amber-500/10 text-amber-400" : "bg-muted/30 text-muted-foreground"}`}>{p.status}</span></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground uppercase">{p.framework}</td>
                        <td className="px-4 py-3">{p.deployedUrl ? <a href={p.deployedUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline"><Globe className="w-3 h-3" /> {t("ud_view")}</a> : <span className="text-xs text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDistanceToNow(new Date(p.createdAt), { addSuffix: true, locale: dfLocale })}</td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-400"
                            onClick={() => { if (confirm(`${t("ud_confirm_del_proj_1")}${p.name}${t("ud_confirm_del_proj_2")}`)) deleteProject.mutate({ projectId: p.id }); }}>
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
