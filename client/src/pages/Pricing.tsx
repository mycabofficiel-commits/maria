import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { CheckCircle2, Sparkles, ArrowRight, Zap } from "lucide-react";
import { useLang } from "@/i18n/LangContext";

export default function Pricing() {
  const { isAuthenticated } = useAuth();
  const { t } = useLang();

  const PLANS = [
    {
      name: "Free",
      slug: "free",
      price: 0,
      desc: t("plan_free_desc"),
      badge: null,
      features: [
        t("plan_free_f1"), t("plan_free_f2"), t("plan_free_f3"),
        t("plan_free_f4"), t("plan_free_f5"),
      ],
      cta: t("plan_free_cta"),
      highlight: false,
    },
    {
      name: "Creator",
      slug: "creator",
      price: 19,
      desc: t("plan_creator_desc"),
      badge: t("pricing_popular"),
      features: [
        t("plan_creator_f1"), t("plan_creator_f2"), t("plan_creator_f3"),
        t("plan_creator_f4"), t("plan_creator_f5"), t("plan_creator_f6"),
        t("plan_creator_f7"),
      ],
      cta: t("plan_creator_cta"),
      highlight: true,
    },
    {
      name: "Pro",
      slug: "pro",
      price: 49,
      desc: t("plan_pro_desc"),
      badge: null,
      features: [
        t("plan_pro_f1"), t("plan_pro_f2"), t("plan_pro_f3"),
        t("plan_pro_f4"), t("plan_pro_f5"), t("plan_pro_f6"),
        t("plan_pro_f7"),
      ],
      cta: t("plan_pro_cta"),
      highlight: false,
    },
    {
      name: "Agency",
      slug: "agency",
      price: 99,
      desc: t("plan_agency_desc"),
      badge: null,
      features: [
        t("plan_agency_f1"), t("plan_agency_f2"), t("plan_agency_f3"),
        t("plan_agency_f4"), t("plan_agency_f5"), t("plan_agency_f6"),
        t("plan_agency_f7"), t("plan_agency_f8"),
      ],
      cta: t("plan_agency_cta"),
      highlight: false,
    },
  ];

  const FAQ_ITEMS = [
    { q: t("pricing_faq_q1"), a: t("pricing_faq_a1") },
    { q: t("pricing_faq_q2"), a: t("pricing_faq_a2") },
    { q: t("pricing_faq_q3"), a: t("pricing_faq_a3") },
    { q: t("pricing_faq_q4"), a: t("pricing_faq_a4") },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <section className="pt-32 pb-16">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary bg-primary/5 px-4 py-1.5">
              <Zap className="w-3.5 h-3.5 mr-2" />
              {t("pricing_badge")}
            </Badge>
            <h1 className="text-5xl font-display font-bold text-foreground mb-4">
              {t("pricing_title")}
            </h1>
            <p className="text-xl text-muted-foreground max-w-xl mx-auto">
              {t("pricing_sub")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.slug}
                className={`relative rounded-2xl border p-6 flex flex-col card-hover ${
                  plan.highlight
                    ? "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
                    : "border-border/60 bg-card"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground px-3 py-0.5 text-xs font-semibold">
                      {plan.badge}
                    </Badge>
                  </div>
                )}

                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    {plan.highlight && <Sparkles className="w-4 h-4 text-primary" />}
                    <h3 className="font-display font-bold text-lg text-foreground">{plan.name}</h3>
                  </div>
                  <div className="flex items-end gap-1 mb-2">
                    <span className="text-4xl font-display font-bold text-foreground">
                      {plan.price === 0 ? t("pricing_free_label") : `${plan.price}€`}
                    </span>
                    {plan.price > 0 && <span className="text-muted-foreground mb-1">{t("pricing_period")}</span>}
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.desc}</p>
                </div>

                <ul className="flex-1 space-y-2.5 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${plan.highlight ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-foreground/80">{f}</span>
                    </li>
                  ))}
                </ul>

                {isAuthenticated ? (
                  <Link href="/billing">
                    <Button
                      className={`w-full ${plan.highlight ? "bg-primary hover:bg-primary/90 text-primary-foreground glow-brand" : "bg-secondary hover:bg-secondary/80 text-secondary-foreground"}`}
                    >
                      {plan.cta}
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </Link>
                ) : (
                  <a href={getLoginUrl()}>
                    <Button
                      className={`w-full ${plan.highlight ? "bg-primary hover:bg-primary/90 text-primary-foreground glow-brand" : "bg-secondary hover:bg-secondary/80 text-secondary-foreground"}`}
                    >
                      {plan.cta}
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* FAQ */}
          <div className="mt-24 max-w-2xl mx-auto">
            <h2 className="text-3xl font-display font-bold text-foreground text-center mb-10">
              {t("pricing_faq_title")}
            </h2>
            <div className="space-y-4">
              {FAQ_ITEMS.map((item) => (
                <div key={item.q} className="rounded-xl border border-border/60 bg-card p-5">
                  <h4 className="font-semibold text-foreground mb-2">{item.q}</h4>
                  <p className="text-sm text-muted-foreground">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
