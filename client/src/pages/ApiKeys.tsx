import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Key, Shield, CheckCircle2, XCircle, AlertTriangle, Loader2,
  Eye, EyeOff, Trash2, TestTube, Info
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  valid: { label: "Valide", color: "text-emerald-400", icon: CheckCircle2, bg: "bg-emerald-400/10" },
  invalid: { label: "Invalide", color: "text-destructive", icon: XCircle, bg: "bg-destructive/10" },
  expired: { label: "Expirée", color: "text-amber-400", icon: AlertTriangle, bg: "bg-amber-400/10" },
  quota_exceeded: { label: "Quota dépassé", color: "text-amber-400", icon: AlertTriangle, bg: "bg-amber-400/10" },
  untested: { label: "Non testée", color: "text-muted-foreground", icon: Key, bg: "bg-muted" },
};

const MODELS = [
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", desc: "Recommandé — Meilleur équilibre qualité/coût" },
  { value: "claude-opus-4-5", label: "Claude Opus 4.5", desc: "Meilleure qualité, plus coûteux" },
  { value: "claude-haiku-3-5", label: "Claude Haiku 3.5", desc: "Rapide et économique" },
];

export default function ApiKeys() {
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-5");

  const utils = trpc.useUtils();
  const { data: apiKey, isLoading } = trpc.user.getApiKey.useQuery();

  const saveKey = trpc.user.saveApiKey.useMutation({
    onSuccess: () => {
      toast.success("Clé API sauvegardée avec succès");
      setNewKey("");
      utils.user.getApiKey.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteKey = trpc.user.deleteApiKey.useMutation({
    onSuccess: () => {
      toast.success("Clé API supprimée");
      utils.user.getApiKey.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const testKey = trpc.user.testApiKey.useMutation({
    onSuccess: (data) => {
      if (data.valid) {
        toast.success("✅ Clé API valide et fonctionnelle !");
      } else {
        const msg = data.errorMessage || data.status;
        toast.error(`❌ ${msg}`, { duration: 6000 });
      }
      utils.user.getApiKey.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSave = () => {
    if (!newKey.trim()) return toast.error("Entrez une clé API");
    if (!newKey.startsWith("sk-ant-")) {
      return toast.error("La clé doit commencer par sk-ant-");
    }
    saveKey.mutate({ key: newKey.trim(), model: selectedModel });
  };

  return (
    <AppLayout title="Clés API">
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-1">Clés API</h2>
          <p className="text-muted-foreground">Connectez votre clé API Anthropic pour générer des sites web.</p>
        </div>

        {/* Security notice */}
        <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5">
          <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-foreground mb-1">Sécurité maximale</div>
            <div className="text-muted-foreground">
              Votre clé est chiffrée avec AES-256 avant stockage. Elle n'est jamais exposée côté client et tous les appels API sont effectués côté serveur.
            </div>
          </div>
        </div>

        {/* Current key */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : apiKey ? (
          <div className="p-5 rounded-xl border border-border/60 bg-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Clé API Anthropic</h3>
              {(() => {
                const conf = STATUS_CONFIG[apiKey.status] || STATUS_CONFIG.untested;
                return (
                  <Badge variant="outline" className={`${conf.color} border-current/20 ${conf.bg}`}>
                    <conf.icon className="w-3 h-3 mr-1.5" />
                    {conf.label}
                  </Badge>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 font-mono text-sm text-muted-foreground mb-4">
              <Key className="w-4 h-4" />
              sk-ant-…{apiKey.keyHint}
            </div>
            <div className="text-xs text-muted-foreground mb-4">
              Modèle : <span className="text-foreground">{MODELS.find(m => m.value === apiKey.model)?.label || apiKey.model}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testKey.mutate()}
                disabled={testKey.isPending}
                className="border-border/60"
              >
                {testKey.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <TestTube className="w-3.5 h-3.5 mr-1.5" />}
                Tester
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteKey.mutate()}
                disabled={deleteKey.isPending}
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                {deleteKey.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                Supprimer
              </Button>
            </div>
          </div>
        ) : null}

        {/* Add / Update key */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <h3 className="font-semibold text-foreground mb-4">
            {apiKey ? "Mettre à jour la clé" : "Ajouter une clé API"}
          </h3>

          <div className="space-y-4">
            <div>
              <Label className="text-sm text-foreground mb-1.5 block">Clé API Anthropic</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder="sk-ant-api03-..."
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="pr-10 font-mono bg-input border-border/60"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                <Info className="w-3 h-3" />
                Obtenez votre clé sur{" "}
                <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  console.anthropic.com
                </a>
              </p>
            </div>

            <div>
              <Label className="text-sm text-foreground mb-1.5 block">Modèle Claude</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="bg-input border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <div>
                        <div className="font-medium">{m.label}</div>
                        <div className="text-xs text-muted-foreground">{m.desc}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleSave}
              disabled={saveKey.isPending || !newKey.trim()}
            >
              {saveKey.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Key className="w-4 h-4 mr-2" />
              )}
              {apiKey ? "Mettre à jour" : "Sauvegarder la clé"}
            </Button>
          </div>
        </div>

        {/* Cost info */}
        <div className="p-4 rounded-xl border border-border/60 bg-card">
          <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            Estimation des coûts
          </h4>
          <div className="space-y-2 text-sm">
            {[
              { model: "Claude Sonnet 4.5", cost: "~0.003$ / génération" },
              { model: "Claude Opus 4.5", cost: "~0.015$ / génération" },
              { model: "Claude Haiku 3.5", cost: "~0.0008$ / génération" },
            ].map((item) => (
              <div key={item.model} className="flex items-center justify-between">
                <span className="text-muted-foreground">{item.model}</span>
                <span className="text-foreground font-mono">{item.cost}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Les coûts sont débités directement sur votre compte Anthropic. Maria n'ajoute aucune marge.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
