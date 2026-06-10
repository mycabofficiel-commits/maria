import { Helmet } from "react-helmet-async";
import { useLang } from "@/i18n/LangContext";

const SITE_URL = "https://mar-ia.net";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

interface SEOHeadProps {
  title: string;
  description: string;
  path?: string;
  jsonLd?: object | object[];
}

export default function SEOHead({ title, description, path = "/", jsonLd }: SEOHeadProps) {
  const { lang } = useLang();
  const canonical = `${SITE_URL}${path}`;

  const jsonLdArray = jsonLd
    ? Array.isArray(jsonLd) ? jsonLd : [jsonLd]
    : [];

  return (
    <Helmet>
      {/* ── HTML lang ── */}
      <html lang={lang} />

      {/* ── Primary ── */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      {/* ── hreflang (same URL, language switcher) ── */}
      <link rel="alternate" hrefLang="fr" href={`${SITE_URL}${path}`} />
      <link rel="alternate" hrefLang="en" href={`${SITE_URL}${path}`} />
      <link rel="alternate" hrefLang="es" href={`${SITE_URL}${path}`} />
      <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}${path}`} />

      {/* ── Open Graph ── */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:site_name" content="Mar-ia" />
      <meta property="og:locale" content={lang === "fr" ? "fr_FR" : lang === "es" ? "es_ES" : "en_GB"} />

      {/* ── Twitter / X ── */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={OG_IMAGE} />

      {/* ── JSON-LD ── */}
      {jsonLdArray.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}
