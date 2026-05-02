import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { HelpCircle, MessageSquare, BookOpen, Mail, ChevronRight, Zap } from "lucide-react";

const faqs = [
  {
    q: "Quelle clé API dois-je utiliser ?",
    a: "Maria utilise l'API Anthropic (Claude). Créez une clé sur console.anthropic.com, puis collez-la dans Paramètres > Clés API. Le modèle recommandé est claude-sonnet-4-5.",
  },
  {
    q: "Combien coûte une génération ?",
    a: "Maria est BYOK (Bring Your Own Key) : vous payez directement Anthropic. Une génération typique coûte entre 0,02 € et 0,10 € selon la longueur du site. Aucune marge n'est prélevée par Maria.",
  },
  {
    q: "Mon site est-il publié automatiquement ?",
    a: "Non. La génération crée un aperçu local. Cliquez sur « Publier » dans la barre du haut pour mettre votre site en ligne sur une URL publique.",
  },
  {
    q: "Puis-je modifier le code manuellement ?",
    a: "Oui. L'éditeur de code (HTML/CSS/JS) est entièrement éditable. Utilisez Ctrl+S pour sauvegarder vos modifications.",
  },
  {
    q: "Comment revenir à une version précédente ?",
    a: "Dans le chat, cliquez sur « Versions » pour voir l'historique. Cliquez sur « Restaurer » à côté de la version souhaitée.",
  },
  {
    q: "Quels navigateurs sont supportés ?",
    a: "Maria fonctionne sur Chrome, Firefox, Edge et Safari (mode normal). Les modes navigation privée avec restrictions de cookies ne sont pas supportés.",
  },
  {
    q: "Mon site est-il responsive ?",
    a: "Oui. Maria génère du code mobile-first par défaut. Utilisez les boutons Desktop/Tablet/Mobile dans la barre de prévisualisation pour vérifier le rendu.",
  },
  {
    q: "Puis-je exporter mon site ?",
    a: "Oui. Dans le panneau Deploy (bouton dans le chat), vous pouvez télécharger le code en ZIP ou copier le HTML complet.",
  },
];

export default function Support() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <main className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-4">
              <HelpCircle className="w-4 h-4" />
              Support
            </div>
            <h1 className="text-4xl font-bold mb-4">Centre d'aide</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Trouvez rapidement des réponses à vos questions ou contactez-nous directement.
            </p>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
            {[
              { icon: BookOpen, label: "Documentation", href: "/documentation", desc: "Guides complets" },
              { icon: MessageSquare, label: "Chat avec Maria", href: "/dashboard", desc: "Créer un projet" },
              { icon: Zap, label: "Démarrage rapide", href: "/documentation", desc: "En 5 minutes" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.label} href={item.href}>
                  <div className="rounded-xl border border-border/60 bg-card p-4 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group">
                    <Icon className="w-6 h-6 text-primary mb-2" />
                    <p className="font-medium text-sm group-hover:text-primary transition-colors">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* FAQ */}
          <h2 className="text-2xl font-semibold mb-6">Questions fréquentes</h2>
          <div className="space-y-4 mb-14">
            {faqs.map((faq, i) => (
              <details key={i} className="group rounded-xl border border-border/60 bg-card">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none">
                  <span className="font-medium text-sm pr-4">{faq.q}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 group-open:rotate-90 transition-transform" />
                </summary>
                <div className="px-4 pb-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              </details>
            ))}
          </div>

          {/* Contact */}
          <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
            <Mail className="w-10 h-10 text-primary mx-auto mb-3" />
            <h3 className="text-xl font-semibold mb-2">Vous n'avez pas trouvé votre réponse ?</h3>
            <p className="text-muted-foreground text-sm mb-5">
              Contactez-nous par email — nous répondons sous 24h.
            </p>
            <a
              href="mailto:support@mariaai.app"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
            >
              <Mail className="w-4 h-4" />
              support@mariaai.app
            </a>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
