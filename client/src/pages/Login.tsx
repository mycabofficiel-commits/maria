import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function Login() {
  useEffect(() => {
    window.location.href = getLoginUrl();
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
      <p className="text-sm text-muted-foreground">Redirection vers la connexion…</p>
    </div>
  );
}
