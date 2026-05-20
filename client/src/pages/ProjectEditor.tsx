import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import AppLayout from "@/components/AppLayout";
import {
  Sparkles, Send, Eye, Code2, History, Smartphone, Tablet, Monitor,
  Loader2, ArrowLeft, Globe, RotateCcw, Save, CheckCircle2, MessageSquare,
  Rocket, Share2, Tag, MousePointer2, Copy, Check, PencilRuler, Upload,
  PanelLeftClose, PanelLeftOpen
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Streamdown } from "streamdown";
import DeployPanel from "@/components/DeployPanel";
import ImportProjectPanel from "@/components/ImportProjectPanel";

/* ── helpers ─────────────────────────────────────────────── */
const SITE_TYPES = ["Landing page", "Site vitrine", "Portfolio", "Restaurant", "Artisan", "Agence", "SaaS", "E-commerce simple"];
const STYLES = ["Moderne", "Minimaliste", "Luxe", "Corporate", "Startup", "Premium"];
const COLORS = ["Bleu/Violet", "Vert/Émeraude", "Orange/Ambre", "Rose/Rouge", "Gris/Noir", "Multicolore"];
const PROMPT_SUGGESTIONS = [
  "Une landing page pour une startup SaaS de gestion de projet",
  "Un site vitrine pour un restaurant gastronomique parisien",
  "Un portfolio créatif pour un photographe",
  "Une page de vente pour un coach en développement personnel",
];

type ViewMode = "desktop" | "tablet" | "mobile";
const VIEW_SIZES: Record<ViewMode, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };
type CodeTab = "html" | "css" | "js";

const extractHtml = (code: string): string => {
  if (!code) return "";
  const m = code.match(/<!-- HTML -->\n([\s\S]*?)(?=<!-- CSS -->|$)/);
  if (m) return m[1].trim();
  return code.trim();
};
const extractCss = (code: string): string => {
  if (!code) return "";
  const m = code.match(/<!-- CSS -->\n([\s\S]*?)(?=<!-- JS -->|$)/);
  if (m) return m[1].trim();
  const all = Array.from(code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi));
  return all.map(x => x[1]).join("\n").trim();
};
const extractJs = (code: string): string => {
  if (!code) return "";
  const m = code.match(/<!-- JS -->\n([\s\S]*?)$/);
  if (m) return m[1].trim();
  const all = Array.from(code.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi));
  return all.map(x => x[1]).join("\n").trim();
};

/* ── component ───────────────────────────────────────────── */
export default function ProjectEditor() {
  const params = useParams<{ id: string }>();
  const projectId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();

  /* state */
  const [prompt, setPrompt] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("desktop");
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [siteType, setSiteType] = useState("Landing page");
  const [style, setStyle] = useState("Moderne");
  const [language, setLanguage] = useState("fr");
  const [colorPalette, setColorPalette] = useState("Bleu/Violet");
  const [restoreTarget, setRestoreTarget] = useState<{ versionId: number; label: string } | null>(null);
  const [codeTab, setCodeTab] = useState<CodeTab>("html");
  const [inspectMode, setInspectMode] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [visualEditMode, setVisualEditMode] = useState(false);
  const [showImport, setShowImport] = useState(false);
  /* sidebar tab (mobile) */
  const [sideTab, setSideTab] = useState<"versions" | "deploy">("versions");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [streamingTokens, setStreamingTokens] = useState(0);
  const [streamingChars, setStreamingChars] = useState(0);
  const [copiedTab, setCopiedTab] = useState<CodeTab | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const [editorCollapsed, setEditorCollapsed] = useState(false);

  /* visual edit state */
  const [veSelection, setVeSelection] = useState<null | {
    tag: string; isText: boolean; isImage: boolean; isBlock: boolean;
    rect: { top: number; left: number; width: number; height: number };
    color: string; backgroundColor: string; fontSize: string; fontWeight: string; textAlign: string;
  }>(null);
  const veOriginalHtmlRef = useRef<string>("");
  const [veDirty, setVeDirty] = useState(false);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const veUrlRef = useRef<string>("");
  const [vePreviewSrc, setVePreviewSrc] = useState("");

  /* code state (editable) */
  const [htmlCode, setHtmlCode] = useState("");
  const [cssCode, setCssCode] = useState("");
  const [jsCode, setJsCode] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  /* queries */
  const utils = trpc.useUtils();
  const { data: project, isLoading: projectLoading } = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId });
  const { data: versions } = trpc.projects.getVersions.useQuery({ projectId }, { enabled: !!projectId });
  const { data: chatMessages } = trpc.projects.getChatMessages.useQuery({ projectId }, { enabled: !!projectId });
  const { data: currentVersionData } = trpc.projects.getVersionCode.useQuery(
    { versionId: selectedVersionId || project?.currentVersionId || 0 },
    { enabled: !!(selectedVersionId || project?.currentVersionId) }
  );

  /* sync version → code state */
  useEffect(() => {
    if (project?.currentVersionId && !selectedVersionId) setSelectedVersionId(project.currentVersionId);
  }, [project?.currentVersionId]);

  useEffect(() => {
    if (currentVersionData?.generatedCode) {
      setHtmlCode(extractHtml(currentVersionData.generatedCode));
      setCssCode(extractCss(currentVersionData.generatedCode));
      setJsCode(extractJs(currentVersionData.generatedCode));
    }
  }, [currentVersionData?.generatedCode]);

  // Scroll vers le dernier message — déclenché à chaque changement de messages ou de panels
  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);
  useEffect(() => {
    if (!chatMessages || chatMessages.length === 0) return;
    // Plusieurs délais pour couvrir le rendu initial (Streamdown, images, etc.)
    scrollToBottom();
    const t1 = setTimeout(scrollToBottom, 100);
    const t2 = setTimeout(scrollToBottom, 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [chatMessages, showVersions, scrollToBottom]);

  /* preview blob URL */
  const [previewSrc, setPreviewSrc] = useState("");
  const prevUrlRef = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildPreview = useCallback((h: string, c: string, j: string) => {
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    let full: string;
    // If h is a complete HTML document (imported), use it as-is with minimal additions
    const isFullDoc = /<!doctype|<html[\s>]/i.test(h);
    if (isFullDoc) {
      full = h;
      // Only add viewport if missing
      if (!h.includes('name="viewport"') && !h.includes("name='viewport'")) {
        full = full.replace(/<head>/i, `<head>${viewportMeta}`);
      }
      // Only add extra CSS/JS if not already present in the document
      if (c && !/<style/i.test(h)) full = full.replace(/<\/head>/i, `<style>${c}</style></head>`);
      if (j && !/<script/i.test(h)) full = full.replace(/<\/body>/i, `<script>${j}<\/script></body>`);
    } else if (h) {
      full = h
        .replace(/<head>/i, `<head>${viewportMeta}`)
        .replace(/<\/head>/i, `<style>${c}</style></head>`)
        .replace(/<\/body>/i, `<script>${j}<\/script></body>`);
    } else {
      full = `<!DOCTYPE html><html><head>${viewportMeta}<meta charset="UTF-8"><style>${c}</style></head><body><script>${j}<\/script></body></html>`;
    }
    const blob = new Blob([full], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    prevUrlRef.current = url;
    setPreviewSrc(url);
  }, []);

  useEffect(() => {
    if (!htmlCode && !cssCode && !jsCode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => buildPreview(htmlCode, cssCode, jsCode), 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [htmlCode, cssCode, jsCode, buildPreview]);

  /* also update preview when version data arrives (from server) */
  useEffect(() => {
    const code = currentVersionData?.generatedCode;
    if (code) buildPreview(extractHtml(code), extractCss(code), extractJs(code));
  }, [currentVersionData?.generatedCode]);

  /* ── Streaming generate ── */
  const [streamingCode, setStreamingCode] = useState("");
  const [isChatPending, setIsChatPending] = useState(false);

  const generateSiteStream = useCallback(async () => {
    if (!prompt.trim()) { toast.error("Décrivez votre site d'abord."); return; }
    setIsGenerating(true);
    setStreamingCode("");
    setHtmlCode("");
    setCssCode("");
    setJsCode("");
    let accumulated = "";
    try {
      const res = await fetch("/api/stream/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId, prompt, siteType, style, language, colorPalette }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.text !== undefined) {
                accumulated += evt.text;
                setStreamingCode(accumulated);
                setStreamingChars(accumulated.length);
                // Live update editor tabs
                setHtmlCode(extractHtml(accumulated));
                setCssCode(extractCss(accumulated));
                setJsCode(extractJs(accumulated));
              }
              if (evt.versionId) {
                setSelectedVersionId(evt.versionId);
                setStreamingTokens(evt.tokensUsed || 0);
                toast.success(`Site généré ! ${evt.tokensUsed} tokens.`);
                utils.projects.getVersions.invalidate({ projectId });
                utils.projects.get.invalidate({ id: projectId });
                utils.user.getUsageStats.invalidate();
              }
              if (evt.message) toast.error(evt.message);
            } catch { /* skip */ }
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsGenerating(false);
      setStreamingChars(0);
    }
  }, [projectId, prompt, siteType, style, language, colorPalette]);

  /* Keep tRPC mutation as fallback (unused but keeps types happy) */
  const generateSite = trpc.projects.generate.useMutation({ onError: (err: any) => toast.error(err.message) });

  /* ── Streaming chat ── */
  const sendChatStream = useCallback(async (msg: string) => {
    if (!msg.trim()) return;
    setIsChatPending(true);
    setStreamingReply("");
    setChatMessage("");
    // Optimistically add user message to local cache
    utils.projects.getChatMessages.setData({ projectId }, (old: any) => [
      ...(old || []),
      { id: Date.now(), role: "user", content: msg, createdAt: new Date().toISOString(), projectId, userId: 0, versionId: null, tokensUsed: null },
    ]);
    try {
      const res = await fetch("/api/stream/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId, message: msg }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let accJson = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.text !== undefined) {
                accJson += evt.text;
                const m = accJson.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                if (m) setStreamingReply(m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
              }
              if (evt.versionId) {
                setSelectedVersionId(evt.versionId);
                toast.success("Site modifié !");
              }
              if (evt.reply !== undefined) {
                // Final done event — clear streaming bubble, refresh messages
                setStreamingReply("");
                utils.projects.getChatMessages.invalidate({ projectId });
                utils.projects.getVersions.invalidate({ projectId });
                utils.projects.get.invalidate({ id: projectId });
                // If code was modified, update editor immediately
                if (evt.generatedCode) {
                  setHtmlCode(extractHtml(evt.generatedCode));
                  setCssCode(extractCss(evt.generatedCode));
                  setJsCode(extractJs(evt.generatedCode));
                }
              }
              if (evt.message) toast.error(evt.message);
            } catch { /* skip */ }
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setStreamingReply("");
      setIsChatPending(false);
    }
  }, [projectId]);

  /* chatEdit kept for type compatibility */
  const chatEdit = { isPending: isChatPending, mutate: (args: any) => sendChatStream(args.message) };

  const restoreVersion = trpc.projects.restoreVersion.useMutation({
    onSuccess: (_, vars) => {
      toast.success("Version restaurée !");
      setSelectedVersionId(vars.versionId);
      setRestoreTarget(null);
      utils.projects.get.invalidate({ id: projectId });
      utils.projects.getVersions.invalidate({ projectId });
    },
    onError: (err: any) => { toast.error(err.message); setRestoreTarget(null); },
  });

  const updateCode = trpc.projects.updateCode.useMutation({
    onSuccess: () => toast.success("Code sauvegardé"),
    onError: (err: any) => toast.error(err.message),
  });

  const sendToIframe = useCallback((msg: object) => {
    previewRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  const deployProject = trpc.deploy.deploy.useMutation({
    onSuccess: (data) => {
      toast.success("Site déployé en ligne !", { duration: 6000,
        action: { label: "Voir le site", onClick: () => window.open(data.deployedUrl, "_blank") }
      });
      utils.projects.get.invalidate({ id: projectId });
      utils.deploy.getDeployInfo.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(err.message),
  });

  /* inspect: listen to messages from iframe */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "INSPECT_ELEMENT" && e.data.tag) {
        const tag = e.data.tag.toLowerCase();
        const fullCode = codeTab === "html" ? htmlCode : codeTab === "css" ? cssCode : jsCode;
        const lines = fullCode.split("\n");
        const idx = lines.findIndex(l => l.toLowerCase().includes(`<${tag}`));
        if (idx >= 0) {
          setHighlightLine(idx);
          // scroll textarea to line
          if (textareaRef.current) {
            const lineH = 20;
            textareaRef.current.scrollTop = Math.max(0, (idx - 3) * lineH);
          }
          setTimeout(() => setHighlightLine(null), 2000);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [codeTab, htmlCode, cssCode, jsCode]);

  /* visual edit: listen for messages from iframe */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "VISUAL_EDIT_UPDATE" && e.data.html) {
        const updatedHtml = e.data.html as string;
        setHtmlCode(extractHtml(updatedHtml) || updatedHtml);
      }
      if (e.data?.type === "VE_SELECT") {
        setVeSelection({
          tag: e.data.tag,
          isText: e.data.isText,
          isImage: e.data.isImage,
          isBlock: e.data.isBlock,
          rect: e.data.rect,
          color: e.data.computedStyle?.color || "",
          backgroundColor: e.data.computedStyle?.backgroundColor || "",
          fontSize: e.data.computedStyle?.fontSize || "",
          fontWeight: e.data.computedStyle?.fontWeight || "",
          textAlign: e.data.computedStyle?.textAlign || "",
        });
      }
      if (e.data?.type === "VE_HTML_UPDATE") {
        setHtmlCode(e.data.html);
        setVeDirty(true);
      }
      if (e.data?.type === "VE_DESELECT") {
        setVeSelection(null);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const VISUAL_EDIT_SCRIPT = `<script id="__ve__">
(function(){
  var sel=null,deb=null;

  /* VE styles — marked with id for cleanup */
  var vs=document.createElement('style');
  vs.id='__ve_s__';
  vs.textContent='[data-veh]{outline:2px dashed rgba(99,102,241,.5)!important;cursor:pointer!important}[data-ves]{outline:2px solid #6366f1!important}';
  document.head.appendChild(vs);

  /* Returns outerHTML stripped of ALL VE artifacts */
  function cleanHtml(){
    var h=document.documentElement.outerHTML;
    h=h.replace(/<script[^>]*id="__ve__"[^>]*>[\\s\\S]*?<\\/script>/i,'');
    h=h.replace(/<style[^>]*id="__ve_s__"[^>]*>[\\s\\S]*?<\\/style>/i,'');
    h=h.replace(/\\s*data-ve[hs]="[^"]*"/g,'');
    h=h.replace(/\\s*contenteditable="[^"]*"/g,'');
    return h;
  }

  function push(){
    clearTimeout(deb);
    deb=setTimeout(function(){
      window.parent.postMessage({type:'VE_HTML_UPDATE',html:cleanHtml()},'*');
    },300);
  }

  function computedProps(el){
    var cs=window.getComputedStyle(el);
    return {color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,textAlign:cs.textAlign};
  }

  function selectEl(el){
    if(sel){sel.removeAttribute('data-ves');if(sel.contentEditable==='true')sel.contentEditable='false';}
    if(!el||el===document.body||el===document.documentElement||!el.tagName){
      sel=null;window.parent.postMessage({type:'VE_DESELECT'},'*');return;
    }
    sel=el;el.setAttribute('data-ves','1');
    var r=el.getBoundingClientRect();
    var tag=el.tagName;
    window.parent.postMessage({
      type:'VE_SELECT',tag:tag,
      isText:['H1','H2','H3','H4','H5','H6','P','SPAN','A','LI','BUTTON','LABEL','STRONG','EM','B','I','TD','TH','DIV'].indexOf(tag)>=0,
      isImage:tag==='IMG',
      isBlock:['DIV','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','NAV','FIGURE'].indexOf(tag)>=0,
      rect:{top:r.top+window.scrollY,left:r.left+window.scrollX,width:r.width,height:r.height},
      computedStyle:computedProps(el)
    },'*');
  }

  document.addEventListener('mouseover',function(e){
    var t=e.target;if(t&&t.setAttribute&&t!==document.body&&t!==document.documentElement)t.setAttribute('data-veh','1');
  },true);
  document.addEventListener('mouseout',function(e){
    var t=e.target;if(t&&t.removeAttribute)t.removeAttribute('data-veh');
  },true);

  document.addEventListener('click',function(e){
    e.preventDefault();e.stopPropagation();
    if(e.target&&e.target.tagName)selectEl(e.target);
  },true);

  document.addEventListener('dblclick',function(e){
    var el=e.target;
    if(!el||!el.tagName)return;
    if(['H1','H2','H3','H4','H5','H6','P','SPAN','A','LI','BUTTON','LABEL','STRONG','EM','B','I','TD','TH'].indexOf(el.tagName)>=0){
      e.preventDefault();e.stopPropagation();
      el.contentEditable='true';el.focus();
      try{var rng=document.createRange();rng.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(rng);}catch(ex){}
    }
  },true);

  document.addEventListener('input',function(){push();});
  window.addEventListener('scroll',function(){window.parent.postMessage({type:'VE_DESELECT'},'*');});

  window.addEventListener('message',function(e){
    if(!e.data||!e.data.type)return;
    if(e.data.type==='VE_STYLE'&&sel){try{sel.style[e.data.prop]=e.data.value;}catch(ex){}push();}
    if(e.data.type==='VE_TEXT'&&sel){sel.innerText=e.data.value;push();}
    if(e.data.type==='VE_IMG_SRC'&&sel&&sel.tagName==='IMG'){sel.src=e.data.value;push();}
  });
})();
<\/script>`;

  /* inject inspect/visual-edit script into preview */
  const getPreviewSrc = () => {
    if (!inspectMode && !visualEditMode) return previewSrc;
    const code = currentVersionData?.generatedCode || "";
    if (!code) return previewSrc;
    let injected = code;
    if (inspectMode) {
      const script = `<script>document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.parent.postMessage({type:'INSPECT_ELEMENT',tag:e.target.tagName,id:e.target.id,cls:e.target.className},'*');},true);<\/script>`;
      injected = injected.replace(/<\/body>/i, `${script}</body>`);
    }
    if (visualEditMode) {
      injected = injected.replace(/<\/body>/i, `${VISUAL_EDIT_SCRIPT}</body>`);
    }
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const blob = new Blob([injected], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    prevUrlRef.current = url;
    return url;
  };

  const hasCode = !!(currentVersionData?.generatedCode);

  /* loading */
  if (authLoading || projectLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) { window.location.href = getLoginUrl(); return null; }

  /* ── RENDER ─────────────────────────────────────────────── */
  return (
    <AppLayout title={project?.name || "Éditeur"}>
      <div className="flex flex-col h-[calc(100vh-4rem)] -mx-4 -my-4 lg:-mx-6 lg:-my-6 overflow-hidden">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-background/80 backdrop-blur-sm flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/projects">
              <Button variant="ghost" size="icon" className="w-8 h-8 flex-shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="font-display font-semibold text-sm truncate max-w-[140px] sm:max-w-xs">{project?.name}</h1>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-xs text-muted-foreground border-border/40">{project?.framework?.toUpperCase() || "HTML"}</Badge>
                {project?.status === "ready" && <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/20"><CheckCircle2 className="w-2.5 h-2.5 mr-1" />Prêt</Badge>}
                {project?.status === "published" && <Badge variant="outline" className="text-xs text-primary border-primary/20"><Globe className="w-2.5 h-2.5 mr-1" />Publié</Badge>}
                {isGenerating && <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/20"><Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />Génération…</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {hasCode && (
              <Button size="sm" variant={visualEditMode ? "default" : "outline"}
                className={`text-xs h-8 px-2 sm:px-3 ${visualEditMode ? "bg-violet-600 hover:bg-violet-700 text-white border-0" : "border-border/60"}`}
                onClick={() => {
                  const next = !visualEditMode;
                  if (next) {
                    // Entering visual edit mode — save original and build blob URL ONCE
                    veOriginalHtmlRef.current = htmlCode;
                    const code = currentVersionData?.generatedCode || "";
                    const base = code ||
                      `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${cssCode}</style></head><body>${htmlCode}</body></html>`;
                    const injected = base.replace(/<\/body>/i, `${VISUAL_EDIT_SCRIPT}</body>`);
                    if (veUrlRef.current) URL.revokeObjectURL(veUrlRef.current);
                    const blob = new Blob([injected], { type: "text/html" });
                    const url = URL.createObjectURL(blob);
                    veUrlRef.current = url;
                    setVePreviewSrc(url);
                  } else {
                    // Exiting without saving — restore original and rebuild regular preview
                    const restoreHtml = veDirty ? veOriginalHtmlRef.current : htmlCode;
                    if (veDirty) {
                      setHtmlCode(restoreHtml);
                      setVeDirty(false);
                    }
                    setVeSelection(null);
                    buildPreview(restoreHtml, cssCode, jsCode);
                  }
                  setVisualEditMode(next);
                  setInspectMode(false);
                }}>
                <PencilRuler className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Éditeur Visuel</span>
              </Button>
            )}
            {hasCode && (
              <Button size="sm"
                className={`text-xs h-8 px-2 sm:px-3 ${project?.isPublished ? "bg-emerald-600 hover:bg-emerald-700 text-white border-0" : "bg-primary hover:bg-primary/90 text-primary-foreground border-0"}`}
                onClick={() => deployProject.mutate({ projectId })}
                disabled={deployProject.isPending}>
                {deployProject.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin sm:mr-1.5" />
                  : <Rocket className="w-3.5 h-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">{project?.isPublished ? "Redéployer" : "Déployer"}</span>
              </Button>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        {!hasCode && !isGenerating ? (
          /* ═══ BUILDER MODE (before first generation) ═══ */
          <div className="flex-1 overflow-y-auto p-4 max-w-2xl mx-auto w-full">
            <div className="space-y-4">
              <div>
                <h2 className="font-display font-semibold text-base mb-1">Décrivez votre site</h2>
                <p className="text-xs text-muted-foreground mb-3">Soyez précis : secteur, public cible, sections souhaitées…</p>
                <Textarea
                  placeholder="Ex: Une landing page pour une startup de livraison de repas sains, avec un hero accrocheur, une section fonctionnalités et un CTA fort..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[120px] bg-input border-border/60 text-sm resize-none"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground font-medium">Suggestions</p>
                {PROMPT_SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => setPrompt(s)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all">
                    {s}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                  <Select value={siteType} onValueChange={setSiteType}>
                    <SelectTrigger className="h-9 text-xs bg-input border-border/60"><SelectValue /></SelectTrigger>
                    <SelectContent>{SITE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Style</label>
                  <Select value={style} onValueChange={setStyle}>
                    <SelectTrigger className="h-9 text-xs bg-input border-border/60"><SelectValue /></SelectTrigger>
                    <SelectContent>{STYLES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Langue</label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="h-9 text-xs bg-input border-border/60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fr" className="text-xs">Français</SelectItem>
                      <SelectItem value="en" className="text-xs">English</SelectItem>
                      <SelectItem value="es" className="text-xs">Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Palette</label>
                  <Select value={colorPalette} onValueChange={setColorPalette}>
                    <SelectTrigger className="h-9 text-xs bg-input border-border/60"><SelectValue /></SelectTrigger>
                    <SelectContent>{COLORS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium gap-2"
                onClick={generateSiteStream}
                disabled={isGenerating || !prompt.trim()}
              >
                {isGenerating ? <><Loader2 className="w-4 h-4 animate-spin" />Génération en cours…</> : <><Sparkles className="w-4 h-4" />Générer le site</>}
              </Button>
            </div>
          </div>
        ) : isGenerating ? (
          /* ═══ GENERATING SPINNER ═══ */
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground animate-pulse">Maria génère votre site…</p>
            {streamingChars > 0 && (
              <div className="flex flex-col items-center gap-2 w-64">
                <div className="w-full h-1.5 bg-border/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (streamingChars / 12000) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground/70 font-mono">{streamingChars.toLocaleString()} caractères générés</span>
              </div>
            )}
          </div>
        ) : (
          /* ═══ EDITOR MODE (3-zone layout) ═══ */
          <div
            className="flex-1 overflow-hidden grid"
            style={{
              gridTemplateColumns: editorCollapsed ? '0px 1fr' : '45% 55%',
              gridTemplateRows: '60% 40%',
              transition: 'grid-template-columns 0.3s cubic-bezier(0.4,0,0.2,1)',
            }}
          >

            {/* ── LEFT PANEL : Code (top) + Chat (bottom) ── */}
            <div
              className="flex flex-col border-r border-border/50 overflow-hidden"
              style={{
                gridColumn: '1', gridRow: '1 / 3',
                display: 'flex', flexDirection: 'column',
                opacity: editorCollapsed ? 0 : 1,
                transition: 'opacity 0.2s ease',
                pointerEvents: editorCollapsed ? 'none' : 'auto',
              }}
            >

              {/* ── Code zone (top-left, 60% height) ── */}
              <div className="flex flex-col border-b border-border/50" style={{ flex: '0 0 60%', minHeight: 0 }}>
                {/* Code toolbar */}
                <div className="flex items-center gap-1 px-2 py-1 bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0">
                  {/* Arborescence : src/ > index.html | assets/ > style.css | assets/ > script.js */}
                  <span className="text-[#858585] text-[10px] mr-1 hidden sm:inline">src/</span>
                  {(["html", "css", "js"] as CodeTab[]).map((tab) => {
                    const folder = tab === "html" ? "" : "assets/";
                    const filename = tab === "html" ? "index.html" : tab === "css" ? "style.css" : "script.js";
                    return (
                      <button key={tab} onClick={() => setCodeTab(tab)}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                          codeTab === tab ? "bg-[#1e1e1e] text-white border border-[#3c3c3c]" : "text-[#858585] hover:text-white hover:bg-[#2a2d2e]"
                        }`}>
                        <Code2 className="w-3 h-3" />
                        <span className="text-[#858585] text-[10px] hidden sm:inline">{folder}</span>{filename}
                      </button>
                    );
                  })}
                       <div className="ml-auto flex items-center gap-1">
                    {/* Copy button */}
                    <Button size="sm" variant="ghost"
                      className="h-6 px-2 text-[10px] gap-1 text-[#858585] hover:text-white"
                      title="Copier le code"
                      onClick={() => {
                        const code = codeTab === "html" ? htmlCode : codeTab === "css" ? cssCode : jsCode;
                        navigator.clipboard.writeText(code).then(() => {
                          setCopiedTab(codeTab);
                          setTimeout(() => setCopiedTab(null), 2000);
                        });
                      }}>
                      {copiedTab === codeTab ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span className="hidden sm:inline">{copiedTab === codeTab ? "Copié !" : "Copier"}</span>
                    </Button>
                    <Button size="sm" variant="ghost"
                      className={`h-6 px-2 text-[10px] gap-1 ${inspectMode ? "text-primary bg-primary/10" : "text-[#858585] hover:text-white"}`}
                      onClick={() => setInspectMode(!inspectMode)}
                      title="Mode inspection : cliquez un élément dans la preview pour voir son code">
                      <MousePointer2 className="w-3 h-3" />
                      <span className="hidden sm:inline">Inspect</span>
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 text-[#858585] hover:text-white"
                      onClick={() => {
                        if (selectedVersionId) {
                          const combined = `<!-- HTML -->
${htmlCode}
<!-- CSS -->
${cssCode}
<!-- JS -->
${jsCode}`;
                          updateCode.mutate({ versionId: selectedVersionId, code: combined });
                        }
                      }}>
                      <Save className="w-3 h-3" />
                      <span className="hidden sm:inline">Sauvegarder</span>
                    </Button>
                  </div>
                </div>

                {/* Textarea editor */}
                <div className="relative flex-1 overflow-hidden bg-[#1e1e1e]">
                  <textarea
                    ref={textareaRef}
                    key={`${codeTab}-${selectedVersionId}`}
                    value={codeTab === "html" ? htmlCode : codeTab === "css" ? cssCode : jsCode}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (codeTab === "html") setHtmlCode(v);
                      else if (codeTab === "css") setCssCode(v);
                      else setJsCode(v);
                    }}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    className="absolute inset-0 w-full h-full resize-none bg-transparent text-[#d4d4d4] font-mono text-xs leading-5 p-4 outline-none border-0 focus:ring-0"
                    style={{ fontFamily: "'Fira Code','Cascadia Code','Consolas','Courier New',monospace", tabSize: 2 }}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const s = e.currentTarget.selectionStart, end = e.currentTarget.selectionEnd;
                        const v = e.currentTarget.value;
                        const nv = v.substring(0, s) + "  " + v.substring(end);
                        if (codeTab === "html") setHtmlCode(nv);
                        else if (codeTab === "css") setCssCode(nv);
                        else setJsCode(nv);
                        requestAnimationFrame(() => { e.currentTarget.selectionStart = s + 2; e.currentTarget.selectionEnd = s + 2; });
                      }
                      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                        e.preventDefault();
                        if (selectedVersionId) {
                          const combined = `<!-- HTML -->\n${htmlCode}\n<!-- CSS -->\n${cssCode}\n<!-- JS -->\n${jsCode}`;
                          updateCode.mutate({ versionId: selectedVersionId, code: combined });
                        }
                      }
                    }}
                  />
                  {/* Highlight overlay hint */}
                  {highlightLine !== null && (
                    <div className="absolute left-0 right-0 bg-yellow-400/20 border-l-2 border-yellow-400 pointer-events-none"
                      style={{ top: `${highlightLine * 20 + 16}px`, height: "20px" }} />
                  )}
                </div>

                {/* Status bar */}
                <div className="h-5 bg-[#007acc] flex items-center px-3 gap-4 flex-shrink-0">
                  <span className="text-[10px] text-white/80">{codeTab === "html" ? "index.html" : codeTab === "css" ? "style.css" : "script.js"}</span>
                  <span className="text-[10px] text-white/60">
                    {(codeTab === "html" ? htmlCode : codeTab === "css" ? cssCode : jsCode).split("\n").length} lignes
                  </span>
                  {streamingTokens > 0 && !isGenerating && (
                    <span className="text-[10px] text-white/50 ml-auto">{streamingTokens.toLocaleString()} tokens</span>
                  )}
                  {inspectMode && <span className="text-[10px] text-yellow-300 ml-auto">🔍 Mode inspection actif</span>}
                </div>
              </div>

              {/* ── Chat zone (bottom-left, 40% height) ── */}
              <div className="flex flex-col" style={{ flex: '0 0 40%', minHeight: 0 }}>
                {/* Chat header */}
                <div className="px-3 py-1.5 border-b border-border/40 flex-shrink-0 flex items-center gap-2 bg-background/60">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
                    <Sparkles className="w-2.5 h-2.5 text-primary" />
                  </div>
                  <p className="text-xs font-semibold">Maria</p>
                  <span className="text-[10px] text-muted-foreground">· agent IA</span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant={showVersions ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => setShowVersions(v => !v)}
                    >
                      <History className="w-3 h-3" />
                      Versions
                    </Button>
                    <Button
                      variant={sideTab === "deploy" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => { setSideTab("deploy"); setSidebarOpen(true); }}
                    >
                      <Rocket className="w-3 h-3" />
                      Deploy
                    </Button>
                    <Button
                      variant={showImport ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => setShowImport(v => !v)}
                    >
                      <Upload className="w-3 h-3" />
                      Import
                    </Button>
                    <Link href={`/projects/${projectId}/share`}>
                      <Button variant="ghost" size="icon" className="w-6 h-6"><Share2 className="w-3 h-3" /></Button>
                    </Link>
                  </div>
                </div>

                {/* Import panel */}
                {showImport && (
                  <div className="border-b border-border/40 bg-muted/20 overflow-y-auto" style={{ maxHeight: '50%' }}>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
                      <span className="text-[10px] font-medium text-muted-foreground">Importer un projet</span>
                      <button onClick={() => setShowImport(false)} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                    </div>
                    <ImportProjectPanel
                      projectId={projectId}
                      onImportSuccess={(versionId) => {
                        setSelectedVersionId(versionId);
                        setShowImport(false);
                        utils.projects.getVersions.invalidate({ projectId });
                        utils.projects.get.invalidate({ id: projectId });
                      }}
                    />
                  </div>
                )}

                {/* Deploy panel (inline, togglable) */}
                {sidebarOpen && sideTab === "deploy" && (
                  <div className="border-b border-border/40 bg-muted/20 overflow-y-auto" style={{ maxHeight: '50%' }}>
                    <div className="p-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium text-muted-foreground">Déploiement</span>
                        <button onClick={() => setSidebarOpen(false)} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                      </div>
                      <DeployPanel projectId={projectId} hasCode={hasCode} />
                    </div>
                  </div>
                )}

                {/* Versions panel (inline, togglable) */}
                {showVersions && (
                  <div className="border-b border-border/40 bg-muted/20 overflow-y-auto" style={{ maxHeight: '45%' }}>
                    <div className="p-2 space-y-1.5">
                      <p className="text-[10px] text-muted-foreground font-medium px-1">{versions?.length || 0} version(s)</p>
                      {versions?.map((v: any) => {
                        const isActive = v.id === project?.currentVersionId;
                        return (
                          <div key={v.id} className={`rounded-lg border p-2 cursor-pointer transition-all ${
                            isActive ? "border-primary/40 bg-primary/5" : "border-border/40 hover:border-border hover:bg-muted/30"
                          }`} onClick={() => setSelectedVersionId(v.id)}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">v{v.versionNumber}</span>
                              {isActive
                                ? <Badge className="text-[10px] h-4 px-1.5 bg-primary/20 text-primary border-0">Active</Badge>
                                : <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 gap-1"
                                    onClick={(e) => { e.stopPropagation(); setRestoreTarget({ versionId: v.id, label: `v${v.versionNumber}` }); }}>
                                    <RotateCcw className="w-2.5 h-2.5" /> Restaurer
                                  </Button>
                              }
                            </div>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              {v.createdAt ? formatDistanceToNow(new Date(v.createdAt), { addSuffix: true, locale: fr }) : ""}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {!chatMessages || chatMessages.length === 0 ? (
                    <div className="text-center py-3 space-y-2">
                      <p className="text-xs text-muted-foreground">Posez une question ou demandez une modification…</p>
                      <div className="flex flex-col gap-1">
                        {["Change les couleurs en violet", "Ajoute une section FAQ", "Explique ce code"].map((s) => (
                          <button key={s} onClick={() => setChatMessage(s)}
                            className="text-[10px] px-2 py-1 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all text-left">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    chatMessages.map((msg: any) => {
                      const linkedVersion = msg.versionId && versions ? versions.find((v: any) => v.id === msg.versionId) : null;
                      const msgDate = msg.createdAt ? new Date(msg.createdAt) : null;
                      const msgTime = msgDate ? msgDate.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
                      return (
                        <div key={msg.id} className={`flex gap-1.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                          {msg.role === "assistant" && (
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Sparkles className="w-2.5 h-2.5 text-primary" />
                            </div>
                          )}
                          <div className="flex flex-col max-w-[85%]">
                            <div className={`rounded-xl px-2.5 py-1.5 text-xs ${
                              msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border border-border/60 text-foreground rounded-tl-sm"
                            }`}>
                              {msg.role === "assistant" ? <Streamdown>{msg.content}</Streamdown> : msg.content}
                            </div>
                            {msgTime && <span className="text-[9px] text-muted-foreground/50 mt-0.5 px-1">{msgTime}</span>}
                            {linkedVersion && (
                              <button className="mt-0.5 flex items-center gap-1 text-[10px] text-primary hover:text-primary/80"
                                onClick={() => setSelectedVersionId(linkedVersion.id)}>
                                <Tag className="w-2 h-2" /> v{linkedVersion.versionNumber} — voir
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {/* Streaming reply — shown while Maria is generating her response */}
                  {streamingReply && (
                    <div className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-primary" />
                      </div>
                      <div className="bg-card border border-primary/30 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[85%]">
                        <Streamdown className="text-xs">{streamingReply}</Streamdown>
                        <span className="inline-block w-1.5 h-3 bg-primary/70 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
                      </div>
                    </div>
                  )}
                  {/* Typing dots — shown only while waiting for first tokens */}
                  {chatEdit.isPending && !streamingReply && (
                    <div className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-2.5 h-2.5 text-primary" />
                      </div>
                      <div className="bg-card border border-border/60 rounded-xl rounded-tl-sm px-2.5 py-1.5">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat input */}
                <div className="p-2 border-t border-border/50 flex-shrink-0">
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="Parlez à Maria…"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && chatMessage.trim()) {
                          e.preventDefault();
                          sendChatStream(chatMessage);
                        }
                      }}
                      className="bg-input border-border/60 text-xs h-8"
                    />
                    <Button size="icon" className="h-8 w-8 bg-primary hover:bg-primary/90 text-primary-foreground flex-shrink-0"
                      onClick={() => { if (chatMessage.trim()) sendChatStream(chatMessage); }}
                      disabled={chatEdit.isPending || !chatMessage.trim()}>
                      {chatEdit.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── RIGHT PANEL : Preview pleine largeur ── */}
            <div className="flex flex-col overflow-hidden" style={{ gridColumn: '2', gridRow: '1 / 3' }}>
              {/* Preview toolbar */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 flex-shrink-0 bg-background/60">
                <div className="flex items-center gap-1">
                  {/* Collapse / expand left panel button */}
                  <Button
                    variant="ghost" size="icon"
                    className="w-7 h-7 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditorCollapsed(v => !v)}
                    title={editorCollapsed ? "Ouvrir l'éditeur" : "Réduire l'éditeur"}
                  >
                    {editorCollapsed
                      ? <PanelLeftOpen className="w-3.5 h-3.5" />
                      : <PanelLeftClose className="w-3.5 h-3.5" />
                    }
                  </Button>
                  <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Prévisualisation live</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse ml-1" />
                </div>
                <div className="flex items-center gap-1">
                  {(["desktop", "tablet", "mobile"] as ViewMode[]).map((mode) => {
                    const icons = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };
                    const Icon = icons[mode];
                    return (
                      <Button key={mode} variant="ghost" size="icon"
                        className={`w-7 h-7 ${viewMode === mode ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                        onClick={() => setViewMode(mode)}>
                        <Icon className="w-3.5 h-3.5" />
                      </Button>
                    );
                  })}
                </div>
              </div>
              {/* iframe preview — pleine hauteur */}
              <div className="flex-1 flex items-start justify-center p-3 bg-muted/20 overflow-hidden">
                <div className="h-full overflow-hidden rounded-lg border border-border/60 shadow-xl transition-all duration-300 bg-white relative"
                  style={{ width: VIEW_SIZES[viewMode], maxWidth: "100%" }}>
                  {visualEditMode && (
                    <div className="absolute top-0 left-0 right-0 z-10 bg-violet-600/90 text-white text-[10px] text-center py-1 flex items-center justify-center gap-1.5">
                      <PencilRuler className="w-3 h-3" />
                      Mode édition visuelle — Cliquez sur un élément pour le modifier
                    </div>
                  )}

                  {visualEditMode && (
                    <div className="absolute top-8 left-0 right-0 z-20 flex flex-col gap-1 px-2 pointer-events-none">
                      {/* Main toolbar */}
                      <div className="flex items-center gap-1 bg-[#1e1e2e]/95 backdrop-blur border border-white/10 rounded-lg px-2 py-1.5 shadow-xl pointer-events-auto flex-wrap">

                        {/* Text controls — shown if text element selected */}
                        {veSelection?.isText && <>
                          <button title="Gras" onClick={() => sendToIframe({ type: 'VE_STYLE', prop: 'fontWeight', value: veSelection.fontWeight === 'bold' || veSelection.fontWeight === '700' ? 'normal' : 'bold' })} className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white text-xs font-bold">B</button>
                          <button title="Italique" onClick={() => sendToIframe({ type: 'VE_STYLE', prop: 'fontStyle', value: 'italic' })} className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white text-xs italic">I</button>
                          {/* Font size */}
                          <input type="number" min="8" max="120" defaultValue={parseInt(veSelection.fontSize) || 16}
                            key={`fs-${veSelection.tag}-${veSelection.rect.top}`}
                            className="w-14 h-7 bg-white/10 border border-white/20 rounded px-1 text-white text-xs text-center"
                            onChange={e => sendToIframe({ type: 'VE_STYLE', prop: 'fontSize', value: e.target.value + 'px' })} />
                          {/* Alignment */}
                          {(['left', 'center', 'right'] as const).map(align => (
                            <button key={align} title={`Aligner ${align}`} onClick={() => sendToIframe({ type: 'VE_STYLE', prop: 'textAlign', value: align })}
                              className={`w-7 h-7 rounded flex items-center justify-center text-xs ${veSelection.textAlign === align ? 'bg-primary/40 text-primary' : 'hover:bg-white/10 text-white/70'}`}>
                              {align === 'left' ? '⬅' : align === 'center' ? '⬛' : '➡'}
                            </button>
                          ))}
                          <div className="w-px h-5 bg-white/20" />
                          {/* Text color */}
                          <label title="Couleur du texte" className="flex items-center gap-1 cursor-pointer">
                            <span className="text-[10px] text-white/60">A</span>
                            <input type="color" className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                              defaultValue="#ffffff"
                              onChange={e => sendToIframe({ type: 'VE_STYLE', prop: 'color', value: e.target.value })} />
                          </label>
                        </>}

                        {/* Background color — for any selected element */}
                        {veSelection && <>
                          <label title="Couleur de fond" className="flex items-center gap-1 cursor-pointer">
                            <span className="text-[10px] text-white/60">BG</span>
                            <input type="color" className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                              defaultValue="#ffffff"
                              onChange={e => sendToIframe({ type: 'VE_STYLE', prop: 'backgroundColor', value: e.target.value })} />
                          </label>
                          <div className="w-px h-5 bg-white/20" />
                          {/* Width */}
                          <label className="flex items-center gap-1">
                            <span className="text-[10px] text-white/60">W</span>
                            <input type="text" placeholder="auto" className="w-16 h-7 bg-white/10 border border-white/20 rounded px-1 text-white text-xs"
                              onBlur={e => { if (e.target.value) sendToIframe({ type: 'VE_STYLE', prop: 'width', value: e.target.value }); }} />
                          </label>
                          {/* Padding */}
                          <label className="flex items-center gap-1">
                            <span className="text-[10px] text-white/60">P</span>
                            <input type="text" placeholder="0px" className="w-16 h-7 bg-white/10 border border-white/20 rounded px-1 text-white text-xs"
                              onBlur={e => { if (e.target.value) sendToIframe({ type: 'VE_STYLE', prop: 'padding', value: e.target.value }); }} />
                          </label>
                        </>}

                        {/* Image replace */}
                        {veSelection?.isImage && <>
                          <div className="w-px h-5 bg-white/20" />
                          <button onClick={() => imageUploadRef.current?.click()} className="flex items-center gap-1 h-7 px-2 rounded bg-violet-600/80 hover:bg-violet-600 text-white text-xs">
                            🖼 Remplacer
                          </button>
                        </>}

                        {/* Element indicator */}
                        <div className="ml-auto text-[10px] text-white/40 px-1">{veSelection ? `<${veSelection.tag.toLowerCase()}>` : 'Cliquez un élément'}</div>
                      </div>

                      {/* Save / Cancel bar */}
                      {veDirty && (
                        <div className="flex items-center gap-2 bg-emerald-900/90 backdrop-blur border border-emerald-500/30 rounded-lg px-3 py-1.5 shadow-xl pointer-events-auto">
                          <span className="text-xs text-emerald-300 flex-1">Modifications non sauvegardées</span>
                          <button onClick={() => {
                            setHtmlCode(veOriginalHtmlRef.current);
                            setVeDirty(false);
                            setVeSelection(null);
                            setVisualEditMode(false);
                            buildPreview(veOriginalHtmlRef.current, cssCode, jsCode);
                          }} className="text-xs text-white/60 hover:text-white px-2 py-1 rounded hover:bg-white/10">
                            Annuler
                          </button>
                          <button onClick={() => {
                            const vId = selectedVersionId || project?.currentVersionId;
                            if (vId) updateCode.mutate({ versionId: vId, code: htmlCode });
                            setVeDirty(false);
                            setVeSelection(null);
                            setVisualEditMode(false);
                            buildPreview(htmlCode, cssCode, jsCode);
                            toast.success("Modifications sauvegardées !");
                          }} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded font-medium">
                            💾 Sauvegarder
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Hidden image upload input */}
                  <input ref={imageUploadRef} type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => sendToIframe({ type: 'VE_IMG_SRC', value: ev.target?.result as string });
                      reader.readAsDataURL(file);
                    }} />

                  <iframe
                    ref={previewRef}
                    src={visualEditMode ? (vePreviewSrc || "about:blank") : inspectMode ? getPreviewSrc() : (previewSrc || "about:blank")}
                    className="w-full h-full border-0"
                    title="Preview"
                    sandbox="allow-scripts allow-same-origin"
                  />
                </div>
              </div>
            </div>


          </div>
        )}
      </div>

      {/* Restore dialog */}
      <AlertDialog open={!!restoreTarget} onOpenChange={() => setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurer cette version ?</AlertDialogTitle>
            <AlertDialogDescription>
              Vous allez restaurer <strong>{restoreTarget?.label}</strong>.<br />
              La version active sera remplacée. Cette action est réversible depuis l'onglet Versions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => { if (restoreTarget) restoreVersion.mutate({ projectId, versionId: restoreTarget.versionId }); }}>
              {restoreVersion.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Restauration…</> : <><RotateCcw className="w-4 h-4 mr-2" />Restaurer</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
