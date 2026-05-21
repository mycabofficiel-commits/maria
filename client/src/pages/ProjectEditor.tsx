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
import { EditorView, basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";
import { html as cmHtml } from "@codemirror/lang-html";
import { css as cmCss } from "@codemirror/lang-css";
import { javascript as cmJs } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import AppLayout from "@/components/AppLayout";
import {
  Sparkles, Send, Eye, Code2, History, Smartphone, Tablet, Monitor,
  Loader2, ArrowLeft, Globe, RotateCcw, Save, CheckCircle2, MessageSquare,
  Rocket, Share2, Tag, MousePointer2, Copy, Check, PencilRuler, Upload,
  PanelLeftClose, PanelLeftOpen, Bug, Mic, MicOff, Paperclip, Camera, X as XIcon, Image as ImageIcon
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

// ── CodeMirror setup ──────────────────────────────────────────────────────────
const cmHighlightEffect = StateEffect.define<number | null>();
const cmHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(cmHighlightEffect)) {
        if (e.value === null || e.value < 0) return Decoration.none;
        try {
          const line = tr.state.doc.line(e.value + 1);
          return Decoration.set([Decoration.line({ class: "cm-hl" }).range(line.from)]);
        } catch { return Decoration.none; }
      }
    }
    return val.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const cmTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace" },
  ".cm-scroller": { overflow: "auto", height: "100%" },
  ".cm-content": { padding: "8px 0", minHeight: "100%" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": { backgroundColor: "#0d0d0d", borderRight: "1px solid #1a1a1a", color: "#4a4a4a", minWidth: "38px" },
  ".cm-activeLineGutter": { backgroundColor: "#1a1a1a" },
  ".cm-activeLine": { backgroundColor: "#1a1a1a80" },
  ".cm-selectionBackground, .cm-focused .cm-selectionBackground": { backgroundColor: "#264f78 !important" },
  ".cm-cursor": { borderLeftColor: "#6366f1", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-hl": { backgroundColor: "rgba(250,204,21,.15) !important", borderLeft: "2px solid #facc15" },
});

// ── Visual Editor script injected into iframe via contentDocument ──
const VE_SCRIPT = `(function(){
  var sel=null,deb=null,dragEl=null,overlay=null,resizing=null;

  var vs=document.createElement('style');
  vs.id='__ve_s__';
  vs.textContent='[data-veh]{outline:2px dashed rgba(99,102,241,.5)!important;cursor:pointer!important}[data-vedrag]{opacity:0.5!important}';
  document.head.appendChild(vs);

  function cleanHtml(){
    var clone=document.documentElement.cloneNode(true);
    ['#__ve__','#__ve_s__','#__ve_ov__'].forEach(function(id){
      var el=clone.querySelector(id);if(el&&el.parentNode)el.parentNode.removeChild(el);
    });
    Array.from(clone.querySelectorAll('[data-veh],[data-ves],[data-vedrag],[draggable],[contenteditable]')).forEach(function(el){
      ['data-veh','data-ves','data-vedrag','draggable','contenteditable'].forEach(function(a){el.removeAttribute(a);});
    });
    return '<!DOCTYPE html>\\n'+clone.outerHTML;
  }

  function push(){
    clearTimeout(deb);
    deb=setTimeout(function(){window.parent.postMessage({type:'VE_HTML_UPDATE',html:cleanHtml()},'*');},300);
  }

  function computedProps(el){
    var cs=window.getComputedStyle(el);
    return {color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,textAlign:cs.textAlign};
  }

  function createOverlay(el){
    removeOverlay();
    var r=el.getBoundingClientRect();
    overlay=document.createElement('div');
    overlay.id='__ve_ov__';
    overlay.style.cssText='position:fixed;pointer-events:none;z-index:99998;box-sizing:border-box;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;';
    var handles=[
      {t:'-4px',l:'-4px',c:'nw'},{t:'-4px',l:'calc(50% - 4px)',c:'n'},{t:'-4px',r:'-4px',c:'ne'},
      {t:'calc(50% - 4px)',l:'-4px',c:'w'},{t:'calc(50% - 4px)',r:'-4px',c:'e'},
      {b:'-4px',l:'-4px',c:'sw'},{b:'-4px',l:'calc(50% - 4px)',c:'s'},{b:'-4px',r:'-4px',c:'se'}
    ];
    handles.forEach(function(p){
      var h=document.createElement('div');
      h.setAttribute('data-vehandle',p.c);
      h.style.cssText='position:absolute;width:8px;height:8px;background:#6366f1;border:2px solid #fff;border-radius:2px;cursor:'+p.c+'-resize;pointer-events:auto;z-index:99999;';
      if(p.t)h.style.top=p.t;if(p.b)h.style.bottom=p.b;
      if(p.l)h.style.left=p.l;if(p.r)h.style.right=p.r;
      overlay.appendChild(h);
    });
    document.body.appendChild(overlay);
  }

  function updateOverlay(){
    if(!overlay||!sel)return;
    var r=sel.getBoundingClientRect();
    overlay.style.left=r.left+'px';overlay.style.top=r.top+'px';
    overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';
  }

  function removeOverlay(){
    if(overlay&&overlay.parentNode)overlay.parentNode.removeChild(overlay);
    overlay=null;resizing=null;
  }

  function getBodyChildren(){
    return Array.from(document.body.children).filter(function(el){
      return el.id!=='__ve_ov__'&&!(el.getAttribute&&el.getAttribute('data-vehandle'));
    });
  }

  function sendLayers(){
    var items=getBodyChildren().map(function(el,i){
      var cs=window.getComputedStyle(el);
      return {idx:i,tag:el.tagName,text:(el.innerText||el.textContent||'').trim().slice(0,40),zIndex:cs.zIndex,selected:el===sel};
    });
    window.parent.postMessage({type:'VE_LAYERS',items:items},'*');
  }

  function ensurePositioned(el){
    if(window.getComputedStyle(el).position==='static')el.style.position='relative';
  }

  function selectEl(el){
    if(sel){sel.removeAttribute('data-ves');sel.removeAttribute('draggable');if(sel.contentEditable==='true')sel.contentEditable='false';}
    removeOverlay();
    if(!el||el===document.body||el===document.documentElement||!el.tagName||(el.getAttribute&&el.getAttribute('data-vehandle'))){
      sel=null;window.parent.postMessage({type:'VE_DESELECT'},'*');sendLayers();return;
    }
    sel=el;el.setAttribute('draggable','true');
    createOverlay(el);
    var r=el.getBoundingClientRect(),tag=el.tagName,isImg=tag==='IMG';
    window.parent.postMessage({
      type:'VE_SELECT',tag:tag,
      isText:['H1','H2','H3','H4','H5','H6','P','SPAN','A','LI','BUTTON','LABEL','STRONG','EM','B','I','TD','TH','DIV'].indexOf(tag)>=0,
      isImage:isImg,
      isBlock:['DIV','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE','NAV','FIGURE'].indexOf(tag)>=0,
      canMove:!!(el.parentElement&&el.parentElement.children.length>1),
      rect:{top:r.top+window.scrollY,left:r.left+window.scrollX,width:r.width,height:r.height},
      computedStyle:computedProps(el),
      zIndex:window.getComputedStyle(el).zIndex,
      textContent:el.innerText||el.textContent||'',
      imgW:isImg?el.naturalWidth:0,imgH:isImg?el.naturalHeight:0,
      imgOW:isImg?el.offsetWidth:0,imgOH:isImg?el.offsetHeight:0
    },'*');
    sendLayers();
  }

  document.addEventListener('mouseover',function(e){
    var t=e.target;
    if(t&&t.setAttribute&&t!==document.body&&t!==document.documentElement&&t!==sel&&!(t.getAttribute&&t.getAttribute('data-vehandle')))
      t.setAttribute('data-veh','1');
  },true);
  document.addEventListener('mouseout',function(e){var t=e.target;if(t&&t.removeAttribute)t.removeAttribute('data-veh');},true);

  document.addEventListener('click',function(e){
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('data-vehandle'))return;
    e.preventDefault();e.stopPropagation();
    if(e.target&&e.target.tagName)selectEl(e.target);
  },true);

  document.addEventListener('dblclick',function(e){
    var el=e.target;
    if(!el||!el.tagName||(el.getAttribute&&el.getAttribute('data-vehandle')))return;
    if(['H1','H2','H3','H4','H5','H6','P','SPAN','A','LI','BUTTON','LABEL','STRONG','EM','B','I','TD','TH'].indexOf(el.tagName)>=0){
      e.preventDefault();e.stopPropagation();
      el.contentEditable='true';el.focus();
      try{var rng=document.createRange();rng.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(rng);}catch(x){}
    }
  },true);

  document.addEventListener('mousedown',function(e){
    var h=e.target.getAttribute&&e.target.getAttribute('data-vehandle');
    if(!h||!sel)return;
    e.preventDefault();e.stopPropagation();
    var r=sel.getBoundingClientRect();
    resizing={h:h,sx:e.clientX,sy:e.clientY,sw:r.width,sh:r.height};
  },true);
  document.addEventListener('mousemove',function(e){
    if(!resizing||!sel)return;
    e.preventDefault();
    var dx=e.clientX-resizing.sx,dy=e.clientY-resizing.sy,h=resizing.h;
    if(h.indexOf('e')>=0)sel.style.width=Math.max(20,resizing.sw+dx)+'px';
    if(h.indexOf('s')>=0)sel.style.height=Math.max(20,resizing.sh+dy)+'px';
    if(h.indexOf('w')>=0)sel.style.width=Math.max(20,resizing.sw-dx)+'px';
    if(h.indexOf('n')>=0)sel.style.height=Math.max(20,resizing.sh-dy)+'px';
    updateOverlay();
  },true);
  document.addEventListener('mouseup',function(){if(resizing){resizing=null;push();}},true);
  document.addEventListener('scroll',updateOverlay,true);

  document.addEventListener('dragstart',function(e){if(e.target===sel){dragEl=sel;e.target.setAttribute('data-vedrag','1');e.dataTransfer.effectAllowed='move';}},true);
  document.addEventListener('dragover',function(e){if(dragEl){e.preventDefault();e.dataTransfer.dropEffect='move';}},true);
  document.addEventListener('drop',function(e){
    if(!dragEl)return;
    e.preventDefault();e.stopPropagation();
    var t=e.target;
    while(t&&t!==document.body){if(t.parentElement===dragEl.parentElement&&t!==dragEl)break;t=t.parentElement;}
    if(t&&t!==dragEl&&t.parentElement===dragEl.parentElement){
      var siblings=Array.from(dragEl.parentElement.children);
      if(siblings.indexOf(dragEl)<siblings.indexOf(t))dragEl.parentElement.insertBefore(dragEl,t.nextSibling);
      else dragEl.parentElement.insertBefore(dragEl,t);
      push();
    }
    dragEl.removeAttribute('data-vedrag');dragEl=null;updateOverlay();
  },true);
  document.addEventListener('dragend',function(){if(dragEl)dragEl.removeAttribute('data-vedrag');dragEl=null;},true);

  document.addEventListener('input',function(){
    push();
    if(sel&&sel.contentEditable==='true')window.parent.postMessage({type:'VE_TEXT_SYNC',text:sel.innerText||''},'*');
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape')selectEl(null);});

  window.addEventListener('message',function(e){
    if(!e.data||!e.data.type)return;
    if(e.data.type==='VE_STYLE'&&sel){try{sel.style[e.data.prop]=e.data.value;}catch(x){}updateOverlay();push();}
    if(e.data.type==='VE_TEXT'&&sel){sel.innerText=e.data.value;push();}
    if(e.data.type==='VE_IMG_SRC'&&sel&&sel.tagName==='IMG'){sel.src=e.data.value;push();}
    if(e.data.type==='VE_MOVE_UP'&&sel&&sel.previousElementSibling){sel.parentElement.insertBefore(sel,sel.previousElementSibling);updateOverlay();push();sendLayers();}
    if(e.data.type==='VE_MOVE_DOWN'&&sel&&sel.nextElementSibling){sel.parentElement.insertBefore(sel.nextElementSibling,sel);updateOverlay();push();sendLayers();}
    if(e.data.type==='VE_INSERT_IMG'){
      var img=document.createElement('img');img.src=e.data.src;img.style.maxWidth='100%';
      if(sel)sel.appendChild(img);else document.body.appendChild(img);
      selectEl(img);push();
    }
    if(e.data.type==='VE_LAYER_FRONT'&&sel){
      var sib1=sel.parentElement?Array.from(sel.parentElement.children):[];
      var mx=sib1.reduce(function(m,s){var z=parseInt(window.getComputedStyle(s).zIndex)||0;return z>m?z:m;},0);
      ensurePositioned(sel);sel.style.zIndex=(mx+1)+'';push();sendLayers();
    }
    if(e.data.type==='VE_LAYER_BACK'&&sel){
      var sib2=sel.parentElement?Array.from(sel.parentElement.children):[];
      var mn=sib2.reduce(function(m,s){var z=parseInt(window.getComputedStyle(s).zIndex)||0;return z<m?z:m;},0);
      ensurePositioned(sel);sel.style.zIndex=(mn-1)+'';push();sendLayers();
    }
    if(e.data.type==='VE_LAYER_UP'&&sel){
      var z1=parseInt(window.getComputedStyle(sel).zIndex)||0;
      ensurePositioned(sel);sel.style.zIndex=(z1+1)+'';push();sendLayers();
    }
    if(e.data.type==='VE_LAYER_DOWN'&&sel){
      var z2=parseInt(window.getComputedStyle(sel).zIndex)||0;
      ensurePositioned(sel);sel.style.zIndex=(z2-1)+'';push();sendLayers();
    }
    if(e.data.type==='VE_SELECT_IDX'){
      var bc=getBodyChildren();var tgt=bc[e.data.idx];if(tgt)selectEl(tgt);
    }
    if(e.data.type==='VE_LAYER_ZIDX'){
      var bc2=getBodyChildren();var el2=bc2[e.data.idx];if(!el2)return;
      var curZ=parseInt(window.getComputedStyle(el2).zIndex)||0;
      ensurePositioned(el2);el2.style.zIndex=(curZ+e.data.delta)+'';push();sendLayers();
    }
    if(e.data.type==='VE_GET_LAYERS'){sendLayers();}
  });
})();`;

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

  /* ── Dictation ── */
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  /* ── Attachments ── */
  type Attachment = { name: string; base64: string; mimeType: string; preview: string };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [siteType, setSiteType] = useState("Landing page");
  const [style, setStyle] = useState("Moderne");
  const [language, setLanguage] = useState("fr");
  const [colorPalette, setColorPalette] = useState("Bleu/Violet");
  const [restoreTarget, setRestoreTarget] = useState<{ versionId: number; label: string } | null>(null);
  const [codeTab, setCodeTab] = useState<CodeTab>("html");
  const [inspectMode, setInspectMode] = useState(false);
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
  const [agentStep, setAgentStep] = useState<{ agent: string; step: string; icon: string } | null>(null);

  /* visual edit state */
  const [veSelection, setVeSelection] = useState<null | {
    tag: string; isText: boolean; isImage: boolean; isBlock: boolean; canMove: boolean; zIndex: string;
    rect: { top: number; left: number; width: number; height: number };
    color: string; backgroundColor: string; fontSize: string; fontWeight: string; textAlign: string;
    textContent: string;
    imgW: number; imgH: number; imgOW: number; imgOH: number;
  }>(null);
  const [veTextInput, setVeTextInput] = useState("");
  const [showLayers, setShowLayers] = useState(false);
  const [veLayers, setVeLayers] = useState<Array<{ idx: number; tag: string; text: string; zIndex: string; selected: boolean }>>([]);
  const veOriginalHtmlRef = useRef<string>("");
  const [veDirty, setVeDirty] = useState(false);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const imageInsertRef = useRef<HTMLInputElement>(null);
  const veCurrentHtmlRef = useRef<string>("");

  /* code state (editable) */
  const [htmlCode, setHtmlCode] = useState("");
  const [cssCode, setCssCode] = useState("");
  const [jsCode, setJsCode] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const cmContainerRef = useRef<HTMLDivElement>(null);
  const cmViewRef = useRef<EditorView | null>(null);
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
    if (visualEditMode) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => buildPreview(htmlCode, cssCode, jsCode), 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [htmlCode, cssCode, jsCode, buildPreview, visualEditMode]);

  /* also update preview when version data arrives (from server) */
  useEffect(() => {
    const code = currentVersionData?.generatedCode;
    if (code && !visualEditMode) buildPreview(extractHtml(code), extractCss(code), extractJs(code));
  }, [currentVersionData?.generatedCode, visualEditMode]);

  /* ── CodeMirror: create/destroy editor on tab or version change ── */
  useEffect(() => {
    if (!cmContainerRef.current) return;
    cmViewRef.current?.destroy();
    const lang = codeTab === "html" ? cmHtml() : codeTab === "css" ? cmCss() : cmJs();
    const content = codeTab === "html" ? htmlCode : codeTab === "css" ? cssCode : jsCode;
    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup, oneDark, cmTheme, cmHighlightField, lang,
        EditorView.updateListener.of((upd) => {
          if (!upd.docChanged) return;
          const v = upd.state.doc.toString();
          if (codeTab === "html") setHtmlCode(v);
          else if (codeTab === "css") setCssCode(v);
          else setJsCode(v);
        }),
      ],
    });
    cmViewRef.current = new EditorView({ state, parent: cmContainerRef.current });
    return () => { cmViewRef.current?.destroy(); cmViewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeTab, selectedVersionId]);

  /* ── CodeMirror: sync external content changes (streaming, VE save) ── */
  useEffect(() => {
    if (!cmViewRef.current) return;
    const content = codeTab === "html" ? htmlCode : codeTab === "css" ? cssCode : jsCode;
    const current = cmViewRef.current.state.doc.toString();
    if (current !== content) {
      cmViewRef.current.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    }
  }, [htmlCode, cssCode, jsCode, codeTab]);

  /* ── Streaming generate ── */
  const [streamingCode, setStreamingCode] = useState("");
  const [isChatPending, setIsChatPending] = useState(false);

  const generateSiteStream = useCallback(async () => {
    if (!prompt.trim()) { toast.error("Décrivez votre site d'abord."); return; }
    setIsGenerating(true);
    setAgentStep(null);
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
              if (evt.agent !== undefined && evt.step !== undefined) {
                // Multi-agent progress event
                setAgentStep({ agent: evt.agent, step: evt.step, icon: evt.icon || "⚙️" });
              }
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
                setAgentStep(null);
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
      setAgentStep(null);
    }
  }, [projectId, prompt, siteType, style, language, colorPalette]);

  /* Keep tRPC mutation as fallback (unused but keeps types happy) */
  const generateSite = trpc.projects.generate.useMutation({ onError: (err: any) => toast.error(err.message) });

  /* ── Streaming chat ── */
  const sendChatStream = useCallback(async (msg: string) => {
    if (!msg.trim() && attachments.length === 0) return;
    setIsChatPending(true);
    setStreamingReply("");
    setChatMessage("");
    recognitionRef.current?.stop();
    setIsRecording(false);
    const sentAttachments = [...attachments];
    setAttachments([]);
    // Optimistically add user message to local cache
    utils.projects.getChatMessages.setData({ projectId }, (old: any) => [
      ...(old || []),
      { id: Date.now(), role: "user", content: msg || "📎 Image jointe", createdAt: new Date().toISOString(), projectId, userId: 0, versionId: null, tokensUsed: null },
    ]);
    try {
      const res = await fetch("/api/stream/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          message: msg || "Voici une image de référence. Utilise-la pour améliorer ou modifier le site.",
          images: sentAttachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType })),
        }),
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

  /* ── Dictation ── */
  const toggleDictation = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Dictée non supportée dans ce navigateur (Chrome/Edge recommandé)"); return; }
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript).join("");
      setChatMessage(transcript);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isRecording]);

  /* ── Attachments ── */
  const handleAttachFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) { toast.error(`${file.name}: seules les images sont supportées`); return; }
      if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name}: taille max 5 Mo`); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        setAttachments((prev) => [...prev, { name: file.name, base64, mimeType: file.type, preview: dataUrl }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

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

  const injectVeScript = useCallback(() => {
    try {
      const iframeDoc = previewRef.current?.contentDocument;
      if (!iframeDoc?.body) { setTimeout(() => injectVeScript(), 150); return; }
      iframeDoc.getElementById('__ve__')?.remove();
      iframeDoc.getElementById('__ve_s__')?.remove();
      iframeDoc.getElementById('__ve_ov__')?.remove();
      const s = iframeDoc.createElement('script');
      s.id = '__ve__';
      s.textContent = VE_SCRIPT;
      iframeDoc.body.appendChild(s);
    } catch (err) { console.error('[VE] inject failed', err); }
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

  const [debugReport, setDebugReport] = useState<string | null>(null);
  const [isDebugging, setIsDebugging] = useState(false);

  const runDebug = useCallback(async () => {
    setIsDebugging(true);
    setDebugReport(null);
    try {
      const res = await fetch("/api/stream/debug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.versionId) {
              setDebugReport(evt.report || "Code corrigé.");
              utils.projects.getVersions.invalidate({ projectId });
              utils.projects.get.invalidate({ id: projectId });
              toast.success("Débogage terminé — nouvelle version créée", { duration: 5000 });
            }
            if (evt.message) throw new Error(evt.message);
          } catch (e: any) {
            if (e.message) toast.error(e.message);
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsDebugging(false);
    }
  }, [projectId]);

  /* inspect: listen to messages from iframe */
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "INSPECT_ELEMENT" && e.data.tag) {
        const tag = e.data.tag.toLowerCase();
        const fullCode = codeTab === "html" ? htmlCode : codeTab === "css" ? cssCode : jsCode;
        const lines = fullCode.split("\n");
        const idx = lines.findIndex(l => l.toLowerCase().includes(`<${tag}`));
        if (idx >= 0) {
          if (cmViewRef.current) {
            try {
              const pos = cmViewRef.current.state.doc.line(idx + 1).from;
              cmViewRef.current.dispatch({
                effects: [
                  EditorView.scrollIntoView(pos, { y: "start", yMargin: 60 }),
                  cmHighlightEffect.of(idx),
                ],
              });
              setTimeout(() => cmViewRef.current?.dispatch({ effects: cmHighlightEffect.of(null) }), 2000);
            } catch {}
          }
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
      if (e.data?.type === "VE_LAYERS") {
        setVeLayers(e.data.items || []);
      }
      if (e.data?.type === "VE_SELECT") {
        const s = {
          tag: e.data.tag,
          isText: e.data.isText,
          isImage: e.data.isImage,
          isBlock: e.data.isBlock,
          canMove: e.data.canMove || false,
          zIndex: e.data.zIndex || "auto",
          rect: e.data.rect,
          color: e.data.computedStyle?.color || "",
          backgroundColor: e.data.computedStyle?.backgroundColor || "",
          fontSize: e.data.computedStyle?.fontSize || "",
          fontWeight: e.data.computedStyle?.fontWeight || "",
          textAlign: e.data.computedStyle?.textAlign || "",
          textContent: e.data.textContent || "",
          imgW: e.data.imgW || 0,
          imgH: e.data.imgH || 0,
          imgOW: e.data.imgOW || 0,
          imgOH: e.data.imgOH || 0,
        };
        setVeSelection(s);
        if (s.isText) setVeTextInput(s.textContent);
      }
      if (e.data?.type === "VE_TEXT_SYNC") {
        setVeTextInput(e.data.text || "");
      }
      if (e.data?.type === "VE_HTML_UPDATE") {
        veCurrentHtmlRef.current = e.data.html;
        setVeDirty(true);
      }
      if (e.data?.type === "VE_DESELECT") {
        setVeSelection(null);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);


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
                  if (!visualEditMode) {
                    // Enter VE mode
                    veOriginalHtmlRef.current = htmlCode;
                    veCurrentHtmlRef.current = "";
                    setVeDirty(false);
                    setVeSelection(null);
                    setInspectMode(false);
                    setVisualEditMode(true);
                    // Inject script after React re-renders (iframe already has previewSrc loaded)
                    requestAnimationFrame(() => setTimeout(injectVeScript, 50));
                  } else {
                    // Exit VE mode without saving
                    if (veDirty) {
                      setHtmlCode(veOriginalHtmlRef.current);
                      buildPreview(veOriginalHtmlRef.current, cssCode, jsCode);
                    }
                    setVeDirty(false);
                    setVeSelection(null);
                    setVisualEditMode(false);
                  }
                }}>
                <PencilRuler className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Éditeur Visuel</span>
              </Button>
            )}
            {hasCode && (
              <Button size="sm" variant="outline"
                className="text-xs h-8 px-2 sm:px-3 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                onClick={runDebug}
                disabled={isDebugging}
                title="Analyser et corriger automatiquement les bugs, liens cassés et erreurs">
                {isDebugging
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin sm:mr-1.5" />
                  : <Bug className="w-3.5 h-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">{isDebugging ? "Débogage…" : "Débugger"}</span>
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
          <div className="flex-1 flex flex-col items-center justify-center gap-5">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />

            {/* Agent step badge */}
            {agentStep ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm font-medium text-primary">
                  <span>{agentStep.icon}</span>
                  <span className="font-semibold">{agentStep.agent}</span>
                  <span className="text-muted-foreground">—</span>
                  <span className="text-muted-foreground">{agentStep.step}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground animate-pulse">Mar-ia génère votre site…</p>
            )}

            {/* Code streaming progress */}
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

                {/* Editor area: file tree + CodeMirror */}
                <div className="flex flex-1 overflow-hidden min-h-0">
                  {/* File tree sidebar */}
                  <div className="w-36 flex-shrink-0 bg-[#0d0d0d] border-r border-[#1a1a1a] overflow-y-auto hidden md:flex flex-col py-1 select-none">
                    {/* src/ folder */}
                    <div className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[#6b7280]">
                      <svg className="w-3 h-3 opacity-60" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.764c.958 0 1.76.56 2.109 1.5H13.5A1.5 1.5 0 0115 5v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13V3.5z"/></svg>
                      <span>src/</span>
                    </div>
                    {/* index.html */}
                    <button
                      onClick={() => setCodeTab("html")}
                      className={`flex items-center gap-1.5 w-full text-left px-3 py-0.5 text-[11px] font-mono transition-colors ${
                        codeTab === "html" ? "bg-[#1e1e2e] text-[#e2b8ff] border-l-2 border-[#6366f1]" : "text-[#9ca3af] hover:bg-[#1a1a1a] hover:text-white"
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0 text-[#e8894b]" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 1A.5.5 0 004 1.5v1h8v-1a.5.5 0 00-.5-.5h-7zm-1 3.5A.5.5 0 014 5v9a.5.5 0 00.5.5h7A.5.5 0 0012 14V5a.5.5 0 00-.5-.5h-7z"/></svg>
                      index.html
                    </button>
                    {/* assets/ folder */}
                    <div className="flex items-center gap-1 px-2 py-0.5 mt-0.5 text-[10px] text-[#6b7280]">
                      <svg className="w-3 h-3 opacity-60" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.764c.958 0 1.76.56 2.109 1.5H13.5A1.5 1.5 0 0115 5v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13V3.5z"/></svg>
                      <span>assets/</span>
                    </div>
                    {/* style.css */}
                    <button
                      onClick={() => setCodeTab("css")}
                      className={`flex items-center gap-1.5 w-full text-left px-3 py-0.5 text-[11px] font-mono transition-colors ${
                        codeTab === "css" ? "bg-[#1e1e2e] text-[#b8d7ff] border-l-2 border-[#6366f1]" : "text-[#9ca3af] hover:bg-[#1a1a1a] hover:text-white"
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0 text-[#519aba]" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 1A.5.5 0 004 1.5v1h8v-1a.5.5 0 00-.5-.5h-7zm-1 3.5A.5.5 0 014 5v9a.5.5 0 00.5.5h7A.5.5 0 0012 14V5a.5.5 0 00-.5-.5h-7z"/></svg>
                      style.css
                    </button>
                    {/* script.js */}
                    <button
                      onClick={() => setCodeTab("js")}
                      className={`flex items-center gap-1.5 w-full text-left px-3 py-0.5 text-[11px] font-mono transition-colors ${
                        codeTab === "js" ? "bg-[#1e1e2e] text-[#ffffa8] border-l-2 border-[#6366f1]" : "text-[#9ca3af] hover:bg-[#1a1a1a] hover:text-white"
                      }`}
                    >
                      <svg className="w-3 h-3 flex-shrink-0 text-[#f1e05a]" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 1A.5.5 0 004 1.5v1h8v-1a.5.5 0 00-.5-.5h-7zm-1 3.5A.5.5 0 014 5v9a.5.5 0 00.5.5h7A.5.5 0 0012 14V5a.5.5 0 00-.5-.5h-7z"/></svg>
                      script.js
                    </button>
                  </div>

                  {/* CodeMirror editor */}
                  <div ref={cmContainerRef} className="flex-1 overflow-hidden bg-[#0d0d0d]" />
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
                  {/* Debug report — shown after debugCode completes */}
                  {debugReport && (
                    <div className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Bug className="w-2.5 h-2.5 text-amber-400" />
                      </div>
                      <div className="bg-card border border-amber-500/30 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[90%]">
                        <p className="text-[10px] font-semibold text-amber-400 mb-1">Rapport de débogage</p>
                        <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{debugReport}</p>
                        <button onClick={() => setDebugReport(null)} className="mt-1.5 text-[10px] text-muted-foreground hover:text-foreground">Fermer</button>
                      </div>
                    </div>
                  )}
                  {/* Debugging indicator */}
                  {isDebugging && (
                    <div className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                        <Bug className="w-2.5 h-2.5 text-amber-400" />
                      </div>
                      <div className="bg-card border border-amber-500/30 rounded-xl rounded-tl-sm px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                          <span className="text-xs text-muted-foreground">Analyse et correction du code…</span>
                        </div>
                      </div>
                    </div>
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
                <div className="px-2 pb-2 pt-1 border-t border-border/50 flex-shrink-0">
                  {/* Attachment thumbnails */}
                  {attachments.length > 0 && (
                    <div className="flex gap-1.5 mb-1.5 flex-wrap">
                      {attachments.map((att, i) => (
                        <div key={i} className="relative group">
                          <img src={att.preview} alt={att.name}
                            className="h-14 w-14 object-cover rounded-lg border border-border/60" />
                          <button
                            onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <XIcon className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Input pill */}
                  <div className="flex items-center gap-1 bg-[#1a1a2e] border border-[#2e2e4e] rounded-full px-2 py-1">
                    {/* Camera — trigger image upload */}
                    <button
                      onClick={() => { if (attachInputRef.current) { attachInputRef.current.accept = "image/*"; attachInputRef.current.capture = "environment"; attachInputRef.current.click(); } }}
                      className="p-1.5 rounded-full text-[#6b7280] hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                      title="Prendre une photo">
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                    {/* Mic — dictation */}
                    <button
                      onClick={toggleDictation}
                      className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${isRecording ? "text-red-400 bg-red-400/20 animate-pulse" : "text-[#6b7280] hover:text-white hover:bg-white/10"}`}
                      title={isRecording ? "Arrêter la dictée" : "Dicter un message"}>
                      {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    </button>
                    {/* Paperclip — attach file */}
                    <button
                      onClick={() => { if (attachInputRef.current) { attachInputRef.current.removeAttribute("capture"); attachInputRef.current.accept = "image/*"; attachInputRef.current.click(); } }}
                      className="p-1.5 rounded-full text-[#6b7280] hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                      title="Joindre une image">
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>
                    {/* Text input */}
                    <input
                      type="text"
                      placeholder={isRecording ? "🎤 Dictée en cours…" : "Parlez à Mar-ia…"}
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && (chatMessage.trim() || attachments.length > 0)) {
                          e.preventDefault();
                          sendChatStream(chatMessage);
                        }
                      }}
                      className="flex-1 bg-transparent text-xs text-white placeholder-[#6b7280] outline-none min-w-0 px-1"
                    />
                    {/* Send */}
                    <button
                      onClick={() => { if (chatMessage.trim() || attachments.length > 0) sendChatStream(chatMessage); }}
                      disabled={chatEdit.isPending || (!chatMessage.trim() && attachments.length === 0)}
                      className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-primary/90 transition-colors">
                      {chatEdit.isPending ? <Loader2 className="w-3 h-3 animate-spin text-white" /> : <Send className="w-3 h-3 text-white" />}
                    </button>
                  </div>
                  {/* Hidden file input */}
                  <input ref={attachInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => handleAttachFiles(e.target.files)} />
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
              {/* ── VE banner ── */}
              {visualEditMode && (
                <div className="bg-violet-600 text-white text-[10px] text-center py-1 flex items-center justify-center gap-1.5 flex-shrink-0">
                  <PencilRuler className="w-3 h-3" />
                  Mode édition visuelle — Cliquez sur un élément pour le modifier
                </div>
              )}

              {/* ── VE toolbar strip (outside iframe — no click-through issues) ── */}
              {visualEditMode && (
                <div className="border-b border-border/50 bg-[#1e1e2e] flex-shrink-0 px-2 py-2 flex flex-col gap-2">

                  {/* Row 1: style controls */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {veSelection?.isText && <>
                      <button title="Gras" onClick={() => sendToIframe({ type: 'VE_STYLE', prop: 'fontWeight', value: veSelection.fontWeight === 'bold' || veSelection.fontWeight === '700' ? 'normal' : 'bold' })}
                        className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold ${veSelection.fontWeight === 'bold' || veSelection.fontWeight === '700' ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-white/70'}`}>B</button>
                      <button title="Italique" onClick={() => sendToIframe({ type: 'VE_STYLE', prop: 'fontStyle', value: 'italic' })}
                        className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 text-xs italic">I</button>
                      <input type="number" min="8" max="120" defaultValue={parseInt(veSelection.fontSize) || 16}
                        key={`fs-${veSelection.tag}-${veSelection.rect.top}`}
                        className="w-14 h-7 bg-white/10 border border-white/20 rounded px-1 text-white text-xs text-center"
                        onChange={e => sendToIframe({ type: 'VE_STYLE', prop: 'fontSize', value: e.target.value + 'px' })} />
                      {(['left', 'center', 'right'] as const).map(align => (
                        <button key={align} title={`Aligner ${align}`} onClick={() => sendToIframe({ type: 'VE_STYLE', prop: 'textAlign', value: align })}
                          className={`w-7 h-7 rounded flex items-center justify-center text-[11px] ${veSelection.textAlign === align ? 'bg-primary/40 text-primary' : 'hover:bg-white/10 text-white/60'}`}>
                          {align === 'left' ? '≡' : align === 'center' ? '☰' : '≡'}
                        </button>
                      ))}
                      <div className="w-px h-5 bg-white/20" />
                      <label title="Couleur texte" className="flex items-center gap-1 cursor-pointer">
                        <span className="text-[10px] text-white/60">A</span>
                        <input type="color" className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                          defaultValue="#000000" onChange={e => sendToIframe({ type: 'VE_STYLE', prop: 'color', value: e.target.value })} />
                      </label>
                    </>}

                    {veSelection && !veSelection.isImage && <>
                      <label title="Couleur de fond" className="flex items-center gap-1 cursor-pointer">
                        <span className="text-[10px] text-white/60">BG</span>
                        <input type="color" className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                          defaultValue="#ffffff" onChange={e => sendToIframe({ type: 'VE_STYLE', prop: 'backgroundColor', value: e.target.value })} />
                      </label>
                      <div className="w-px h-5 bg-white/20" />
                      <label className="flex items-center gap-1">
                        <span className="text-[10px] text-white/60">W</span>
                        <input type="text" placeholder="auto" className="w-16 h-7 bg-white/10 border border-white/20 rounded px-1 text-white text-xs"
                          onBlur={e => { if (e.target.value) sendToIframe({ type: 'VE_STYLE', prop: 'width', value: e.target.value }); }} />
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-[10px] text-white/60">P</span>
                        <input type="text" placeholder="0px" className="w-16 h-7 bg-white/10 border border-white/20 rounded px-1 text-white text-xs"
                          onBlur={e => { if (e.target.value) sendToIframe({ type: 'VE_STYLE', prop: 'padding', value: e.target.value }); }} />
                      </label>
                    </>}

                    {/* Move up/down */}
                    {veSelection?.canMove && <>
                      <div className="w-px h-5 bg-white/20" />
                      <button title="Monter le bloc" onClick={() => sendToIframe({ type: 'VE_MOVE_UP' })}
                        className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 text-sm">▲</button>
                      <button title="Descendre le bloc" onClick={() => sendToIframe({ type: 'VE_MOVE_DOWN' })}
                        className="w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center text-white/70 text-sm">▼</button>
                    </>}

                    {/* Z-index / calques */}
                    {veSelection && <>
                      <div className="w-px h-5 bg-white/20" />
                      <span className="text-[10px] text-white/40">z:{veSelection.zIndex}</span>
                      <button title="Premier plan" onClick={() => sendToIframe({ type: 'VE_LAYER_FRONT' })}
                        className="px-1.5 h-7 rounded hover:bg-white/10 text-white/60 text-[11px]">⬆</button>
                      <button title="Avancer d'un niveau" onClick={() => sendToIframe({ type: 'VE_LAYER_UP' })}
                        className="px-1.5 h-7 rounded hover:bg-white/10 text-white/60 text-[11px]">+z</button>
                      <button title="Reculer d'un niveau" onClick={() => sendToIframe({ type: 'VE_LAYER_DOWN' })}
                        className="px-1.5 h-7 rounded hover:bg-white/10 text-white/60 text-[11px]">-z</button>
                      <button title="Arrière plan" onClick={() => sendToIframe({ type: 'VE_LAYER_BACK' })}
                        className="px-1.5 h-7 rounded hover:bg-white/10 text-white/60 text-[11px]">⬇</button>
                    </>}

                    {/* Insert image */}
                    <div className="w-px h-5 bg-white/20" />
                    <button title="Insérer une image" onClick={() => imageInsertRef.current?.click()}
                      className="flex items-center gap-1 px-2 h-7 rounded hover:bg-white/10 text-white/70 text-[11px]">
                      <Upload className="w-3 h-3" /> Img+
                    </button>

                    {/* Layers panel toggle */}
                    <div className="w-px h-5 bg-white/20" />
                    <button
                      onClick={() => { setShowLayers(v => !v); sendToIframe({ type: 'VE_GET_LAYERS' }); }}
                      className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] transition-colors ${showLayers ? 'bg-primary/30 text-primary' : 'hover:bg-white/10 text-white/60'}`}>
                      Calques
                    </button>

                    <div className="ml-auto text-[10px] text-white/40 px-1">{veSelection ? `<${veSelection.tag.toLowerCase()}>` : 'Cliquez un élément'}</div>
                  </div>

                  {/* Row 2: text input (texte sélectionné) */}
                  {veSelection?.isText && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/50 flex-shrink-0">Texte</span>
                      <input
                        type="text"
                        value={veTextInput}
                        onChange={e => {
                          setVeTextInput(e.target.value);
                          sendToIframe({ type: 'VE_TEXT', value: e.target.value });
                        }}
                        className="flex-1 h-7 bg-white/10 border border-white/20 rounded px-2 text-white text-xs placeholder:text-white/30 focus:outline-none focus:border-primary/60"
                        placeholder="Contenu du texte…"
                      />
                    </div>
                  )}

                  {/* Row 2b: image zone (image sélectionnée) */}
                  {veSelection?.isImage && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[10px] text-white/50">Image</span>
                        {veSelection.imgW > 0 && (
                          <span className="text-[10px] text-white/40">{veSelection.imgW}×{veSelection.imgH}px (naturel)</span>
                        )}
                        <label className="flex items-center gap-1">
                          <span className="text-[10px] text-white/60">W</span>
                          <input type="text" defaultValue={veSelection.imgOW || ''} placeholder="auto"
                            key={`iw-${veSelection.rect.top}`}
                            className="w-16 h-6 bg-white/10 border border-white/20 rounded px-1 text-white text-xs"
                            onBlur={e => { if (e.target.value) sendToIframe({ type: 'VE_STYLE', prop: 'width', value: e.target.value + (isNaN(Number(e.target.value)) ? '' : 'px') }); }} />
                        </label>
                        <label className="flex items-center gap-1">
                          <span className="text-[10px] text-white/60">H</span>
                          <input type="text" defaultValue={veSelection.imgOH || ''} placeholder="auto"
                            key={`ih-${veSelection.rect.top}`}
                            className="w-16 h-6 bg-white/10 border border-white/20 rounded px-1 text-white text-xs"
                            onBlur={e => { if (e.target.value) sendToIframe({ type: 'VE_STYLE', prop: 'height', value: e.target.value + (isNaN(Number(e.target.value)) ? '' : 'px') }); }} />
                        </label>
                        <label title="Couleur de fond" className="flex items-center gap-1 cursor-pointer">
                          <span className="text-[10px] text-white/60">BG</span>
                          <input type="color" className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                            defaultValue="#ffffff" onChange={e => sendToIframe({ type: 'VE_STYLE', prop: 'backgroundColor', value: e.target.value })} />
                        </label>
                      </div>
                      <div
                        className="flex items-center gap-2 border border-dashed border-violet-500/50 rounded-lg px-3 py-2 cursor-pointer hover:bg-violet-500/10 transition-colors"
                        onClick={() => imageUploadRef.current?.click()}
                      >
                        <Upload className="w-4 h-4 text-violet-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-violet-300 font-medium">Remplacer l'image</div>
                          <div className="text-[10px] text-white/40 truncate">Cliquez pour importer JPG, PNG, WebP, SVG…</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Save / Cancel bar */}
                  {veDirty && (
                    <div className="flex items-center gap-2 bg-emerald-900/50 border border-emerald-500/30 rounded-lg px-3 py-1.5">
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
                        const fullHtml = veCurrentHtmlRef.current;
                        const newHtml = fullHtml ? (extractHtml(fullHtml) || fullHtml) : htmlCode;
                        setHtmlCode(newHtml);
                        const vId = selectedVersionId || project?.currentVersionId;
                        if (vId) updateCode.mutate({ versionId: vId, code: newHtml });
                        setVeDirty(false);
                        setVeSelection(null);
                        setVisualEditMode(false);
                        buildPreview(newHtml, cssCode, jsCode);
                        toast.success("Modifications sauvegardées !");
                      }} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded font-medium">
                        💾 Sauvegarder
                      </button>
                    </div>
                  )}

                  {/* Layers panel */}
                  {showLayers && (
                    <div className="border border-white/10 rounded-lg overflow-hidden">
                      <div className="text-[10px] text-white/40 px-2 py-1 bg-white/5 flex items-center justify-between">
                        <span>Calques — corps de page</span>
                        <span className="text-white/25">ordre visuel ↑ devant</span>
                      </div>
                      {veLayers.length === 0 && (
                        <div className="text-[10px] text-white/30 px-2 py-1.5">Cliquez un élément pour voir les calques</div>
                      )}
                      {[...veLayers].reverse().map(layer => (
                        <div key={layer.idx}
                          className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer border-t border-white/5 ${layer.selected ? 'bg-primary/20 text-primary' : 'hover:bg-white/5 text-white/70'}`}
                          onClick={() => sendToIframe({ type: 'VE_SELECT_IDX', idx: layer.idx })}>
                          <span className="font-mono text-[10px] text-white/40 w-14 flex-shrink-0">&lt;{layer.tag.toLowerCase()}&gt;</span>
                          <span className="flex-1 truncate text-[10px]">{layer.text || '—'}</span>
                          <span className={`text-[10px] w-10 text-right flex-shrink-0 ${layer.zIndex === 'auto' ? 'text-white/25' : 'text-violet-400'}`}>z:{layer.zIndex}</span>
                          <button title="Avancer" onClick={e => { e.stopPropagation(); sendToIframe({ type: 'VE_LAYER_ZIDX', idx: layer.idx, delta: 1 }); }}
                            className="w-5 h-5 rounded hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white text-[11px]">↑</button>
                          <button title="Reculer" onClick={e => { e.stopPropagation(); sendToIframe({ type: 'VE_LAYER_ZIDX', idx: layer.idx, delta: -1 }); }}
                            className="w-5 h-5 rounded hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white text-[11px]">↓</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Hidden inputs for image replace and insert */}
                  <input ref={imageUploadRef} type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => sendToIframe({ type: 'VE_IMG_SRC', value: ev.target?.result as string });
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }} />
                  <input ref={imageInsertRef} type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => sendToIframe({ type: 'VE_INSERT_IMG', src: ev.target?.result as string });
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }} />
                </div>
              )}

              {/* iframe preview — pleine hauteur */}
              <div className="flex-1 flex items-start justify-center p-3 bg-muted/20 overflow-hidden">
                <div className="h-full overflow-hidden rounded-lg border border-border/60 shadow-xl transition-all duration-300 bg-white"
                  style={{ width: VIEW_SIZES[viewMode], maxWidth: "100%" }}>
                  <iframe
                    ref={previewRef}
                    src={inspectMode ? getPreviewSrc() : (previewSrc || "about:blank")}
                    onLoad={() => { if (visualEditMode) setTimeout(injectVeScript, 50); }}
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
