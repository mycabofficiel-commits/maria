import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import LogoBrand from "@/components/LogoBrand";
import { getLoginUrl } from "@/const";
import { useLang } from "@/i18n/LangContext";

export default function Onboarding() {
  const { user, isAuthenticated, loading } = useAuth();
  const { t } = useLang();
  const [, navigate] = useLocation();
  const [step, setStep] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState("free");

  const PLAN_OPTIONS = [
    { slug: "free", name: "Free", price: t("onb_free_price"), desc: t("onb_free_desc") },
    { slug: "creator", name: "Creator", price: "19€/mois", desc: t("onb_creator_desc") },
    { slug: "pro", name: "Pro", price: "49€/mois", desc: t("onb_pro_desc") },
  ];

  const completeOnboarding = trpc.auth.completeOnboarding.useMutation({
    onSuccess: () => {
      toast.success(t("onb_welcome_toast"));
      navigate("/dashboard");
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (loading) {
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

  if ((user as any)?.onboardingDone) {
    navigate("/dashboard");
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <LogoBrand size="lg" showSlogan />
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                s < step ? "bg-primary text-primary-foreground" :
                s === step ? "bg-primary/20 text-primary border border-primary" :
                "bg-muted text-muted-foreground"
              }`}>
                {s < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : s}
              </div>
              {s < 2 && <div className={`flex-1 h-px ${s < step ? "bg-primary" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        <div className="glass rounded-2xl border border-border/60 p-8">
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-2">
                {t("onb_welcome")} {user?.name?.split(" ")[0] || t("onb_welcome_you")} !
              </h1>
              <p className="text-muted-foreground mb-6">
                {t("onb_choose_plan")}
              </p>

              <div className="space-y-3 mb-6">
                {PLAN_OPTIONS.map((plan) => (
                  <button
                    key={plan.slug}
                    onClick={() => setSelectedPlan(plan.slug)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${
                      selectedPlan === plan.slug
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border/60 bg-card text-muted-foreground hover:border-border"
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-semibold text-foreground">{plan.name}</div>
                      <div className="text-xs text-muted-foreground">{plan.desc}</div>
                    </div>
                    <div className="text-sm font-medium">{plan.price}</div>
                  </button>
                ))}
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={() => setStep(2)}
              >
                {t("onb_continue")}
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-2">
                {t("onb_ready")}
              </h1>
              <p className="text-muted-foreground mb-6">
                {t("onb_ready_desc")}
              </p>

              <div className="space-y-3 mb-6">
                {[
                  t("onb_step1"),
                  t("onb_step2"),
                  t("onb_step3"),
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/50">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {i + 1}
                    </div>
                    <span className="text-sm text-foreground">{item}</span>
                  </div>
                ))}
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={() => completeOnboarding.mutate({ plan: selectedPlan })}
                disabled={completeOnboarding.isPending}
              >
                {completeOnboarding.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                {t("onb_goto_dashboard")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
