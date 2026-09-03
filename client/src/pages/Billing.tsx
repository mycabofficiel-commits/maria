import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Zap, Crown, Building2, Sparkles, Loader2, ArrowRight, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { PLAN_LIMITS } from "@shared/const";
import { useLang } from "@/i18n/LangContext";
import type { TranslationKey } from "@/i18n/translations";

const buildPlans = (t: (k: TranslationKey) => string) => [
  {
    slug: "free" as const,
    name: "Free",
    price: "0€",
    period: "/mois",
    desc: t("bill_free_desc"),
    icon: Sparkles,
    color: "text-muted-foreground",
    border: "border-border/60",
    bg: "",
    features: [
      t("bill_feat_1_project"),
      `${PLAN_LIMITS.free.dailyGenerations} ${t("bill_gen_per_day")}`,
      t("bill_feat_live_preview"),
      t("bill_feat_edit_chat"),
      t("bill_feat_export_html"),
    ],
  },
  {
    slug: "creator" as const,
    name: "Creator",
    price: "19€",
    period: "/mois",
    desc: t("bill_creator_desc"),
    icon: Zap,
    color: "text-primary",
    border: "border-primary/40",
    bg: "bg-primary/5",
    badge: t("bill_popular"),
    features: [
      `${PLAN_LIMITS.creator.projectsLimit} ${t("bill_projects_word")}`,
      `${PLAN_LIMITS.creator.dailyGenerations} ${t("bill_gen_per_day")}`,
      t("bill_feat_custom_domain"),
      t("bill_feat_unlimited_versioning"),
      t("bill_feat_advanced_seo"),
      t("bill_feat_priority_support"),
    ],
  },
  {
    slug: "pro" as const,
    name: "Pro",
    price: "49€",
    period: "/mois",
    desc: t("bill_pro_desc"),
    icon: Crown,
    color: "text-cyan-400",
    border: "border-cyan-400/40",
    bg: "bg-cyan-400/5",
    features: [
      `${PLAN_LIMITS.pro.projectsLimit} ${t("bill_projects_word")}`,
      `${PLAN_LIMITS.pro.dailyGenerations} ${t("bill_gen_per_day")}`,
      t("bill_feat_unlimited_domains"),
      t("bill_feat_advanced_code_editor"),
      t("bill_feat_analytics"),
      t("bill_feat_api_access"),
      t("bill_feat_dedicated_support"),
    ],
  },
  {
    slug: "agency" as const,
    name: "Agency",
    price: "99€",
    period: "/mois",
    desc: t("bill_agency_desc"),
    icon: Building2,
    color: "text-amber-400",
    border: "border-amber-400/40",
    bg: "bg-amber-400/5",
    features: [
      t("bill_feat_unlimited_projects"),
      t("bill_feat_unlimited_generations"),
      t("bill_feat_white_label"),
      t("bill_feat_multi_client"),
      t("bill_feat_full_api"),
      t("bill_feat_sla"),
      t("bill_feat_account_manager"),
    ],
  },
];

export default function Billing() {
  const [, navigate] = useLocation();
  const { t, lang } = useLang();
  const PLANS = buildPlans(t);
  const { data: stats } = trpc.user.getUsageStats.useQuery();
  const { data: sub } = trpc.billing.getSubscription.useQuery();
  const currentPlan = stats?.plan || "free";

  const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const createCheckout = trpc.billing.createCheckoutSession.useMutation({
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
      else toast.error(t("bill_toast_no_checkout"));
      setUpgradingPlan(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setUpgradingPlan(null);
    },
  });

  const createPortal = trpc.billing.createPortalSession.useMutation({
    onSuccess: ({ url }) => {
      if (url) window.location.href = url;
      setOpeningPortal(false);
    },
    onError: (err) => {
      toast.error(err.message);
      setOpeningPortal(false);
    },
  });

  // Show toast on return from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success")) {
      toast.success(`${t("bill_toast_activated")} ${params.get("plan") || ""}.`);
      navigate("/billing", { replace: true });
    }
    if (params.get("cancelled")) {
      toast.info(t("bill_toast_cancelled"));
      navigate("/billing", { replace: true });
    }
  }, []);

  const handleUpgrade = (planSlug: "creator" | "pro" | "agency") => {
    setUpgradingPlan(planSlug);
    createCheckout.mutate({ plan: planSlug });
  };

  const handleManage = () => {
    setOpeningPortal(true);
    createPortal.mutate();
  };

  const dailyUsed = stats?.dailyGenerationsUsed ?? 0;
  const dailyLimit = stats?.dailyGenerationsLimit ?? 3;
  const dailyPct = dailyLimit === -1 ? 0 : Math.min(100, (dailyUsed / dailyLimit) * 100);

  return (
    <AppLayout title={t("app_nav_billing")}>
      <div className="max-w-5xl space-y-8">
        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-1">{t("bill_heading")}</h2>
          <p className="text-muted-foreground">{t("bill_subtitle")}</p>
        </div>

        {/* Current plan summary */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">{t("bill_current_plan")}</div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-display font-bold text-foreground capitalize">{currentPlan}</span>
                <Badge variant="outline" className="text-xs capitalize border-primary/30 text-primary">
                  {sub?.subscriptionStatus === "active" ? t("bill_active") : currentPlan === "free" ? t("bill_free_status") : t("bill_active")}
                </Badge>
              </div>
              {sub?.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("bill_renewal")} {new Date(sub.currentPeriodEnd).toLocaleDateString(lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US")}
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Daily generations */}
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">{t("bill_gen_today")}</div>
                <div className="text-lg font-display font-bold text-foreground">
                  {dailyUsed}
                  <span className="text-sm text-muted-foreground font-normal">
                    {" "}/ {dailyLimit === -1 ? "∞" : dailyLimit}
                  </span>
                </div>
                {dailyLimit !== -1 && (
                  <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden w-24">
                    <div
                      className={`h-full rounded-full transition-all ${dailyPct >= 100 ? "bg-destructive" : dailyPct >= 75 ? "bg-amber-400" : "bg-primary"}`}
                      style={{ width: `${dailyPct}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Projects */}
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">{t("profile_projects")}</div>
                <div className="text-lg font-display font-bold text-foreground">
                  {stats?.projectsCount || 0}
                  <span className="text-sm text-muted-foreground font-normal">
                    {" "}/ {(stats?.projectsLimit ?? 1) >= 9999 ? "∞" : stats?.projectsLimit ?? 1}
                  </span>
                </div>
              </div>

              {/* Manage */}
              {currentPlan !== "free" && sub?.stripeCustomerId && (
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManage}
                    disabled={openingPortal}
                    className="text-xs"
                  >
                    {openingPortal ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                    {t("bill_manage")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrentPlan = currentPlan === plan.slug;
            const isUpgrading = upgradingPlan === plan.slug;
            const isFree = plan.slug === "free";
            return (
              <div
                key={plan.slug}
                className={`relative p-5 rounded-xl border ${plan.border} ${plan.bg} flex flex-col`}
              >
                {"badge" in plan && plan.badge && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground text-[10px] px-2 py-0.5">
                      {plan.badge}
                    </Badge>
                  </div>
                )}

                <div className={`w-9 h-9 rounded-lg bg-current/10 flex items-center justify-center mb-3 ${plan.color}`}>
                  <plan.icon className={`w-4.5 h-4.5 ${plan.color}`} />
                </div>

                <div className="mb-1">
                  <span className="text-2xl font-display font-bold text-foreground">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <div className="font-semibold text-foreground mb-0.5">{plan.name}</div>
                <div className="text-xs text-muted-foreground mb-4">{plan.desc}</div>

                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${plan.color}`} />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  className={`w-full text-sm ${
                    isCurrentPlan
                      ? "bg-muted text-muted-foreground cursor-default"
                      : "bg-primary hover:bg-primary/90 text-primary-foreground"
                  }`}
                  disabled={isCurrentPlan || isFree || isUpgrading}
                  onClick={() => !isCurrentPlan && !isFree && handleUpgrade(plan.slug as any)}
                >
                  {isUpgrading ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> {t("bill_redirecting")}</>
                  ) : isCurrentPlan ? (
                    t("bill_current_btn")
                  ) : isFree ? (
                    t("bill_current_btn")
                  ) : (
                    <><span>{t("bill_choose")} {plan.name}</span><ArrowRight className="ml-1.5 w-3.5 h-3.5" /></>
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        {/* FAQ billing */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <h3 className="font-display font-semibold text-foreground mb-4">{t("bill_faq")}</h3>
          <div className="space-y-4">
            {[
              { q: t("bill_faq_q1"), a: t("bill_faq_a1") },
              { q: t("bill_faq_q2"), a: t("bill_faq_a2") },
              { q: t("bill_faq_q3"), a: t("bill_faq_a3") },
              { q: t("bill_faq_q4"), a: t("bill_faq_a4") },
            ].map((item) => (
              <div key={item.q} className="border-b border-border/40 pb-4 last:border-0 last:pb-0">
                <div className="font-medium text-foreground text-sm mb-1">{item.q}</div>
                <div className="text-sm text-muted-foreground">{item.a}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
