-- sessionVersion : permet de révoquer TOUTES les sessions JWT d'un utilisateur.
-- Le token embarque la version au moment de la connexion ; à chaque requête on
-- compare (token.sv) à users.sessionVersion. Incrémenter la colonne invalide
-- instantanément tous les anciens tokens (reset mot de passe, déconnexion globale).
-- Idempotent (IF NOT EXISTS). Les tokens existants n'ont pas de claim sv → traités
-- comme sv=0, donc valides tant que sessionVersion vaut 0 (pas de déconnexion au deploy).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionVersion" integer DEFAULT 0 NOT NULL;
