import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Sparkles, Zap, Eye, MessageSquare, Code2, Globe, Shield, ArrowRight,
  Star, CheckCircle2, Layers, Cpu, Palette, Rocket
} from "lucide-react";

const FEATURES = [
  {
    icon: Cpu,
    title: "Génération IA instantanée",
    desc: "Décrivez votre site en quelques mots. L'IA génère un code HTML/CSS/JS propre, optimisé SEO et responsive en quelques secondes.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: MessageSquare,
    title: "Chat d'édition continu",
    desc: "Modifiez votre site par conversation naturelle. Changez les couleurs, ajoutez des sections, corrigez le responsive — sans toucher au code.",
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
  },
  {
    icon: Eye,
    title: "Prévisualisation live",
    desc: "Voyez votre site en temps réel sur desktop, tablette et mobile. Chaque modification est instantanément visible.",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  {
    icon: Layers,
    title: "Versioning complet",
    desc: "Chaque génération crée une nouvelle version. Revenez à n'importe quel état précédent en un clic.",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  {
    icon: Code2,
    title: "Éditeur de code intégré",
    desc: "Accédez directement au code généré. Modifiez manuellement HTML, CSS et JS avec une arborescence claire.",
    color: "text-rose-400",
    bg: "bg-rose-400/10",
  },
  {
    icon: Globe,
    title: "Publication & domaine",
    desc: "Publiez en un clic avec un sous-domaine gratuit ou connectez votre propre domaine personnalisé.",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Connectez votre clé Anthropic",
    desc: "Ajoutez votre clé API Anthropic personnelle. Elle est chiffrée et n'est jamais exposée côté client.",
  },
  {
    num: "02",
    title: "Décrivez votre site",
    desc: "Choisissez le type de site, le style, la langue et décrivez votre projet en quelques phrases.",
  },
  {
    num: "03",
    title: "Générez, modifiez, publiez",
    desc: "L'IA génère votre site. Affinez par chat, prévisualisez en live, puis publiez en un clic.",
  },
];

const TESTIMONIALS = [
  {
    name: "Sophie Martin",
    role: "Freelance designer",
    avatar: "SM",
    text: "J'ai créé le site de mon portfolio en 10 minutes. Le résultat est bluffant — je n'aurais pas fait mieux moi-même.",
    rating: 5,
  },
  {
    name: "Thomas Dupont",
    role: "Fondateur SaaS",
    avatar: "TD",
    text: "Maria m'a permis de lancer ma landing page en une heure. Le chat d'édition est incroyablement intuitif.",
    rating: 5,
  },
  {
    name: "Camille Rousseau",
    role: "Agence digitale",
    avatar: "CR",
    text: "On livre maintenant 3x plus de sites par mois. La qualité du code généré est vraiment professionnelle.",
    rating: 5,
  },
];

export default function Home() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      {/* ─── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-24 overflow-hidden">
        {/* Background grid */}
        <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" />
        {/* Glow orbs */}
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-1/4 w-64 h-64 bg-cyan-400/8 rounded-full blur-3xl pointer-events-none" />

        <div className="container relative">
          <div className="max-w-4xl mx-auto text-center">
            <Badge
              variant="outline"
              className="mb-6 border-primary/30 text-primary bg-primary/5 px-4 py-1.5 text-sm font-medium"
            >
              <Sparkles className="w-3.5 h-3.5 mr-2" />
              Propulsé par Claude d'Anthropic
            </Badge>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-display font-bold text-foreground mb-6 leading-tight">
              Créez votre site web{" "}
              <span className="gradient-text">par l'IA</span>
              <br />en quelques minutes
            </h1>

            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
              Décrivez votre projet, choisissez votre style, et laissez l'IA générer un site web professionnel. Modifiez par conversation, prévisualisez en live, publiez en un clic.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {isAuthenticated ? (
                <Link href="/dashboard">
                  <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 h-12 text-base glow-brand">
                    Accéder au dashboard
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
              ) : (
                <a href={getLoginUrl()}>
                  <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 h-12 text-base glow-brand">
                    Commencer gratuitement
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </a>
              )}
              <Link href="/pricing">
                <Button variant="outline" size="lg" className="px-8 h-12 text-base border-border/60 hover:border-border text-foreground">
                  Voir les tarifs
                </Button>
              </Link>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              Gratuit pour commencer · Aucune carte bancaire requise
            </p>
          </div>

          {/* Hero visual */}
          <div className="mt-16 max-w-5xl mx-auto">
            <div className="glass rounded-2xl border border-border/60 overflow-hidden shadow-2xl">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-card/50">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-rose-500/70" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/70" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
                </div>
                <div className="flex-1 mx-4 bg-muted rounded-md px-3 py-1 text-xs text-muted-foreground font-mono">
                  maria.app/projects/mon-site
                </div>
                <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400 bg-emerald-400/5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
                  Live
                </Badge>
              </div>
              {/* App preview */}
              <div className="grid grid-cols-5 min-h-[320px]">
                {/* Sidebar */}
                <div className="col-span-1 bg-card/30 border-r border-border/50 p-3 flex flex-col gap-2">
                  {["index.html", "style.css", "script.js"].map((f, i) => (
                    <div key={f} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono ${i === 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                      <Code2 className="w-3 h-3" />
                      {f}
                    </div>
                  ))}
                </div>
                {/* Preview */}
                <div className="col-span-4 bg-white/5 flex items-center justify-center p-8">
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center mx-auto mb-3">
                      <Sparkles className="w-6 h-6 text-primary" />
                    </div>
                    <div className="h-3 bg-foreground/20 rounded w-48 mx-auto mb-2" />
                    <div className="h-2 bg-foreground/10 rounded w-32 mx-auto mb-4" />
                    <div className="flex gap-2 justify-center">
                      <div className="h-8 bg-primary/30 rounded-lg w-24" />
                      <div className="h-8 bg-foreground/10 rounded-lg w-20" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Features ─────────────────────────────────────────────────────── */}
      <section className="py-24 border-t border-border/50">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-border/60 text-muted-foreground">
              Fonctionnalités
            </Badge>
            <h2 className="text-4xl font-display font-bold text-foreground mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Une plateforme complète pour créer, modifier et publier votre site web avec l'aide de l'IA.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="p-6 rounded-xl border border-border/60 bg-card card-hover"
              >
                <div className={`w-10 h-10 rounded-lg ${f.bg} flex items-center justify-center mb-4`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="font-display font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ─────────────────────────────────────────────────── */}
      <section className="py-24 border-t border-border/50">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-border/60 text-muted-foreground">
              Comment ça marche
            </Badge>
            <h2 className="text-4xl font-display font-bold text-foreground mb-4">
              3 étapes pour votre site
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {STEPS.map((step, i) => (
              <div key={step.num} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-full w-full h-px bg-gradient-to-r from-border to-transparent z-0" />
                )}
                <div className="relative z-10">
                  <div className="text-5xl font-display font-bold gradient-text mb-4 opacity-60">{step.num}</div>
                  <h3 className="font-display font-semibold text-foreground mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Security ─────────────────────────────────────────────────────── */}
      <section className="py-16 border-t border-border/50">
        <div className="container">
          <div className="glass rounded-2xl border border-border/60 p-8 md:p-12 flex flex-col md:flex-row items-center gap-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-400/10 flex items-center justify-center flex-shrink-0">
              <Shield className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-2xl font-display font-bold text-foreground mb-2">
                Vos clés API sont en sécurité
              </h3>
              <p className="text-muted-foreground">
                Votre clé Anthropic est chiffrée au repos et n'est jamais exposée côté client. Tous les appels API sont effectués côté serveur avec rate limiting et journalisation des erreurs sans fuite de secrets.
              </p>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0">
              {["Chiffrement AES-256", "Appels serveur uniquement", "Rate limiting", "Logs sécurisés"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Testimonials ─────────────────────────────────────────────────── */}
      <section className="py-24 border-t border-border/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-display font-bold text-foreground mb-4">
              Ils créent avec Maria
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="p-6 rounded-xl border border-border/60 bg-card card-hover">
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ──────────────────────────────────────────────────────────── */}
      <section className="py-24 border-t border-border/50">
        <div className="container">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border border-primary/20 p-12 text-center">
            <div className="absolute inset-0 grid-pattern opacity-20 pointer-events-none" />
            <div className="relative">
              <Rocket className="w-12 h-12 text-primary mx-auto mb-6 animate-float" />
              <h2 className="text-4xl font-display font-bold text-foreground mb-4">
                Prêt à créer votre site ?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                Rejoignez des milliers de créateurs qui utilisent Maria pour construire leur présence en ligne avec l'IA.
              </p>
              {isAuthenticated ? (
                <Link href="/dashboard">
                  <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 h-12 text-base glow-brand">
                    Accéder au dashboard
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
              ) : (
                <a href={getLoginUrl()}>
                  <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 h-12 text-base glow-brand">
                    Commencer gratuitement
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </a>
              )}
              <p className="mt-3 text-sm text-muted-foreground">Gratuit · Aucune carte bancaire</p>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
