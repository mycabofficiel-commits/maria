import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";
import { useLang } from "@/i18n/LangContext";
import type { Lang } from "@/i18n/translations";

interface Section { title: string; content: string | string[]; list?: string[]; }

const SECTIONS: Record<Lang, Section[]> = {
  fr: [
    { title: "1. Responsable du traitement", content: "Mar-ia (ci-après \"nous\") est responsable du traitement de vos données personnelles conformément au Règlement Général sur la Protection des Données (RGPD)." },
    { title: "2. Données collectées", content: "Nous collectons les données suivantes :", list: ["Informations de compte : nom, email, identifiant OAuth", "Données d'usage : projets créés, générations effectuées, logs d'activité", "Clés API : stockées de manière chiffrée, jamais exposées en clair", "Données de facturation : gérées par Stripe (nous ne stockons pas vos coordonnées bancaires)"] },
    { title: "3. Finalités du traitement", content: "Vos données sont utilisées pour : fournir et améliorer le service, gérer votre compte et votre abonnement, vous envoyer des communications relatives au service, assurer la sécurité de la plateforme." },
    { title: "4. Sécurité des clés API", content: "Vos clés API Anthropic sont chiffrées avec AES-256 avant stockage. Elles ne sont jamais transmises au navigateur. Tous les appels API sont effectués côté serveur. Vous pouvez supprimer votre clé à tout moment." },
    { title: "5. Partage des données", content: "Nous ne vendons pas vos données. Nous pouvons partager vos données avec : Stripe (paiements), Anthropic (via votre clé API, pour la génération de contenu), nos prestataires d'hébergement." },
    { title: "6. Conservation des données", content: "Vos données sont conservées pendant la durée de votre abonnement plus 3 ans après la clôture de votre compte, sauf obligation légale contraire." },
    { title: "7. Vos droits", content: "Conformément au RGPD, vous disposez des droits d'accès, de rectification, d'effacement, de portabilité et d'opposition. Pour exercer ces droits, contactez-nous à privacy@maria.app." },
    { title: "8. Cookies", content: "Nous utilisons uniquement des cookies essentiels au fonctionnement du service (session d'authentification). Aucun cookie publicitaire ou de tracking tiers n'est utilisé." },
    { title: "9. Contact", content: "Pour toute question relative à cette politique, contactez-nous à : privacy@maria.app" },
  ],
  en: [
    { title: "1. Data Controller", content: "Mar-ia (hereinafter \"we\") is responsible for processing your personal data in accordance with the General Data Protection Regulation (GDPR)." },
    { title: "2. Data Collected", content: "We collect the following data:", list: ["Account information: name, email, OAuth identifier", "Usage data: projects created, generations performed, activity logs", "API keys: stored encrypted, never exposed in plain text", "Billing data: managed by Stripe (we do not store your bank details)"] },
    { title: "3. Processing Purposes", content: "Your data is used to: provide and improve the service, manage your account and subscription, send you service-related communications, ensure platform security." },
    { title: "4. API Key Security", content: "Your Anthropic API keys are encrypted with AES-256 before storage. They are never transmitted to the browser. All API calls are made server-side. You can delete your key at any time." },
    { title: "5. Data Sharing", content: "We do not sell your data. We may share your data with: Stripe (payments), Anthropic (via your API key, for content generation), our hosting providers." },
    { title: "6. Data Retention", content: "Your data is retained for the duration of your subscription plus 3 years after account closure, unless otherwise required by law." },
    { title: "7. Your Rights", content: "Under GDPR, you have the right of access, rectification, erasure, portability and objection. To exercise these rights, contact us at privacy@maria.app." },
    { title: "8. Cookies", content: "We only use cookies essential to the operation of the service (authentication session). No advertising or third-party tracking cookies are used." },
    { title: "9. Contact", content: "For any questions regarding this policy, contact us at: privacy@maria.app" },
  ],
  es: [
    { title: "1. Responsable del tratamiento", content: "Mar-ia (en adelante \"nosotros\") es responsable del tratamiento de tus datos personales de conformidad con el Reglamento General de Protección de Datos (RGPD)." },
    { title: "2. Datos recopilados", content: "Recopilamos los siguientes datos:", list: ["Información de cuenta: nombre, email, identificador OAuth", "Datos de uso: proyectos creados, generaciones realizadas, registros de actividad", "Claves API: almacenadas cifradas, nunca expuestas en texto claro", "Datos de facturación: gestionados por Stripe (no almacenamos tus datos bancarios)"] },
    { title: "3. Finalidades del tratamiento", content: "Tus datos se utilizan para: proporcionar y mejorar el servicio, gestionar tu cuenta y suscripción, enviarte comunicaciones relativas al servicio, garantizar la seguridad de la plataforma." },
    { title: "4. Seguridad de las claves API", content: "Tus claves API de Anthropic se cifran con AES-256 antes del almacenamiento. Nunca se transmiten al navegador. Todas las llamadas API se realizan en el servidor. Puedes eliminar tu clave en cualquier momento." },
    { title: "5. Compartir datos", content: "No vendemos tus datos. Podemos compartir tus datos con: Stripe (pagos), Anthropic (a través de tu clave API, para la generación de contenido), nuestros proveedores de alojamiento." },
    { title: "6. Conservación de datos", content: "Tus datos se conservan durante la duración de tu suscripción más 3 años tras el cierre de tu cuenta, salvo obligación legal contraria." },
    { title: "7. Tus derechos", content: "De acuerdo con el RGPD, tienes derecho de acceso, rectificación, supresión, portabilidad y oposición. Para ejercer estos derechos, contáctanos en privacy@maria.app." },
    { title: "8. Cookies", content: "Solo utilizamos cookies esenciales para el funcionamiento del servicio (sesión de autenticación). No se utilizan cookies publicitarias ni de seguimiento de terceros." },
    { title: "9. Contacto", content: "Para cualquier pregunta sobre esta política, contáctanos en: privacy@maria.app" },
  ],
};

export default function Privacy() {
  const { lang, t } = useLang();
  const sections = SECTIONS[lang];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <section className="pt-32 pb-24">
        <div className="container max-w-3xl">
          <h1 className="text-4xl font-display font-bold text-foreground mb-2">{t("privacy_title")}</h1>
          <p className="text-muted-foreground mb-10">{t("privacy_updated")}</p>

          <div className="space-y-8 text-muted-foreground">
            {sections.map((s) => (
              <section key={s.title}>
                <h2 className="text-xl font-display font-semibold text-foreground mb-3">{s.title}</h2>
                <p>{s.content}</p>
                {s.list && (
                  <ul className="list-disc pl-6 space-y-1 mt-2">
                    {s.list.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
