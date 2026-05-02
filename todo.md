# Maria — AI Website Builder · TODO

## Phase 1 — Architecture & DB Schema
- [x] Schéma DB : tables projects, versions, files, api_keys, plans, subscriptions, usage_logs
- [x] Migrations SQL appliquées
- [x] Routeurs tRPC de base (projects, versions, apiKeys, billing)
- [x] App.tsx routes et layout global (dark theme premium)
- [x] index.css design tokens (couleurs, typographie)

## Phase 2 — Site Marketing Public
- [x] Landing page (Hero, features, how it works, testimonials, CTA)
- [x] Page Pricing avec plans FREE / CREATOR / PRO / AGENCY
- [x] Page FAQ orientée conversion
- [x] Pages légales : CGU, Politique de confidentialité
- [x] Navigation publique + footer

## Phase 3 — Authentification & Dashboard
- [x] Authentification Manus OAuth (login/logout)
- [x] Onboarding post-inscription (choix plan, configuration)
- [x] Dashboard utilisateur (projets récents, usage, profil)
- [x] Page profil (avatar, nom, email, plan, usage mensuel)

## Phase 4 — AI Builder
- [x] Page AI Builder avec grand champ prompt
- [x] Sélecteurs : type de site, style, langue, palette, framework
- [x] Suggestions de prompts
- [x] Intégration API Anthropic (clé utilisateur)
- [x] Page API Keys : ajout, test, statut, suppression clé Anthropic
- [x] Génération de code HTML/CSS/JS par l'IA
- [x] Sauvegarde automatique du site généré en DB

## Phase 5 — Chat, Prévisualisation & Versioning
- [x] Chat d'édition continue (modifier sections, couleurs, SEO…)
- [x] Historique des versions (v1, v2, v3…)
- [x] Prévisualisation live (iframe) desktop/tablette/mobile
- [x] Restauration d'une version précédente
- [x] Lien de preview unique par version

## Phase 6 — Gestion de Projets & Éditeur
- [x] Dashboard projets (liste, créer, dupliquer, archiver, supprimer)
- [x] Éditeur de fichiers intégré (arborescence, édition manuelle, sauvegarde)
- [x] Module SEO (meta title, description, OG, sitemap, robots.txt)
- [x] Compteurs d'usage (générations, tokens)

## Phase 7 — Billing & Admin
- [x] Plans tarifaires : FREE, CREATOR 19€, PRO 49€, AGENCY 149€
- [x] Compteurs d'usage (générations, tokens, builds)
- [x] Espace Admin (utilisateurs, stats, projets)
- [ ] Intégration Stripe complète (checkout, webhooks) — à activer via webdev_add_feature

## Phase 8 — Finalisation
- [x] UI/UX premium dark mode (Vercel/Linear/Framer style)
- [x] Responsive mobile/desktop
- [x] Tests Vitest (6 tests passés)
- [x] Checkpoint final

## Phase 9 — Export, Import & Déploiement
- [x] Export ZIP du code source (HTML/CSS/JS) depuis l'éditeur
- [x] Import de code existant : upload fichier .html ou coller HTML
- [x] Déploiement en ligne : upload vers S3 avec URL publique unique
- [x] Onglet Deploy dans l'éditeur (déployer, redéployer, voir en ligne)
- [x] Bouton "Voir en ligne" fonctionnel sur les projets déployés
- [x] Mise à jour du schéma DB : champs deployedUrl, deployedAt, deployedVersionId
- [x] 12 tests Vitest passés (dont 6 nouveaux pour deploy)

## Phase 10 — Bugfix Clé API Claude
- [x] Diagnostiquer : modèles Anthropic obsolètes (claude-3-5-sonnet-20241022 = 404)
- [x] Corriger les modèles valides : claude-sonnet-4-5 et claude-opus-4-5
- [x] Mise à jour automatique des anciens modèles en DB
- [x] Fallback automatique dans generate et chatEdit
- [x] Messages d'erreur détaillés dans testApiKey
- [x] 12 tests Vitest passés · 0 erreur TypeScript

## Phase 11 — Bugfix Layout Mobile ProjectEditor
- [x] Corriger l'affichage mobile de ProjectEditor (panneau + preview côte à côte illisible)
- [x] Passer en onglets plein écran sur mobile (Builder / Chat / Versions / Deploy / Preview)
- [x] Conserver le split panel sur desktop (≥ lg)
- [x] Titre tronqué et bouton Publier compact sur mobile
- [x] 0 erreur TypeScript

## Phase 12 — Historique, Versions & Partage
- [x] Historique de chat persistant avec numéro de version associé à chaque message
- [x] Affichage du numéro de version (v1, v2…) dans chaque bulle de chat IA
- [x] Restauration de version avec dialog de confirmation
- [x] Indicateur visuel de la version active dans l'onglet Versions
- [x] Table project_collaborators en DB (projectId, userId, role, inviteToken)
- [x] Routeur share : créer invitation, accepter invitation, lister collaborateurs, révoquer
- [x] Page /projects/:id/share avec formulaire d'invitation par email/lien
- [x] Accès collaborateur en lecture ou édition selon le rôle
- [x] Notification in-app via lien d'invitation unique

## Phase 13 — Éditeur de code & Import de projet
- [x] Éditeur de code avec coloration syntaxique (CodeMirror 6) — HTML/CSS/JS
- [x] Onglets de fichiers dans l'éditeur (index.html, style.css, script.js)
- [x] Sauvegarde du code modifié avec Ctrl+S et confirmation visuelle
- [x] Numéros de ligne, indentation automatique, raccourcis clavier
- [x] Import de projet : upload ZIP (extraction automatique HTML/CSS/JS)
- [x] Import de projet : upload de fichiers séparés (HTML + CSS + JS)
- [x] Import de projet : coller du code HTML directement
- [x] Prévisualisation immédiate après import
- [x] 12 tests Vitest passés · 0 erreur TypeScript

## Phase 14 — Compte Ultra (Super-Admin)
- [x] Ajouter le rôle "ultra" dans l'enum DB (users.role)
- [x] Migrer le schéma DB (ALTER TABLE users MODIFY COLUMN role)
- [x] Attribuer le rôle ultra + plan agency + 999 999 générations à Mycab.officiel@gmail.com
- [x] Procédure ultraProcedure côté serveur (gate ultra strict)
- [x] Tableau de bord Ultra exclusif (/ultra) avec 3 onglets
- [x] Vue d'ensemble : stats globales, activité mensuelle/hebdo, répartition par plan
- [x] Gestion utilisateurs : tous les users, changer rôle/plan, reset générations
- [x] Gestion projets : tous les projets, voir en ligne, supprimer
- [x] Badge Crown + ⚡ Ultra visible dans la sidebar et le dropdown
- [x] Bouton "Tableau de bord Ultra" en accès rapide dans la sidebar
- [x] Route protégée /ultra accessible uniquement au rôle ultra
- [x] 12 tests Vitest passés · 0 erreur TypeScript

## Phase 15 — Monaco Editor (CDN) + Prévisualisation Live
- [x] Créer MonacoEditor.tsx avec Monaco Editor chargé via CDN (https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs)
- [x] 3 onglets : index.html, style.css, script.js avec modèles séparés
- [x] Prévisualisation live via iframe à droite (split panel)
- [x] Debounce 800ms : mise à jour iframe après chaque modification
- [x] Blob + URL.createObjectURL pour injecter le code dans l'iframe
- [x] MonacoEditor intégré dans ProjectEditor (onglet code)
- [x] Fonctions extract pour parser HTML/CSS/JS du code généré
- [x] 12 tests Vitest passés · 0 erreur TypeScript

## Phase 16 — Agent IA Conversationnel avec Mémoire
- [ ] Système prompt agent : Maria se présente, connaît le projet, ses versions et l'historique
- [ ] Mémoire persistante : envoyer tout l'historique de chat à l'IA à chaque message
- [ ] L'IA peut répondre sans modifier le site (questions, conseils, explications)
- [ ] L'IA détecte si elle doit modifier le code ou juste répondre (intent detection)
- [ ] Indicateur "Maria est en train d'écrire..." dans le chat
- [ ] Bulles de chat distinctes (utilisateur vs Maria) avec avatar
- [ ] Messages de l'IA en markdown rendu (Streamdown)
- [ ] Stocker les messages IA sans version (réponses conversationnelles)

## Phase 17 — Nouveau Layout Éditeur (3 zones)
- [ ] Builder visible uniquement avant la première génération
- [ ] Après génération : layout 3 zones (code haut-gauche, chat bas-gauche, preview droite)
- [ ] Onglets HTML/CSS/JS dans la zone code
- [ ] Chat IA intégré dans la zone bas-gauche
- [ ] Preview live à droite avec debounce 800ms
- [ ] Clic sur élément dans la preview → surlignage dans le code
- [ ] 0 erreur TypeScript
