import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  MoreVertical, Edit3, ExternalLink, Share2, Trash2,
  Pencil, Info, Loader2, Calendar, HardDrive, Zap, Hash, Layers,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface ProjectCardMenuProps {
  project: {
    id: number;
    name: string;
    isPublished?: boolean;
    deployedUrl?: string;
  };
  onDeleted?: () => void;
  onRenamed?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Ko";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

export default function ProjectCardMenu({ project, onDeleted, onRenamed }: ProjectCardMenuProps) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [renameOpen, setRenameOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [newName, setNewName] = useState(project.name);

  const { data: details, isLoading: detailsLoading } = trpc.projects.getDetails.useQuery(
    { id: project.id },
    { enabled: detailsOpen }
  );

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("Projet supprimé");
      utils.projects.list.invalidate();
      onDeleted?.();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const renameProject = trpc.projects.rename.useMutation({
    onSuccess: () => {
      toast.success("Projet renommé");
      utils.projects.list.invalidate();
      setRenameOpen(false);
      onRenamed?.();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleRename = () => {
    if (!newName.trim() || newName.trim() === project.name) { setRenameOpen(false); return; }
    renameProject.mutate({ id: project.id, name: newName.trim() });
  };

  return (
    <>
      {/* ── 3-dot trigger ── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}`)}>
            <Edit3 className="w-3.5 h-3.5 mr-2" /> Ouvrir l'éditeur
          </DropdownMenuItem>
          {project.isPublished && project.deployedUrl && (
            <DropdownMenuItem asChild>
              <a href={project.deployedUrl} target="_blank" rel="noopener noreferrer" className="flex items-center">
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Voir en ligne
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => navigate(`/projects/${project.id}/share`)}>
            <Share2 className="w-3.5 h-3.5 mr-2" /> Partager
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setNewName(project.name); setRenameOpen(true); }}>
            <Pencil className="w-3.5 h-3.5 mr-2" /> Renommer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
            <Info className="w-3.5 h-3.5 mr-2" /> Détails
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => {
              if (confirm(`Supprimer "${project.name}" ? Cette action est irréversible.`))
                deleteProject.mutate({ id: project.id });
            }}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── Rename dialog ── */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="bg-card border-border/60 max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" /> Renommer le projet
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              className="bg-input border-border/60"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 border-border/60" onClick={() => setRenameOpen(false)}>
                Annuler
              </Button>
              <Button
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleRename}
                disabled={renameProject.isPending || !newName.trim()}
              >
                {renameProject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Details dialog ── */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="bg-card border-border/60 max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="font-display text-foreground flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> {project.name}
            </DialogTitle>
          </DialogHeader>
          {detailsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : details ? (
            <div className="space-y-1 pt-1">
              {[
                {
                  icon: Hash,
                  label: "ID du projet",
                  value: `#${details.id}`,
                  color: "text-muted-foreground",
                },
                {
                  icon: Calendar,
                  label: "Créé le",
                  value: details.createdAt
                    ? format(new Date(details.createdAt), "d MMM yyyy à HH:mm", { locale: fr })
                    : "—",
                  color: "text-muted-foreground",
                },
                {
                  icon: Calendar,
                  label: "Modifié le",
                  value: details.updatedAt
                    ? format(new Date(details.updatedAt), "d MMM yyyy à HH:mm", { locale: fr })
                    : "—",
                  color: "text-muted-foreground",
                },
                {
                  icon: HardDrive,
                  label: "Taille du code",
                  value: formatBytes(details.codeSizeBytes),
                  color: "text-blue-400",
                },
                {
                  icon: Zap,
                  label: "Tokens utilisés",
                  value: details.totalTokens > 0
                    ? `${(details.totalTokens / 1000).toFixed(1)}k`
                    : "0",
                  color: "text-amber-400",
                },
                {
                  icon: Layers,
                  label: "Versions",
                  value: String(details.versionsCount),
                  color: "text-violet-400",
                },
                {
                  icon: Edit3,
                  label: "Type · Style",
                  value: [details.siteType, details.style].filter(Boolean).join(" · ") || "—",
                  color: "text-muted-foreground",
                },
                {
                  icon: Edit3,
                  label: "Framework",
                  value: (details.framework || "html").toUpperCase(),
                  color: "text-emerald-400",
                },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </div>
                  <span className={`text-xs font-medium ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Impossible de charger les détails.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
