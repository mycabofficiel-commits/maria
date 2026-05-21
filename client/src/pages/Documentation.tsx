import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Zap, Key, Globe, MessageSquare, History, Rocket, ChevronRight } from "lucide-react";

const sections = [
  {
    icon: Zap,
    title: "Démarrage rapide",
    badge: "5 min",
    content: [
      { step: "1", text: "Créez un compte gratuit et connectez-vous." },
      { step: "2", text: "Depuis le Dashboard, cliquez sur « Nouveau projet »." },
      { step: "3", text: "Décrivez votre site en quelques phrases, choisissez un style et une palette." },
      { step: "4", text: "Cliquez sur « Générer le site » — Mar-ia produit votre code en temps réel." },
      { step: "5", text: "Affinez avec le chat, puis publiez en un clic." },
    ],
  },
  {
    icon: Key,
    title: "Clé API Anthropic",
    badge: "Requis",
    content: [
      { step: "1", text: "Rendez-vous sur console.anthropic.com et créez une clé API." },
      { step: "2", text: "Dans Mar-ia, allez dans Paramètres > Clés API." },
      { step: "3", text: "Collez votre clé — elle est chiffrée AES-256 avant stockage." },
      { step: "4", text: "Choisissez le modèle : claude-sonnet-4-5 est recommandé." },
    ],
  },
  {
    icon: MessageSquare,
    title: "Chat avec Mar-ia",
    badge: "IA",
    content: [
      { step: "→", text: "Demandez des modifications en langage naturel : « Change le fond en noir », « Ajoute une section témoignages »." },
      { step: "→", text: "Mar-ia comprend le contexte du projet et de toute la conversation précédente." },
      { step: "→", text: "Chaque modification génère une nouvelle version sauvegardée automatiquement." },
    ],
  },
  {
    icon: History,
    title: "Versions",
    badge: "Historique",
    content: [
      { step: "→", text: "Chaque génération crée une version numérotée (v1, v2, v3…)." },
      { step: "→", text: "Cliquez sur « Versions » dans le chat pour voir l'historique." },
      { step: "→", text: "Cliquez sur « Restaurer » pour revenir à n'importe quelle version précédente." },
    ],
  },
  {
    icon: Globe,
    title: "Publication",
    badge: "Deploy",
    content: [
      { step: "→", text: "Cliquez sur « Publier » dans la barre du haut pour mettre votre site en ligne." },
      { step: "→", text: "Votre site reçoit une URL publique sous mariaai-*.manus.space." },
      { step: "→", text: "Utilisez le panneau Deploy dans le chat pour gérer votre déploiement." },
    ],
  },
];

export default function Documentation() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <main className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-4">
              <BookOpen className="w-4 h-4" />
              Documentation
            </div>
            <h1 className="text-4xl font-bold mb-4">Guide d'utilisation</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Tout ce dont vous avez besoin pour créer, modifier et publier votre site web avec Mar-ia.
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-10">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.title} className="rounded-2xl border border-border/60 bg-card p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold">{section.title}</h2>
                    <Badge variant="outline" className="text-xs ml-auto">{section.badge}</Badge>
                  </div>
                  <ol className="space-y-3">
                    {section.content.map((item, i) => (
                      <li key={i} className="flex gap-3 items-start">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                          {item.step}
                        </span>
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <div className="mt-14 text-center rounded-2xl border border-primary/20 bg-primary/5 p-8">
            <Rocket className="w-10 h-10 text-primary mx-auto mb-3" />
            <h3 className="text-xl font-semibold mb-2">Prêt à créer votre site ?</h3>
            <p className="text-muted-foreground text-sm mb-5">Commencez gratuitement, sans carte bancaire.</p>
            <Link href="/dashboard">
              <button className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
                Accéder au dashboard <ChevronRight className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
