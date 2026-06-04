import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Plus, FolderOpen, Globe, Clock, CheckCircle2, AlertCircle,
  Loader2, Sparkles, Users, Eye, LayoutTemplate, ArrowLeft, ArrowRight
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import ProjectCardMenu from "@/components/ProjectCardMenu";
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template, type TemplateCategory } from "@/data/templates";

const SITE_TYPES = [
  "Landing page", "Site vitrine", "Portfolio", "Restaurant",
  "Artisan", "Agence", "SaaS", "E-commerce simple", "Blog", "Application mobile"
];

const PALETTE_PRESETS = [
  { label: "Bleu/Violet",     colors: ["#6366f1", "#8b5cf6", "#a78bfa"] },
  { label: "Vert/Émeraude",   colors: ["#10b981", "#059669", "#34d399"] },
  { label: "Orange/Ambre",    colors: ["#f59e0b", "#f97316", "#ef4444"] },
  { label: "Rose/Rouge",      colors: ["#ec4899", "#f43f5e", "#fb7185"] },
  { label: "Gris/Noir",       colors: ["#6b7280", "#374151", "#111827"] },
  { label: "Multicolore",     colors: ["#6366f1", "#10b981", "#f59e0b"] },
];

const LANGUAGES = [
  { code: "fr", label: "FR", full: "Français" },
  { code: "en", label: "EN", full: "English" },
  { code: "es", label: "ES", full: "Español" },
  { code: "de", label: "DE", full: "Deutsch" },
  { code: "it", label: "IT", full: "Italiano" },
  { code: "pt", label: "PT", full: "Português" },
  { code: "ar", label: "AR", full: "العربية" },
  { code: "zh", label: "ZH", full: "中文" },
  { code: "ja", label: "JA", full: "日本語" },
];
const STYLES = ["Moderne", "Minimaliste", "Luxe", "Corporate", "Startup", "Premium"];
const FRAMEWORKS = [
  { value: "html", label: "HTML/CSS/JS" },
  { value: "react", label: "React" },
  { value: "nextjs", label: "Next.js" },
];

const CATEGORY_COLORS: Record<string, string> = {
  Business: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Créatif: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Services: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Tech: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Brouillon", color: "text-muted-foreground", icon: Clock },
  generating: { label: "Génération…", color: "text-amber-400", icon: Loader2 },
  ready: { label: "Prêt", color: "text-emerald-400", icon: CheckCircle2 },
  published: { label: "Publié", color: "text-primary", icon: Globe },
  archived: { label: "Archivé", color: "text-muted-foreground", icon: Clock },
  error: { label: "Erreur", color: "text-destructive", icon: AlertCircle },
};

type DialogTab = "blank" | "template" | "tpl-confirm";

export default function Projects() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DialogTab>("blank");
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>("Tous");
  const [selectedTpl, setSelectedTpl] = useState<Template | null>(null);
  const [tplProjectName, setTplProjectName] = useState("");
  const [form, setForm] = useState({
    name: "",
    description: "",
    siteType: "Landing page",
    style: "Moderne",
    languages: ["fr"] as string[],
    colorPalette: "Bleu/Violet",
    customColors: ["#6366f1", "#8b5cf6", "#a78bfa"] as string[],
    useCustomColors: false,
    framework: "html" as "html" | "react" | "nextjs" | "expo",
  });

  const utils = trpc.useUtils();
  const { data: projects, isLoading } = trpc.projects.list.useQuery();
  const { data: sharedProjects } = trpc.share.sharedWithMe.useQuery();

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (data) => {
      resetDialog();
      utils.projects.list.invalidate();
      navigate(`/projects/${data.id}?autoGenerate=true`);
    },
    onError: (err: any) => toast.error(err.message),
  });


  const resetDialog = () => {
    setOpen(false);
    setTab("blank");
    setSelectedTpl(null);
    setTplProjectName("");
    setActiveCategory("Tous");
    setForm({ name: "", description: "", siteType: "Landing page", style: "Moderne", languages: ["fr"], colorPalette: "Bleu/Violet", customColors: ["#6366f1", "#8b5cf6", "#a78bfa"], useCustomColors: false, framework: "html" });
  };

  const handleCreate = () => {
    if (!form.name.trim()) return toast.error("Donnez un nom à votre projet");
    const palette = form.useCustomColors
      ? form.customColors.filter(Boolean).join(",")
      : form.colorPalette;
    // "expo" n'est pas une valeur DB valide (pgEnum html/react/nextjs)
    // Pour Application mobile : on stocke "react" mais siteType="Application mobile" guide le LLM
    const dbFramework = form.framework === "expo" ? "react" : form.framework;
    createProject.mutate({
      name: form.name,
      description: form.description,
      siteType: form.siteType,
      style: form.style,
      language: form.languages.join(","),
      colorPalette: palette,
      framework: dbFramework,
    });
  };

  const handleSelectTemplate = (tpl: Template) => {
    setSelectedTpl(tpl);
    setTplProjectName(tpl.name);
    setTab("tpl-confirm");
  };

  const handleCreateFromTemplate = () => {
    if (!selectedTpl) return;
    createProject.mutate({
      name: tplProjectName.trim() || selectedTpl.name,
      description: selectedTpl.prompt,
      siteType: selectedTpl.siteType,
      style: selectedTpl.style,
      colorPalette: selectedTpl.colorPalette,
      language: selectedTpl.language,
      framework: selectedTpl.framework,
    });
  };

  const filteredTpls = activeCategory === "Tous"
    ? TEMPLATES
    : TEMPLATES.filter((t) => t.category === activeCategory);

  return (
    <AppLayout title="Projets">
      <div className="max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground">Mes projets</h2>
            <p className="text-muted-foreground mt-1">{projects?.length || 0} projet{(projects?.length || 0) > 1 ? "s" : ""}</p>
          </div>
          <Dialog open={open} onOpenChange={(o) => { if (!o) resetDialog(); else setOpen(true); }}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau projet
              </Button>
            </DialogTrigger>
            <DialogContent className={`bg-card border-border/60 transition-all ${tab === "template" ? "max-w-4xl" : "max-w-lg"}`}>
              <DialogHeader>
                <DialogTitle className="font-display text-foreground flex items-center gap-2">
                  {tab === "tpl-confirm" && (
                    <button onClick={() => setTab("template")} className="text-muted-foreground hover:text-foreground">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}
                  {tab === "tpl-confirm" ? (
                    <><span className="text-xl">{selectedTpl?.emoji}</span> {selectedTpl?.name}</>
                  ) : "Nouveau projet"}
                </DialogTitle>
              </DialogHeader>

              {/* Tabs */}
              {tab !== "tpl-confirm" && (
                <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40">
                  <button
                    onClick={() => setTab("blank")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                      tab === "blank" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" /> Projet vide
                  </button>
                  <button
                    onClick={() => setTab("template")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                      tab === "template" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" /> Templates
                  </button>
                </div>
              )}

              {/* ── Tab: Projet vide ── */}
              {tab === "blank" && (
                <div className="space-y-4 pt-1">
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Nom du projet *</Label>
                    <Input
                      placeholder="Mon site web"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="bg-input border-border/60"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Décrivez votre site *</Label>
                    <textarea
                      placeholder="Ex: Une landing page pour une startup de livraison de repas sains, avec un hero accrocheur, section fonctionnalités et un CTA fort…"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={4}
                      className="w-full rounded-md border border-border/60 bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm text-foreground mb-1.5 block">Type de site</Label>
                      <Select
                        value={form.siteType}
                        onValueChange={(v) => {
                          const isMobile = v === "Application mobile";
                          setForm({
                            ...form,
                            siteType: v,
                            framework: isMobile ? "expo" : (form.framework === "expo" ? "html" : form.framework),
                          });
                        }}
                      >
                        <SelectTrigger className="bg-input border-border/60"><SelectValue /></SelectTrigger>
                        <SelectContent>{SITE_TYPES.map((t) => <SelectItem key={t} value={t}>{t === "Application mobile" ? "📱 Application mobile" : t}</SelectItem>)}</SelectContent>
                      </Select>
                      {form.siteType === "Application mobile" && (
                        <p className="text-[10px] text-amber-400 mt-1">⚡ Génération Expo (iOS &amp; Android)</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-sm text-foreground mb-1.5 block">Style</Label>
                      <Select value={form.style} onValueChange={(v) => setForm({ ...form, style: v })}>
                        <SelectTrigger className="bg-input border-border/60"><SelectValue /></SelectTrigger>
                        <SelectContent>{STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Langue(s) — multi-select pills */}
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Langue(s)</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {LANGUAGES.map(({ code, label, full }) => {
                        const selected = form.languages.includes(code);
                        return (
                          <button
                            key={code}
                            type="button"
                            title={full}
                            onClick={() => {
                              if (selected) {
                                if (form.languages.length === 1) return; // keep at least 1
                                setForm({ ...form, languages: form.languages.filter((l) => l !== code) });
                              } else {
                                setForm({ ...form, languages: [...form.languages, code] });
                              }
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                              selected
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {form.languages.length > 1 && (
                      <p className="text-[10px] text-muted-foreground mt-1">Site multilingue : {form.languages.map(l => LANGUAGES.find(x => x.code === l)?.full).join(", ")}</p>
                    )}
                  </div>

                  {/* Palette — presets + personnalisée */}
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Palette de couleurs</Label>
                    <div className="flex flex-wrap gap-2">
                      {PALETTE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          title={preset.label}
                          onClick={() => setForm({ ...form, colorPalette: preset.label, useCustomColors: false })}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                            !form.useCustomColors && form.colorPalette === preset.label
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                          }`}
                        >
                          <span className="flex gap-0.5">
                            {preset.colors.map((c) => (
                              <span key={c} className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: c }} />
                            ))}
                          </span>
                          <span className="hidden sm:inline">{preset.label}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, useCustomColors: true })}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                          form.useCustomColors
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        🎨 Personnalisée
                      </button>
                    </div>
                    {form.useCustomColors && (
                      <div className="flex gap-2 mt-2">
                        {form.customColors.map((color, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <input
                              type="color"
                              value={color}
                              onChange={(e) => {
                                const next = [...form.customColors];
                                next[i] = e.target.value;
                                setForm({ ...form, customColors: next });
                              }}
                              className="w-full h-8 rounded cursor-pointer border border-border/60 bg-transparent p-0.5"
                            />
                            <span className="text-[10px] text-muted-foreground font-mono">{color.toUpperCase()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={handleCreate}
                    disabled={createProject.isPending || !form.name.trim() || !form.description.trim()}
                  >
                    {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    Créer et générer le site
                  </Button>
                </div>
              )}

              {/* ── Tab: Templates ── */}
              {tab === "template" && (
                <div className="space-y-4 pt-1">
                  {/* Category filter */}
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                          activeCategory === cat
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                        }`}
                      >
                        {cat}
                        {cat !== "Tous" && (
                          <span className="ml-1 opacity-60">{TEMPLATES.filter((t) => t.category === cat).length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {/* Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                    {filteredTpls.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="group p-4 rounded-xl border border-border/60 bg-card/50 hover:border-primary/30 hover:bg-card transition-all flex flex-col gap-2 cursor-pointer"
                        onClick={() => handleSelectTemplate(tpl)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-xl flex-shrink-0">{tpl.emoji}</div>
                          <Badge variant="outline" className={`text-[10px] font-medium flex-shrink-0 ${CATEGORY_COLORS[tpl.category]}`}>{tpl.category}</Badge>
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-foreground text-sm mb-0.5">{tpl.name}</h3>
                          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{tpl.description}</p>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-border/30">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{tpl.framework.toUpperCase()} · {tpl.style}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Tab: Confirm template ── */}
              {tab === "tpl-confirm" && selectedTpl && (
                <div className="space-y-4 pt-1">
                  <p className="text-sm text-muted-foreground">
                    Mar-ia va générer ce site en partant de ce template. Tu peux modifier le nom du projet.
                  </p>
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Nom du projet</Label>
                    <Input
                      placeholder={selectedTpl.name}
                      value={tplProjectName}
                      onChange={(e) => setTplProjectName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateFromTemplate()}
                      className="bg-input border-border/60"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 border-border/60" onClick={() => setTab("template")}>
                      <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Retour
                    </Button>
                    <Button className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleCreateFromTemplate} disabled={createProject.isPending}>
                      {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                      Créer le projet
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : !projects || projects.length === 0 ? (
          <div className="text-center py-20 rounded-2xl border border-dashed border-border/60">
            <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-display font-semibold text-foreground mb-2">Aucun projet</h3>
            <p className="text-muted-foreground mb-6">Créez votre premier site web avec l'IA.</p>
            <Button onClick={() => { resetDialog(); setOpen(true); }} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />
              Créer mon premier projet
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project: any) => {
              const statusConf = STATUS_CONFIG[project.status] || STATUS_CONFIG.draft;
              return (
                <div
                  key={project.id}
                  className="group p-5 rounded-xl border border-border/60 bg-card card-hover cursor-pointer relative"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  {/* Actions — 3-dot menu */}
                  <div className="absolute top-3 right-3">
                    <ProjectCardMenu
                      project={{ id: project.id, name: project.name, isPublished: project.isPublished, deployedUrl: (project as any).deployedUrl }}
                    />
                  </div>

                  {/* Icon */}
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Globe className="w-5 h-5 text-primary" />
                  </div>

                  <h3 className="font-semibold text-foreground mb-1 truncate pr-8">{project.name}</h3>
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                    {project.description || `${project.siteType || "Site web"} · ${project.style || "Moderne"}`}
                  </p>

                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={`text-xs ${statusConf.color} border-current/20`}>
                      <statusConf.icon className="w-3 h-3 mr-1" />
                      {statusConf.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true, locale: fr })}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* New project card */}
            <div
              className="p-5 rounded-xl border border-dashed border-border/60 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all min-h-[160px]"
              onClick={() => { resetDialog(); setOpen(true); }}
            >
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <Plus className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-sm text-muted-foreground">Nouveau projet</span>
            </div>
          </div>
        )}

        {/* Shared with me */}
        {sharedProjects && sharedProjects.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="font-display font-semibold text-foreground">Partagés avec moi</h2>
              <span className="text-xs text-muted-foreground">({sharedProjects.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sharedProjects.map((project: any) => {
                const statusConf = STATUS_CONFIG[project.status] || STATUS_CONFIG.draft;
                return (
                  <div
                    key={project.id}
                    className="group p-5 rounded-xl border border-border/60 bg-card/50 card-hover cursor-pointer relative"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    {/* Role badge */}
                    <div className="absolute top-3 right-3">
                      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/40">
                        {project.collaboratorRole === "editor" ? (
                          <><Edit3 className="w-2.5 h-2.5 mr-1" />Éditeur</>
                        ) : (
                          <><Eye className="w-2.5 h-2.5 mr-1" />Lecteur</>
                        )}
                      </Badge>
                    </div>

                    <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center mb-4">
                      <Globe className="w-5 h-5 text-primary/60" />
                    </div>

                    <h3 className="font-semibold text-foreground mb-1 truncate pr-16">{project.name}</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Partagé par <strong>{project.ownerName}</strong>
                    </p>

                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className={`text-xs ${statusConf.color} border-current/20`}>
                        <statusConf.icon className="w-3 h-3 mr-1" />
                        {statusConf.label}
                      </Badge>
                      {project.updatedAt && (
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true, locale: fr })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
