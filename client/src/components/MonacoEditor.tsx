import { useEffect, useRef, useState } from "react";
import { Code2, Eye, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MonacoEditorProps {
  initialHtml?: string;
  initialCss?: string;
  initialJs?: string;
  onChange?: (html: string, css: string, js: string) => void;
}

type FileTab = "html" | "css" | "js";

const FILE_LABELS: Record<FileTab, string> = {
  html: "index.html",
  css: "style.css",
  js: "script.js",
};

const PLACEHOLDER: Record<FileTab, string> = {
  html: "<!-- Votre HTML ici -->",
  css: "/* Votre CSS ici */",
  js: "// Votre JavaScript ici",
};

export default function CodeEditorPanel({
  initialHtml = "",
  initialCss = "",
  initialJs = "",
  onChange,
}: MonacoEditorProps) {
  const [activeTab, setActiveTab] = useState<FileTab>("html");
  const [html, setHtml] = useState(initialHtml);
  const [css, setCss] = useState(initialCss);
  const [js, setJs] = useState(initialJs);
  const [previewSrc, setPreviewSrc] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUrlRef = useRef<string>("");

  // Sync with parent when version changes (key prop forces remount)
  useEffect(() => {
    setHtml(initialHtml);
    setCss(initialCss);
    setJs(initialJs);
  }, [initialHtml, initialCss, initialJs]);

  // Debounced preview update
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      buildPreview(html, css, js);
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [html, css, js]);

  const buildPreview = (h: string, c: string, j: string) => {
    // Revoke previous blob URL
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);

    // Build a standalone HTML document injecting CSS and JS
    const fullHtml = h
      ? h
          .replace(/<\/head>/i, `<style>${c}</style></head>`)
          .replace(/<\/body>/i, `<script>${j}<\/script></body>`)
      : `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${c}</style></head><body><script>${j}<\/script></body></html>`;

    const blob = new Blob([fullHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    prevUrlRef.current = url;
    setPreviewSrc(url);
  };

  const getValue = (): string => {
    if (activeTab === "html") return html;
    if (activeTab === "css") return css;
    return js;
  };

  const setValue = (val: string) => {
    if (activeTab === "html") setHtml(val);
    else if (activeTab === "css") setCss(val);
    else setJs(val);
    if (onChange) onChange(
      activeTab === "html" ? val : html,
      activeTab === "css" ? val : css,
      activeTab === "js" ? val : js,
    );
  };

  const handleSave = () => {
    if (onChange) onChange(html, css, js);
    toast.success("Code sauvegardé");
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0">
        {(["html", "css", "js"] as FileTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
              activeTab === tab
                ? "bg-[#1e1e1e] text-white border border-[#3c3c3c] border-b-[#1e1e1e]"
                : "text-[#858585] hover:text-white hover:bg-[#2a2d2e]"
            }`}
          >
            <Code2 className="w-3 h-3" />
            {FILE_LABELS[tab]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className={`h-7 px-2 text-xs gap-1 ${showPreview ? "text-primary" : "text-[#858585]"}`}
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="w-3 h-3" />
            <span className="hidden sm:inline">Preview</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-[#858585] hover:text-white"
            onClick={handleSave}
          >
            <Save className="w-3 h-3" />
            <span className="hidden sm:inline">Sauvegarder</span>
          </Button>
        </div>
      </div>

      {/* Editor + Preview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Textarea editor */}
        <div className={`flex flex-col ${showPreview ? "w-1/2" : "w-full"} overflow-hidden`}>
          <textarea
            key={`${activeTab}-${initialHtml.length}`}
            value={getValue()}
            onChange={(e) => setValue(e.target.value)}
            placeholder={PLACEHOLDER[activeTab]}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="flex-1 w-full h-full resize-none bg-[#1e1e1e] text-[#d4d4d4] font-mono text-xs leading-5 p-4 outline-none border-0 focus:ring-0"
            style={{
              fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace",
              tabSize: 2,
            }}
            onKeyDown={(e) => {
              // Tab key inserts spaces
              if (e.key === "Tab") {
                e.preventDefault();
                const start = e.currentTarget.selectionStart;
                const end = e.currentTarget.selectionEnd;
                const val = e.currentTarget.value;
                const newVal = val.substring(0, start) + "  " + val.substring(end);
                setValue(newVal);
                // Restore cursor position after React re-render
                requestAnimationFrame(() => {
                  e.currentTarget.selectionStart = start + 2;
                  e.currentTarget.selectionEnd = start + 2;
                });
              }
              // Ctrl+S saves
              if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        </div>

        {/* Live preview iframe */}
        {showPreview && (
          <div className="w-1/2 flex flex-col border-l border-[#3c3c3c]">
            <div className="h-7 bg-[#252526] flex items-center px-3 flex-shrink-0">
              <span className="text-[10px] text-[#858585]">Prévisualisation live</span>
              <span className="ml-2 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            </div>
            <iframe
              src={previewSrc || "about:blank"}
              className="flex-1 border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
              title="Preview"
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="h-5 bg-[#007acc] flex items-center px-3 gap-4 flex-shrink-0">
        <span className="text-[10px] text-white/80">{FILE_LABELS[activeTab]}</span>
        <span className="text-[10px] text-white/60">{getValue().split("\n").length} lignes</span>
        <span className="text-[10px] text-white/60">{getValue().length} caractères</span>
      </div>
    </div>
  );
}
