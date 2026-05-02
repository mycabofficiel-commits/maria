import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { HelpCircle, ArrowRight } from "lucide-react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQ_SECTIONS = [
  {
    title: "Prise en main",
    items: [
      {
        q: "Comment connecter ma clé Anthropic ?",
        a: "Rendez-vous dans Paramètres > Clés API. Collez votre clé API Anthropic (commençant par sk-ant-). Elle sera chiffrée et stockée de manière sécurisée. Vous pouvez tester sa validité directement depuis l'interface.",
      },
      {
        q: "Comment fonctionne la génération de site ?",
        a: "Décrivez votre projet dans le champ prompt, choisissez le type de site (landing page, portfolio, restaurant…), le style visuel et la langue. L'IA génère ensuite un code HTML/CSS/JS complet, optimisé pour le SEO et le responsive.",
      },
      {
        q: "Quels types de sites puis-je créer ?",
        a: "Landing page, site vitrine, portfolio, site pour artisan, SaaS, restaurant, agence, e-commerce simple. Vous pouvez aussi décrire librement votre besoin dans le prompt.",
      },
    ],
  },
  {
    title: "Prévisualisation & édition",
    items: [
      {
        q: "Comment fonctionnent les previews ?",
        a: "Chaque version générée crée une preview privée automatique. Vous pouvez visualiser votre site en mode desktop, tablette et mobile. La preview se rafraîchit automatiquement après chaque génération ou modification.",
      },
      {
        q: "Puis-je modifier le code directement ?",
        a: "Oui, l'éditeur de fichiers intégré vous permet d'accéder à l'arborescence complète et de modifier manuellement HTML, CSS et JS. Vous pouvez aussi demander à l'IA de modifier un fichier ou une section spécifique.",
      },
      {
        q: "Comment modifier mon site par chat ?",
        a: "Après la génération initiale, utilisez le chat d'édition pour décrire vos modifications en langage naturel : 'Change la couleur du header en bleu marine', 'Ajoute une section témoignages', 'Améliore le SEO'. L'IA applique les changements et crée une nouvelle version.",
      },
    ],
  },
  {
    title: "Versioning & publication",
    items: [
      {
        q: "Puis-je revenir à une ancienne version ?",
        a: "Oui, chaque modification crée une nouvelle version numérotée (v1, v2, v3…). Vous pouvez consulter l'historique complet et restaurer n'importe quelle version précédente en un clic.",
      },
      {
        q: "Comment publier mon site ?",
        a: "Depuis le dashboard de votre projet, cliquez sur 'Publier'. Votre site sera accessible sur un sous-domaine maria.app gratuit. Sur les plans payants, vous pouvez connecter votre propre domaine.",
      },
      {
        q: "Puis-je utiliser mon propre domaine ?",
        a: "Oui, à partir du plan Creator. Rendez-vous dans les paramètres de votre projet, section 'Domaine personnalisé', et suivez les instructions pour configurer vos DNS.",
      },
    ],
  },
  {
    title: "Sécurité & facturation",
    items: [
      {
        q: "Mes clés API sont-elles sécurisées ?",
        a: "Absolument. Votre clé Anthropic est chiffrée avec AES-256 avant d'être stockée. Elle n'est jamais exposée côté client, tous les appels API sont effectués côté serveur. Vous pouvez supprimer votre clé à tout moment.",
      },
      {
        q: "Comment sont calculés les coûts ?",
        a: "Les coûts dépendent du modèle Claude utilisé et du nombre de tokens consommés. Maria affiche une estimation du coût pour chaque génération. Vous gardez un contrôle total sur votre budget via votre compte Anthropic.",
      },
      {
        q: "Comment annuler mon abonnement ?",
        a: "Vous pouvez annuler à tout moment depuis Paramètres > Billing > Gérer l'abonnement. L'accès aux fonctionnalités payantes reste actif jusqu'à la fin de la période en cours.",
      },
    ],
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-5 text-left hover:bg-card/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="font-medium text-foreground pr-4">{q}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-4">
          {a}
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <section className="pt-32 pb-24">
        <div className="container max-w-3xl">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-border/60 text-muted-foreground">
              <HelpCircle className="w-3.5 h-3.5 mr-2" />
              FAQ
            </Badge>
            <h1 className="text-5xl font-display font-bold text-foreground mb-4">
              Questions fréquentes
            </h1>
            <p className="text-xl text-muted-foreground">
              Tout ce que vous devez savoir sur Maria.
            </p>
          </div>

          <div className="space-y-10">
            {FAQ_SECTIONS.map((section) => (
              <div key={section.title}>
                <h2 className="text-lg font-display font-semibold text-foreground mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-primary rounded-full" />
                  {section.title}
                </h2>
                <div className="space-y-3">
                  {section.items.map((item) => (
                    <FaqItem key={item.q} q={item.q} a={item.a} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-16 text-center p-8 rounded-2xl border border-border/60 bg-card">
            <h3 className="font-display font-bold text-xl text-foreground mb-2">
              Vous n'avez pas trouvé votre réponse ?
            </h3>
            <p className="text-muted-foreground mb-6">Notre équipe est là pour vous aider.</p>
            <Link href="/">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Contacter le support
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
