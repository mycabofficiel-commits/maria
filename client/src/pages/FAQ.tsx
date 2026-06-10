import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { HelpCircle, ArrowRight } from "lucide-react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLang } from "@/i18n/LangContext";
import SEOHead from "@/components/SEOHead";

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

const FAQ_SEO = {
  fr: { title: "FAQ — Mar-ia", description: "Toutes vos questions sur Mar-ia : connexion de clé API, génération de site, versioning, publication et facturation." },
  en: { title: "FAQ — Mar-ia", description: "All your questions about Mar-ia: API key connection, site generation, versioning, publishing and billing." },
  es: { title: "FAQ — Mar-ia", description: "Todas tus preguntas sobre Mar-ia: conexión de clave API, generación de sitios, versiones, publicación y facturación." },
};

export default function FAQ() {
  const { t, lang } = useLang();
  const seo = FAQ_SEO[lang];

  const FAQ_SECTIONS = [
    {
      title: t("faq_s1"),
      items: [
        { q: t("faq_s1_q1"), a: t("faq_s1_a1") },
        { q: t("faq_s1_q2"), a: t("faq_s1_a2") },
        { q: t("faq_s1_q3"), a: t("faq_s1_a3") },
      ],
    },
    {
      title: t("faq_s2"),
      items: [
        { q: t("faq_s2_q1"), a: t("faq_s2_a1") },
        { q: t("faq_s2_q2"), a: t("faq_s2_a2") },
        { q: t("faq_s2_q3"), a: t("faq_s2_a3") },
      ],
    },
    {
      title: t("faq_s3"),
      items: [
        { q: t("faq_s3_q1"), a: t("faq_s3_a1") },
        { q: t("faq_s3_q2"), a: t("faq_s3_a2") },
        { q: t("faq_s3_q3"), a: t("faq_s3_a3") },
      ],
    },
    {
      title: t("faq_s4"),
      items: [
        { q: t("faq_s4_q1"), a: t("faq_s4_a1") },
        { q: t("faq_s4_q2"), a: t("faq_s4_a2") },
        { q: t("faq_s4_q3"), a: t("faq_s4_a3") },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOHead
        title={seo.title}
        description={seo.description}
        path="/faq"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          "mainEntity": FAQ_SECTIONS.flatMap(s =>
            s.items.map(item => ({
              "@type": "Question",
              "name": item.q,
              "acceptedAnswer": { "@type": "Answer", "text": item.a },
            }))
          ),
        }}
      />
      <PublicNav />

      <section className="pt-32 pb-24">
        <div className="container max-w-3xl">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 border-border/60 text-muted-foreground">
              <HelpCircle className="w-3.5 h-3.5 mr-2" />
              FAQ
            </Badge>
            <h1 className="text-5xl font-display font-bold text-foreground mb-4">
              {t("faq_title")}
            </h1>
            <p className="text-xl text-muted-foreground">
              {t("faq_sub")}
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
              {t("faq_contact_title")}
            </h3>
            <p className="text-muted-foreground mb-6">{t("faq_contact_sub")}</p>
            <Link href="/">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                {t("faq_contact_btn")}
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
