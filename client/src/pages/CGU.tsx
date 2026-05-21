import PublicNav from "@/components/PublicNav";
import PublicFooter from "@/components/PublicFooter";

export default function CGU() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />
      <section className="pt-32 pb-24">
        <div className="container max-w-3xl">
          <h1 className="text-4xl font-display font-bold text-foreground mb-2">Conditions Générales d'Utilisation</h1>
          <p className="text-muted-foreground mb-10">Dernière mise à jour : 1er janvier 2025</p>

          <div className="prose prose-invert max-w-none space-y-8 text-muted-foreground">
            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">1. Objet</h2>
              <p>Les présentes Conditions Générales d'Utilisation (CGU) régissent l'accès et l'utilisation de la plateforme Mar-ia, service de création de sites web par intelligence artificielle, accessible à l'adresse maria.app.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">2. Acceptation des CGU</h2>
              <p>En accédant à la plateforme Mar-ia, vous acceptez sans réserve les présentes CGU. Si vous n'acceptez pas ces conditions, vous devez cesser d'utiliser le service.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">3. Description du service</h2>
              <p>Mar-ia est une plateforme SaaS permettant aux utilisateurs de générer, modifier et publier des sites web à l'aide de l'intelligence artificielle. Le service nécessite la connexion d'une clé API Anthropic personnelle.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">4. Compte utilisateur</h2>
              <p>L'accès au service nécessite la création d'un compte. Vous êtes responsable de la confidentialité de vos identifiants et de toutes les activités effectuées depuis votre compte.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">5. Clés API tierces</h2>
              <p>L'utilisation du service requiert une clé API Anthropic valide. Mar-ia n'est pas responsable des coûts générés par l'utilisation de votre clé API. Vous êtes seul responsable du respect des conditions d'utilisation d'Anthropic.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">6. Propriété intellectuelle</h2>
              <p>Les sites web générés via Mar-ia vous appartiennent. Vous conservez tous les droits sur le contenu que vous créez. Mar-ia conserve les droits sur sa plateforme, son interface et ses algorithmes.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">7. Facturation et abonnements</h2>
              <p>Les abonnements payants sont facturés mensuellement via Stripe. Vous pouvez annuler à tout moment. Aucun remboursement n'est accordé pour les périodes déjà facturées, sauf obligation légale.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">8. Limitation de responsabilité</h2>
              <p>Mar-ia est fourni "tel quel". Nous ne garantissons pas que le service sera ininterrompu ou exempt d'erreurs. Notre responsabilité est limitée au montant payé pour le service au cours des 3 derniers mois.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">9. Résiliation</h2>
              <p>Nous nous réservons le droit de suspendre ou résilier votre accès en cas de violation des présentes CGU, sans préavis ni remboursement.</p>
            </section>

            <section>
              <h2 className="text-xl font-display font-semibold text-foreground mb-3">10. Droit applicable</h2>
              <p>Les présentes CGU sont soumises au droit français. Tout litige sera soumis à la compétence exclusive des tribunaux de Paris.</p>
            </section>
          </div>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
