import { useState } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Sparkles, LayoutTemplate, ArrowRight } from "lucide-react";
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory, type Template } from "@/data/templates";

const CATEGORY_COLORS: Record<string, string> = {
  Business: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Créatif: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Services: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Tech: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

export default function Templates() {
  const [, navigate] = useLocation();
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>("Tous");
  const [selected, setSelected] = useState<Template | null>(null);
  const [projectName, setProjectName] = useState("");

  const utils = trpc.useUtils();
  const createProject = trpc.projects.create.useMutation({
    onSuccess: (data) => {
      toast.success("Projet créé à partir du template !");
      setSelected(null);
      utils.projects.list.invalidate();
      navigate(`/projects/${data.id}?autoGenerate=true`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = activeCategory === "Tous"
    ? TEMPLATES
    : TEMPLATES.filter((t) => t.category === activeCategory);

  const handleUse = (tpl: Template) => {
    setProjectName(tpl.name);
    setSelected(tpl);
  };

  const handleCreate = () => {
    if (!selected) return;
    const name = projectName.trim() || selected.name;
    createProject.mutate({
      name,
      description: selected.prompt,
      siteType: selected.siteType,
      style: selected.style,
      colorPalette: selected.colorPalette,
      language: selected.language,
      framework: selected.framework,
    });
  };

  return (
    <AppLayout title="Templates">
      <div className="max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <LayoutTemplate className="w-5 h-5 text-primary" />
            <h2 className="text-2xl font-display font-bold text-foreground">Galerie de templates</h2>
          </div>
          <p className="text-muted-foreground text-sm">
            Choisis un template et Mar-ia génère ton site en quelques secondes.
          </p>
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {cat}
              {cat !== "Tous" && (
                <span className="ml-1.5 text-xs opacity-60">
                  {TEMPLATES.filter((t) => t.category === cat).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              className="group p-5 rounded-xl border border-border/60 bg-card hover:border-primary/30 hover:bg-card/80 transition-all flex flex-col gap-3"
            >
              {/* Top */}
              <div className="flex items-start justify-between gap-2">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-2xl flex-shrink-0">
                  {tpl.emoji}
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-medium flex-shrink-0 ${CATEGORY_COLORS[tpl.category]}`}
                >
                  {tpl.category}
                </Badge>
              </div>

              {/* Info */}
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">{tpl.name}</h3>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {tpl.description}
                </p>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1">
                {tpl.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-1 border-t border-border/40">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                  {tpl.framework.toUpperCase()} · {tpl.style}
                </span>
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs bg-primary hover:bg-primary/90 text-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleUse(tpl)}
                >
                  Utiliser
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Confirm dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="bg-card border-border/60 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <span className="text-2xl">{selected?.emoji}</span>
              {selected?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Mar-ia va générer ce site en partant de ce template. Tu peux modifier le nom du projet.
            </p>
            <div>
              <Label className="text-sm text-foreground mb-1.5 block">Nom du projet</Label>
              <Input
                placeholder={selected?.name}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="bg-input border-border/60"
                autoFocus
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-border/60"
                onClick={() => setSelected(null)}
              >
                Annuler
              </Button>
              <Button
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleCreate}
                disabled={createProject.isPending}
              >
                {createProject.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Création…</>
                  : <><Sparkles className="w-4 h-4 mr-2" />Créer le projet</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
