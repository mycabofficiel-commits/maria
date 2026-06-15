# Journal des déploiements

| Date (UTC) | Version | Commit (avant) | Message |
|---|---|---|---|
| 2026-06-15 15:07 | v1.2.7 | cf10689 | fix chat: le raisonneur recevait un extrait de code coupe a 8000 chars (sans </html>) et croyait le site tronque - on passe maintenant jusqu'a 45000 chars et tout extrait est marque comme extrait, plus de faux 'code tronque, pas de suite' |
| 2026-06-15 14:54 | v1.2.6 | f7d2bfa | fix vision: chat ET debug utilisent les cles personnelles (BYOK) Anthropic/OpenAI/Qwen en fallback, pas seulement DeepSeek - les images sont enfin lues si une cle perso Claude/OpenAI existe |
| 2026-06-15 14:38 | v1.2.5 | 7b69efe | chat: phase raison inclut l'historique de conversation (fin de la perte de contexte) ; lecture d'image avec fallback OpenAI GPT-4o si pas de cle Claude + message clair si aucune cle vision |
| 2026-06-15 12:45 | v1.2.4 | 4feb848 | sites generes: annee courante auto + credit Mar-ia.net obligatoire (retirable via chat pour comptes payants) ; prompt renforce langues fonctionnelles + logos reseaux sociaux en SVG inline |
| 2026-06-15 12:12 | v1.2.3 | 5b55c08 | UI: footer annee dynamique + suppression mention Anthropic ; modal nouveau projet : sous-menus options replies par defaut (SEO ne masque plus les autres) |
| 2026-06-15 11:58 | v1.2.2 | f8cc93c | fix: lecture de package.json dans vite.config protegee par try/catch (ne crashe plus le serveur bundle au demarrage Render) |
| 2026-06-15 11:52 | v1.2.1 | 55e146d | fix: ouvre le port Render immediatement (0.0.0.0 + PORT exact) et migrations DB apres le listen pour ne plus echouer le scan de port |
| 2026-06-15 10:34 | v1.2.0 | 16a96d7 | Options de création (réseaux sociaux, SEO, FAQ, maps, vidéo…) portées dans le vrai modal Projects + version affichée sous le profil et dans le footer |
| 2026-06-15 10:07 | v1.1.2 | b6b2262 | Sous-menus supplementaires : Newsletter (service emailing Mailchimp/Brevo/ConvertKit/MailerLite), Temoignages (nombre d'avis), FAQ (questions personnalisees) |
| 2026-06-15 10:02 | v1.1.1 | b1003f1 | Sous-menus de configuration des options : reseaux sociaux (choix + liens), Google Maps (adresse), SEO (mots-cles/hashtags), nouvelle option Video YouTube (liens), WhatsApp (numero), contact (email de reception) |
| 2026-06-15 09:51 | v1.1.0 | 3039fa1 | Options a cocher a la creation de projet (footer, animations, SEO, reseaux sociaux, cookies RGPD, contact, WhatsApp, FAQ, temoignages, newsletter, Maps, pages legales, preloader) injectees dans le prompt de generation |
| 2026-06-15 09:31 | v1.0.1 | e693784 | Securisation DB/auth (IDOR, OTP en DB, FK/index, rate-limit + revocation session) + systeme de versionnage et sauvegarde des deploiements |
