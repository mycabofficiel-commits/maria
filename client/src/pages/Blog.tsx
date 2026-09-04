import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Badge } from "@/components/ui/badge";
import { Rss, Clock, ChevronRight } from "lucide-react";
import { useLang } from "@/i18n/LangContext";
import type { TranslationKey } from "@/i18n/translations";

type Post = { slug: string; category: TranslationKey; date: string; readTime: string; title: TranslationKey; excerpt: TranslationKey; color: string };

const POST_KEYS: Post[] = [
  { slug: "lancement-maria", category: "blog_p1_cat", date: "16 avril 2026", readTime: "3 min", title: "blog_p1_title", excerpt: "blog_p1_excerpt", color: "text-primary" },
  { slug: "streaming-temps-reel", category: "blog_p2_cat", date: "16 avril 2026", readTime: "4 min", title: "blog_p2_title", excerpt: "blog_p2_excerpt", color: "text-emerald-400" },
  { slug: "prompt-caching", category: "blog_p3_cat", date: "16 avril 2026", readTime: "5 min", title: "blog_p3_title", excerpt: "blog_p3_excerpt", color: "text-amber-400" },
  { slug: "byok-avantage", category: "blog_p4_cat", date: "10 avril 2026", readTime: "6 min", title: "blog_p4_title", excerpt: "blog_p4_excerpt", color: "text-blue-400" },
];

export default function Blog() {
  const { t } = useLang();
  const posts = POST_KEYS.map((p) => ({
    ...p,
    category: t(p.category),
    title: t(p.title),
    excerpt: t(p.excerpt),
  }));
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <main className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-4">
              <Rss className="w-4 h-4" />
              {t("blog_badge")}
            </div>
            <h1 className="text-4xl font-bold mb-4">{t("blog_title")}</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {t("blog_subtitle")}
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
                  {t("blog_read_more")} <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </article>
            ))}
          </div>

          {/* Newsletter CTA */}
          <div className="mt-14 text-center rounded-2xl border border-border/60 bg-card p-8">
            <Rss className="w-10 h-10 text-primary mx-auto mb-3" />
            <h3 className="text-xl font-semibold mb-2">{t("blog_news_h")}</h3>
            <p className="text-muted-foreground text-sm mb-5">
              {t("blog_news_desc")}
            </p>
            <Link href="/dashboard">
              <button className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
                {t("blog_news_btn")} <ChevronRight className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
