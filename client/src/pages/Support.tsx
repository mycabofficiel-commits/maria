import { Link } from "wouter";
import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { HelpCircle, MessageSquare, BookOpen, Mail, ChevronRight, Zap } from "lucide-react";
import { useLang } from "@/i18n/LangContext";
import type { TranslationKey } from "@/i18n/translations";

const FAQ_KEYS: { q: TranslationKey; a: TranslationKey }[] = [
  { q: "sup_q1", a: "sup_a1" },
  { q: "sup_q2", a: "sup_a2" },
  { q: "sup_q3", a: "sup_a3" },
  { q: "sup_q4", a: "sup_a4" },
  { q: "sup_q5", a: "sup_a5" },
  { q: "sup_q6", a: "sup_a6" },
  { q: "sup_q7", a: "sup_a7" },
  { q: "sup_q8", a: "sup_a8" },
];

export default function Support() {
  const { t } = useLang();
  const faqs = FAQ_KEYS.map((f) => ({ q: t(f.q), a: t(f.a) }));
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <main className="pt-24 pb-20">
        <div className="max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-4">
              <HelpCircle className="w-4 h-4" />
              {t("sup_badge")}
            </div>
            <h1 className="text-4xl font-bold mb-4">{t("sup_title")}</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {t("sup_subtitle")}
            </p>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
            {[
              { icon: BookOpen, label: t("sup_link_doc"), href: "/documentation", desc: t("sup_link_doc_desc") },
              { icon: MessageSquare, label: t("sup_link_chat"), href: "/dashboard", desc: t("sup_link_chat_desc") },
              { icon: Zap, label: t("sup_link_quick"), href: "/documentation", desc: t("sup_link_quick_desc") },
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
          <h2 className="text-2xl font-semibold mb-6">{t("sup_faq_h")}</h2>
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
            <h3 className="text-xl font-semibold mb-2">{t("sup_contact_h")}</h3>
            <p className="text-muted-foreground text-sm mb-5">
              {t("sup_contact_desc")}
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
