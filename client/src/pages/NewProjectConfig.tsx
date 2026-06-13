import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles, ArrowLeft, Loader2, Lock, Globe, Palette, Shield, Languages, Layers, Info } from "lucide-react";
import { TEMPLATES } from "@/data/templates";
import { TemplatePreviewThumb } from "@/components/TemplatePreviewThumb";

// ── Constants ────────────────────────────────────────────────────────────────

const AUTH_OPTIONS = [
  { id: "none",    label: "Sans auth",    icon: "🚫", desc: "Accès libre, pas de connexion" },
  { id: "email",   label: "Email / mdp", icon: "✉️",  desc: "Inscription + connexion classique" },
  { id: "google",  label: "Google",       icon: "🔵",  desc: "OAuth Google One-tap" },
  { id: "github",  label: "GitHub",       icon: "⚫",  desc: "OAuth GitHub" },
  { id: "magic",   label: "Magic link",   icon: "✨",  desc: "Connexion par lien email sans mot de passe" },
];

const LANG_OPTIONS = [
  { code:"fr", flag:"🇫🇷", label:"Français" },
  { code:"en", flag:"🇬🇧", label:"English" },
  { code:"es", flag:"🇪🇸", label:"Español" },
  { code:"de", flag:"🇩🇪", label:"Deutsch" },
  { code:"it", flag:"🇮🇹", label:"Italiano" },
  { code:"pt", flag:"🇧🇷", label:"Português" },
  { code:"ar", flag:"🇸🇦", label:"عربي" },
  { code:"zh", flag:"🇨🇳", label:"中文" },
  { code:"ja", flag:"🇯🇵", label:"日本語" },
];

const STYLE_OPTIONS = ["Moderne","Minimaliste","Luxe","Corporate","Startup","Premium"];

const COLOR_PRESETS = [
  { label:"Violet/Indigo", p:"#7c3aed", s:"#4f46e5", a:"#a78bfa" },
  { label:"Bleu/Cyan",     p:"#2563eb", s:"#06b6d4", a:"#60a5fa" },
  { label:"Vert/Émeraude", p:"#059669", s:"#10b981", a:"#34d399" },
  { label:"Rose/Rouge",    p:"#db2777", s:"#ef4444", a:"#f472b6" },
  { label:"Orange/Ambre",  p:"#ea580c", s:"#d97706", a:"#fb923c" },
  { label:"Gris/Noir",     p:"#374151", s:"#111827", a:"#6b7280" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function NewProjectConfig() {
  const [, navigate] = useLocation();

  // Read ?template= from URL
  const params = new URLSearchParams(window.location.search);
  const templateId = params.get("template");
  const template = templateId ? TEMPLATES.find(t => t.id === templateId) ?? null : null;

  // Form state
  const [name, setName] = useState(template?.name ?? "");
  const [prompt, setPrompt] = useState(template?.prompt ?? "");
  const [style, setStyle] = useState(template?.style ?? "Moderne");
  const [langs, setLangs] = useState<string[]>([template?.language ?? "fr"]);
  const [authMethods, setAuthMethods] = useState<string[]>(["none"]);
  const [colorMode, setColorMode] = useState<"preset"|"custom">("preset");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customColors, setCustomColors] = useState({ p:"#6366f1", s:"#8b5cf6", a:"#a78bfa" });
  const [darkMode, setDarkMode] = useState(template?.colorPalette === "violet" || template?.colorPalette === "indigo" || template?.colorPalette === "monochrome" || template?.colorPalette === "orange");
  const [framework, setFramework] = useState(template?.framework ?? "html");

  // Lock framework if template is expo
  const frameworkLocked = template?.framework === "expo";

  // Sync name when template loaded
  useEffect(() => {
    if (template) {
      setName(template.name);
      setPrompt(template.prompt);
      setStyle(template.style);
      setLangs([template.language]);
    }
  }, [templateId]);

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (data) => {
      toast.success("Projet créé ! Mar-ia génère votre projet…");
      navigate(`/projects/${data.id}?autoGenerate=true`);
    },
    onError: (err) => toast.error(err.message),
  });

  // Build final prompt enriched with user choices
  function buildFinalPrompt() {
    let final = prompt.trim();

    // Auth
    const activeAuth = authMethods.filter(a => a !== "none");
    if (activeAuth.length > 0) {
      const labels = activeAuth.map(id => AUTH_OPTIONS.find(a => a.id === id)?.label ?? id);
      final += `\n\nAuthentification : Intégrer un système d'authentification complet avec ${labels.join(", ")}.`;
    }

    // Languages
    if (langs.length > 1) {
      const lLabels = langs.map(c => LANG_OPTIONS.find(l => l.code === c)?.label ?? c);
      final += `\n\nMulti-langues : L'interface doit être disponible en ${lLabels.join(", ")} avec un sélecteur de langue.`;
    }

    // Colors
    const colors = colorMode === "preset" ? COLOR_PRESETS[selectedPreset] : customColors;
    final += `\n\nCouleurs : Palette principale = ${colors.p} (primaire), ${colors.s} (secondaire), ${colors.a} (accent).`;

    // Dark mode
    if (darkMode) {
      final += `\n\nThème : Design sombre (dark mode), fond presque noir.`;
    }

    return final;
  }

  function handleSubmit() {
    if (!name.trim()) { toast.error("Donne un nom au projet !"); return; }
    const colors = colorMode === "preset" ? COLOR_PRESETS[selectedPreset] : customColors;
    createProject.mutate({
      name: name.trim(),
      description: buildFinalPrompt(),
      siteType: template?.siteType ?? "Landing page",
      style,
      colorPalette: colors.p,
      language: langs[0] ?? "fr",
      framework: framework as any,
    });
  }

  // ── Toggle helpers ──────────────────────────────────────────────────────
  function toggleAuth(id: string) {
    if (id === "none") { setAuthMethods(["none"]); return; }
    setAuthMethods(prev => {
      const withoutNone = prev.filter(a => a !== "none");
      return withoutNone.includes(id) ? (withoutNone.filter(a => a !== id) || ["none"]) : [...withoutNone, id];
    });
  }

  function toggleLang(code: string) {
    setLangs(prev => prev.includes(code)
      ? (prev.length > 1 ? prev.filter(c => c !== code) : prev)
      : [...prev, code]
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <AppLayout title="Nouveau projet">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Back */}
        <button
          onClick={() => navigate("/projects")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Retour aux projets
        </button>

        <h1 className="text-2xl font-display font-bold text-foreground mb-6">
          {template ? (
            <span className="flex items-center gap-3">
              <span className="text-3xl">{template.emoji}</span>
              <span>Configurer — {template.name}</span>
            </span>
          ) : "Nouveau projet"}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">

          {/* ── Left: Preview ──────────────────────────────────────────── */}
          {template && (
            <div className="space-y-4">
              <div className="rounded-2xl overflow-hidden border border-border/60 shadow-lg">
                <TemplatePreviewThumb template={template} height={200} />
                <div className="p-4 bg-card/70">
                  <p className="text-sm font-medium text-foreground mb-1">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {template.tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80">#{tag}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tech info */}
              <div className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2"><Layers className="w-3.5 h-3.5" /><span>Framework : <strong className="text-foreground">{framework.toUpperCase()}</strong></span></div>
                <div className="flex items-center gap-2"><Palette className="w-3.5 h-3.5" /><span>Style : <strong className="text-foreground">{style}</strong></span></div>
                <div className="flex items-center gap-2"><Globe className="w-3.5 h-3.5" /><span>Type : <strong className="text-foreground">{template.siteType}</strong></span></div>
              </div>
            </div>
          )}

          {/* ── Right: Form ────────────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Project name */}
            <Section icon={<Info className="w-4 h-4" />} title="Nom du projet">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex : MonSaaS, FoodApp, Portfolio…"
                className="bg-input border-border/60 text-foreground"
                autoFocus
              />
            </Section>

            {/* AI Prompt */}
            <Section icon={<Sparkles className="w-4 h-4" />} title="Instructions pour l'IA" subtitle="Décris ce que l'IA doit construire, l'architecture, le contenu, le nom des sections…">
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={6}
                placeholder="Décris ton projet en détail : fonctionnalités, sections, contenu, architecture…"
                className="w-full rounded-xl bg-input border border-border/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
            </Section>

            {/* Colors */}
            <Section icon={<Palette className="w-4 h-4" />} title="Palette de couleurs">
              {/* Tabs */}
              <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40 mb-3 w-fit">
                {(["preset","custom"] as const).map(m => (
                  <button key={m} onClick={() => setColorMode(m)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors font-medium ${colorMode===m?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>
                    {m === "preset" ? "Presets" : "Personnalisée"}
                  </button>
                ))}
              </div>

              {colorMode === "preset" ? (
                <div className="grid grid-cols-3 gap-2">
                  {COLOR_PRESETS.map((preset, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedPreset(i)}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs transition-all ${selectedPreset===i?"border-primary bg-primary/10":"border-border/60 hover:border-border"}`}
                    >
                      <div className="flex gap-1 flex-shrink-0">
                        {[preset.p, preset.s, preset.a].map((c,j) => (
                          <div key={j} style={{ background:c }} className="w-4 h-4 rounded-full" />
                        ))}
                      </div>
                      <span className="text-muted-foreground text-[11px] truncate">{preset.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {(["p","s","a"] as const).map((k,i) => (
                    <div key={k}>
                      <Label className="text-xs text-muted-foreground mb-1 block">{["Primaire","Secondaire","Accent"][i]}</Label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={customColors[k]} onChange={e => setCustomColors(prev => ({...prev,[k]:e.target.value}))}
                          className="w-9 h-9 rounded-lg cursor-pointer border border-border/60 bg-transparent p-0.5" />
                        <Input value={customColors[k]} onChange={e => setCustomColors(prev => ({...prev,[k]:e.target.value}))}
                          className="bg-input border-border/60 text-xs h-9 font-mono" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Dark mode toggle */}
              <div className="flex items-center gap-3 mt-3 p-3 rounded-xl bg-muted/20 border border-border/30">
                <button
                  onClick={() => setDarkMode(!darkMode)}
                  className={`relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0 ${darkMode?"bg-primary":"bg-muted-foreground/30"}`}
                  style={{ height:22 }}
                >
                  <div className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${darkMode?"translate-x-5":"translate-x-0.5"}`}
                    style={{ width:18, height:18, top:2, left:2, transform: darkMode?"translateX(18px)":"translateX(0)" }} />
                </button>
                <div>
                  <p className="text-sm text-foreground font-medium">Mode sombre</p>
                  <p className="text-xs text-muted-foreground">Fond noir, textes clairs — idéal pour SaaS/Tech</p>
                </div>
              </div>
            </Section>

            {/* Authentication */}
            <Section icon={<Shield className="w-4 h-4" />} title="Authentification" subtitle="L'IA intégrera le système choisi dans le code généré">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AUTH_OPTIONS.map(opt => {
                  const active = authMethods.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleAuth(opt.id)}
                      className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${active?"border-primary bg-primary/8":"border-border/60 hover:border-border"}`}
                    >
                      <span className="text-lg flex-shrink-0 mt-0.5">{opt.icon}</span>
                      <div>
                        <p className={`text-sm font-medium ${active?"text-primary":"text-foreground"}`}>{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Languages */}
            <Section icon={<Languages className="w-4 h-4" />} title="Langues" subtitle="L'interface sera disponible dans les langues sélectionnées">
              <div className="flex flex-wrap gap-2">
                {LANG_OPTIONS.map(l => {
                  const active = langs.includes(l.code);
                  return (
                    <button
                      key={l.code}
                      onClick={() => toggleLang(l.code)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${active?"border-primary bg-primary/10 text-primary font-medium":"border-border/60 text-muted-foreground hover:border-border hover:text-foreground"}`}
                    >
                      <span>{l.flag}</span>
                      <span>{l.label}</span>
                    </button>
                  );
                })}
              </div>
              {langs.length > 1 && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  L'IA ajoutera un sélecteur de langue et traduira le contenu en {langs.length} langues.
                </p>
              )}
            </Section>

            {/* Framework (only if not locked) */}
            {!frameworkLocked && (
              <Section icon={<Layers className="w-4 h-4" />} title="Framework">
                <div className="flex gap-2">
                  {([{v:"html",l:"HTML/CSS/JS"},{v:"react",l:"React"},{v:"nextjs",l:"Next.js"}] as {v:"html"|"react"|"nextjs"; l:string}[]).map(f => (
                    <button key={f.v} onClick={() => setFramework(f.v)}
                      className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${framework===f.v?"border-primary bg-primary/10 text-primary":"border-border/60 text-muted-foreground hover:border-border hover:text-foreground"}`}>
                      {f.l}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {/* Submit */}
            <div className="pt-2">
              <Button
                onClick={handleSubmit}
                disabled={createProject.isPending || !name.trim()}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-base font-semibold rounded-xl"
              >
                {createProject.isPending ? (
                  <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Création en cours…</>
                ) : (
                  <><Sparkles className="w-5 h-5 mr-2" /> Créer et générer avec l'IA</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Mar-ia va générer l'intégralité du {template?.framework === "expo" ? "code React Native" : "code"} selon tes instructions.
              </p>
            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────
function Section({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-5 space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-foreground text-sm">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
