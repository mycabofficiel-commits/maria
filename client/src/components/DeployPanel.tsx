import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Download, Upload, Globe, Loader2, CheckCircle2, Copy, ExternalLink,
  FileCode2, FolderOpen, Rocket, RefreshCw, AlertCircle
} from "lucide-react";
import ImportProjectPanel from "@/components/ImportProjectPanel";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface DeployPanelProps {
  projectId: number;
  hasCode: boolean;
  onImportSuccess?: (versionId: number) => void;
}

type Tab = "deploy" | "export" | "import";

export default function DeployPanel({ projectId, hasCode, onImportSuccess }: DeployPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("deploy");
  const [importMode, setImportMode] = useState<"paste" | "file">("paste");
  const [pastedHtml, setPastedHtml] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: deployInfo, isLoading: deployInfoLoading } = trpc.deploy.getDeployInfo.useQuery(
    { projectId },
    { refetchInterval: false }
  );

  const exportZip = trpc.deploy.exportZip.useMutation({
    onSuccess: (data) => {
      // Trigger download
      const a = document.createElement("a");
      a.href = data.url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("ZIP téléchargé avec succès !");
    },
    onError: (e) => toast.error(e.message),
  });

  const importCode = trpc.deploy.importCode.useMutation({
    onSuccess: (data) => {
      toast.success(`Code importé — Version ${data.versionNumber} créée`);
      setPastedHtml("");
      setImportLabel("");
      utils.projects.get.invalidate({ id: projectId });
      utils.projects.getVersions.invalidate({ projectId });
      onImportSuccess?.(data.versionId);
    },
    onError: (e) => toast.error(e.message),
  });

  const deploy = trpc.deploy.deploy.useMutation({
    onSuccess: (data) => {
      toast.success("Site déployé en ligne !", { duration: 6000 });
      utils.deploy.getDeployInfo.invalidate({ projectId });
    },
    onError: (e) => toast.error(e.message),
  });

  // ── File upload handler ───────────────────────────────────────────────────
  const handleFileUpload = (file: File) => {
    if (!file.name.endsWith(".html") && !file.name.endsWith(".htm") && !file.name.endsWith(".zip")) {
      toast.error("Seuls les fichiers .html, .htm sont supportés pour l'import direct. Pour un ZIP, utilisez le mode collage.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setPastedHtml(content);
      setImportLabel(file.name.replace(/\.(html?|zip)$/, ""));
      setImportMode("paste");
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("URL copiée !");
  };

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "deploy", label: "Déployer", icon: Rocket },
    { id: "export", label: "Exporter", icon: Download },
    { id: "import", label: "Importer", icon: Upload },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border/50 bg-card/30">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── DEPLOY TAB ─────────────────────────────────────────────────── */}
        {activeTab === "deploy" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Mettre en ligne</h3>
              <p className="text-xs text-muted-foreground">
                Déployez votre site sur un hébergement public et obtenez une URL partageable immédiatement.
              </p>
            </div>

            {/* Current deploy status */}
            {deployInfoLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement...
              </div>
            ) : deployInfo?.deployedUrl ? (
              <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-medium text-emerald-400">Site en ligne</span>
                  {deployInfo.deployedAt && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {formatDistanceToNow(new Date(deployInfo.deployedAt), { addSuffix: true, locale: fr })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 bg-background/50 rounded px-2 py-1.5">
                  <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-foreground font-mono truncate flex-1">
                    {deployInfo.deployedUrl}
                  </span>
                  <button
                    onClick={() => copyUrl(deployInfo.deployedUrl!)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <a
                    href={deployInfo.deployedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-border/50 bg-muted/20">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Aucun déploiement actif
                </div>
              </div>
            )}

            {/* Deploy actions */}
            <div className="space-y-2">
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
                disabled={!hasCode || deploy.isPending}
                onClick={() => deploy.mutate({ projectId })}
              >
                {deploy.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Déploiement en cours...</>
                ) : deployInfo?.deployedUrl ? (
                  <><RefreshCw className="w-4 h-4 mr-2" /> Redéployer (mise à jour)</>
                ) : (
                  <><Rocket className="w-4 h-4 mr-2" /> Déployer en ligne</>
                )}
              </Button>

              {deployInfo?.deployedUrl && (
                <a href={deployInfo.deployedUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" className="w-full text-sm border-border/60">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Voir le site en ligne
                  </Button>
                </a>
              )}
            </div>

            {/* Info */}
            <div className="p-3 rounded-lg border border-border/40 bg-card/30 space-y-1.5">
              <div className="text-xs font-medium text-foreground">Comment ça marche ?</div>
              {[
                "Votre site est uploadé sur un CDN public",
                "Vous obtenez une URL unique et permanente",
                "Redéployez à chaque modification pour mettre à jour",
                "L'URL reste la même après chaque redéploiement",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400 flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── EXPORT TAB ─────────────────────────────────────────────────── */}
        {activeTab === "export" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Exporter le code</h3>
              <p className="text-xs text-muted-foreground">
                Téléchargez le code source de votre site pour l'héberger où vous voulez.
              </p>
            </div>

            {/* Export options */}
            <div className="space-y-2">
              <div
                className="p-4 rounded-lg border border-border/60 bg-card/30 hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => !exportZip.isPending && hasCode && exportZip.mutate({ projectId })}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <FileCode2 className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">Archive ZIP complète</div>
                    <div className="text-xs text-muted-foreground">
                      index.html + style.css + script.js + README.md
                    </div>
                  </div>
                  {exportZip.isPending ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>

            <Button
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
              disabled={!hasCode || exportZip.isPending}
              onClick={() => exportZip.mutate({ projectId })}
            >
              {exportZip.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Génération du ZIP...</>
              ) : (
                <><Download className="w-4 h-4 mr-2" /> Télécharger le ZIP</>
              )}
            </Button>

            {/* Hosting suggestions */}
            <div className="p-3 rounded-lg border border-border/40 bg-card/30">
              <div className="text-xs font-medium text-foreground mb-2">Hébergeurs recommandés</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { name: "Netlify", url: "https://netlify.com", desc: "Drag & drop" },
                  { name: "Vercel", url: "https://vercel.com", desc: "Git deploy" },
                  { name: "GitHub Pages", url: "https://pages.github.com", desc: "Gratuit" },
                  { name: "Cloudflare", url: "https://pages.cloudflare.com", desc: "CDN mondial" },
                ].map((h) => (
                  <a
                    key={h.name}
                    href={h.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-2 rounded border border-border/40 hover:border-border/80 transition-colors"
                  >
                    <div>
                      <div className="text-xs font-medium text-foreground">{h.name}</div>
                      <div className="text-[10px] text-muted-foreground">{h.desc}</div>
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── IMPORT TAB ────────────────────────────────────────────────────────────────── */}
        {activeTab === "import" && (
          <ImportProjectPanel
            projectId={projectId}
            onImportSuccess={(versionId) => onImportSuccess?.(versionId)}
          />
        )}
      </div>
    </div>
  );
}
