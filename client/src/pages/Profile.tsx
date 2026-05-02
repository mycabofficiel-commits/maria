import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { User, Mail, Calendar, Zap, Loader2, Save } from "lucide-react";
import { Link } from "wouter";

const PLAN_COLORS: Record<string, string> = {
  free: "border-border/60 text-muted-foreground",
  creator: "border-primary/40 text-primary bg-primary/5",
  pro: "border-cyan-400/40 text-cyan-400 bg-cyan-400/5",
  agency: "border-amber-400/40 text-amber-400 bg-amber-400/5",
};

export default function Profile() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: profile } = trpc.user.getProfile.useQuery();
  const { data: stats } = trpc.user.getUsageStats.useQuery();
  const [name, setName] = useState("");

  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Profil mis à jour");
      utils.user.getProfile.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const displayName = profile?.name || user?.name || "Utilisateur";
  const plan = (profile as any)?.plan || "free";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <AppLayout title="Profil">
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-1">Mon profil</h2>
          <p className="text-muted-foreground">Gérez vos informations personnelles.</p>
        </div>

        {/* Avatar & plan */}
        <div className="flex items-center gap-5 p-5 rounded-xl border border-border/60 bg-card">
          <Avatar className="w-16 h-16">
            <AvatarFallback className="bg-primary/20 text-primary text-xl font-bold">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-lg font-display font-bold text-foreground">{displayName}</h3>
            <p className="text-sm text-muted-foreground">{profile?.email || user?.email || "—"}</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="outline" className={`capitalize text-xs ${PLAN_COLORS[plan]}`}>
                Plan {plan}
              </Badge>
              <Link href="/billing">
                <span className="text-xs text-primary hover:underline cursor-pointer">Changer de plan</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Edit name */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <h3 className="font-semibold text-foreground mb-4">Informations</h3>
          <div className="space-y-4">
            <div>
              <Label className="text-sm text-foreground mb-1.5 block">Nom affiché</Label>
              <Input
                placeholder={displayName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-input border-border/60"
              />
            </div>
            <div>
              <Label className="text-sm text-foreground mb-1.5 block">Email</Label>
              <Input
                value={profile?.email || user?.email || ""}
                disabled
                className="bg-muted border-border/60 text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground mt-1">L'email est géré par votre compte Manus.</p>
            </div>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => updateProfile.mutate({ name: name || displayName })}
              disabled={updateProfile.isPending || !name.trim()}
            >
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Sauvegarder
            </Button>
          </div>
        </div>

        {/* Usage */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Usage ce mois
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="text-muted-foreground">Générations</span>
                <span className="text-foreground font-medium">
                  {stats?.generationsUsed || 0} / {stats?.generationsLimit || 3}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((stats?.generationsUsed || 0) / (stats?.generationsLimit || 3)) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Projets</span>
              <span className="text-foreground font-medium">{stats?.projectsCount || 0}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tokens utilisés</span>
              <span className="text-foreground font-medium font-mono">
                {((stats?.tokensTotal || 0) / 1000).toFixed(1)}k
              </span>
            </div>
          </div>
        </div>

        {/* Account info */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <h3 className="font-semibold text-foreground mb-4">Compte</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4" />
              Membre depuis {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "—"}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="w-4 h-4" />
              Connecté via Manus OAuth
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
