import { useState, useRef, useCallback } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload, FileArchive, FileCode, CheckCircle2, Loader2,
  AlertCircle, FolderOpen, Code2, ClipboardPaste, X
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface ImportProjectPanelProps {
  projectId: number;
  onImportSuccess: (versionId: number) => void;
}

interface ParsedFiles {
  html: string;
  css: string;
  js: string;
  extraFiles: { name: string; size: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mergeIntoHtml(files: ParsedFiles): string {
  let html = files.html || "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"UTF-8\">\n<title>Mon site</title>\n</head>\n<body>\n</body>\n</html>";

  // Inject CSS if separate
  if (files.css && !html.includes("<style>")) {
    html = html.replace("</head>", `  <style>\n${files.css}\n  </style>\n</head>`);
  } else if (files.css) {
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/i, `<style>\n${files.css}\n</style>`);
  }

  // Inject JS if separate
  if (files.js && !html.includes("<script>")) {
    html = html.replace("</body>", `  <script>\n${files.js}\n  </script>\n</body>`);
  } else if (files.js) {
    html = html.replace(/<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/i, `<script>\n${files.js}\n</script>`);
  }

  return html;
}

async function parseZip(file: File): Promise<ParsedFiles> {
  const zip = new JSZip();
  const loaded = await zip.loadAsync(file);

  const result: ParsedFiles = { html: "", css: "", js: "", extraFiles: [] };

  const entries = Object.entries(loaded.files).filter(([, f]) => !f.dir);

  for (const [name, zipFile] of entries) {
    const basename = name.split("/").pop()?.toLowerCase() || "";
    const content = await zipFile.async("string");

    if (basename.endsWith(".html") || basename.endsWith(".htm")) {
      // Prefer index.html, otherwise take first html
      if (!result.html || basename === "index.html") {
        result.html = content;
      }
    } else if (basename.endsWith(".css") && !result.css) {
      result.css = content;
    } else if (basename.endsWith(".js") && !basename.includes(".min.") && !result.js) {
      result.js = content;
    } else {
      result.extraFiles.push({ name: basename, size: content.length });
    }
  }

  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportProjectPanel({ projectId, onImportSuccess }: ImportProjectPanelProps) {
  const [mode, setMode] = useState<"zip" | "files" | "paste">("zip");
  const [isDragging, setIsDragging] = useState(false);
  const [parsedFiles, setParsedFiles] = useState<ParsedFiles | null>(null);
  const [pasteCode, setPasteCode] = useState("");
  const [separateFiles, setSeparateFiles] = useState<{ html: string; css: string; js: string }>({ html: "", css: "", js: "" });
  const [isProcessing, setIsProcessing] = useState(false);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const cssInputRef = useRef<HTMLInputElement>(null);
  const jsInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const importCode = trpc.deploy.importCode.useMutation({
    onSuccess: (data) => {
      toast.success("Projet importé avec succès !");
      utils.projects.getVersions.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
      onImportSuccess(data.versionId);
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    await processZipFile(file);
  }, []);

  const processZipFile = async (file: File) => {
    if (!file.name.endsWith(".zip")) {
      toast.error("Veuillez sélectionner un fichier ZIP");
      return;
    }
    setIsProcessing(true);
    try {
      const parsed = await parseZip(file);
      if (!parsed.html) {
        toast.error("Aucun fichier HTML trouvé dans le ZIP");
        return;
      }
      setParsedFiles(parsed);
      toast.success(`ZIP analysé : ${parsed.extraFiles.length + (parsed.html ? 1 : 0) + (parsed.css ? 1 : 0) + (parsed.js ? 1 : 0)} fichier(s) trouvé(s)`);
    } catch {
      toast.error("Impossible de lire le fichier ZIP");
    } finally {
      setIsProcessing(false);
    }
  };

  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });

  const handleSeparateFile = async (type: "html" | "css" | "js", file: File) => {
    const content = await readFileAsText(file);
    setSeparateFiles((prev) => ({ ...prev, [type]: content }));
    toast.success(`${file.name} chargé`);
  };

  // ── Import action ────────────────────────────────────────────────────────────

  const handleImport = () => {
    let finalCode = "";

    if (mode === "zip" && parsedFiles) {
      finalCode = mergeIntoHtml(parsedFiles);
    } else if (mode === "files") {
      if (!separateFiles.html) {
        toast.error("Veuillez au moins charger un fichier HTML");
        return;
      }
      finalCode = mergeIntoHtml({ ...separateFiles, extraFiles: [] });
    } else if (mode === "paste") {
      if (!pasteCode.trim()) {
        toast.error("Collez du code HTML");
        return;
      }
      finalCode = pasteCode.trim();
    }

    if (!finalCode) return;

    importCode.mutate({ projectId, htmlContent: finalCode, label: "Import externe" });
  };

  const isReady = () => {
    if (mode === "zip") return !!parsedFiles?.html;
    if (mode === "files") return !!separateFiles.html;
    if (mode === "paste") return pasteCode.trim().length > 0;
    return false;
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Importer un projet</h3>
        <p className="text-xs text-muted-foreground">
          Importez un site existant depuis un ZIP, des fichiers séparés, ou en collant du code.
        </p>
      </div>

      <Tabs value={mode} onValueChange={(v) => { setMode(v as any); setParsedFiles(null); }}>
        <TabsList className="w-full bg-muted/30 h-8">
          <TabsTrigger value="zip" className="flex-1 text-xs h-7 gap-1">
            <FileArchive className="w-3 h-3" /> ZIP
          </TabsTrigger>
          <TabsTrigger value="files" className="flex-1 text-xs h-7 gap-1">
            <FolderOpen className="w-3 h-3" /> Fichiers
          </TabsTrigger>
          <TabsTrigger value="paste" className="flex-1 text-xs h-7 gap-1">
            <ClipboardPaste className="w-3 h-3" /> Coller
          </TabsTrigger>
        </TabsList>

        {/* ZIP mode */}
        <TabsContent value="zip" className="mt-3">
          {!parsedFiles ? (
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border/60 hover:border-primary/40 hover:bg-primary/5"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => zipInputRef.current?.click()}
            >
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && processZipFile(e.target.files[0])}
              />
              {isProcessing ? (
                <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
              ) : (
                <FileArchive className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              )}
              <p className="text-sm font-medium text-foreground mb-1">
                {isProcessing ? "Analyse en cours…" : "Glissez votre ZIP ici"}
              </p>
              <p className="text-xs text-muted-foreground">
                ou cliquez pour parcourir · index.html + style.css + script.js
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-400">ZIP analysé avec succès</span>
                </div>
                <div className="space-y-1">
                  {parsedFiles.html && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileCode className="w-3 h-3 text-orange-400" />
                      <span>index.html</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1">HTML</Badge>
                    </div>
                  )}
                  {parsedFiles.css && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileCode className="w-3 h-3 text-blue-400" />
                      <span>style.css</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1">CSS</Badge>
                    </div>
                  )}
                  {parsedFiles.js && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileCode className="w-3 h-3 text-yellow-400" />
                      <span>script.js</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1">JS</Badge>
                    </div>
                  )}
                  {parsedFiles.extraFiles.map((f) => (
                    <div key={f.name} className="flex items-center gap-2 text-xs text-muted-foreground/60">
                      <FileCode className="w-3 h-3" />
                      <span>{f.name}</span>
                      <span className="ml-auto">{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => { setParsedFiles(null); }}
              >
                <X className="w-3 h-3 mr-1" /> Changer de fichier
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Separate files mode */}
        <TabsContent value="files" className="mt-3 space-y-3">
          {(["html", "css", "js"] as const).map((type) => {
            const refs = { html: htmlInputRef, css: cssInputRef, js: jsInputRef };
            const colors = { html: "text-orange-400", css: "text-blue-400", js: "text-yellow-400" };
            const labels = { html: "index.html *", css: "style.css", js: "script.js" };
            const accepts = { html: ".html,.htm", css: ".css", js: ".js" };

            return (
              <div key={type}>
                <input
                  ref={refs[type]}
                  type="file"
                  accept={accepts[type]}
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleSeparateFile(type, e.target.files[0])}
                />
                <button
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                    separateFiles[type]
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border/60 hover:border-primary/40 hover:bg-primary/5"
                  }`}
                  onClick={() => refs[type].current?.click()}
                >
                  <FileCode className={`w-4 h-4 flex-shrink-0 ${colors[type]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{labels[type]}</p>
                    {separateFiles[type] ? (
                      <p className="text-[10px] text-emerald-400">
                        {separateFiles[type].split("\n").length} lignes chargées
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">Cliquez pour sélectionner</p>
                    )}
                  </div>
                  {separateFiles[type] ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <Upload className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  )}
                </button>
              </div>
            );
          })}
        </TabsContent>

        {/* Paste mode */}
        <TabsContent value="paste" className="mt-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Code2 className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs text-muted-foreground">Collez votre code HTML complet</span>
            </div>
            <Textarea
              value={pasteCode}
              onChange={(e) => setPasteCode(e.target.value)}
              placeholder={"<!DOCTYPE html>\n<html>\n  <head>…</head>\n  <body>…</body>\n</html>"}
              className="font-mono text-xs bg-[#0d0d0d] text-[#e2e8f0] border-border/40 resize-none h-48 leading-relaxed"
              spellCheck={false}
            />
            {pasteCode.trim() && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                {pasteCode.split("\n").length} lignes · {formatBytes(pasteCode.length)}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Import button */}
      <div className="pt-2 border-t border-border/40">
        {!isReady() && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <AlertCircle className="w-3.5 h-3.5" />
            {mode === "zip" && "Sélectionnez un fichier ZIP contenant votre site"}
            {mode === "files" && "Chargez au moins un fichier HTML"}
            {mode === "paste" && "Collez votre code HTML"}
          </div>
        )}
        <Button
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={handleImport}
          disabled={!isReady() || importCode.isPending}
        >
          {importCode.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />Import en cours…</>
          ) : (
            <><Upload className="w-4 h-4 mr-2" />Importer le projet</>
          )}
        </Button>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          L'import crée une nouvelle version éditable par l'IA
        </p>
      </div>
    </div>
  );
}
