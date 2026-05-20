import { useState, useMemo, useRef } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Link, useLocation } from "wouter";
import JSZip from "jszip";
import {
  Sparkles, FolderOpen, Zap, Key, ArrowRight, Plus,
  Globe, Clock, CheckCircle2, AlertCircle, Loader2, LayoutTemplate,
  Upload, FileArchive
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Brouillon", color: "text-muted-foreground", icon: Clock },
  generating: { label: "Génération…", color: "text-amber-400", icon: Loader2 },
  ready: { label: "Prêt", color: "text-emerald-400", icon: CheckCircle2 },
  published: { label: "Publié", color: "text-primary", icon: Globe },
  archived: { label: "Archivé", color: "text-muted-foreground", icon: Clock },
  error: { label: "Erreur", color: "text-destructive", icon: AlertCircle },
};

const PLAN_COLORS: Record<string, string> = {
  free: "border-border/60 text-muted-foreground",
  creator: "border-primary/40 text-primary bg-primary/5",
  pro: "border-cyan-400/40 text-cyan-400 bg-cyan-400/5",
  agency: "border-amber-400/40 text-amber-400 bg-amber-400/5",
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading } = trpc.user.getUsageStats.useQuery();
  const { data: projects, isLoading: projectsLoading } = trpc.projects.list.useQuery();
  const { data: apiKey } = trpc.user.getApiKey.useQuery();
  const [, navigate] = useLocation();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importProjectName, setImportProjectName] = useState("Projet importé");
  const [selectedExistingId, setSelectedExistingId] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const planLimits: Record<string, number> = { free: 1, creator: 5, pro: 20, agency: 9999 };
  const projectLimit = planLimits[(user as any)?.plan || "free"] || 1;
  const atLimit = useMemo(() => (projects?.length || 0) >= projectLimit, [projects, projectLimit]);

  const createProject = trpc.projects.create.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const importCode = trpc.deploy.importCode.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith(".zip")) { toast.error("Veuillez sélectionner un fichier .zip"); return; }
    setSelectedFile(file);
  };

  const handleImport = async () => {
    if (!selectedFile) { toast.error("Sélectionnez un fichier ZIP d'abord"); return; }
    setIsImporting(true);
    try {
      // Parse ZIP — collect ALL css/js files and images
      const zip = new JSZip();
      const loaded = await zip.loadAsync(selectedFile);

      let html = "";
      const cssFiles: { name: string; content: string }[] = [];
      const jsFiles: { name: string; content: string }[] = [];
      const imageFiles: { name: string; b64: string; mime: string }[] = [];

      for (const [name, zipFile] of Object.entries(loaded.files)) {
        if ((zipFile as any).dir) continue;
        const base = name.split("/").pop()?.toLowerCase() || "";
        if (base.endsWith(".html") || base.endsWith(".htm")) {
          const content = await (zipFile as any).async("string");
          if (!html || base === "index.html") html = content;
        } else if (base.endsWith(".css")) {
          cssFiles.push({ name, content: await (zipFile as any).async("string") });
        } else if (base.endsWith(".js")) {
          jsFiles.push({ name, content: await (zipFile as any).async("string") });
        } else if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(base)) {
          const b64 = await (zipFile as any).async("base64");
          const mime = base.endsWith(".svg") ? "image/svg+xml"
            : base.endsWith(".gif") ? "image/gif"
            : base.endsWith(".webp") ? "image/webp"
            : base.endsWith(".png") ? "image/png"
            : "image/jpeg";
          imageFiles.push({ name, b64, mime });
        }
      }

      if (!html) { toast.error("Aucun fichier HTML trouvé dans le ZIP"); setIsImporting(false); return; }

      // Replace image src references with base64 data URIs
      for (const img of imageFiles) {
        const filename = img.name.split("/").pop() || img.name;
        const dataUri = `data:${img.mime};base64,${img.b64}`;
        html = html.split(filename).join(dataUri);
      }

      // Remove existing <link rel="stylesheet"> and <script src="..."> tags (we'll inline them)
      html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "");
      html = html.replace(/<script[^>]+src=["'][^"']+["'][^>]*><\/script>/gi, "");

      // Inline ALL CSS files
      const allCss = cssFiles.map(f => f.content).join("\n");
      if (allCss) {
        if (/<\/head>/i.test(html)) {
          html = html.replace(/<\/head>/i, `<style>\n${allCss}\n</style>\n</head>`);
        } else {
          html = `<style>\n${allCss}\n</style>\n` + html;
        }
      }

      // Inline ALL JS files (skip service workers and minified vendor chunks)
      const allJs = jsFiles
        .filter(f => !f.name.includes("sw.js") && !f.name.includes("workbox"))
        .map(f => f.content)
        .join("\n");
      if (allJs) {
        if (/<\/body>/i.test(html)) {
          html = html.replace(/<\/body>/i, `<script>\n${allJs}\n<\/script>\n</body>`);
        } else {
          html = html + `\n<script>\n${allJs}\n<\/script>`;
        }
      }

      let projectId: number;
      if (atLimit) {
        projectId = parseInt(selectedExistingId || String(projects?.[0]?.id || 0));
        if (!projectId) { toast.error("Sélectionnez un projet de destination"); setIsImporting(false); return; }
      } else {
        const created = await createProject.mutateAsync({
          name: importProjectName.trim() || "Projet importé",
          description: "Projet importé", siteType: "Site vitrine",
          style: "Moderne", colorPalette: "Bleu/Violet", framework: "html", language: "fr",
        });
        projectId = created.id;
        utils.projects.list.invalidate();
      }

      await importCode.mutateAsync({ projectId, htmlContent: html, label: `Import ${selectedFile.name}` });
      toast.success("Projet importé avec succès !");
      setShowImportDialog(false);
      navigate(`/projects/${projectId}`);
    } catch (e: any) {
      toast.error(e.message || "Erreur lors de l'import");
    } finally {
      setIsImporting(false);
    }
  };

  const resetImportDialog = () => {
    setSelectedFile(null);
    setImportProjectName("Projet importé");
    setSelectedExistingId("");
    setIsDragging(false);
  };

  const recentProjects = projects?.slice(0, 4) || [];
  const plan = (user as any)?.plan || "free";

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-6 max-w-6xl">
        {/* Welcome */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground">
              Bonjour, {user?.name?.split(" ")[0] || "là"} 👋
            </h2>
            <p className="text-muted-foreground mt-1">Voici un aperçu de votre activité.</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`capitalize ${PLAN_COLORS[plan]}`}>
              Plan {plan}
            </Badge>
            <Link href="/projects">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau projet
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Projets",
              value: statsLoading ? "—" : stats?.projectsCount || 0,
              icon: FolderOpen,
              color: "text-primary",
              bg: "bg-primary/10",
              sub: `/ ${plan === "agency" ? "∞" : plan === "pro" ? 20 : plan === "creator" ? 5 : 1} max`,
            },
            {
              label: "Générations",
              value: statsLoading ? "—" : stats?.generationsUsed || 0,
              icon: Sparkles,
              color: "text-cyan-400",
              bg: "bg-cyan-400/10",
              sub: `/ ${stats?.generationsLimit || 3} ce mois`,
            },
            {
              label: "Tokens utilisés",
              value: statsLoading ? "—" : ((stats?.tokensTotal || 0) / 1000).toFixed(1) + "k",
              icon: Zap,
              color: "text-amber-400",
              bg: "bg-amber-400/10",
              sub: "total",
            },
            {
              label: "Clé API",
              value: apiKey ? "Connectée" : "Non configurée",
              icon: Key,
              color: apiKey ? "text-emerald-400" : "text-muted-foreground",
              bg: apiKey ? "bg-emerald-400/10" : "bg-muted",
              sub: apiKey ? `…${apiKey.keyHint}` : "Configurer",
            },
          ].map((stat) => (
            <div key={stat.label} className="p-5 rounded-xl border border-border/60 bg-card">
              <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                <stat.icon className={`w-4.5 h-4.5 ${stat.color}`} />
              </div>
              <div className="text-2xl font-display font-bold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{stat.label} {stat.sub}</div>
            </div>
          ))}
        </div>

        {/* API Key warning */}
        {!apiKey && (
          <div className="flex items-center justify-between p-4 rounded-xl border border-amber-400/20 bg-amber-400/5">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-foreground">Clé API Anthropic requise</div>
                <div className="text-xs text-muted-foreground">Connectez votre clé pour commencer à générer des sites.</div>
              </div>
            </div>
            <Link href="/api-keys">
              <Button size="sm" variant="outline" className="border-amber-400/30 text-amber-400 hover:bg-amber-400/10 flex-shrink-0">
                Configurer
                <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        )}

        {/* Recent projects */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-foreground">Projets récents</h3>
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                Voir tout
                <ArrowRight className="ml-1.5 w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>

          {projectsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="text-center py-12 rounded-xl border border-dashed border-border/60">
              <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">Aucun projet pour l'instant.</p>
              <Link href="/projects">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Plus className="w-4 h-4 mr-2" />
                  Créer mon premier site
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {recentProjects.map((project: any) => {
                const statusConf = STATUS_CONFIG[project.status] || STATUS_CONFIG.draft;
                return (
                  <div
                    key={project.id}
                    className="p-5 rounded-xl border border-border/60 bg-card card-hover cursor-pointer"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-foreground truncate">{project.name}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{project.description || project.siteType || "Site web"}</p>
                      </div>
                      <Badge variant="outline" className={`ml-2 flex-shrink-0 text-xs ${statusConf.color} border-current/20`}>
                        <statusConf.icon className="w-3 h-3 mr-1" />
                        {statusConf.label}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="capitalize">{project.framework || "html"}</span>
                      <span>{formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true, locale: fr })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div>
          <h3 className="font-display font-semibold text-foreground mb-4">Actions rapides</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { href: "/projects", icon: Plus, label: "Nouveau projet", desc: "Créer un site avec l'IA", color: "text-primary", bg: "bg-primary/10" },
              { href: "/templates", icon: LayoutTemplate, label: "Templates", desc: "Partir d'un template prêt", color: "text-violet-400", bg: "bg-violet-400/10" },
              { href: "/api-keys", icon: Key, label: "Clés API", desc: "Gérer votre clé Anthropic", color: "text-cyan-400", bg: "bg-cyan-400/10" },
              { href: "/billing", icon: Zap, label: "Billing", desc: "Gérer votre abonnement", color: "text-amber-400", bg: "bg-amber-400/10" },
            ].map((action) => (
              <Link key={action.href} href={action.href}>
                <div className="flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-card card-hover cursor-pointer">
                  <div className={`w-9 h-9 rounded-lg ${action.bg} flex items-center justify-center flex-shrink-0`}>
                    <action.icon className={`w-4.5 h-4.5 ${action.color}`} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.desc}</div>
                  </div>
                </div>
              </Link>
            ))}
            {/* Import card — bouton dédié, pas un Link */}
            <div
              className="flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-card card-hover cursor-pointer"
              onClick={() => { resetImportDialog(); setShowImportDialog(true); }}
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-400/10 flex items-center justify-center flex-shrink-0">
                <Upload className="w-4.5 h-4.5 text-emerald-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">Importer</div>
                <div className="text-xs text-muted-foreground">ZIP, fichiers ou code HTML</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Import dialog */}
      <Dialog open={showImportDialog} onOpenChange={(o) => { if (!o) { setShowImportDialog(false); resetImportDialog(); } }}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-400" />
              Importer un projet ZIP
            </DialogTitle>
            <DialogDescription>
              Sélectionnez un fichier .zip contenant votre site (index.html, style.css, script.js).
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            {/* Zone de sélection de fichier */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                isDragging ? "border-emerald-500 bg-emerald-500/5" :
                selectedFile ? "border-emerald-500/50 bg-emerald-500/5" :
                "border-border/60 hover:border-emerald-500/50 hover:bg-emerald-500/5"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
            >
              {selectedFile ? (
                <>
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-400">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">Cliquez pour changer</p>
                </>
              ) : (
                <>
                  <FileArchive className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Glissez votre ZIP ici</p>
                  <p className="text-xs text-muted-foreground mt-1">ou cliquez pour parcourir</p>
                </>
              )}
            </div>

            {/* Destination */}
            {atLimit ? (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-xs text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  Limite plan {plan} atteinte — sera importé comme nouvelle version d'un projet existant.
                </div>
                <Select value={selectedExistingId || String(projects?.[0]?.id || "")} onValueChange={setSelectedExistingId}>
                  <SelectTrigger className="bg-input border-border/60 text-sm">
                    <SelectValue placeholder="Choisir un projet…" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects?.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nom du projet</label>
                <Input
                  placeholder="Mon site importé"
                  value={importProjectName}
                  onChange={(e) => setImportProjectName(e.target.value)}
                  className="bg-input border-border/60"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => { setShowImportDialog(false); resetImportDialog(); }}>Annuler</Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleImport}
                disabled={!selectedFile || isImporting}
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                Importer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
