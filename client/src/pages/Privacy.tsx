import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <section className="pt-32 pb-24">
        <div className="container max-w-3xl">
          <h1 className="text-4xl font-display font-bold text-foreground mb-2">Politique de Confidentialité</h1>
          <p className="text-muted-foreground mb-10">Dernière mise à jour : 1er janvier 2025</p>

          <div className="space-y-8 text-muted-foreground">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">1. Responsable du traitement</h2>
              <p>Maria (ci-après "nous") est responsable du traitement de vos données personnelles conformément au Règlement Général sur la Protection des Données (RGPD).</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">2. Données collectées</h2>
              <p className="mb-2">Nous collectons les données suivantes :</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Informations de compte : nom, email, identifiant OAuth</li>
                <li>Données d'usage : projets créés, générations effectuées, logs d'activité</li>
                <li>Clés API : stockées de manière chiffrée, jamais exposées en clair</li>
                <li>Données de facturation : gérées par Stripe (nous ne stockons pas vos coordonnées bancaires)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">3. Finalités du traitement</h2>
              <p>Vos données sont utilisées pour : fournir et améliorer le service, gérer votre compte et votre abonnement, vous envoyer des communications relatives au service, assurer la sécurité de la plateforme.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">4. Sécurité des clés API</h2>
              <p>Vos clés API Anthropic sont chiffrées avec AES-256 avant stockage. Elles ne sont jamais transmises au navigateur. Tous les appels API sont effectués côté serveur. Vous pouvez supprimer votre clé à tout moment.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">5. Partage des données</h2>
              <p>Nous ne vendons pas vos données. Nous pouvons partager vos données avec : Stripe (paiements), Anthropic (via votre clé API, pour la génération de contenu), nos prestataires d'hébergement.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">6. Conservation des données</h2>
              <p>Vos données sont conservées pendant la durée de votre abonnement plus 3 ans après la clôture de votre compte, sauf obligation légale contraire.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">7. Vos droits</h2>
              <p>Conformément au RGPD, vous disposez des droits d'accès, de rectification, d'effacement, de portabilité et d'opposition. Pour exercer ces droits, contactez-nous à privacy@maria.app.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">8. Cookies</h2>
              <p>Nous utilisons uniquement des cookies essentiels au fonctionnement du service (session d'authentification). Aucun cookie publicitaire ou de tracking tiers n'est utilisé.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">9. Contact</h2>
              <p>Pour toute question relative à cette politique, contactez-nous à : privacy@maria.app</p>
            </section>
          </div>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
