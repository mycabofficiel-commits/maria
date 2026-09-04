import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Zap, Key, Globe, MessageSquare, History, Rocket, ChevronRight } from "lucide-react";
import { useLang } from "@/i18n/LangContext";
import type { TranslationKey } from "@/i18n/translations";

type DocSection = { icon: any; title: TranslationKey; badge: TranslationKey; content: { step: string; text: TranslationKey }[] };

const SECTION_KEYS: DocSection[] = [
  {
    icon: Zap,
    title: "doc_s1_title",
    badge: "doc_s1_badge",
    content: [
      { step: "1", text: "doc_s1_1" },
      { step: "2", text: "doc_s1_2" },
      { step: "3", text: "doc_s1_3" },
      { step: "4", text: "doc_s1_4" },
      { step: "5", text: "doc_s1_5" },
    ],
  },
  {
    icon: Key,
    title: "doc_s2_title",
    badge: "doc_s2_badge",
    content: [
      { step: "1", text: "doc_s2_1" },
      { step: "2", text: "doc_s2_2" },
      { step: "3", text: "doc_s2_3" },
      { step: "4", text: "doc_s2_4" },
    ],
  },
  {
    icon: MessageSquare,
    title: "doc_s3_title",
    badge: "doc_s3_badge",
    content: [
      { step: "→", text: "doc_s3_1" },
      { step: "→", text: "doc_s3_2" },
      { step: "→", text: "doc_s3_3" },
    ],
  },
  {
    icon: History,
    title: "doc_s4_title",
    badge: "doc_s4_badge",
    content: [
      { step: "→", text: "doc_s4_1" },
      { step: "→", text: "doc_s4_2" },
      { step: "→", text: "doc_s4_3" },
    ],
  },
  {
    icon: Globe,
    title: "doc_s5_title",
    badge: "doc_s5_badge",
    content: [
      { step: "→", text: "doc_s5_1" },
      { step: "→", text: "doc_s5_2" },
      { step: "→", text: "doc_s5_3" },
    ],
  },
];

export default function Documentation() {
  const { t } = useLang();
  const sections = SECTION_KEYS.map((s) => ({
    icon: s.icon,
    title: t(s.title),
    badge: t(s.badge),
    content: s.content.map((c) => ({ step: c.step, text: t(c.text) })),
  }));
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <main className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-4">
              <BookOpen className="w-4 h-4" />
              {t("doc_badge")}
            </div>
            <h1 className="text-4xl font-bold mb-4">{t("doc_title")}</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {t("doc_subtitle")}
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
            <h3 className="text-xl font-semibold mb-2">{t("doc_cta_h")}</h3>
            <p className="text-muted-foreground text-sm mb-5">{t("doc_cta_desc")}</p>
            <Link href="/dashboard">
              <button className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
                {t("doc_cta_btn")} <ChevronRight className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
