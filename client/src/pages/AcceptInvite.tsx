import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Loader2, CheckCircle2, XCircle, Users, Eye, Edit3 } from "lucide-react";
import LogoBrand from "@/components/LogoBrand";
import { Link } from "wouter";

export default function AcceptInvite() {
  const params = useParams<{ token: string }>();
  const token = params.token || "";
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [acceptedProjectId, setAcceptedProjectId] = useState<number | null>(null);

  const { data: preview, isLoading: previewLoading, error: previewError } = trpc.share.previewInvite.useQuery(
    { token }, { enabled: !!token }
  );

  const accept = trpc.share.accept.useMutation({
    onSuccess: (data) => {
      setAccepted(true);
      setAcceptedProjectId(data.projectId);
    },
    onError: () => {},
  });

  if (authLoading || previewLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  const isExpired = preview?.expiresAt && new Date(preview.expiresAt) < new Date();
  const isInvalid = !!previewError || preview?.status === "revoked";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center mb-2">
            <LogoBrand size="md" />
          </div>
        </div>

        {/* Invalid / expired */}
        {(isInvalid || isExpired) && (
          <Card className="border-destructive/30 bg-card">
            <CardContent className="pt-6 text-center space-y-3">
              <XCircle className="w-12 h-12 text-destructive mx-auto" />
              <h2 className="font-display font-semibold text-lg text-foreground">
                {isExpired ? "Invitation expirée" : "Invitation invalide"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isExpired
                  ? "Ce lien d'invitation a expiré. Demandez un nouveau lien au propriétaire du projet."
                  : "Ce lien d'invitation est invalide ou a été révoqué."}
              </p>
              <Link href="/">
                <Button variant="outline" className="mt-2">Retour à l'accueil</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Already accepted */}
        {accepted && acceptedProjectId && (
          <Card className="border-emerald-500/30 bg-card">
            <CardContent className="pt-6 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
              <h2 className="font-display font-semibold text-lg text-foreground">Invitation acceptée !</h2>
              <p className="text-sm text-muted-foreground">
                Vous avez maintenant accès au projet <strong>{preview?.projectName}</strong>.
              </p>
              <Link href={`/projects/${acceptedProjectId}`}>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground mt-2">
                  Ouvrir le projet
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Preview & accept */}
        {!isInvalid && !isExpired && !accepted && preview && (
          <Card className="border-border/60 bg-card">
            <CardHeader className="text-center pb-2">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-lg">Invitation à collaborer</CardTitle>
              <CardDescription className="text-sm">
                <strong>{preview.ownerName}</strong> vous invite à rejoindre le projet
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Project info */}
              <div className="p-3 rounded-lg border border-border/50 bg-background/50 text-center">
                <p className="font-semibold text-foreground">{preview.projectName}</p>
                <div className="flex items-center justify-center gap-1.5 mt-1.5">
                  {preview.role === "editor" ? (
                    <><Edit3 className="w-3.5 h-3.5 text-primary" /><span className="text-xs text-muted-foreground">Accès éditeur — vous pouvez modifier le site</span></>
                  ) : (
                    <><Eye className="w-3.5 h-3.5 text-primary" /><span className="text-xs text-muted-foreground">Accès lecteur — consultation uniquement</span></>
                  )}
                </div>
              </div>

              {/* Expiry */}
              {preview.expiresAt && (
                <p className="text-xs text-muted-foreground text-center">
                  Lien valide jusqu'au {new Date(preview.expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}

              {/* Auth required */}
              {!isAuthenticated ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground text-center">
                    Connectez-vous pour accepter l'invitation
                  </p>
                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => {
                      const returnPath = `/invite/${token}`;
                      const loginBase = getLoginUrl();
                      // Connexion locale → /login?next=<retour>. Connexion OAuth → URL OAuth telle quelle.
                      window.location.href = loginBase.startsWith("/login")
                        ? `/login?next=${encodeURIComponent(returnPath)}`
                        : loginBase;
                    }}
                  >
                    Se connecter pour accepter
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={() => accept.mutate({ token })}
                  disabled={accept.isPending}
                >
                  {accept.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Acceptation…</>
                  ) : (
                    <>Accepter l'invitation</>
                  )}
                </Button>
              )}

              {accept.error && (
                <p className="text-xs text-destructive text-center">{(accept.error as any).message}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
