import { useEffect, useRef, useState, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Copy, Loader2, Code2, FileCode, FileType, FileText } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileTab = {
  id: "html" | "css" | "js";
  label: string;
  icon: React.ElementType;
  language: () => any;
  placeholder: string;
};

const FILE_TABS: FileTab[] = [
  {
    id: "html",
    label: "index.html",
    icon: FileCode,
    language: html,
    placeholder: "<!-- Votre code HTML ici -->",
  },
  {
    id: "css",
    label: "style.css",
    icon: FileType,
    language: css,
    placeholder: "/* Votre CSS ici */",
  },
  {
    id: "js",
    label: "script.js",
    icon: FileText,
    language: javascript,
    placeholder: "// Votre JavaScript ici",
  },
];

// ─── Custom CodeMirror theme extension ────────────────────────────────────────

const customTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  },
  ".cm-scroller": {
    overflow: "auto",
    height: "100%",
  },
  ".cm-content": {
    padding: "12px 0",
    minHeight: "100%",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    backgroundColor: "#0d0d0d",
    borderRight: "1px solid #1e1e1e",
    color: "#4a4a4a",
    minWidth: "42px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#1a1a1a",
  },
  ".cm-activeLine": {
    backgroundColor: "#1a1a1a80",
  },
  ".cm-selectionBackground": {
    backgroundColor: "#264f78 !important",
  },
  ".cm-focused .cm-selectionBackground": {
    backgroundColor: "#264f78 !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#6366f1",
    borderLeftWidth: "2px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "#6366f130",
    outline: "1px solid #6366f160",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

// ─── Props ────────────────────────────────────────────────────────────────────

interface CodeEditorProps {
  /** Full HTML code (may contain embedded <style> and <script>) */
  code: string;
  onSave: (code: string) => void;
  isSaving?: boolean;
  readOnly?: boolean;
}

// ─── Helper: extract sections from a single HTML file ─────────────────────────

function extractSections(fullHtml: string): { html: string; css: string; js: string } {
  // Extract <style> content
  const styleMatch = fullHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const cssContent = styleMatch ? styleMatch[1].trim() : "";

  // Extract <script> content (last inline script, not src)
  const scriptMatches = Array.from(fullHtml.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi));
  const jsContent = scriptMatches.length > 0 ? scriptMatches[scriptMatches.length - 1][1].trim() : "";

  // HTML = full file (user edits the whole thing in html tab)
  return { html: fullHtml, css: cssContent, js: jsContent };
}

// ─── Helper: rebuild HTML from sections ───────────────────────────────────────

function rebuildHtml(htmlBase: string, css: string, js: string): string {
  // If css tab was edited, inject back into <style>
  let result = htmlBase;

  if (css) {
    if (/<style[^>]*>/i.test(result)) {
      result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/i, `<style>\n${css}\n</style>`);
    } else {
      result = result.replace("</head>", `  <style>\n${css}\n  </style>\n</head>`);
    }
  }

  if (js) {
    // Replace last inline script
    const scriptRegex = /<script(?![^>]*src)[^>]*>[\s\S]*?<\/script>/gi;
    const matches = Array.from(result.matchAll(scriptRegex));
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      result = result.slice(0, last.index!) + `<script>\n${js}\n</script>` + result.slice(last.index! + last[0].length);
    } else {
      result = result.replace("</body>", `  <script>\n${js}\n  </script>\n</body>`);
    }
  }

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CodeEditor({ code, onSave, isSaving = false, readOnly = false }: CodeEditorProps) {
  const [activeTab, setActiveTab] = useState<"html" | "css" | "js">("html");
  const [sections, setSections] = useState(() => extractSections(code));
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Re-parse when code prop changes (new version selected)
  useEffect(() => {
    const parsed = extractSections(code);
    setSections(parsed);
    setIsDirty(false);
  }, [code]);

  // Build CodeMirror editor
  useEffect(() => {
    if (!editorRef.current) return;

    const tab = FILE_TABS.find((t) => t.id === activeTab)!;
    const content = sections[activeTab] || "";

    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const extensions = [
      basicSetup,
      oneDark,
      customTheme,
      tab.language(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newContent = update.state.doc.toString();
          setSections((prev) => ({ ...prev, [activeTab]: newContent }));
          setIsDirty(true);
        }
      }),
    ];

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, readOnly]);

  // Update editor content when sections change externally (tab switch)
  useEffect(() => {
    if (!viewRef.current) return;
    const current = viewRef.current.state.doc.toString();
    const next = sections[activeTab] || "";
    if (current !== next) {
      viewRef.current.dispatch({
        changes: { from: 0, to: current.length, insert: next },
      });
    }
  }, [activeTab, sections]);

  const handleSave = useCallback(() => {
    const rebuilt = rebuildHtml(sections.html, sections.css, sections.js);
    onSave(rebuilt);
    setIsDirty(false);
  }, [sections, onSave]);

  const handleCopy = useCallback(() => {
    const content = sections[activeTab] || "";
    navigator.clipboard.writeText(content);
    toast.success("Code copié !");
  }, [sections, activeTab]);

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (!readOnly && isDirty) handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, readOnly, isDirty]);

  const currentTab = FILE_TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] rounded-lg overflow-hidden border border-border/40">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e1e1e] flex-shrink-0 bg-[#111111]">
        {/* File tabs */}
        <div className="flex items-center gap-0.5">
          {FILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-t transition-colors ${
                  isActive
                    ? "bg-[#1e1e1e] text-[#e2e8f0] border-b-2 border-[#6366f1]"
                    : "text-[#6b7280] hover:text-[#9ca3af] hover:bg-[#1a1a1a]"
                }`}
              >
                <Icon className="w-3 h-3" />
                {tab.label}
                {isDirty && isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#6366f1] ml-0.5" />
                )}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {isDirty && !readOnly && (
            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30 py-0 px-1.5">
              Non sauvegardé
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] text-[#9ca3af] hover:text-[#e2e8f0] px-2"
            onClick={handleCopy}
          >
            <Copy className="w-3 h-3 mr-1" />
            Copier
          </Button>
          {!readOnly && (
            <Button
              size="sm"
              className="h-6 text-[11px] bg-[#6366f1] hover:bg-[#5558e3] text-white px-2"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
            >
              {isSaving ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Save className="w-3 h-3 mr-1" />
              )}
              {isDirty ? "Sauvegarder" : "Sauvegardé"}
            </Button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1 bg-[#0d0d0d] border-b border-[#1a1a1a] flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Code2 className="w-3 h-3 text-[#6366f1]" />
          <span className="text-[10px] text-[#6b7280] font-mono">{currentTab.label}</span>
        </div>
        <span className="text-[10px] text-[#4a4a4a]">
          {(sections[activeTab] || "").split("\n").length} lignes
        </span>
        {readOnly && (
          <Badge variant="outline" className="text-[10px] text-[#6b7280] border-[#2a2a2a] py-0 px-1.5 ml-auto">
            Lecture seule
          </Badge>
        )}
        {!readOnly && (
          <span className="text-[10px] text-[#4a4a4a] ml-auto">Ctrl+S pour sauvegarder</span>
        )}
      </div>

      {/* CodeMirror editor */}
      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
