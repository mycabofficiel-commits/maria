import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Badge } from "@/components/ui/badge";
import { Rss, Clock, ChevronRight } from "lucide-react";

const posts = [
  {
    slug: "lancement-maria",
    category: "Annonce",
    date: "16 avril 2026",
    readTime: "3 min",
    title: "Lancement de Maria — Créez votre site web par l'IA en quelques minutes",
    excerpt:
      "Nous sommes ravis de vous présenter Maria, le premier AI Website Builder BYOK (Bring Your Own Key) qui vous permet de créer des sites web professionnels en quelques minutes grâce à Claude d'Anthropic.",
    color: "text-primary",
  },
  {
    slug: "streaming-temps-reel",
    category: "Fonctionnalité",
    date: "16 avril 2026",
    readTime: "4 min",
    title: "Streaming en temps réel : voyez votre site se construire caractère par caractère",
    excerpt:
      "Avec la nouvelle version de Maria, le code HTML/CSS/JS s'affiche en temps réel dans l'éditeur pendant que l'IA génère. Fini l'attente — vous voyez votre site prendre forme instantanément.",
    color: "text-emerald-400",
  },
  {
    slug: "prompt-caching",
    category: "Technique",
    date: "16 avril 2026",
    readTime: "5 min",
    title: "Prompt Caching Anthropic : -70% sur le coût en tokens",
    excerpt:
      "Maria intègre désormais le Prompt Caching d'Anthropic sur les system prompts. Résultat : les appels répétés coûtent jusqu'à 70% moins cher en tokens, ce qui se traduit directement par une réduction de vos coûts API.",
    color: "text-amber-400",
  },
  {
    slug: "byok-avantage",
    category: "Stratégie",
    date: "10 avril 2026",
    readTime: "6 min",
    title: "BYOK : pourquoi apporter votre propre clé API change tout",
    excerpt:
      "Contrairement aux autres AI builders qui facturent à la génération, Maria vous laisse utiliser votre propre clé API Anthropic. Vous payez directement Anthropic au prix coûtant, sans marge intermédiaire.",
    color: "text-blue-400",
  },
];

export default function Blog() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <main className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-4">
              <Rss className="w-4 h-4" />
              Blog
            </div>
            <h1 className="text-4xl font-bold mb-4">Actualités & Tutoriels</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Nouveautés, guides techniques et conseils pour tirer le meilleur de Maria.
            </p>
          </div>

          {/* Posts */}
          <div className="space-y-6">
            {posts.map((post) => (
              <article key={post.slug} className="rounded-2xl border border-border/60 bg-card p-6 hover:border-primary/30 transition-colors group">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline" className={`text-xs border-0 bg-primary/10 ${post.color}`}>{post.category}</Badge>
                  <span className="text-muted-foreground/50 text-xs">·</span>
                  <span className="text-xs text-muted-foreground">{post.date}</span>
                  <span className="text-muted-foreground/50 text-xs">·</span>
                  <Clock className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground">{post.readTime}</span>
                </div>
                <h2 className="text-lg font-semibold mb-2 group-hover:text-primary transition-colors">{post.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{post.excerpt}</p>
                <div className="mt-4 flex items-center gap-1 text-xs text-primary font-medium">
                  Lire la suite <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </article>
            ))}
          </div>

          {/* Newsletter CTA */}
          <div className="mt-14 text-center rounded-2xl border border-border/60 bg-card p-8">
            <Rss className="w-10 h-10 text-primary mx-auto mb-3" />
            <h3 className="text-xl font-semibold mb-2">Restez informé</h3>
            <p className="text-muted-foreground text-sm mb-5">
              Nouvelles fonctionnalités, tutoriels et conseils — directement dans votre inbox.
            </p>
            <Link href="/dashboard">
              <button className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
                Commencer gratuitement <ChevronRight className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
