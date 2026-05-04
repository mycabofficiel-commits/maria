import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function Login() {
  useEffect(() => {
    const oauthUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
    const appId = import.meta.env.VITE_APP_ID;
    if (oauthUrl && appId && oauthUrl !== 'undefined') {
      const redirectUri = window.location.origin + '/api/oauth/callback';
      const state = btoa(redirectUri);
      const url = new URL(oauthUrl + '/app-auth');
      url.searchParams.set('appId', appId);
      url.searchParams.set('redirectUri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('type', 'signIn');
      window.location.href = url.toString();
    } else {
      window.location.href = '/dashboard';
    }
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
      <p className="text-sm text-muted-foreground">Connexion en cours…</p>
    </div>
  );
}
