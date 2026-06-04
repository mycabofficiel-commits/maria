import { useState } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Key, Shield, CheckCircle2, Loader2,
  Eye, EyeOff, Trash2, Power, PowerOff, Plus,
  ExternalLink, Sparkles, Lock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// Provider display info (same order as pipeline)
const PROVIDERS: { id: "deepseek" | "qwen" | "anthropic" | "openai"; label: string; role: string; color: string; plans: string }[] = [
  { id: "deepseek",  label: "DeepSeek",       role: "Exécuteur final HTML",         color: "text-blue-400",    plans: "Tous les plans" },
  { id: "qwen",      label: "Qwen",            role: "Coordinator de contenu",       color: "text-orange-400",  plans: "Creator · Pro · Agency" },
  { id: "anthropic", label: "Claude",          role: "Architecte + Debug",           color: "text-violet-400",  plans: "Pro · Agency" },
  { id: "openai",    label: "GPT-4o",          role: "Stratège business",            color: "text-emerald-400", plans: "Agency uniquement" },
];

// ── Admin view ─────────────────────────────────────────────────────────────────
function AdminApiKeys() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: platformKeys, isLoading } = trpc.admin.getPlatformKeys.useQuery();

  const setPlatformKey    = trpc.admin.setPlatformKey.useMutation({ onSuccess: () => { toast.success("Clé enregistrée"); utils.admin.getPlatformKeys.invalidate(); setAddingFor(null); setNewKey(""); setNewLabel(""); }, onError: e => toast.error(e.message) });
  const togglePlatformKey = trpc.admin.togglePlatformKey.useMutation({ onSuccess: () => { toast.success("Statut mis à jour"); utils.admin.getPlatformKeys.invalidate(); }, onError: e => toast.error(e.message) });
  const deletePlatformKey = trpc.admin.deletePlatformKey.useMutation({ onSuccess: () => { toast.success("Clé supprimée"); utils.admin.getPlatformKeys.invalidate(); }, onError: e => toast.error(e.message) });

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newKey, setNewKey]       = useState("");
  const [newLabel, setNewLabel]   = useState("");
  const [showKey, setShowKey]     = useState(false);

  const activeCount = platformKeys?.filter(k => k.isActive).length || 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-foreground mb-1">Clés API LLM</h2>
        <p className="text-muted-foreground text-sm">Vous êtes administrateur — vous gérez les clés utilisées par toute la plateforme.</p>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5">
        <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-medium text-foreground mb-0.5">Chiffrement AES-256</div>
          <div className="text-muted-foreground">Les clés sont chiffrées avant stockage. Seuls les 4 derniers caractères sont visibles.</div>
        </div>
      </div>

      {/* Summary table */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted/20 animate-pulse" />)}</div>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
            <span className="font-semibold text-foreground flex items-center gap-2 text-sm">
              <Key className="w-4 h-4 text-amber-400" /> Récapitulatif
            </span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              activeCount === PROVIDERS.length ? "bg-emerald-500/10 text-emerald-400" :
              activeCount > 0               ? "bg-amber-500/10 text-amber-400" :
                                              "bg-rose-500/10 text-rose-400"
            }`}>
              {activeCount} / {PROVIDERS.length} actives
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/10 border-b border-border/30">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">LLM</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Plans concernés</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Statut</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Clé</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map((prov) => {
                const k = platformKeys?.find(p => p.provider === prov.id);
                const isAdding = addingFor === prov.id;
                return (
                  <>
                    <tr key={prov.id} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="px-4 py-3">
                        <div className={`font-semibold ${prov.color}`}>{prov.label}</div>
                        <div className="text-xs text-muted-foreground">{prov.role}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{prov.plans}</td>
                      <td className="px-4 py-3">
                        {k ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${k.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
                            <CheckCircle2 className="w-3 h-3" />
                            {k.isActive ? "Active" : "Désactivée"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400">
                            ✗ Manquante
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {k ? (
                          <div>
                            <div>{k.keyHint}</div>
                            {k.updatedAt && <div className="text-muted-foreground/50">{formatDistanceToNow(new Date(k.updatedAt), { addSuffix: true, locale: fr })}</div>}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {k && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-amber-400"
                                onClick={() => togglePlatformKey.mutate({ provider: prov.id, isActive: !k.isActive })}
                                title={k.isActive ? "Désactiver" : "Activer"}>
                                {k.isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-rose-400"
                                onClick={() => { if (confirm(`Supprimer la clé ${prov.label} ?`)) deletePlatformKey.mutate({ provider: prov.id }); }}
                                title="Supprimer">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant={k ? "outline" : "default"}
                            className={`h-7 px-2.5 text-xs gap-1 ${!k ? "bg-primary hover:bg-primary/90" : "border-border/50"}`}
                            onClick={() => { setAddingFor(isAdding ? null : prov.id); setNewKey(""); setNewLabel(""); }}>
                            <Plus className="w-3 h-3" />
                            {k ? "Modifier" : "Ajouter"}
                          </Button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline form */}
                    {isAdding && (
                      <tr key={`${prov.id}-form`} className="border-b border-border/20 bg-muted/5">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="grid sm:grid-cols-2 gap-3 mb-3">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground font-medium">Clé API {prov.label} *</label>
                              <div className="relative">
                                <Input
                                  type={showKey ? "text" : "password"}
                                  placeholder="Colle la clé ici…"
                                  value={newKey}
                                  onChange={e => setNewKey(e.target.value)}
                                  className="h-9 text-sm pr-9 bg-muted/20 border-border/50 font-mono"
                                  autoFocus
                                />
                                <button onClick={() => setShowKey(!showKey)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground font-medium">Label (optionnel)</label>
                              <Input placeholder="ex: Production, Test…" value={newLabel} onChange={e => setNewLabel(e.target.value)} className="h-9 text-sm bg-muted/20 border-border/50" />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setAddingFor(null); setNewKey(""); setNewLabel(""); }}>Annuler</Button>
                            <Button size="sm" className="h-8 text-xs bg-primary hover:bg-primary/90"
                              disabled={!newKey.trim() || setPlatformKey.isPending}
                              onClick={() => setPlatformKey.mutate({ provider: prov.id, rawKey: newKey.trim(), label: newLabel.trim() || undefined })}>
                              {setPlatformKey.isPending ? "Enregistrement…" : "Enregistrer"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div className="rounded-xl border border-border/40 bg-card/60 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">ℹ️ Logique de priorité</p>
        <p>1. Clé DB active (configurée ici) — priorité absolue</p>
        <p>2. Variable d'environnement (DEEPSEEK_API_KEY, etc.) — fallback</p>
        <p>3. Aucune → erreur "Service IA indisponible"</p>
        <p className="pt-1">Les utilisateurs <strong>n'ont plus besoin</strong> de configurer leur propre clé API.</p>
      </div>
    </div>
  );
}

// ── User view ──────────────────────────────────────────────────────────────────
function UserApiKeys() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-display font-bold text-foreground mb-1">Intelligence Artificielle</h2>
        <p className="text-muted-foreground text-sm">L'IA est entièrement gérée par la plateforme.</p>
      </div>

      {/* Platform managed banner */}
      <div className="flex items-start gap-4 p-5 rounded-xl border border-primary/20 bg-primary/5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="font-semibold text-foreground mb-1">Aucune clé API requise</div>
          <div className="text-sm text-muted-foreground">
            Mar-ia gère toutes les connexions IA pour vous. Vous n'avez pas besoin de créer ou configurer de clé API personnelle.
          </div>
        </div>
      </div>

      {/* Pipeline by plan */}
      <div className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/30">
          <span className="font-semibold text-foreground text-sm flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" /> IA utilisée selon votre plan
          </span>
        </div>
        <div className="divide-y divide-border/20">
          {[
            { plan: "Free",    color: "text-muted-foreground",  agents: "DeepSeek",                           badge: "bg-muted/30 text-muted-foreground" },
            { plan: "Creator", color: "text-violet-400",         agents: "Qwen → DeepSeek",                    badge: "bg-violet-500/10 text-violet-400" },
            { plan: "Pro",     color: "text-blue-400",           agents: "Claude → Qwen → DeepSeek",           badge: "bg-blue-500/10 text-blue-400" },
            { plan: "Agency",  color: "text-emerald-400",        agents: "GPT-4o → Claude → Qwen → DeepSeek", badge: "bg-emerald-500/10 text-emerald-400" },
          ].map(({ plan, color, agents, badge }) => (
            <div key={plan} className="flex items-center justify-between px-4 py-3">
              <span className={`text-sm font-semibold ${color}`}>{plan}</span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-mono ${badge}`}>{agents}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Pour changer de plan, rendez-vous sur la page{" "}
        <a href="/billing" className="text-primary hover:underline inline-flex items-center gap-0.5">
          Facturation <ExternalLink className="w-3 h-3" />
        </a>
      </p>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function ApiKeys() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = user?.role === "ultra" || user?.role === "admin";

  // Redirect non-admins who land here directly
  if (user && !isAdmin) {
    navigate("/dashboard");
    return null;
  }

  return (
    <AppLayout title="Clés API">
      <AdminApiKeys />
    </AppLayout>
  );
}
