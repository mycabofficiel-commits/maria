import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";
import { useLang } from "@/i18n/LangContext";
import SEOHead from "@/components/SEOHead";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { t } = useLang();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
      <SEOHead title="404 — Mar-ia" description={t("notfound_sub")} path="/404" />
      <div className="w-full max-w-lg mx-4 text-center">
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/10 rounded-full animate-pulse" />
            <AlertCircle className="relative h-16 w-16 text-primary" />
          </div>
        </div>

        <h1 className="text-6xl font-display font-bold text-foreground mb-3">404</h1>

        <h2 className="text-2xl font-semibold text-foreground mb-4">
          {t("notfound_title")}
        </h2>

        <p className="text-muted-foreground mb-8 leading-relaxed">
          {t("notfound_sub")}
        </p>

        <Button
          onClick={() => setLocation("/")}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5"
        >
          <Home className="w-4 h-4 mr-2" />
          {t("notfound_btn")}
        </Button>
      </div>
    </div>
  );
}
