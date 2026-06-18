import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import AppLayout from "@/components/AppLayout";
import {
  ArrowLeft, Users, Link2, Copy, Mail, Trash2, Clock, CheckCircle2,
  XCircle, Eye, Edit3, Loader2, Share2, UserPlus,
} from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export default function ShareProject() {
  const params = useParams<{ id: string }>();
  const projectId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [expiryPreset, setExpiryPreset] = useState<"1d" | "7d" | "30d" | "custom" | "never">("7d");
  const [customExpiry, setCustomExpiry] = useState(""); // datetime-local
  const [revokeTarget, setRevokeTarget] = useState<number | null>(null);

  const DAY = 86400000;
  // Expiration à envoyer : ISO string, null (jamais), ou undefined (défaut serveur 7j).
  const computeExpiresAt = (): string | null | undefined => {
    const now = Date.now();
    switch (expiryPreset) {
      case "never": return null;
      case "1d": return new Date(now + DAY).toISOString();
      case "7d": return new Date(now + 7 * DAY).toISOString();
      case "30d": return new Date(now + 30 * DAY).toISOString();
      case "custom": return customExpiry ? new Date(customExpiry).toISOString() : undefined;
    }
  };
  const nowLocalMin = (() => {
    const d = new Date(Date.now() + 5 * 60000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const customInvalid = expiryPreset === "custom" && (!customExpiry || new Date(customExpiry).getTime() <= Date.now());
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: project, isLoading: projectLoading } = trpc.projects.get.useQuery(
    { id: projectId }, { enabled: !!projectId }
  );

  const { data: collaborators, isLoading: collabLoading } = trpc.share.list.useQuery(
    { projectId }, { enabled: !!projectId }
  );

  const invite = trpc.share.invite.useMutation({
    onSuccess: (data) => {
      toast.success("Invitation créée !");
      utils.share.list.invalidate({ projectId });
      // Auto-copy link
      const link = `${window.location.origin}/invite/${data.inviteToken}`;
      navigator.clipboard.writeText(link).catch(() => {});
      setCopiedToken(data.inviteToken);
      setInviteEmail("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const revoke = trpc.share.revoke.useMutation({
    onSuccess: () => {
      toast.success("Accès révoqué");
      utils.share.list.invalidate({ projectId });
      setRevokeTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (authLoading || projectLoading) {
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

  const getInviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(getInviteLink(token));
    setCopiedToken(token);
    toast.success("Lien copié !");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-amber-400 border-amber-400/30 text-xs"><Clock className="w-3 h-3 mr-1" />En attente</Badge>;
      case "accepted":
        return <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />Accepté</Badge>;
      case "revoked":
        return <Badge variant="outline" className="text-muted-foreground border-border/40 text-xs"><XCircle className="w-3 h-3 mr-1" />Révoqué</Badge>;
      default:
        return null;
    }
  };

  const activeCollabs = collaborators?.filter(c => c.status !== "revoked") || [];
  const revokedCollabs = collaborators?.filter(c => c.status === "revoked") || [];

  return (
    <AppLayout title={`Partager — ${project?.name || "Projet"}`}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}`}>
            <Button variant="ghost" size="icon" className="w-8 h-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="font-display font-bold text-xl text-foreground flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary" />
              Partager le projet
            </h1>
            <p className="text-sm text-muted-foreground">{project?.name}</p>
          </div>
        </div>

        {/* Invite form */}
        <Card className="border-border/60 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" />
              Inviter un collaborateur
            </CardTitle>
            <CardDescription className="text-xs">
              Générez un lien d'invitation. L'invité devra se connecter pour accéder au projet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Email (optionnel)"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-input border-border/60 text-sm h-9"
                type="email"
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "viewer" | "editor")}>
                <SelectTrigger className="w-36 h-9 text-xs bg-input border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer" className="text-xs">
                    <div className="flex items-center gap-1.5"><Eye className="w-3 h-3" /> Lecteur</div>
                  </SelectItem>
                  <SelectItem value="editor" className="text-xs">
                    <div className="flex items-center gap-1.5"><Edit3 className="w-3 h-3" /> Éditeur</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Expiration de l'accès */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-primary" /> Durée d'accès
              </label>
              <Select value={expiryPreset} onValueChange={(v) => setExpiryPreset(v as typeof expiryPreset)}>
                <SelectTrigger className="h-9 text-xs bg-input border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d" className="text-xs">Expire dans 1 jour</SelectItem>
                  <SelectItem value="7d" className="text-xs">Expire dans 7 jours</SelectItem>
                  <SelectItem value="30d" className="text-xs">Expire dans 30 jours</SelectItem>
                  <SelectItem value="custom" className="text-xs">Date &amp; heure précises…</SelectItem>
                  <SelectItem value="never" className="text-xs">Sans expiration</SelectItem>
                </SelectContent>
              </Select>
              {expiryPreset === "custom" && (
                <input
                  type="datetime-local"
                  value={customExpiry}
                  min={nowLocalMin}
                  onChange={(e) => setCustomExpiry(e.target.value)}
                  className="w-full h-9 rounded-md border border-border/60 bg-input px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
              {customInvalid && (
                <p className="text-[11px] text-destructive">Choisis une date/heure dans le futur.</p>
              )}
            </div>
            <Button
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-9 text-sm"
              onClick={() => invite.mutate({ projectId, inviteEmail: inviteEmail || undefined, role: inviteRole, expiresAt: computeExpiresAt() })}
              disabled={invite.isPending || customInvalid}
            >
              {invite.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Génération…</>
              ) : (
                <><Link2 className="w-3.5 h-3.5 mr-2" />Générer le lien d'invitation</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              L'accès est révoqué automatiquement à l'expiration · <strong>Lecteur</strong> = consultation · <strong>Éditeur</strong> = peut modifier
            </p>
          </CardContent>
        </Card>

        {/* Active collaborators */}
        <Card className="border-border/60 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Collaborateurs actifs
              {activeCollabs.length > 0 && (
                <Badge variant="secondary" className="text-xs ml-auto">{activeCollabs.length}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {collabLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : activeCollabs.length === 0 ? (
              <div className="text-center py-6">
                <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                <p className="text-sm text-muted-foreground">Aucun collaborateur pour l'instant.</p>
                <p className="text-xs text-muted-foreground mt-1">Invitez des personnes pour collaborer sur ce projet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeCollabs.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Users className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {(c as any).collaboratorName || c.inviteEmail || "Invitation en attente"}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {statusBadge(c.status)}
                          <Badge variant="outline" className="text-[10px] border-border/40 text-muted-foreground">
                            {c.role === "editor" ? <><Edit3 className="w-2.5 h-2.5 mr-0.5" />Éditeur</> : <><Eye className="w-2.5 h-2.5 mr-0.5" />Lecteur</>}
                          </Badge>
                          {c.createdAt && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true, locale: fr })}
                            </span>
                          )}
                          {(c as any).expiresAt ? (
                            <span className={`text-[10px] ${new Date((c as any).expiresAt) < new Date() ? "text-destructive" : "text-amber-400/80"}`}>
                              {new Date((c as any).expiresAt) < new Date()
                                ? "· accès expiré"
                                : `· expire ${formatDistanceToNow(new Date((c as any).expiresAt), { addSuffix: true, locale: fr })}`}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/60">· sans expiration</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                      {c.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-foreground"
                          onClick={() => copyLink(c.inviteToken)}
                          title="Copier le lien"
                        >
                          {copiedToken === c.inviteToken ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setRevokeTarget(c.id)}
                        title="Révoquer l'accès"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revoked (collapsed) */}
        {revokedCollabs.length > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            {revokedCollabs.length} invitation(s) révoquée(s) masquée(s)
          </div>
        )}
      </div>

      {/* Revoke confirmation dialog */}
      <AlertDialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer l'accès ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette personne ne pourra plus accéder au projet. Le lien d'invitation sera désactivé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => revokeTarget && revoke.mutate({ collaboratorId: revokeTarget })}
            >
              Révoquer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
