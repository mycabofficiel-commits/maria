import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Zap, Crown, Building2, Sparkles, Loader2, ArrowRight } from "lucide-react";
import { Link } from "wouter";

const PLANS = [
  {
    slug: "free",
    name: "Free",
    price: "0€",
    period: "/mois",
    desc: "Pour découvrir Mar-ia",
    icon: Sparkles,
    color: "text-muted-foreground",
    border: "border-border/60",
    bg: "",
    features: [
      "1 projet",
      "3 générations / mois",
      "Prévisualisation live",
      "Chat d'édition",
      "Export HTML",
    ],
    cta: "Plan actuel",
    ctaDisabled: true,
  },
  {
    slug: "creator",
    name: "Creator",
    price: "19€",
    period: "/mois",
    desc: "Pour les créateurs indépendants",
    icon: Zap,
    color: "text-primary",
    border: "border-primary/40",
    bg: "bg-primary/5",
    badge: "Populaire",
    features: [
      "5 projets",
      "30 générations / mois",
      "Domaine personnalisé",
      "Versioning illimité",
      "SEO avancé",
      "Support prioritaire",
    ],
    cta: "Choisir Creator",
    ctaDisabled: false,
  },
  {
    slug: "pro",
    name: "Pro",
    price: "49€",
    period: "/mois",
    desc: "Pour les professionnels",
    icon: Crown,
    color: "text-cyan-400",
    border: "border-cyan-400/40",
    bg: "bg-cyan-400/5",
    features: [
      "20 projets",
      "100 générations / mois",
      "Domaines illimités",
      "Éditeur de code avancé",
      "Analytics intégrés",
      "API access",
      "Support dédié",
    ],
    cta: "Choisir Pro",
    ctaDisabled: false,
  },
  {
    slug: "agency",
    name: "Agency",
    price: "149€",
    period: "/mois",
    desc: "Pour les agences",
    icon: Building2,
    color: "text-amber-400",
    border: "border-amber-400/40",
    bg: "bg-amber-400/5",
    features: [
      "Projets illimités",
      "Générations illimitées",
      "White label",
      "Gestion multi-clients",
      "API access complet",
      "SLA garanti",
      "Account manager dédié",
    ],
    cta: "Choisir Agency",
    ctaDisabled: false,
  },
];

export default function Billing() {
  const { user } = useAuth();
  const { data: stats } = trpc.user.getUsageStats.useQuery();
  const currentPlan = stats?.plan || "free";

  const handleUpgrade = (planSlug: string) => {
    toast.info("L'intégration Stripe sera disponible prochainement. Contactez-nous pour un accès anticipé.", {
      duration: 5000,
    });
  };

  return (
    <AppLayout title="Billing">
      <div className="max-w-5xl space-y-8">
        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-1">Billing & Plans</h2>
          <p className="text-muted-foreground">Gérez votre abonnement et choisissez le plan adapté à vos besoins.</p>
        </div>

        {/* Current plan summary */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Plan actuel</div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-display font-bold text-foreground capitalize">{currentPlan}</span>
                <Badge variant="outline" className="text-xs capitalize border-primary/30 text-primary">
                  Actif
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Générations</div>
                <div className="text-lg font-display font-bold text-foreground">
                  {stats?.generationsUsed || 0}
                  <span className="text-sm text-muted-foreground font-normal"> / {stats?.generationsLimit || 3}</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden w-24">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min(100, ((stats?.generationsUsed || 0) / (stats?.generationsLimit || 3)) * 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Projets</div>
                <div className="text-lg font-display font-bold text-foreground">
                  {stats?.projectsCount || 0}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrentPlan = currentPlan === plan.slug;
            return (
              <div
                key={plan.slug}
                className={`relative p-5 rounded-xl border ${plan.border} ${plan.bg} flex flex-col`}
              >
                {plan.badge && (
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
                      : `bg-primary hover:bg-primary/90 text-primary-foreground`
                  }`}
                  disabled={isCurrentPlan || plan.ctaDisabled}
                  onClick={() => !isCurrentPlan && handleUpgrade(plan.slug)}
                >
                  {isCurrentPlan ? "Plan actuel" : plan.cta}
                  {!isCurrentPlan && <ArrowRight className="ml-1.5 w-3.5 h-3.5" />}
                </Button>
              </div>
            );
          })}
        </div>

        {/* FAQ billing */}
        <div className="p-5 rounded-xl border border-border/60 bg-card">
          <h3 className="font-display font-semibold text-foreground mb-4">Questions fréquentes</h3>
          <div className="space-y-4">
            {[
              {
                q: "Comment fonctionne la facturation ?",
                a: "Les abonnements sont facturés mensuellement via Stripe. Vous pouvez annuler à tout moment depuis cette page.",
              },
              {
                q: "Puis-je changer de plan à tout moment ?",
                a: "Oui, vous pouvez passer à un plan supérieur ou inférieur à tout moment. Le changement est effectif immédiatement.",
              },
              {
                q: "Les coûts API Anthropic sont-ils inclus ?",
                a: "Non, les coûts Anthropic sont séparés et débités directement sur votre compte Anthropic. Mar-ia ne prend aucune marge sur ces coûts.",
              },
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
