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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Plus, FolderOpen, Globe, Clock, CheckCircle2, AlertCircle,
  Loader2, MoreVertical, Trash2, ExternalLink, Sparkles, Edit3,
  Share2, Users, Eye
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const SITE_TYPES = [
  "Landing page", "Site vitrine", "Portfolio", "Restaurant",
  "Artisan", "Agence", "SaaS", "E-commerce simple", "Blog"
];
const STYLES = ["Moderne", "Minimaliste", "Luxe", "Corporate", "Startup", "Premium"];
const FRAMEWORKS = [
  { value: "html", label: "HTML/CSS/JS" },
  { value: "react", label: "React" },
  { value: "nextjs", label: "Next.js" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Brouillon", color: "text-muted-foreground", icon: Clock },
  generating: { label: "Génération…", color: "text-amber-400", icon: Loader2 },
  ready: { label: "Prêt", color: "text-emerald-400", icon: CheckCircle2 },
  published: { label: "Publié", color: "text-primary", icon: Globe },
  archived: { label: "Archivé", color: "text-muted-foreground", icon: Clock },
  error: { label: "Erreur", color: "text-destructive", icon: AlertCircle },
};

export default function Projects() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    siteType: "Landing page",
    style: "Moderne",
    language: "fr",
    framework: "html" as "html" | "react" | "nextjs",
  });

  const utils = trpc.useUtils();
  const { data: projects, isLoading } = trpc.projects.list.useQuery();
  const { data: sharedProjects } = trpc.share.sharedWithMe.useQuery();

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (data) => {
      toast.success("Projet créé !");
      setOpen(false);
      utils.projects.list.invalidate();
      navigate(`/projects/${data.id}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("Projet supprimé");
      utils.projects.list.invalidate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleCreate = () => {
    if (!form.name.trim()) return toast.error("Donnez un nom à votre projet");
    createProject.mutate(form);
  };

  return (
    <AppLayout title="Projets">
      <div className="max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground">Mes projets</h2>
            <p className="text-muted-foreground mt-1">{projects?.length || 0} projet{(projects?.length || 0) > 1 ? "s" : ""}</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau projet
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border/60 max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display text-foreground">Créer un projet</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <Label className="text-sm text-foreground mb-1.5 block">Nom du projet *</Label>
                  <Input
                    placeholder="Mon site web"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="bg-input border-border/60"
                  />
                </div>
                <div>
                  <Label className="text-sm text-foreground mb-1.5 block">Description</Label>
                  <Input
                    placeholder="Décrivez brièvement votre projet"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="bg-input border-border/60"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Type de site</Label>
                    <Select value={form.siteType} onValueChange={(v) => setForm({ ...form, siteType: v })}>
                      <SelectTrigger className="bg-input border-border/60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SITE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Style</Label>
                    <Select value={form.style} onValueChange={(v) => setForm({ ...form, style: v })}>
                      <SelectTrigger className="bg-input border-border/60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Langue</Label>
                    <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                      <SelectTrigger className="bg-input border-border/60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fr">Français</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Español</SelectItem>
                        <SelectItem value="de">Deutsch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Framework</Label>
                    <Select value={form.framework} onValueChange={(v: any) => setForm({ ...form, framework: v })}>
                      <SelectTrigger className="bg-input border-border/60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FRAMEWORKS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={handleCreate}
                  disabled={createProject.isPending}
                >
                  {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Créer le projet
                </Button>
              </div>
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
            <Button onClick={() => setOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground">
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
                  {/* Actions */}
                  <div
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="w-7 h-7">
                          <MoreVertical className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}`)}>
                          <Edit3 className="w-3.5 h-3.5 mr-2" /> Ouvrir l'éditeur
                        </DropdownMenuItem>
                        {project.isPublished && (project as any).deployedUrl && (
                           <DropdownMenuItem asChild>
                             <a href={(project as any).deployedUrl} target="_blank" rel="noopener noreferrer" className="flex items-center">
                               <ExternalLink className="w-3.5 h-3.5 mr-2" /> Voir en ligne
                             </a>
                           </DropdownMenuItem>
                         )}
                        <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}/share`)}>
                          <Share2 className="w-3.5 h-3.5 mr-2" /> Partager
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => deleteProject.mutate({ id: project.id })}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
              onClick={() => setOpen(true)}
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
