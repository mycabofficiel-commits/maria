#!/usr/bin/env node
/**
 * Script de déploiement avec versionnage + sauvegarde automatique.
 *
 * À chaque appel :
 *   1. incrémente la version dans package.json (patch par défaut)
 *   2. enregistre une ligne dans DEPLOYMENTS.md (date, version, commit, message)
 *   3. commit + crée un tag Git annoté  vX.Y.Z  (= point de sauvegarde/restauration)
 *   4. push vers origin/main avec le tag  → déclenche le deploy Render
 *
 * Usage :
 *   node scripts/deploy.mjs "message du déploiement"            → bump patch
 *   node scripts/deploy.mjs "message" minor                     → bump minor
 *   node scripts/deploy.mjs "message" major                     → bump major
 *
 * Restaurer une version (sauvegarde) :
 *   git checkout v1.2.3          (lecture seule)
 *   git revert <commit>          (annuler proprement)
 *   git reset --hard v1.2.3      (revenir en arrière — destructif)
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(ROOT, "package.json");
const LOG_PATH = join(ROOT, "DEPLOYMENTS.md");

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: "pipe", encoding: "utf8", ...opts }).trim();
}
function runLive(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const bumpArg = ["patch", "minor", "major"].includes(args[args.length - 1])
  ? args.pop()
  : "patch";
const message = args.join(" ").trim() || "Déploiement";

// ── Garde : ne déploie pas une branche autre que main par erreur ──────────────
const branch = run("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.error(`✋ Branche courante = "${branch}". Le déploiement se fait depuis "main". Abandon.`);
  process.exit(1);
}

// ── Bump version ──────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
const next =
  bumpArg === "major" ? `${maj + 1}.0.0`
  : bumpArg === "minor" ? `${maj}.${min + 1}.0`
  : `${maj}.${min}.${pat + 1}`;
pkg.version = next;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");

const tag = `v${next}`;
const now = new Date().toISOString().replace("T", " ").slice(0, 16);
const shortSha = run("git rev-parse --short HEAD");

// ── Journal de déploiement (sauvegarde lisible) ───────────────────────────────
const header = "# Journal des déploiements\n\n| Date (UTC) | Version | Commit (avant) | Message |\n|---|---|---|---|\n";
const line = `| ${now} | ${tag} | ${shortSha} | ${message.replace(/\|/g, "/")} |\n`;
if (!existsSync(LOG_PATH)) writeFileSync(LOG_PATH, header);
const prev = readFileSync(LOG_PATH, "utf8");
// Insère la nouvelle ligne juste après l'en-tête du tableau (ordre antéchronologique).
const idx = prev.indexOf("|---|---|---|---|\n");
const insertAt = idx >= 0 ? idx + "|---|---|---|---|\n".length : prev.length;
writeFileSync(LOG_PATH, prev.slice(0, insertAt) + line + prev.slice(insertAt));

console.log(`\n🚀 Déploiement ${tag}  (bump ${bumpArg})  — « ${message} »\n`);

// ── Commit + tag + push ────────────────────────────────────────────────────────
runLive("git add -A");
runLive(`git commit -m "deploy: ${tag} — ${message.replace(/"/g, "'")}"`);
runLive(`git tag -a ${tag} -m "${message.replace(/"/g, "'")}"`);
runLive("git push origin main --follow-tags");

console.log(`\n✅ ${tag} poussé. Render va redéployer (~2-3 min).`);
console.log(`   Sauvegarde/restauration : git checkout ${tag}\n`);
