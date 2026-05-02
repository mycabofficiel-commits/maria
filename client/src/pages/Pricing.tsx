import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { CheckCircle2, Sparkles, ArrowRight, Zap } from "lucide-react";

const PLANS = [
  {
    name: "Free",
    slug: "free",
    price: 0,
    period: "/mois",
    desc: "Pour découvrir Maria et créer votre premier site.",
    badge: null,
    features: [
      "1 projet",
      "3 générations par mois",
      "Prévisualisation limitée",
      "Branding Maria",
      "Support communauté",
    ],
    cta: "Commencer gratuitement",
    highlight: false,
  },
  {
    name: "Creator",
    slug: "creator",
    price: 19,
    period: "/mois",
    desc: "Pour les créateurs et freelances qui veulent aller plus loin.",
    badge: "Populaire",
    features: [
      "5 projets",
      "30 générations par mois",
      "Chat d'édition illimité",
      "Domaine personnalisé",
      "Sans branding Maria",
      "Logs standards",
      "Support email",
    ],
    cta: "Choisir Creator",
    highlight: true,
  },
  {
    name: "Pro",
    slug: "pro",
    price: 49,
    period: "/mois",
    desc: "Pour les professionnels qui gèrent plusieurs projets.",
    badge: null,
    features: [
      "20 projets",
      "100 générations par mois",
      "Historique complet des versions",
      "Logs avancés",
      "Debug assisté par IA",
      "Collaboration basique",
      "Support prioritaire",
    ],
    cta: "Choisir Pro",
    highlight: false,
  },
  {
    name: "Agency",
    slug: "agency",
    price: 99,
    period: "/mois",
    desc: "Pour les agences et équipes qui livrent à grande échelle.",
    badge: null,
    features: [
      "Projets illimités",
      "Générations illimitées",
      "Multi-clients",
      "Collaboration équipe",
      "Marque blanche partielle",
      "Export code complet",
      "Analytics avancées",
      "Support dédié",
    ],
    cta: "Contacter les ventes",
    highlight: false,
  },
];

const FAQ_ITEMS = [
  {
    q: "Puis-je changer de plan à tout moment ?",
    a: "Oui, vous pouvez upgrader ou downgrader votre plan à tout moment. La facturation est au prorata.",
  },
  {
    q: "Qu'est-ce qu'une génération ?",
    a: "Une génération correspond à la création ou modification majeure d'un site via l'IA. Les modifications mineures par chat ne consomment pas de génération.",
  },
  {
    q: "Ma clé Anthropic est-elle nécessaire ?",
    a: "Oui, vous devez connecter votre propre clé API Anthropic. Cela vous garantit un contrôle total sur vos coûts et votre usage.",
  },
  {
    q: "Y a-t-il un engagement ?",
    a: "Non, tous les plans sont sans engagement. Vous pouvez annuler à tout moment depuis votre espace billing.",
  },
];

export default function Pricing() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <section className="pt-32 pb-16">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary bg-primary/5 px-4 py-1.5">
              <Zap className="w-3.5 h-3.5 mr-2" />
              Tarification simple
            </Badge>
            <h1 className="text-5xl font-display font-bold text-foreground mb-4">
              Un plan pour chaque besoin
            </h1>
            <p className="text-xl text-muted-foreground max-w-xl mx-auto">
              Commencez gratuitement, évoluez selon vos besoins. Connectez votre clé Anthropic et gardez le contrôle de vos coûts.
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
                    <span className="text-4xl font-display font-bold text-foreground">{plan.price === 0 ? "Gratuit" : `${plan.price}€`}</span>
                    {plan.price > 0 && <span className="text-muted-foreground mb-1">{plan.period}</span>}
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
            <h2 className="text-3xl font-display font-bold text-foreground text-center mb-10">Questions fréquentes</h2>
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
