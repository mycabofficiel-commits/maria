import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  Sparkles, Send, Eye, EyeOff, Code2, History, Smartphone, Tablet, Monitor,
  Loader2, ArrowLeft, Globe, RotateCcw, Save, CheckCircle2, MessageSquare,
  Rocket, Share2, Tag, MousePointer2, Copy, Check, PencilRuler, Upload,
  PanelLeftClose, PanelLeftOpen, Mic, MicOff, Paperclip, Camera, X as XIcon, Image as ImageIcon, Trash2,
  ExternalLink, Download, Plus, GripVertical, Plug, KeyRound, Brain, Database, TrendingUp, Link2,
  HardDrive, Type as TypeIcon
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

/* ── Storage helpers : bibliothèque d'images & de contenu ──────────────────── */
// Extrait toutes les images uniques (balises <img>, <source>, et url(...) dans le CSS / styles inline)
const extractMediaUrls = (html: string, css: string): string[] => {
  const seen = new Set<string>();
  const push = (u: string) => {
    const v = (u || "").trim();
    if (!v || v.startsWith("#")) return;
    seen.add(v);
  };
  let m: RegExpExecArray | null;
  const srcRe = /<(?:img|source)\b[^>]*\bsrc(?:set)?=["']([^"']+)["']/gi;
  while ((m = srcRe.exec(html))) push(m[1].split(",")[0].trim().split(" ")[0]);
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = urlRe.exec(html))) push(m[1]);
  while ((m = urlRe.exec(css))) push(m[1]);
  return Array.from(seen);
};
// Extrait les blocs de texte éditables (titres, paragraphes, boutons, liens, items…)
type TextItem = { idx: number; tag: string; text: string };
const TEXT_TAG_RE = /<(h1|h2|h3|h4|h5|h6|p|a|button|span|li|figcaption|label|blockquote)\b[^>]*>([^<>]*?)<\/\1>/gi;
const extractTexts = (html: string): TextItem[] => {
  const items: TextItem[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  const re = new RegExp(TEXT_TAG_RE.source, "gi");
  while ((m = re.exec(html))) {
    const text = m[2].trim();
    if (text && !/^[\s ]*$/.test(text)) items.push({ idx: i, tag: m[1].toLowerCase(), text });
    i++;
  }
  return items;
};
// Réinjecte les textes modifiés (par index d'occurrence) dans le HTML
const applyTextEdits = (html: string, edits: Record<number, string>): string => {
  let i = -1;
  const re = new RegExp(TEXT_TAG_RE.source, "gi");
  return html.replace(re, (full, _tag, inner) => {
    i++;
    const edit = edits[i];
    if (edit === undefined || edit === inner) return full;
    return full.replace(`>${inner}</`, () => `>${edit}</`);
  });
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
  var sel=null,deb=null,dragEl=null,overlay=null,resizing=null,dropIndicator=null,dropTarget=null;

  var vs=document.createElement('style');
  vs.id='__ve_s__';
  vs.textContent='[data-veh]{outline:2px dashed rgba(99,102,241,.5)!important;cursor:pointer!important}[data-vedrag]{opacity:0.5!important}';
  document.head.appendChild(vs);

  function cleanHtml(){
    var clone=document.documentElement.cloneNode(true);
    ['#__ve__','#__ve_s__','#__ve_ov__','#__ve_preload__','#__ve_htip__','#__ve_dim__','#__ve_drop__'].forEach(function(id){
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
    overlay.style.cssText='position:fixed;pointer-events:none;z-index:99998;box-sizing:border-box;outline:2px solid #6366f1;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;';
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
    // Dimension badge — shows W × H at top-left of overlay
    var dim=document.createElement('div');
    dim.id='__ve_dim__';
    dim.style.cssText='position:absolute;top:-22px;left:0;background:#6366f1;color:#fff;font:bold 11px/1 monospace;padding:2px 6px;border-radius:4px 4px 0 0;white-space:nowrap;pointer-events:none;';
    dim.textContent=Math.round(r.width)+'×'+Math.round(r.height)+' px';
    overlay.appendChild(dim);
    document.body.appendChild(overlay);
  }

  function updateOverlay(){
    if(!overlay||!sel)return;
    var r=sel.getBoundingClientRect();
    overlay.style.left=r.left+'px';overlay.style.top=r.top+'px';
    overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';
    var dim=overlay.querySelector('#__ve_dim__');
    if(dim)dim.textContent=Math.round(r.width)+'×'+Math.round(r.height)+' px';
    // Also notify parent of new dimensions (for toolbar update during resize)
    window.parent.postMessage({type:'VE_RESIZE',w:Math.round(r.width),h:Math.round(r.height)},'*');
  }

  function removeOverlay(){
    if(overlay&&overlay.parentNode)overlay.parentNode.removeChild(overlay);
    overlay=null;resizing=null;
  }

  function showDropLine(e,el){
    if(!el||!el.tagName||el===document.body||el===document.documentElement)return;
    if(!dropIndicator){
      dropIndicator=document.createElement('div');
      dropIndicator.id='__ve_drop__';
      dropIndicator.style.cssText='position:fixed;pointer-events:none;z-index:100001;height:3px;background:linear-gradient(90deg,#6366f1,#06b6d4);border-radius:2px;box-shadow:0 0 8px rgba(99,102,241,.8);';
      document.body.appendChild(dropIndicator);
    }
    var r=el.getBoundingClientRect();
    var pos=(e.clientY-r.top)<r.height/2?'before':'after';
    dropIndicator.style.left=r.left+'px';
    dropIndicator.style.top=(pos==='before'?r.top:r.bottom)-1.5+'px';
    dropIndicator.style.width=r.width+'px';
    dropIndicator.style.display='block';
    dropTarget={el:el,pos:pos};
  }

  function hideDropLine(){
    if(dropIndicator)dropIndicator.style.display='none';
    dropTarget=null;
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

  // Hover dimension tooltip
  var hoverTip=document.createElement('div');
  hoverTip.id='__ve_htip__';
  hoverTip.style.cssText='position:fixed;pointer-events:none;z-index:100000;background:rgba(30,30,46,.92);color:#a5b4fc;font:bold 10px/1.4 monospace;padding:3px 7px;border-radius:4px;border:1px solid #6366f1;white-space:nowrap;display:none;transition:none;';
  document.body.appendChild(hoverTip);

  document.addEventListener('mouseover',function(e){
    var t=e.target;
    if(t&&t.setAttribute&&t!==document.body&&t!==document.documentElement&&t!==sel&&!(t.getAttribute&&t.getAttribute('data-vehandle'))){
      t.setAttribute('data-veh','1');
      var r=t.getBoundingClientRect();
      hoverTip.textContent=Math.round(r.width)+'×'+Math.round(r.height)+' px';
      hoverTip.style.display='block';
    }
  },true);
  document.addEventListener('mouseout',function(e){
    var t=e.target;
    if(t&&t.removeAttribute)t.removeAttribute('data-veh');
    hoverTip.style.display='none';
  },true);
  document.addEventListener('mousemove',function(e){
    if(hoverTip.style.display==='block'){
      hoverTip.style.left=(e.clientX+14)+'px';
      hoverTip.style.top=(e.clientY-24)+'px';
    }
  },true);

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

  document.addEventListener('dragstart',function(e){
    if(e.target===sel){dragEl=sel;e.target.setAttribute('data-vedrag','1');e.dataTransfer.effectAllowed='move';}
  },true);
  document.addEventListener('dragover',function(e){
    if(!dragEl)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    var t=e.target;
    if(!t||!t.tagName||t===dragEl||dragEl.contains(t)||(t.getAttribute&&t.getAttribute('data-vehandle'))||t.id==='__ve_drop__')return;
    showDropLine(e,t);
  },true);
  document.addEventListener('drop',function(e){
    if(!dragEl)return;
    e.preventDefault();e.stopPropagation();
    var dropped=dragEl;
    if(dropTarget){
      var dt=dropTarget;
      if(dt.pos==='before'&&dt.el.parentElement)dt.el.parentElement.insertBefore(dropped,dt.el);
      else if(dt.el.parentElement){var nxt=dt.el.nextSibling;if(nxt)dt.el.parentElement.insertBefore(dropped,nxt);else dt.el.parentElement.appendChild(dropped);}
    }
    dropped.removeAttribute('data-vedrag');dragEl=null;
    hideDropLine();selectEl(dropped);push();sendLayers();
  },true);
  document.addEventListener('dragleave',function(e){
    if(!dragEl)return;
    if(!e.relatedTarget||!document.documentElement.contains(e.relatedTarget))hideDropLine();
  },true);
  document.addEventListener('dragend',function(){if(dragEl)dragEl.removeAttribute('data-vedrag');dragEl=null;hideDropLine();},true);

  document.addEventListener('input',function(){
    push();
    if(sel&&sel.contentEditable==='true')window.parent.postMessage({type:'VE_TEXT_SYNC',text:sel.innerText||''},'*');
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){selectEl(null);return;}
    // Delete/Backspace supprime l'élément sélectionné (sauf si on édite du texte)
    if((e.key==='Delete'||e.key==='Backspace')&&sel&&sel.contentEditable!=='true'){
      var activeTag=document.activeElement&&document.activeElement.tagName;
      if(activeTag==='INPUT'||activeTag==='TEXTAREA'||activeTag==='SELECT')return;
      e.preventDefault();e.stopPropagation();
      var parent=sel.parentElement;
      removeOverlay();
      sel.remove();
      sel=null;
      window.parent.postMessage({type:'VE_DESELECT'},'*');
      push();sendLayers();
    }
  });

  window.addEventListener('message',function(e){
    if(!e.data||!e.data.type)return;
    if(e.data.type==='VE_STYLE'&&sel){try{sel.style[e.data.prop]=e.data.value;}catch(x){}updateOverlay();push();}
    if(e.data.type==='VE_TEXT'&&sel){sel.innerText=e.data.value;push();}
    if(e.data.type==='VE_IMG_SRC'&&sel&&sel.tagName==='IMG'){sel.src=e.data.value;push();}
    if(e.data.type==='VE_MOVE_UP'&&sel&&sel.previousElementSibling){sel.parentElement.insertBefore(sel,sel.previousElementSibling);updateOverlay();push();sendLayers();}
    if(e.data.type==='VE_MOVE_DOWN'&&sel&&sel.nextElementSibling){sel.parentElement.insertBefore(sel.nextElementSibling,sel);updateOverlay();push();sendLayers();}
    if(e.data.type==='VE_DELETE'&&sel){removeOverlay();sel.remove();sel=null;window.parent.postMessage({type:'VE_DESELECT'},'*');push();sendLayers();}
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
    if(e.data.type==='VE_INSERT_BLOCK'){
      var tmp=document.createElement('div');
      tmp.innerHTML=e.data.html;
      var newEl=tmp.firstElementChild;
      if(!newEl){newEl=document.createElement('div');newEl.innerHTML=e.data.html;}
      if(sel){var nxs=sel.nextElementSibling;if(nxs)sel.parentElement.insertBefore(newEl,nxs);else sel.parentElement.appendChild(newEl);}
      else{document.body.appendChild(newEl);}
      selectEl(newEl);push();sendLayers();
    }
  });
})();`;

/* ── API key input with show/hide toggle ────────────────────────────────── */
function ApiKeyField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex-1 flex items-center bg-white/5 border border-white/15 rounded-lg overflow-hidden focus-within:border-emerald-500/60 transition-colors">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || "sk_…"}
        className="flex-1 bg-transparent px-2 py-1.5 text-xs text-white placeholder:text-white/30 outline-none font-mono"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="button" onClick={() => setShow(v => !v)} className="px-2 text-white/40 hover:text-white/80 transition-colors flex-shrink-0">
        {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
    </div>
  );
}

/* ── Add integration form (used in integrations panel) ──────────────────── */
function AddIntegrationForm({ projectId, onSave, saving }: { projectId: number; onSave: (d: any) => void; saving: boolean }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  return (
    <div className="space-y-1.5 border border-dashed border-border/40 rounded-lg p-2">
      <p className="text-[10px] text-muted-foreground font-medium">Ajouter une intégration</p>
      <input
        type="text"
        placeholder="Nom de l'API (ex: stripe, openai…)"
        value={name}
        onChange={e => setName(e.target.value)}
        className="w-full px-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg placeholder:text-white/30 focus:outline-none focus:border-primary/50"
      />
      <ApiKeyField value={key} onChange={setKey} placeholder="Clé API secrète…" />
      <button
        disabled={!name.trim() || !key.trim() || saving}
        onClick={() => { if (name && key) { onSave({ apiName: name.trim().toLowerCase(), apiLabel: name.trim(), key: key.trim(), projectId }); setName(""); setKey(""); }}}
        className="w-full py-1.5 rounded-lg bg-primary/80 hover:bg-primary disabled:opacity-40 text-white text-[11px] font-medium transition-colors flex items-center justify-center gap-1"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        {saving ? "Sauvegarde…" : "Ajouter"}
      </button>
    </div>
  );
}

/* ── Visual Editor block palette ────────────────────────────────────────── */
const VE_BLOCKS = [
  {
    id: "hero", label: "Hero", icon: "🏠", category: "sections",
    html: `<section style="padding:80px 40px;text-align:center;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;"><h1 style="font-size:2.8em;font-weight:700;margin:0 0 16px">Titre Principal</h1><p style="font-size:1.15em;opacity:.85;margin:0 0 32px">Sous-titre accrocheur qui décrit votre proposition de valeur</p><a href="#" style="background:white;color:#6366f1;padding:14px 32px;border-radius:50px;font-weight:700;text-decoration:none;display:inline-block">Commencer →</a></section>`,
  },
  {
    id: "cta", label: "CTA", icon: "📣", category: "sections",
    html: `<section style="padding:60px 40px;text-align:center;background:#fafafa;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;"><h2 style="font-size:2em;font-weight:700;color:#111;margin:0 0 12px">Prêt à commencer ?</h2><p style="color:#6b7280;margin:0 0 28px;font-size:1.05em">Rejoignez des milliers d'utilisateurs satisfaits.</p><a href="#" style="background:#6366f1;color:white;padding:14px 32px;border-radius:8px;font-weight:600;text-decoration:none;display:inline-block;font-size:1em">Démarrer gratuitement</a></section>`,
  },
  {
    id: "features", label: "Features 3 col", icon: "✨", category: "sections",
    html: `<section style="padding:60px 40px;"><h2 style="text-align:center;font-size:2em;font-weight:700;margin:0 0 40px;color:#111">Nos fonctionnalités</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;"><div style="padding:28px;background:#f9fafb;border-radius:12px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:2.4em;margin-bottom:14px">⚡</div><h3 style="font-weight:600;margin:0 0 8px;color:#111">Rapide</h3><p style="color:#6b7280;font-size:.9em;margin:0">Description de cette fonctionnalité importante.</p></div><div style="padding:28px;background:#f9fafb;border-radius:12px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:2.4em;margin-bottom:14px">🔒</div><h3 style="font-weight:600;margin:0 0 8px;color:#111">Sécurisé</h3><p style="color:#6b7280;font-size:.9em;margin:0">Description de cette fonctionnalité importante.</p></div><div style="padding:28px;background:#f9fafb;border-radius:12px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:2.4em;margin-bottom:14px">🌐</div><h3 style="font-weight:600;margin:0 0 8px;color:#111">Accessible</h3><p style="color:#6b7280;font-size:.9em;margin:0">Description de cette fonctionnalité importante.</p></div></div></section>`,
  },
  {
    id: "text2col", label: "2 colonnes", icon: "📐", category: "sections",
    html: `<section style="padding:60px 40px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;"><div><h2 style="font-size:1.9em;font-weight:700;color:#111;margin:0 0 16px">Titre de la section</h2><p style="color:#4b5563;line-height:1.75;margin:0 0 20px">Paragraphe décrivant en détail les avantages ou fonctionnalités clés. Soyez précis et convaincant.</p><a href="#" style="color:#6366f1;font-weight:600;text-decoration:none;">En savoir plus →</a></div><div style="background:#f3f4f6;border-radius:16px;padding:48px 32px;text-align:center;color:#9ca3af;font-size:.9em;">Image ou contenu</div></section>`,
  },
  {
    id: "testimonial", label: "Témoignage", icon: "💬", category: "sections",
    html: `<section style="padding:60px 40px;background:#faf5ff;"><blockquote style="max-width:680px;margin:0 auto;text-align:center;"><p style="font-size:1.35em;font-style:italic;color:#4c1d95;line-height:1.75;margin:0 0 28px">"Ce produit a complètement transformé notre façon de travailler. Je le recommande sans hésitation à toute l'équipe."</p><footer style="color:#7c3aed;font-weight:600;">Marie Dupont <span style="font-weight:400;color:#6b7280">— Directrice Marketing, Entreprise XYZ</span></footer></blockquote></section>`,
  },
  {
    id: "pricing", label: "Tarifs", icon: "💰", category: "sections",
    html: `<section style="padding:60px 40px;"><h2 style="text-align:center;font-size:2em;font-weight:700;margin:0 0 40px;color:#111">Nos tarifs</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;max-width:860px;margin:0 auto;"><div style="border:1px solid #e5e7eb;border-radius:16px;padding:32px;text-align:center;"><h3 style="font-weight:600;margin:0 0 8px;color:#374151">Starter</h3><p style="font-size:2.5em;font-weight:700;color:#111;margin:0 0 4px">0€<span style="font-size:.4em;font-weight:400;color:#6b7280">/mois</span></p><p style="color:#6b7280;font-size:.85em;margin:0 0 24px">Idéal pour débuter</p><a href="#" style="display:block;border:1px solid #6366f1;color:#6366f1;padding:10px;border-radius:8px;text-decoration:none;font-weight:600;">Commencer</a></div><div style="border:2px solid #6366f1;border-radius:16px;padding:32px;text-align:center;background:#fafaff;"><p style="font-size:.75em;font-weight:600;color:#6366f1;margin:0 0 8px;text-transform:uppercase">Recommandé</p><h3 style="font-weight:600;margin:0 0 8px;color:#374151">Pro</h3><p style="font-size:2.5em;font-weight:700;color:#111;margin:0 0 4px">29€<span style="font-size:.4em;font-weight:400;color:#6b7280">/mois</span></p><p style="color:#6b7280;font-size:.85em;margin:0 0 24px">Pour les professionnels</p><a href="#" style="display:block;background:#6366f1;color:white;padding:10px;border-radius:8px;text-decoration:none;font-weight:600;">Choisir Pro</a></div></div></section>`,
  },
  {
    id: "contact", label: "Contact", icon: "✉️", category: "forms",
    html: `<section style="padding:60px 40px;max-width:640px;margin:0 auto;"><h2 style="font-size:1.9em;font-weight:700;margin:0 0 28px;text-align:center;color:#111">Contactez-nous</h2><form style="display:flex;flex-direction:column;gap:16px;" onsubmit="event.preventDefault();this.innerHTML='<p style=text-align:center;padding:32px;color:#059669;font-weight:600;font-size:1.1em>✅ Message envoyé !</p>';"><input placeholder="Votre nom" style="padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;outline:none;font-family:inherit;" /><input type="email" placeholder="Votre email" style="padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;outline:none;font-family:inherit;" /><textarea rows="4" placeholder="Votre message…" style="padding:12px 16px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;resize:vertical;outline:none;font-family:inherit;"></textarea><button type="submit" style="background:#6366f1;color:white;padding:14px;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer;font-family:inherit;">Envoyer →</button></form></section>`,
  },
  {
    id: "gallery", label: "Galerie", icon: "🖼️", category: "media",
    html: `<section style="padding:60px 40px;"><h2 style="text-align:center;font-size:1.8em;font-weight:700;margin:0 0 32px;color:#111">Galerie</h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;"><img src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=75" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;" /><img src="https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=400&q=75" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;" /><img src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&q=75" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;" /><img src="https://images.unsplash.com/photo-1501854140801-50d01698950b?w=400&q=75" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;" /></div></section>`,
  },
  {
    id: "text", label: "Texte riche", icon: "📝", category: "content",
    html: `<section style="padding:48px 40px;max-width:720px;margin:0 auto;"><h2 style="font-size:1.8em;font-weight:700;color:#111;margin:0 0 16px">Titre de section</h2><p style="color:#374151;line-height:1.8;margin:0 0 16px">Premier paragraphe avec votre contenu principal. Expliquez votre sujet de manière claire et engageante pour vos visiteurs.</p><p style="color:#374151;line-height:1.8;margin:0">Second paragraphe avec des informations supplémentaires. N'hésitez pas à ajouter des détails pertinents.</p></section>`,
  },
  {
    id: "divider", label: "Séparateur", icon: "—", category: "layout",
    html: `<div style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" /></div>`,
  },
  {
    id: "spacer", label: "Espace", icon: "↕", category: "layout",
    html: `<div style="height:80px;"></div>`,
  },
] as const;

const VE_BLOCK_CATEGORIES = [
  { id: "sections", label: "Sections" },
  { id: "forms",    label: "Formulaires" },
  { id: "media",    label: "Médias" },
  { id: "content",  label: "Contenu" },
  { id: "layout",   label: "Mise en page" },
] as const;

/* ── Pharmacy cross icon (replaces Bug) ─────────────────────────────────── */
function PharmacieCross({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M19 9h-4V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v4H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4h4a1 1 0 0 0 1-1v-4a1 1 0 0-1-1z" />
    </svg>
  );
}

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
  const [isChatPending, setIsChatPending] = useState(false);
  /* ── Console errors captured from the preview iframe ── */
  const [consoleErrors, setConsoleErrors] = useState<string[]>([]);
  /* ── Expo / React Native ── */
  const [expoSnackUrl, setExpoSnackUrl] = useState("");
  const [expoSnackPlatform, setExpoSnackPlatform] = useState<"android" | "ios">("android");
  const [expoSnackLoading, setExpoSnackLoading] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [expoHtmlPreview, setExpoHtmlPreview] = useState("");
  const [expoHtmlLoading, setExpoHtmlLoading] = useState(false);

  const saveToExpoSnack = async (code: string, name: string) => {
    setExpoSnackLoading(true);
    try {
      const res = await fetch("https://exp.host/--/api/v2/snack/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifest: { name, description: `App générée par Mar-ia`, sdkVersion: "54.0.0" },
          code: { "App.js": { type: "CODE", contents: code } },
          dependencies: { "expo": "~54.0.0", "react": "18.3.1", "react-native": "0.76.7", "expo-linear-gradient": "~14.0.1" },
        }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const hashId = data.hashId || data.id || "";
        if (hashId) {
          const url = `https://snack.expo.dev/${hashId}`;
          setExpoSnackUrl(url);
          toast.success("Lien Expo Snack généré !");
        } else {
          toast.error("Expo Snack n'a pas retourné d'ID.");
        }
      } else {
        toast.error("Erreur lors de la création du Snack.");
      }
    } catch {
      toast.error("Impossible de contacter Expo Snack.");
    } finally {
      setExpoSnackLoading(false);
    }
  };

  const generateExpoHtmlPreview = async (code: string) => {
    if (!code || expoHtmlLoading) return;
    setExpoHtmlLoading(true);
    setExpoHtmlPreview(""); // reset previous preview
    let partialHtml = "";
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPartial = (html: string) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const cleaned = html.replace(/^```html\n?/i, "").replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
        if (cleaned) buildPreview(cleaned, "", "");
      }, 400);
    };

    try {
      const res = await fetch("/api/expo/html-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, projectName: project?.name || "App" }),
      });
      if (!res.ok || !res.body) throw new Error("Erreur serveur");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: chunk")) continue;
          if (line.startsWith("event: error")) continue;
          if (line.startsWith("event: done")) continue;
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          try {
            const evt = JSON.parse(raw) as { text?: string; html?: string; message?: string };
            if (evt.text) {
              partialHtml += evt.text;
              flushPartial(partialHtml);
            } else if (evt.html) {
              // Final cleaned HTML from server
              if (debounceTimer) clearTimeout(debounceTimer);
              setExpoHtmlPreview(evt.html);
              buildPreview(evt.html, "", "");
            } else if (evt.message) {
              toast.error("Erreur aperçu : " + evt.message);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: any) {
      toast.error("Impossible de générer l'aperçu : " + (err?.message ?? "erreur réseau"));
    } finally {
      if (debounceTimer) clearTimeout(debounceTimer);
      setExpoHtmlLoading(false);
    }
  };

  /* ── Resizable panel ── */
  const [panelWidth, setPanelWidth] = useState(45);
  const [codeCollapsed, setCodeCollapsed] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(45);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── Plan validation before actions (generate/debug) ── */
  const [pendingAction, setPendingAction] = useState<{ summary: string; action: () => void } | null>(null);
  const [localChatItems, setLocalChatItems] = useState<Array<{ id: number; summary: string; timestamp: Date }>>([]);

  /* ── API integrations ── */
  const [pendingApiRequest, setPendingApiRequest] = useState<{ apiName: string; apiLabel: string; message: string } | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [showIntegrationsPanel, setShowIntegrationsPanel] = useState(false);
  const [discussionMode, setDiscussionMode] = useState(false);

  /* ── Chat workflow phases ── */
  const [chatPhase, setChatPhase] = useState<"idle" | "reasoning" | "awaiting_validation" | "executing">("idle");
  const [pendingSummary, setPendingSummary] = useState<string>("");
  const [summaryEdit, setSummaryEdit] = useState<string>("");
  const [isSummaryEditing, setIsSummaryEditing] = useState(false);
  const [pendingOriginalMsg, setPendingOriginalMsg] = useState<string>("");

  /* ── Suggestions A/B/C post-action ── */
  const [suggestions, setSuggestions] = useState<Array<{ label: string; text: string } | string>>([]);
  const fetchSuggestions = useCallback(async (context: string, lastAction: string, lang = language) => {
    setSuggestions([]);
    try {
      const r = await fetch("/api/stream/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ context: context.slice(0, 400), lastAction, language: lang }),
      });
      if (!r.ok) return;
      const { suggestions: s } = await r.json();
      if (Array.isArray(s) && s.length > 0) setSuggestions(s);
    } catch { /* silencieux */ }
  }, [language]);

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
  const [showBlocksPalette, setShowBlocksPalette] = useState(false);
  const [showDbPanel, setShowDbPanel] = useState(false);
  const [showDomainPanel, setShowDomainPanel] = useState(false);
  const [showSeoPanel, setShowSeoPanel] = useState(false);
  const [showStoragePanel, setShowStoragePanel] = useState(false);
  const [storageTab, setStorageTab] = useState<"images" | "content">("images");
  const [imgEdits, setImgEdits] = useState<Record<string, string>>({});
  const [textEdits, setTextEdits] = useState<Record<number, string>>({});
  const storageImgUploadRef = useRef<HTMLInputElement>(null);
  const storageUploadTargetRef = useRef<string | null>(null);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [seoOgTitle, setSeoOgTitle] = useState("");
  const [seoOgDesc, setSeoOgDesc] = useState("");
  const [seoKeywords, setSeoKeywords] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [blockCategory, setBlockCategory] = useState<string>("sections");
  const [veLayers, setVeLayers] = useState<Array<{ idx: number; tag: string; text: string; zIndex: string; selected: boolean }>>([]);
  const [veLiveDims, setVeLiveDims] = useState<{ w: number; h: number } | null>(null);
  const [dimCopied, setDimCopied] = useState(false);
  const [veDeleteConfirm, setVeDeleteConfirm] = useState(false);
  const veOriginalHtmlRef = useRef<string>("");
  const [veDirty, setVeDirty] = useState(false);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const imageInsertRef = useRef<HTMLInputElement>(null);
  const veCurrentHtmlRef = useRef<string>("");

  /* code state (editable) */
  const [htmlCode, setHtmlCode] = useState("");
  const [cssCode, setCssCode] = useState("");
  const [jsCode, setJsCode] = useState("");

  // Storage : listes calculées d'images & de textes éditables
  const storageImages = useMemo(() => extractMediaUrls(htmlCode, cssCode), [htmlCode, cssCode]);
  const storageTexts = useMemo(() => extractTexts(htmlCode), [htmlCode]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const cmContainerRef = useRef<HTMLDivElement>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);

  /* queries */
  const utils = trpc.useUtils();
  const { data: project, isLoading: projectLoading, refetch: refetchProject } = trpc.projects.get.useQuery({ id: projectId }, { enabled: !!projectId });
  const { data: versions } = trpc.projects.getVersions.useQuery({ projectId }, { enabled: !!projectId });
  const { data: chatMessages } = trpc.projects.getChatMessages.useQuery({ projectId }, { enabled: !!projectId });
  const { data: currentVersionData } = trpc.projects.getVersionCode.useQuery(
    { versionId: selectedVersionId || project?.currentVersionId || 0 },
    { enabled: !!(selectedVersionId || project?.currentVersionId) }
  );

  /* ── Expo flag — must be declared early (before any useEffect that uses it) ── */
  const isExpoProject = project?.framework === "expo";

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

  /* ── Pre-fill form from project metadata (new project, no code yet) ── */
  const autoGenTriggeredRef = useRef(false);
  const shouldAutoGen = useRef(new URLSearchParams(window.location.search).get("autoGenerate") === "true");
  // Prevents the builder form from flashing while we wait for auto-generation to kick in
  const [waitingForAutoGen, setWaitingForAutoGen] = useState(shouldAutoGen.current);

  useEffect(() => {
    if (!project || project.currentVersionId) return; // skip if already has code
    if (project.siteType) setSiteType(project.siteType);
    if (project.style) setStyle(project.style);
    if (project.language) setLanguage(project.language);
    if (project.colorPalette) setColorPalette(project.colorPalette);
    // Strip [INSPIRATION_URLS: ...] block from displayed prompt — the generator handles it server-side
    if (project.description && !prompt) {
      const cleanDesc = project.description.replace(/\[INSPIRATION_URLS:[^\]]*\]/g, "").trim();
      setPrompt(cleanDesc || project.description);
    }
    // Clean URL
    if (shouldAutoGen.current) window.history.replaceState({}, "", window.location.pathname);
  }, [project?.id]);

  /* ── Auto-generate: fires once prompt is set (after pre-fill) ── */
  useEffect(() => {
    if (!shouldAutoGen.current) return;
    if (autoGenTriggeredRef.current) return;
    if (!prompt.trim()) return; // wait for pre-fill to set the prompt
    if (!project || project.currentVersionId) return;
    if (isGenerating) return;
    autoGenTriggeredRef.current = true;
    shouldAutoGen.current = false;
    // Set isGenerating=true synchronously with waitingForAutoGen=false
    // so React batches them and the builder form never flashes
    setWaitingForAutoGen(false);
    setIsGenerating(true);
    // Small delay ensures the "Génération en cours…" UI renders before the fetch
    setTimeout(() => generateSiteStream(), 80);
  }, [prompt, project?.id, isGenerating]);

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
  // Scroll quand isChatPending démarre (pour voir les dots/agent steps)
  useEffect(() => {
    if (isChatPending) setTimeout(scrollToBottom, 80);
  }, [isChatPending, scrollToBottom]);

  /* preview HTML content (srcdoc — no blob URL) */
  const [previewSrc, setPreviewSrc] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildPreview = useCallback((h: string, c: string, j: string) => {
    const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    // Intercept all <a href> clicks in the sandboxed iframe to prevent navigation
    // (without allow-same-origin, clicking href="#..." would blank the iframe)
    const navInterceptor = `<script>
(function(){document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;var hr=a.getAttribute('href');if(!hr||hr.startsWith('javascript'))return;e.preventDefault();if(hr.startsWith('#')){var id=hr.slice(1);if(!id)return;var el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth'});}},true);})();
<\/script>`;
    // Capture JS errors / console.error from the iframe and send to parent via postMessage
    // Parent stores them and feeds them to the LLM as additional context
    const consoleCapture = `<script>
(function(){
  var _oe=window.onerror;
  window.onerror=function(msg,src,line,col,err){
    window.parent.postMessage({type:'CONSOLE_ERROR',message:'JS Error: '+msg+' (ligne '+line+')'},'*');
    if(_oe)return _oe.apply(this,arguments);
  };
  var _ce=console.error.bind(console);
  console.error=function(){
    _ce.apply(console,arguments);
    var txt=Array.from(arguments).map(function(a){try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(x){return String(a);}}).join(' ');
    window.parent.postMessage({type:'CONSOLE_ERROR',message:'[console.error] '+txt.slice(0,300)},'*');
  };
  window.addEventListener('unhandledrejection',function(e){
    var reason=e.reason?(e.reason.message||String(e.reason)):'unknown';
    window.parent.postMessage({type:'CONSOLE_ERROR',message:'Promise rejetée: '+reason.slice(0,200)},'*');
  });
})();
<\/script>`;
    let full: string;
    // If h is a complete HTML document (imported), use it as-is with minimal additions
    const isFullDoc = /<!doctype|<html[\s>]/i.test(h);
    if (isFullDoc) {
      full = h;
      // Only add viewport if missing
      if (!h.includes('name="viewport"') && !h.includes("name='viewport'")) {
        full = full.replace(/<head>/i, `<head>${viewportMeta}`);
      }
      // Inject console capture first (before any user JS runs)
      full = full.replace(/<head>/i, `<head>${consoleCapture}`);
      // Only add extra CSS/JS if not already present in the document
      if (c && !/<style/i.test(h)) full = full.replace(/<\/head>/i, `<style>${c}</style></head>`);
      if (j && !/<script/i.test(h)) full = full.replace(/<\/body>/i, `<script>${j}<\/script></body>`);
      full = full.replace(/<\/body>/i, `${navInterceptor}</body>`);
    } else if (h) {
      full = h
        .replace(/<head>/i, `<head>${viewportMeta}${consoleCapture}`)
        .replace(/<\/head>/i, `<style>${c}</style></head>`)
        .replace(/<\/body>/i, `<script>${j}<\/script>${navInterceptor}</body>`);
    } else {
      full = `<!DOCTYPE html><html><head>${viewportMeta}${consoleCapture}<meta charset="UTF-8"><style>${c}</style></head><body><script>${j}<\/script>${navInterceptor}</body></html>`;
    }
    setPreviewSrc(full);
  }, []);

  useEffect(() => {
    if (!htmlCode && !cssCode && !jsCode) return;
    if (visualEditMode) return;
    if (isExpoProject) {
      // For Expo: show existing HTML preview if available, else leave iframe alone
      if (expoHtmlPreview) buildPreview(expoHtmlPreview, "", "");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => buildPreview(htmlCode, cssCode, jsCode), 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [htmlCode, cssCode, jsCode, buildPreview, visualEditMode, isExpoProject, expoHtmlPreview]);

  /* also update preview when version data arrives (from server) */
  useEffect(() => {
    const code = currentVersionData?.generatedCode;
    if (!code || visualEditMode) return;
    if (isExpoProject) {
      // Auto-generate HTML preview on first load if not already generated
      if (!expoHtmlPreview && !expoHtmlLoading) generateExpoHtmlPreview(code);
    } else {
      buildPreview(extractHtml(code), extractCss(code), extractJs(code));
    }
  }, [currentVersionData?.generatedCode, visualEditMode, isExpoProject]);

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

  const generateSiteStream = useCallback(async () => {
    if (!prompt.trim()) { toast.error("Décrivez votre site d'abord."); return; }
    setIsGenerating(true);
    setAgentStep(null);
    setConsoleErrors([]); // reset console errors on new generation
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
              if (evt.snackUrl) {
                setExpoSnackUrl(evt.snackUrl);
              }
              if (evt.versionId) {
                setAgentStep(null);
                setSelectedVersionId(evt.versionId);
                setStreamingTokens(evt.tokensUsed || 0);
                const isExpo = project?.framework === "expo";
                toast.success(isExpo ? `App générée ! ${evt.tokensUsed} tokens.` : `Site généré ! ${evt.tokensUsed} tokens.`);
                utils.projects.getVersions.invalidate({ projectId });
                utils.projects.get.invalidate({ id: projectId });
                utils.user.getUsageStats.invalidate();
                fetchSuggestions(`${siteType} ${style} — ${prompt}`, "generate", language);
              }
              if (evt.message) toast.error(evt.message);
            } catch { /* skip */ }
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      // Don't set isGenerating(false) immediately — wait 1.5s for tRPC to refetch
      // so we never flash the builder form between "generation done" and "hasCode = true"
      setTimeout(() => {
        setIsGenerating(false);
        setStreamingChars(0);
        setAgentStep(null);
      }, 1500);
    }
  }, [projectId, prompt, siteType, style, language, colorPalette]);

  /* Keep tRPC mutation as fallback (unused but keeps types happy) */
  const generateSite = trpc.projects.generate.useMutation({ onError: (err: any) => toast.error(err.message) });
  const clearChat = trpc.projects.clearChat.useMutation({
    onSuccess: () => { utils.projects.getChatMessages.invalidate({ projectId }); toast.success("Historique effacé"); },
    onError: (err: any) => toast.error(err.message),
  });

  /* ── Phase 1: Raisonnement → awaiting_validation (ou discuss direct) ── */
  const sendChatStream = useCallback(async (msg: string) => {
    if (!msg.trim() && attachments.length === 0) return;
    setIsChatPending(true);
    setStreamingReply("");
    setChatMessage("");
    setSuggestions([]);
    setChatPhase("reasoning");
    recognitionRef.current?.stop();
    setIsRecording(false);
    const sentAttachments = [...attachments];
    setAttachments([]);
    setPendingOriginalMsg(msg);

    // Optimistically add user message
    utils.projects.getChatMessages.setData({ projectId }, (old: any) => [
      ...(old || []),
      { id: Date.now(), role: "user", content: msg || "📎 Image jointe", createdAt: new Date().toISOString(), projectId, userId: 0, versionId: null, tokensUsed: null },
    ]);

    // ── Mode Discussion : streaming conversationnel direct ──
    if (discussionMode) {
      try {
        const res = await fetch("/api/stream/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ projectId, message: msg, phase: "discuss" }),
        });
        if (!res.ok || !res.body) throw new Error(await res.text());
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let accReply = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.agent && evt.step) setAgentStep({ agent: evt.agent, step: evt.step, icon: evt.icon || "💬" });
              if (evt.text !== undefined) { accReply += evt.text; setStreamingReply(accReply); }
              if (evt.discuss && evt.reply !== undefined) {
                setStreamingReply("");
                utils.projects.getChatMessages.invalidate({ projectId });
                setChatPhase("idle");
              }
              if (evt.message) toast.error(evt.message);
            } catch { /* skip */ }
          }
        }
      } catch (err: any) {
        toast.error(err.message);
        setChatPhase("idle");
      } finally {
        setIsChatPending(false);
        setAgentStep(null);
        setStreamingReply("");
        setChatPhase("idle");
      }
      return;
    }

    try {
      const res = await fetch("/api/stream/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          message: msg || "Voici une image de référence.",
          phase: "reason",
          consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
          images: sentAttachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType })),
        }),
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
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.agent && evt.step) setAgentStep({ agent: evt.agent, step: evt.step, icon: evt.icon || "🧠" });
            // API key request from server
            if (evt.apiName && evt.apiLabel) {
              setPendingApiRequest({ apiName: evt.apiName, apiLabel: evt.apiLabel, message: evt.message || `Clé API requise pour ${evt.apiLabel}` });
              setApiKeyInput("");
            }
            if (evt.summary !== undefined) {
              setPendingSummary(evt.summary);
              setSummaryEdit(evt.summary);
              setChatPhase("awaiting_validation");
              // Scroll to bottom so validation card is visible
              setTimeout(scrollToBottom, 150);
            }
            if (evt.message && !evt.apiName) toast.error(evt.message);
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      toast.error(err.message);
      setChatPhase("idle");
    } finally {
      setIsChatPending(false);
      setAgentStep(null);
    }
  }, [projectId, attachments, discussionMode]);

  /* ── Phase 2: Execute après validation ── */
  const executeChatStream = useCallback(async (originalMsg: string, validatedSummary: string) => {
    setIsChatPending(true);
    setStreamingReply("");
    setChatPhase("executing");
    setSuggestions([]);

    try {
      const res = await fetch("/api/stream/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId, message: originalMsg, phase: "execute", validatedSummary, consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined }),
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
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.agent && evt.step) setAgentStep({ agent: evt.agent, step: evt.step, icon: evt.icon || "⚙️" });
            if (evt.text !== undefined) {
              accJson += evt.text;
              const m = accJson.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
              if (m) setStreamingReply(m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
            }
            if (evt.versionId) { setSelectedVersionId(evt.versionId); toast.success(isExpoProject ? "App modifiée !" : "Site modifié !"); }
            if (evt.reply !== undefined) {
              setStreamingReply("");
              utils.projects.getChatMessages.invalidate({ projectId });
              utils.projects.getVersions.invalidate({ projectId });
              utils.projects.get.invalidate({ id: projectId });
              if (evt.generatedCode) {
                setHtmlCode(extractHtml(evt.generatedCode));
                setCssCode(extractCss(evt.generatedCode));
                setJsCode(extractJs(evt.generatedCode));
                // For Expo projects, also refresh the HTML phone preview
                if (isExpoProject && evt.action === "modify") {
                  generateExpoHtmlPreview(evt.generatedCode);
                }
              } else if (evt.action === "modify") {
                toast.warning("Code non extrait. Réessaie.");
              }
              setChatPhase("idle");
            }
            if (evt.suggestions && Array.isArray(evt.suggestions)) setSuggestions(evt.suggestions);
            if (evt.message) toast.error(evt.message);
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setStreamingReply("");
      setIsChatPending(false);
      setAgentStep(null);
      setChatPhase("idle");
    }
  }, [projectId, isExpoProject, generateExpoHtmlPreview]);

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

  /* ── Integrations ── */
  const { data: integrations, refetch: refetchIntegrations } = trpc.integrations.list.useQuery(
    { projectId },
    { enabled: showIntegrationsPanel }
  );
  const saveIntegration = trpc.integrations.save.useMutation({
    onSuccess: () => { refetchIntegrations(); toast.success("Clé API sauvegardée 🔐"); },
    onError: (err: any) => toast.error(err.message),
  });
  const deleteIntegration = trpc.integrations.delete.useMutation({
    onSuccess: () => { refetchIntegrations(); toast.success("Intégration supprimée"); },
    onError: (err: any) => toast.error(err.message),
  });

  const updateProject = trpc.projects.update.useMutation({ onSuccess: () => refetchProject() });
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
      // Guard: if contentDocument is null/inaccessible (cross-origin or not ready),
      // retry once — but cap retries to avoid infinite loop
      if (!iframeDoc) {
        console.warn('[VE] contentDocument null — sandbox may be missing allow-same-origin');
        return;
      }
      if (!iframeDoc.body) {
        // Not ready yet — retry once after 200ms (but not infinitely)
        setTimeout(() => {
          const doc = previewRef.current?.contentDocument;
          if (doc?.body) {
            doc.getElementById('__ve__')?.remove();
            doc.getElementById('__ve_preload__')?.remove();
            const s = doc.createElement('script');
            s.id = '__ve__';
            s.textContent = VE_SCRIPT;
            doc.body.appendChild(s);
          }
        }, 200);
        return;
      }
      // VE script already embedded via srcDoc (getPreviewSrc), skip re-injection
      // unless it's missing (e.g. after a preview rebuild)
      if (iframeDoc.getElementById('__ve_preload__') || iframeDoc.getElementById('__ve__')) {
        return; // already running
      }
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

  /**
   * Inject html2canvas into a hidden iframe and return a JPEG base64 screenshot.
   * The iframe renders the real site HTML so the LLM sees exactly what the user sees.
   */
  const captureScreenshot = useCallback((): Promise<{ data: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const code = currentVersionData?.generatedCode || htmlCode || "";
      if (!code) { reject(new Error("Aucun code à capturer")); return; }

      // Inject html2canvas (CDN) + capture script into the site HTML
      const captureScript = `<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
<script>
(function(){
  function doCapture(){
    if(typeof html2canvas==='undefined'){
      window.parent.postMessage({type:'SCREENSHOT_ERROR',error:'html2canvas indisponible'},'*');
      return;
    }
    html2canvas(document.documentElement,{
      useCORS:false,allowTaint:true,scale:0.5,logging:false,
      width:1280,height:900,windowWidth:1280,windowHeight:900
    }).then(function(canvas){
      window.parent.postMessage({type:'SCREENSHOT_DONE',dataUrl:canvas.toDataURL('image/jpeg',0.72)},'*');
    }).catch(function(err){
      window.parent.postMessage({type:'SCREENSHOT_ERROR',error:String(err)},'*');
    });
  }
  // Wait for page + fonts + scripts to settle
  if(document.readyState==='complete') setTimeout(doCapture,2200);
  else window.addEventListener('load',function(){setTimeout(doCapture,2200);});
})();
<\/script>`;

      // Build debug HTML (inject into <head> + before </body>)
      let debugHtml = code;
      if (/<\/head>/i.test(debugHtml)) {
        debugHtml = debugHtml.replace(/<\/head>/i, `<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script></head>`);
      } else {
        debugHtml = `<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>` + debugHtml;
      }
      if (/<\/body>/i.test(debugHtml)) {
        debugHtml = debugHtml.replace(/<\/body>/i, `${captureScript}</body>`);
      } else {
        debugHtml += captureScript;
      }

      // Create off-screen iframe (1280×900 — desktop viewport)
      const iframe = document.createElement("iframe");
      (iframe as any).sandbox = "allow-scripts allow-same-origin";
      iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1280px;height:900px;opacity:0;pointer-events:none;";
      iframe.srcdoc = debugHtml;
      document.body.appendChild(iframe);

      const tid = setTimeout(() => {
        window.removeEventListener("message", handler);
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
        reject(new Error("Screenshot timeout (15s)"));
      }, 15000);

      const handler = (e: MessageEvent) => {
        if (e.data?.type === "SCREENSHOT_DONE") {
          clearTimeout(tid);
          window.removeEventListener("message", handler);
          if (document.body.contains(iframe)) document.body.removeChild(iframe);
          const raw = (e.data.dataUrl as string).replace(/^data:[^;]+;base64,/, "");
          resolve({ data: raw, mimeType: "image/jpeg" });
        }
        if (e.data?.type === "SCREENSHOT_ERROR") {
          clearTimeout(tid);
          window.removeEventListener("message", handler);
          if (document.body.contains(iframe)) document.body.removeChild(iframe);
          reject(new Error(e.data.error || "Erreur screenshot"));
        }
      };
      window.addEventListener("message", handler);
    });
  }, [currentVersionData?.generatedCode, htmlCode]);

  const runDebug = useCallback(async () => {
    setIsDebugging(true);
    setDebugReport(null);
    let screenshot: { data: string; mimeType: string } | null = null;
    try {
      // ── Step 1: capture screenshot (best-effort — debug still runs without it)
      toast.info("📸 Capture de la preview en cours…", { id: "debug-snap", duration: 10000 });
      try {
        screenshot = await captureScreenshot();
        toast.dismiss("debug-snap");
        toast.info("🔍 Analyse visuelle + code par l'IA…", { id: "debug-analyze", duration: 30000 });
      } catch (snapErr: any) {
        toast.dismiss("debug-snap");
        toast.info("🔍 Analyse du code par l'IA (sans screenshot)…", { id: "debug-analyze", duration: 30000 });
        console.warn("[debug] screenshot failed:", snapErr.message);
      }

      // ── Step 2: send to server (screenshot is optional)
      const res = await fetch("/api/stream/debug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          screenshot: screenshot?.data,
          screenshotMimeType: screenshot?.mimeType,
          consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        }),
      });
      toast.dismiss("debug-analyze");
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
            if (evt.agent && evt.step) setAgentStep({ agent: evt.agent, step: evt.step, icon: evt.icon || "🔍" });
            if (evt.versionId) {
              setAgentStep(null);
              setDebugReport(evt.report || "Code corrigé.");
              setSelectedVersionId(evt.versionId);
              utils.projects.getVersions.invalidate({ projectId });
              utils.projects.get.invalidate({ id: projectId });
              utils.projects.getVersionCode.invalidate({ versionId: evt.versionId });
              toast.success("✅ Débogage terminé — nouvelle version créée", { duration: 5000 });
              fetchSuggestions("débogage automatique du site", "debug", language);
            }
            if (evt.message) throw new Error(evt.message);
          } catch (e: any) {
            if (e.message) toast.error(e.message);
          }
        }
      }
    } catch (err: any) {
      toast.dismiss("debug-snap");
      toast.dismiss("debug-analyze");
      toast.error(err.message);
    } finally {
      setIsDebugging(false);
      setAgentStep(null);
    }
  }, [projectId, captureScreenshot, consoleErrors]);

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
      // Capture JS errors / console.error from the preview iframe
      if (e.data?.type === "CONSOLE_ERROR" && e.data.message) {
        const msg = String(e.data.message).slice(0, 250);
        setConsoleErrors(prev => {
          if (prev.includes(msg)) return prev; // deduplicate
          return [...prev.slice(-9), msg]; // keep last 10
        });
      }
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
        setVeDeleteConfirm(false);
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
        setVeLiveDims(null);
        setVeDeleteConfirm(false);
      }
      // Live resize dimensions update
      if (e.data?.type === "VE_RESIZE") {
        setVeLiveDims({ w: e.data.w, h: e.data.h });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  /* ── Drag resize ── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newPct = ((e.clientX - rect.left) / rect.width) * 100;
      setPanelWidth(Math.min(75, Math.max(20, newPct)));
    };
    const onUp = () => { isDraggingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);


  /* inject inspect/visual-edit script into preview */
  const getPreviewSrc = () => {
    if (!inspectMode && !visualEditMode) return previewSrc;
    // For VE mode: base on current previewSrc (reflects unsaved editor changes)
    // For inspect mode: base on saved version code
    const code = visualEditMode
      ? (previewSrc || currentVersionData?.generatedCode || "")
      : (currentVersionData?.generatedCode || "");
    if (!code) return previewSrc;
    let injected = code;
    if (inspectMode) {
      const script = `<script>document.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.parent.postMessage({type:'INSPECT_ELEMENT',tag:e.target.tagName,id:e.target.id,cls:e.target.className},'*');},true);<\/script>`;
      injected = injected.replace(/<\/body>/i, `${script}</body>`);
    }
    if (visualEditMode) {
      // Embed VE script directly — avoids contentDocument cross-origin issues when
      // sandbox is loaded fresh. injectVeScript also fires via onLoad as a backup.
      const veTag = `<script id="__ve_preload__">${VE_SCRIPT.replace(/<\/script>/gi, '<\\/script>')}<\/script>`;
      injected = injected.includes('</body>')
        ? injected.replace(/<\/body>/i, `${veTag}</body>`)
        : injected + veTag;
    }
    return injected;
  };

  const hasCode = !!(currentVersionData?.generatedCode);
  // For Expo projects, the snackUrl may come from the done SSE event or from project.previewUrl
  const activeSnackUrl = expoSnackUrl || (isExpoProject ? (project?.previewUrl || "") : "");

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
              <Button size="sm" variant="outline"
                className="text-xs h-8 px-2 sm:px-3 border-border/60"
                title={codeCollapsed ? "Afficher le code" : "Réduire le code"}
                onClick={() => setCodeCollapsed(v => !v)}>
                {codeCollapsed
                  ? <PanelLeftOpen className="w-3.5 h-3.5 sm:mr-1.5 rotate-90" />
                  : <PanelLeftClose className="w-3.5 h-3.5 sm:mr-1.5 rotate-90" />}
                <span className="hidden sm:inline">{codeCollapsed ? "Code" : "Code"}</span>
              </Button>
            )}
            {hasCode && (
              <Button size="sm" variant={visualEditMode ? "default" : "outline"}
                className={`text-xs h-8 px-2 sm:px-3 ${visualEditMode ? "bg-violet-600 hover:bg-violet-700 text-white border-0" : "border-border/60"}`}
                onClick={() => {
                  if (!visualEditMode) {
                    // Enter VE mode — the iframe key changes which remounts it with
                    // allow-same-origin sandbox + VE script embedded in srcDoc.
                    // onLoad then calls injectVeScript as a backup.
                    veOriginalHtmlRef.current = htmlCode;
                    veCurrentHtmlRef.current = "";
                    setVeDirty(false);
                    setVeSelection(null);
                    setInspectMode(false);
                    setVisualEditMode(true);
                  } else {
                    // Exit VE mode — always rebuild preview to flush the VE script
                    const exitHtml = veDirty ? veOriginalHtmlRef.current : htmlCode;
                    if (veDirty) setHtmlCode(veOriginalHtmlRef.current);
                    setVeDirty(false);
                    setVeSelection(null);
                    setVeDeleteConfirm(false);
                    setVisualEditMode(false);
                    // Always call buildPreview so the iframe reloads without the VE script
                    buildPreview(exitHtml, cssCode, jsCode);
                  }
                }}>
                <PencilRuler className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Éditeur Visuel</span>
              </Button>
            )}
            {hasCode && (
              <Button size="sm" variant="outline"
                className={`text-xs h-8 px-2 sm:px-3 ${consoleErrors.length > 0
                  ? "border-red-500/60 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  : "border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"}`}
                onClick={() => setPendingAction({ summary: "Analyser le code du site, identifier les erreurs et les corriger automatiquement.", action: runDebug })}
                disabled={isDebugging}
                title={consoleErrors.length > 0
                  ? `${consoleErrors.length} erreur(s) JS détectée(s) — cliquez pour analyser et corriger`
                  : "Analyser et corriger automatiquement les bugs, liens cassés et erreurs"}>
                {isDebugging
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin sm:mr-1.5" />
                  : <PharmacieCross className="w-3.5 h-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">
                  {isDebugging ? "Débogage…" : consoleErrors.length > 0 ? `Réparer (${consoleErrors.length})` : "Débugger"}
                </span>
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
        {!hasCode && !isGenerating && !waitingForAutoGen ? (
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
                onClick={() => setPendingAction({
                  summary: `Générer un ${siteType.toLowerCase()} de style "${style}" en ${language === 'fr' ? 'français' : language === 'en' ? 'anglais' : language}, palette ${colorPalette}. Prompt : "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`,
                  action: generateSiteStream,
                })}
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
              <p className="text-sm text-muted-foreground animate-pulse">{isExpoProject ? "Mar-ia génère votre application mobile…" : "Mar-ia génère votre site…"}</p>
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
          <div ref={containerRef} className="flex-1 overflow-hidden flex">

            {/* ── LEFT PANEL : Code (top) + Chat (bottom) ── */}
            <div
              className="flex flex-col border-r border-border/50 overflow-hidden flex-shrink-0"
              style={{
                width: editorCollapsed ? 0 : `${panelWidth}%`,
                opacity: editorCollapsed ? 0 : 1,
                transition: isDraggingRef.current ? 'none' : 'width 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease',
                pointerEvents: editorCollapsed ? 'none' : 'auto',
                minWidth: 0,
              }}
            >

              {/* ── Code zone (top-left, 60% height) ── */}
              <div className="flex flex-col border-b border-border/50" style={{ flex: codeCollapsed ? '0 0 0%' : '0 0 60%', minHeight: 0, overflow: 'hidden', transition: isDraggingRef.current ? 'none' : 'flex 0.2s ease' }}>
                {/* Code toolbar */}
                <div className="flex items-center gap-1 px-2 py-1 bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0">
                  {/* Quick-access: BD · Domaine · SEO */}
                  <button
                    onClick={() => setShowDbPanel(true)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors text-[#858585] hover:text-white hover:bg-[#2a2d2e]"
                    title="Base de données">
                    <Database className="w-3 h-3" />
                    <span className="hidden sm:inline">BD</span>
                  </button>
                  <button
                    onClick={() => { setDomainInput(project?.customDomain ?? ""); setShowDomainPanel(true); }}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors text-[#858585] hover:text-white hover:bg-[#2a2d2e]"
                    title="Domaine & DNS">
                    <Link2 className="w-3 h-3" />
                    <span className="hidden sm:inline">Domaine</span>
                  </button>
                  <button
                    onClick={() => {
                      const titleM = htmlCode.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                      const descM  = htmlCode.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i) || htmlCode.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["']/i);
                      const kwM    = htmlCode.match(/<meta\s+name=["']keywords["']\s+content=["']([\s\S]*?)["']/i);
                      const ogTM   = htmlCode.match(/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']/i);
                      const ogDM   = htmlCode.match(/<meta\s+property=["']og:description["']\s+content=["']([\s\S]*?)["']/i);
                      setSeoTitle(titleM ? titleM[1] : "");
                      setSeoDesc(descM ? descM[1] : "");
                      setSeoKeywords(kwM ? kwM[1] : "");
                      setSeoOgTitle(ogTM ? ogTM[1] : "");
                      setSeoOgDesc(ogDM ? ogDM[1] : "");
                      setShowSeoPanel(true);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors text-[#858585] hover:text-white hover:bg-[#2a2d2e]"
                    title="SEO — Titre, description, Open Graph">
                    <TrendingUp className="w-3 h-3" />
                    <span className="hidden sm:inline">SEO</span>
                  </button>
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
                      className={`h-6 px-2 text-[10px] gap-1 ${showStoragePanel ? "text-primary bg-primary/10" : "text-[#858585] hover:text-white"}`}
                      onClick={() => { setImgEdits({}); setTextEdits({}); setStorageTab("images"); setShowStoragePanel(true); }}
                      title="Storage : bibliothèque d'images et de contenu du site">
                      <HardDrive className="w-3 h-3" />
                      <span className="hidden sm:inline">Storage</span>
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
                  <span className="text-[10px] text-white/80">{isExpoProject ? "App.js" : codeTab === "html" ? "index.html" : codeTab === "css" ? "style.css" : "script.js"}</span>
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
              <div className="flex flex-col" style={{ flex: codeCollapsed ? '1 1 100%' : '0 0 40%', minHeight: 0, overflow: 'hidden', transition: isDraggingRef.current ? 'none' : 'flex 0.2s ease' }}>
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
                    <Button
                      variant={showIntegrationsPanel ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1"
                      title="Gérer les clés API connectées"
                      onClick={() => setShowIntegrationsPanel(v => !v)}
                    >
                      <Plug className="w-3 h-3" />
                      API
                    </Button>
                    <Button
                      variant={discussionMode ? "secondary" : "ghost"}
                      size="sm"
                      className={`h-6 px-2 text-[10px] gap-1 transition-colors ${discussionMode ? "text-sky-400 border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20" : ""}`}
                      title={discussionMode ? "Mode Réflexion actif — aucune modification du code" : "Activer le mode Réflexion (discussion sans action)"}
                      onClick={() => { setDiscussionMode(v => !v); setChatPhase("idle"); setSuggestions([]); }}
                    >
                      <Brain className="w-3 h-3" />
                      {discussionMode ? "Réflexion" : "Réfléchir"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
                      title="Vider l'historique du chat"
                      onClick={() => { if (confirm("Vider tout l'historique du chat ?")) clearChat.mutate({ projectId }); }}
                    >
                      <Trash2 className="w-3 h-3" />
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

                {/* Integrations panel */}
                {showIntegrationsPanel && (
                  <div className="border-b border-border/40 bg-muted/20 overflow-y-auto" style={{ maxHeight: '55%' }}>
                    <div className="p-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
                          <Plug className="w-3 h-3" /> Intégrations API
                        </span>
                        <button onClick={() => setShowIntegrationsPanel(false)} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mb-2 leading-relaxed">
                        Vos clés sont chiffrées. Le code généré appelle <code className="bg-white/10 px-1 rounded">/api/proxy/call</code> — la vraie clé ne sera jamais exposée.
                      </p>

                      {/* Existing integrations */}
                      {integrations && integrations.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {integrations.map((intg: any) => (
                            <div key={intg.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/40 bg-background/40">
                              <Plug className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium">{intg.apiLabel}</span>
                                <span className="text-[10px] text-muted-foreground ml-1.5 font-mono">{intg.keyHint}</span>
                              </div>
                              <button
                                onClick={() => deleteIntegration.mutate({ id: intg.id })}
                                className="text-[10px] text-muted-foreground hover:text-destructive p-1 rounded"
                                title="Supprimer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add new integration */}
                      <AddIntegrationForm
                        projectId={projectId}
                        onSave={(data) => saveIntegration.mutate(data)}
                        saving={saveIntegration.isPending}
                      />
                    </div>
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
                  {/* Plan summaries validated in this session */}
                  {localChatItems.map(item => (
                    <div key={item.id} className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-primary/70" />
                      </div>
                      <div className="bg-primary/5 border border-primary/20 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[90%]">
                        <p className="text-[10px] font-semibold text-primary mb-0.5">✓ Plan validé</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{item.summary}</p>
                      </div>
                    </div>
                  ))}

                  {/* ── API key request — inline widget ── */}
                  {pendingApiRequest && (
                    <div className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <KeyRound className="w-2.5 h-2.5 text-emerald-400" />
                      </div>
                      <div className="bg-card border border-emerald-500/30 rounded-xl rounded-tl-sm px-3 py-2.5 max-w-[92%] w-full">
                        <p className="text-[10px] font-semibold text-emerald-400 mb-1 flex items-center gap-1">
                          <Plug className="w-3 h-3" /> Clé API requise — {pendingApiRequest.apiLabel}
                        </p>
                        <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">{pendingApiRequest.message}</p>
                        <div className="flex gap-2">
                          <ApiKeyField
                            value={apiKeyInput}
                            onChange={setApiKeyInput}
                            placeholder={`Clé ${pendingApiRequest.apiLabel}…`}
                          />
                          <button
                            disabled={!apiKeyInput.trim() || apiKeySaving}
                            onClick={async () => {
                              if (!apiKeyInput.trim()) return;
                              setApiKeySaving(true);
                              try {
                                // Search doc info first
                                const docRes = await fetch("/api/integrations/search-doc", {
                                  method: "POST",
                                  headers: { "content-type": "application/json" },
                                  credentials: "include",
                                  body: JSON.stringify({ apiName: pendingApiRequest.apiName }),
                                });
                                const docInfo = docRes.ok ? await docRes.json() : {};

                                await saveIntegration.mutateAsync({
                                  apiName: pendingApiRequest.apiName,
                                  apiLabel: docInfo.label || pendingApiRequest.apiLabel,
                                  key: apiKeyInput.trim(),
                                  projectId,
                                  baseUrl: docInfo.baseUrl || undefined,
                                  docUrl: docInfo.docUrl || undefined,
                                  docSummary: docInfo.summary || undefined,
                                });
                                setPendingApiRequest(null);
                                setApiKeyInput("");
                                toast.success(`✅ ${pendingApiRequest.apiLabel} connecté — Maria peut maintenant l'utiliser`);
                              } catch (e: any) {
                                toast.error(e.message);
                              } finally {
                                setApiKeySaving(false);
                              }
                            }}
                            className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors flex items-center gap-1"
                          >
                            {apiKeySaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                            {apiKeySaving ? "Sauvegarde…" : "Connecter"}
                          </button>
                          <button
                            onClick={() => { setPendingApiRequest(null); setApiKeyInput(""); }}
                            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground text-[11px] transition-colors"
                            title="Ignorer"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Debug report — shown after debugCode completes */}
                  {debugReport && (
                    <div className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <PharmacieCross className="w-2.5 h-2.5 text-amber-400" />
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
                        <PharmacieCross className="w-2.5 h-2.5 text-amber-400" />
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
                  {/* Agent step — shown during chat execution */}
                  {chatEdit.isPending && agentStep && (
                    <div className="flex gap-1.5 items-start">
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-primary animate-pulse" />
                      </div>
                      <div className="bg-card border border-primary/20 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[85%]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{agentStep.icon}</span>
                          <span className="text-[10px] font-semibold text-primary">{agentStep.agent}</span>
                          <span className="text-[10px] text-muted-foreground">— {agentStep.step}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Typing dots — shown only while waiting for first tokens (no agent step yet) */}
                  {chatEdit.isPending && !streamingReply && !agentStep && (
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

                  {/* ── Suggestions A/B/C ── */}
                  {suggestions.length > 0 && !streamingReply && chatPhase === "idle" && (
                    <div className="flex flex-col gap-1.5 pb-1 pl-7">
                      {suggestions.map((s, i) => {
                        const isObj = typeof s === "object" && s !== null;
                        const label = isObj ? (s as any).label : String.fromCharCode(65 + i);
                        const text = isObj ? (s as any).text : s;
                        const colors = ["text-blue-400 border-blue-500/30 hover:border-blue-400/60 hover:bg-blue-500/5", "text-violet-400 border-violet-500/30 hover:border-violet-400/60 hover:bg-violet-500/5", "text-emerald-400 border-emerald-500/30 hover:border-emerald-400/60 hover:bg-emerald-500/5"];
                        return (
                          <button
                            key={i}
                            className={`text-left text-[11px] px-2.5 py-1.5 rounded-full border transition-all w-fit max-w-full leading-snug flex items-center gap-1.5 ${colors[i % 3]}`}
                            onClick={() => { setChatMessage(text); setSuggestions([]); }}
                          >
                            <span className="font-bold text-[10px] opacity-80">{label}.</span>
                            <span>{text}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Carte de validation du raisonnement ── */}
                  {chatPhase === "awaiting_validation" && !discussionMode && (
                    <div className="mx-2 mb-1.5 rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground mb-1">Mar-ia a compris ta demande :</p>
                          {isSummaryEditing ? (
                            <textarea
                              className="w-full text-xs bg-background border border-border/60 rounded-lg px-2 py-1.5 resize-none text-foreground leading-relaxed focus:outline-none focus:border-primary/60"
                              rows={4}
                              value={summaryEdit}
                              onChange={e => setSummaryEdit(e.target.value)}
                              autoFocus
                            />
                          ) : (
                            <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap pr-1">{pendingSummary}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-7 text-xs bg-primary hover:bg-primary/90 flex-1 gap-1"
                          onClick={() => {
                            const validated = isSummaryEditing ? summaryEdit : pendingSummary;
                            setChatPhase("idle");
                            setIsSummaryEditing(false);
                            executeChatStream(pendingOriginalMsg, validated);
                          }}>
                          ✓ Valider
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs border-border/50 flex-1"
                          onClick={() => { setIsSummaryEditing(v => !v); setSummaryEdit(pendingSummary); }}>
                          {isSummaryEditing ? "✓ Ok" : "✎ Modifier"}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground flex-1"
                          onClick={() => { setChatPhase("idle"); setIsSummaryEditing(false); }}>
                          ✕ Annuler
                        </Button>
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* pendingAction for generate/debug only */}
                {pendingAction && (
                  <div className="mx-2 mb-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-foreground mb-0.5">Confirmer l'action</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{pendingAction.summary}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-7 text-xs bg-amber-500 hover:bg-amber-500/90 flex-1 gap-1"
                        onClick={() => { pendingAction.action(); setPendingAction(null); }}>
                        ✓ Confirmer
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground flex-1"
                        onClick={() => setPendingAction(null)}>
                        ✕ Annuler
                      </Button>
                    </div>
                  </div>
                )}

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
                  {/* Discussion mode banner */}
                  {discussionMode && (
                    <div className="flex items-center gap-1.5 mb-1.5 px-1 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px]">
                      <Brain className="w-3 h-3 flex-shrink-0" />
                      <span className="font-medium">Mode Réflexion</span>
                      <span className="text-sky-400/60">— Discutons du projet, sans modifier le code</span>
                    </div>
                  )}
                  {/* Input pill */}
                  <div className={`flex items-end gap-1 rounded-2xl px-2 py-1.5 transition-colors ${discussionMode ? "bg-[#0e1a2e] border border-sky-500/30" : "bg-[#1a1a2e] border border-[#2e2e4e]"}`}>
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
                    {/* Textarea input */}
                    <textarea
                      rows={2}
                      placeholder={isRecording ? "🎤 Dictée en cours…" : discussionMode ? "Réfléchissons ensemble au projet…" : "Parlez à Mar-ia…"}
                      value={chatMessage}
                      onChange={(e) => {
                        setChatMessage(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && (chatMessage.trim() || attachments.length > 0)) {
                          e.preventDefault();
                          sendChatStream(chatMessage);
                        }
                      }}
                      className="flex-1 bg-transparent text-xs text-white placeholder-[#6b7280] outline-none min-w-0 px-1 resize-none leading-relaxed"
                      style={{ minHeight: "2.5rem", maxHeight: "7.5rem" }}
                    />
                    {/* Send */}
                    <button
                      onClick={() => { if (chatMessage.trim() || attachments.length > 0) sendChatStream(chatMessage); }}
                      disabled={chatEdit.isPending || (!chatMessage.trim() && attachments.length === 0)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-colors ${discussionMode ? "bg-sky-500 hover:bg-sky-400" : "bg-primary hover:bg-primary/90"}`}>
                      {chatEdit.isPending ? <Loader2 className="w-3 h-3 animate-spin text-white" /> : <Send className="w-3 h-3 text-white" />}
                    </button>
                  </div>
                  {/* Hidden file input */}
                  <input ref={attachInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => handleAttachFiles(e.target.files)} />
                </div>
              </div>
            </div>

            {/* ── DRAG HANDLE ── */}
            {!editorCollapsed && (
              <div
                className="w-1.5 flex-shrink-0 cursor-col-resize group bg-border/20 hover:bg-primary/40 transition-colors select-none"
                onMouseDown={(e) => {
                  isDraggingRef.current = true;
                  dragStartXRef.current = e.clientX;
                  dragStartWidthRef.current = panelWidth;
                  e.preventDefault();
                }}
              >
                <div className="h-full w-px mx-auto bg-border/50 group-hover:bg-primary/60 transition-colors" />
              </div>
            )}

            {/* ── RIGHT PANEL : Preview pleine largeur ── */}
            <div className="flex flex-col overflow-hidden flex-1 min-w-0">
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
                  {consoleErrors.length > 0 && (
                    <button
                      title={`${consoleErrors.length} erreur(s) JS détectée(s) :\n${consoleErrors.join('\n')}\n\nCes erreurs sont transmises au LLM lors du prochain message.\nCliquer pour effacer.`}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors ml-1"
                      onClick={() => setConsoleErrors([])}
                    >
                      <PharmacieCross className="w-3 h-3" />
                      {consoleErrors.length} erreur{consoleErrors.length > 1 ? "s" : ""}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {isExpoProject ? null : (
                    (["desktop", "tablet", "mobile"] as ViewMode[]).map((mode) => {
                      const icons = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };
                      const Icon = icons[mode];
                      return (
                        <Button key={mode} variant="ghost" size="icon"
                          className={`w-7 h-7 ${viewMode === mode ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                          onClick={() => setViewMode(mode)}>
                          <Icon className="w-3.5 h-3.5" />
                        </Button>
                      );
                    })
                  )}
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

                    {/* Delete block */}
                    {veSelection && <>
                      <div className="w-px h-5 bg-white/20" />
                      {veDeleteConfirm ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-red-400">Supprimer ?</span>
                          <button
                            title="Confirmer la suppression"
                            onClick={() => {
                              sendToIframe({ type: 'VE_DELETE' });
                              setVeDeleteConfirm(false);
                              setVeSelection(null);
                            }}
                            className="px-2 h-7 rounded bg-red-500/80 hover:bg-red-500 text-white text-[11px] font-medium transition-colors">
                            Oui
                          </button>
                          <button
                            title="Annuler"
                            onClick={() => setVeDeleteConfirm(false)}
                            className="px-2 h-7 rounded hover:bg-white/10 text-white/60 text-[11px]">
                            Non
                          </button>
                        </div>
                      ) : (
                        <button
                          title="Supprimer cet élément (Delete)"
                          onClick={() => setVeDeleteConfirm(true)}
                          className="flex items-center gap-1 px-2 h-7 rounded hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-colors text-[11px]">
                          <Trash2 className="w-3 h-3" /> Supprimer
                        </button>
                      )}
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
                      onClick={() => { setShowLayers(v => !v); if (!showLayers) setShowBlocksPalette(false); sendToIframe({ type: 'VE_GET_LAYERS' }); }}
                      className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] transition-colors ${showLayers ? 'bg-primary/30 text-primary' : 'hover:bg-white/10 text-white/60'}`}>
                      Calques
                    </button>

                    {/* Blocks palette toggle */}
                    <div className="w-px h-5 bg-white/20" />
                    <button
                      onClick={() => { setShowBlocksPalette(v => !v); if (!showBlocksPalette) setShowLayers(false); }}
                      className={`flex items-center gap-1 px-2 h-7 rounded text-[11px] transition-colors ${showBlocksPalette ? 'bg-emerald-500/30 text-emerald-300' : 'hover:bg-white/10 text-white/60'}`}>
                      <Plus className="w-3 h-3" /> Blocs
                    </button>

                    {/* Dimensions display */}
                    {veSelection && (() => {
                      const w = veLiveDims?.w ?? Math.round(veSelection.rect.width);
                      const h = veLiveDims?.h ?? Math.round(veSelection.rect.height);
                      const unsplashUrl = `https://images.unsplash.com/photo-PHOTO_ID?w=${w}&h=${h}&fit=crop&q=80`;
                      return (
                        <div className="ml-auto flex items-center gap-1.5">
                          {/* Tag label */}
                          <span className="text-[10px] text-white/40">&lt;{veSelection.tag.toLowerCase()}&gt;</span>
                          <div className="w-px h-4 bg-white/20" />
                          {/* Dimensions badge */}
                          <span className="font-mono text-[11px] font-bold text-violet-300 bg-violet-500/20 px-2 py-0.5 rounded">
                            {w} × {h} px
                          </span>
                          {/* Copy Unsplash URL */}
                          <button
                            title={`Copier l'URL Unsplash à ${w}×${h}px\n${unsplashUrl}`}
                            className={`flex items-center gap-1 px-2 h-6 rounded text-[10px] transition-colors ${dimCopied ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/10 hover:bg-violet-500/30 text-white/60 hover:text-violet-300'}`}
                            onClick={() => {
                              navigator.clipboard.writeText(unsplashUrl).catch(() => {});
                              setDimCopied(true);
                              setTimeout(() => setDimCopied(false), 2000);
                            }}>
                            {dimCopied ? <Check className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                            {dimCopied ? 'Copié !' : `Unsplash ${w}×${h}`}
                          </button>
                        </div>
                      );
                    })()}
                    {!veSelection && <div className="ml-auto text-[10px] text-white/40 px-1">Survolez pour voir les dimensions — cliquez pour sélectionner</div>}
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

                  {/* Blocks palette */}
                  {showBlocksPalette && (
                    <div className="border border-emerald-500/20 rounded-lg overflow-hidden bg-black/30">
                      <div className="flex items-center justify-between px-2 py-1.5 bg-emerald-500/10 border-b border-emerald-500/15">
                        <span className="text-[10px] font-medium text-emerald-300 flex items-center gap-1.5">
                          <Plus className="w-3 h-3" /> Insérer un bloc
                        </span>
                        <span className="text-[10px] text-white/30">
                          {veSelection ? `après &lt;${veSelection.tag.toLowerCase()}&gt;` : "en fin de page"}
                        </span>
                      </div>
                      {/* Category tabs */}
                      <div className="flex gap-0 border-b border-white/10 overflow-x-auto">
                        {VE_BLOCK_CATEGORIES.map(cat => (
                          <button key={cat.id}
                            onClick={() => setBlockCategory(cat.id)}
                            className={`px-2.5 py-1 text-[10px] whitespace-nowrap flex-shrink-0 transition-colors border-b-2 ${blockCategory === cat.id ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10' : 'border-transparent text-white/40 hover:text-white/70 hover:bg-white/5'}`}>
                            {cat.label}
                          </button>
                        ))}
                      </div>
                      {/* Block items */}
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 p-2">
                        {VE_BLOCKS.filter(b => b.category === blockCategory).map(block => (
                          <button
                            key={block.id}
                            title={`Insérer : ${block.label}`}
                            onClick={() => {
                              sendToIframe({ type: 'VE_INSERT_BLOCK', html: block.html });
                              toast.success(`Bloc "${block.label}" inséré`);
                            }}
                            className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border border-white/10 hover:border-emerald-400/40 hover:bg-emerald-500/10 transition-all cursor-pointer group">
                            <span className="text-lg leading-none">{block.icon}</span>
                            <span className="text-[9px] text-white/55 group-hover:text-emerald-300 transition-colors text-center leading-tight">{block.label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="px-2 pb-2 text-[9px] text-white/25 flex items-center gap-1">
                        <GripVertical className="w-2.5 h-2.5" />
                        Après insertion, glissez l'élément pour le repositionner
                      </div>
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
              {isExpoProject ? (
                /* ── EXPO PREVIEW : phone mockup pleine hauteur comme le preview web ── */
                <div className="flex-1 flex flex-col overflow-hidden">

                  {/* Zone preview : même pattern que le preview web — items-start, h-full sur l'enfant */}
                  <div className="flex-1 flex items-start justify-center p-3 bg-[#0c0c14] overflow-hidden">
                    {expoHtmlLoading && !expoHtmlPreview && (
                      <div className="flex flex-col items-center gap-3 text-muted-foreground mt-16">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="text-sm">Génération de l'aperçu…</span>
                      </div>
                    )}
                    {!expoHtmlLoading && !expoHtmlPreview && (
                      <div className="flex flex-col items-center gap-3 mt-16">
                        <button
                          onClick={() => generateExpoHtmlPreview(htmlCode)}
                          disabled={!htmlCode}
                          className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors"
                        >
                          <span className="text-4xl">📱</span>
                          <span className="text-sm font-medium">Générer l'aperçu</span>
                          <span className="text-xs text-muted-foreground">Aperçu HTML de l'app</span>
                        </button>
                      </div>
                    )}
                    {expoHtmlPreview && (
                      /* Phone mockup : h-full + aspect-ratio = même pattern que le web preview */
                      <div
                        className="h-full overflow-hidden shadow-2xl flex-shrink-0"
                        style={{ aspectRatio: "390/844", maxWidth: "390px", borderRadius: "2.5rem", border: "8px solid #1c1c2e", background: "#000" }}
                      >
                        <iframe
                          key={visualEditMode ? "expo-ve-mode" : inspectMode ? "expo-inspect-mode" : "expo-preview"}
                          ref={previewRef}
                          srcDoc={(visualEditMode || inspectMode) ? getPreviewSrc() : previewSrc}
                          onLoad={() => { if (visualEditMode) setTimeout(injectVeScript, 50); }}
                          className="w-full h-full border-0"
                          title="App Preview"
                          sandbox={visualEditMode ? "allow-scripts allow-same-origin" : "allow-scripts"}
                        />
                      </div>
                    )}
                  </div>

                  {/* Barre d'outils compacte en bas */}
                  <div className="flex-shrink-0 border-t border-border/30 bg-background/80 flex items-center gap-2 px-3 py-2 flex-wrap">
                    <button
                      onClick={() => generateExpoHtmlPreview(htmlCode)}
                      disabled={expoHtmlLoading || !htmlCode}
                      className="flex items-center gap-1.5 px-2 py-1 rounded border border-border/50 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                    >
                      {expoHtmlLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "🔄"} Régénérer
                    </button>
                    <div className="w-px h-4 bg-border/40" />
                    <button
                      onClick={() => saveToExpoSnack(htmlCode, project?.name || "App")}
                      disabled={expoSnackLoading || !htmlCode}
                      className="flex items-center gap-1.5 px-2 py-1 rounded border border-border/50 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                    >
                      {expoSnackLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />}
                      {expoSnackLoading ? "…" : "QR Expo Go"}
                    </button>
                    {activeSnackUrl && (() => {
                      const snackHash = activeSnackUrl.replace("https://snack.expo.dev/", "").replace(/[?#].*/, "");
                      const snackUrl = `https://snack.expo.dev/${snackHash}`;
                      const expUrl = `exp://snack.expo.dev/${snackHash}`;
                      return (
                        <>
                          {/* QR code — icône cliquable → modal plein écran fixe */}
                          <button
                            onClick={() => setShowQrModal(true)}
                            className="flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                            title="Agrandir le QR code"
                          >
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(snackUrl)}&bgcolor=ffffff&color=000000&margin=6`}
                              alt="QR" width={32} height={32} className="rounded border border-border/40"
                            />
                          </button>

                          {/* Modal QR plein écran — position:fixed échappe tous les overflow:hidden */}
                          {showQrModal && (
                            <div
                              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                              onClick={() => setShowQrModal(false)}
                            >
                              <div
                                className="bg-white rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-4"
                                onClick={e => e.stopPropagation()}
                              >
                                <p className="text-sm font-semibold text-gray-700">Scanner avec Expo Go</p>
                                <img
                                  src={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(snackUrl)}&bgcolor=ffffff&color=000000&margin=16`}
                                  alt="QR Expo Go"
                                  width={280}
                                  height={280}
                                  className="rounded-lg"
                                />
                                <p className="text-xs text-gray-400 text-center max-w-[280px] break-all">{snackUrl}</p>
                                <button
                                  onClick={() => setShowQrModal(false)}
                                  className="mt-1 px-5 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-sm text-gray-600 transition-colors"
                                >
                                  Fermer
                                </button>
                              </div>
                            </div>
                          )}
                          <a href={snackUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline">
                            <ExternalLink className="w-3 h-3" /> Expo Snack
                          </a>
                          <div className="w-px h-4 bg-border/40" />
                          {/* Bouton Installer — copie le lien exp:// direct pour mobile */}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(expUrl).then(() => {
                                toast.success("Lien copié ! Collez-le dans Expo Go sur votre mobile.", { duration: 4000 });
                              }).catch(() => {
                                // Fallback: ouvrir une fenêtre avec le lien
                                const w = window.open("", "_blank");
                                if (w) {
                                  w.document.write(`<pre style="font-size:18px;padding:20px;word-break:break-all">${expUrl}</pre><p style="padding:0 20px">Copiez ce lien et ouvrez-le dans <b>Expo Go</b> sur Android ou iOS.</p>`);
                                }
                              });
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded border border-primary/40 text-xs text-primary hover:bg-primary/10 transition-colors"
                            title="Copie le lien Expo Go pour tester sur votre mobile (Android ou iOS)"
                          >
                            📲 Installer
                          </button>
                        </>
                      );
                    })()}
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          const blob = new Blob([htmlCode], { type: "text/javascript" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a"); a.href = url; a.download = "App.js"; a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Download className="w-3 h-3" /> App.js
                      </button>
                      <button
                        onClick={async () => {
                          const code = htmlCode;
                          const pkgJson = JSON.stringify({
                            name: "maria-app", version: "1.0.0", main: "App.js",
                            scripts: { start: "expo start", android: "expo run:android", ios: "expo run:ios" },
                            dependencies: { expo: "~54.0.0", react: "18.3.1", "react-native": "0.76.7", "expo-linear-gradient": "~14.0.1" },
                            devDependencies: { "@babel/core": "^7.20.0" }
                          }, null, 2);
                          const appConfig = `import { ExpoConfig } from 'expo/config';\nexport default ({ config }: { config: ExpoConfig }): ExpoConfig => ({\n  ...config,\n  name: '${project?.name || "App"}',\n  slug: '${(project?.name || "app").toLowerCase().replace(/\s+/g, "-")}',\n  version: '1.0.0',\n  orientation: 'portrait',\n  platforms: ['android', 'ios'],\n});\n`;
                          const zip = [`package.json\n${pkgJson}`, `App.js\n${code}`, `app.config.js\n${appConfig}`].join("\n---FILE---\n");
                          const blob = new Blob([zip], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a"); a.href = url; a.download = `${project?.name || "app"}-expo.txt`; a.click();
                          URL.revokeObjectURL(url);
                          toast.success("Projet exporté !");
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/40 text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      >
                        <Download className="w-3 h-3" /> Exporter
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-start justify-center p-3 bg-muted/20 overflow-hidden">
                  <div className="h-full overflow-hidden rounded-lg border border-border/60 shadow-xl transition-all duration-300 bg-white"
                    style={{ width: VIEW_SIZES[viewMode], maxWidth: "100%" }}>
                    <iframe
                      key={visualEditMode ? "ve-mode" : (inspectMode ? "inspect-mode" : "preview-mode")}
                      ref={previewRef}
                      srcDoc={(inspectMode || visualEditMode) ? getPreviewSrc() : previewSrc}
                      onLoad={() => { if (visualEditMode) setTimeout(injectVeScript, 50); }}
                      className="w-full h-full border-0"
                      title="Preview"
                      sandbox={visualEditMode ? "allow-scripts allow-same-origin" : "allow-scripts"}
                    />
                  </div>
                </div>
              )}
            </div>


          </div>
        )}
      </div>

      {/* ── BD panel ────────────────────────────────────────────────────────── */}
      {showDbPanel && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDbPanel(false)}>
          <div className="bg-[#1a1a2e] border border-border/40 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground text-sm">Base de données</h2>
                  <p className="text-[10px] text-muted-foreground">Stockage & API de données</p>
                </div>
              </div>
              <button onClick={() => setShowDbPanel(false)} className="text-muted-foreground hover:text-foreground transition-colors"><XIcon className="w-4 h-4" /></button>
            </div>
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 text-center space-y-2">
              <div className="text-2xl">🗄️</div>
              <p className="text-sm font-medium text-foreground">Bientôt disponible</p>
              <p className="text-xs text-muted-foreground leading-relaxed">Connectez une base de données à votre site : stockage de formulaires, liste d'abonnés, catalogue produits — sans backend à gérer.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[["Formulaires", "Stockez les soumissions de vos formulaires contact"], ["Abonnés", "Gérez une liste d'emails ou de membres"], ["Catalogue", "Produits, articles, portfolio dynamique"], ["Analytics", "Compteur de vues et événements personnalisés"]].map(([t, d]) => (
                <div key={t} className="rounded-lg border border-border/40 p-3 opacity-50 cursor-not-allowed">
                  <p className="text-xs font-medium text-foreground">{t}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{d}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowDbPanel(false)} className="w-full py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors">Fermer</button>
          </div>
        </div>
      )}

      {/* ── Domaine / DNS panel ──────────────────────────────────────────────── */}
      {showDomainPanel && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDomainPanel(false)}>
          <div className="bg-[#1a1a2e] border border-border/40 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Link2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground text-sm">Domaine & DNS</h2>
                  <p className="text-[10px] text-muted-foreground">Liez votre nom de domaine</p>
                </div>
              </div>
              <button onClick={() => setShowDomainPanel(false)} className="text-muted-foreground hover:text-foreground transition-colors"><XIcon className="w-4 h-4" /></button>
            </div>
            {project?.slug && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground">URL publié</p>
                  <p className="text-xs font-mono text-emerald-400 truncate">{project.slug}.mar-ia.app</p>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(`https://${project!.slug}.mar-ia.app`); toast.success("Copié !"); }} className="text-muted-foreground hover:text-foreground flex-shrink-0"><Copy className="w-3 h-3" /></button>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Domaine personnalisé</label>
              <Input
                placeholder="ex : monsite.com"
                value={domainInput}
                onChange={e => setDomainInput(e.target.value)}
                className="bg-input border-border/60 text-sm h-9 font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Entrez uniquement le domaine sans <span className="font-mono">https://</span></p>
            </div>
            <div className="rounded-xl bg-[#111] border border-border/30 p-3 space-y-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Configuration DNS requise</p>
              {[
                { type: "A", name: "@", value: "76.76.21.21" },
                { type: "CNAME", name: "www", value: "cname.mar-ia.app" },
              ].map(r => (
                <div key={r.type} className="flex items-center gap-2 font-mono text-xs">
                  <span className="w-14 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-center">{r.type}</span>
                  <span className="text-muted-foreground w-10">{r.name}</span>
                  <span className="text-foreground flex-1 truncate">{r.value}</span>
                  <button onClick={() => { navigator.clipboard.writeText(r.value); toast.success("Copié !"); }} className="text-muted-foreground hover:text-foreground"><Copy className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
            <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-9"
              disabled={!domainInput.trim()}
              onClick={() => {
                updateProject.mutate({ id: projectId, customDomain: domainInput.trim() || undefined });
                setShowDomainPanel(false);
                toast.success("Domaine enregistré !");
              }}>
              <Save className="w-3.5 h-3.5 mr-1.5" /> Enregistrer le domaine
            </Button>
          </div>
        </div>
      )}

      {/* ── SEO panel ────────────────────────────────────────────────────────── */}
      {showSeoPanel && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSeoPanel(false)}>
          <div className="bg-[#1a1a2e] border border-border/40 rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground text-sm">SEO</h2>
                  <p className="text-[10px] text-muted-foreground">Titre, description, Open Graph</p>
                </div>
              </div>
              <button onClick={() => setShowSeoPanel(false)} className="text-muted-foreground hover:text-foreground transition-colors"><XIcon className="w-4 h-4" /></button>
            </div>
            {/* Fields */}
            <div className="space-y-3">
              {([
                { label: "Titre de la page", key: "title", value: seoTitle, set: setSeoTitle, placeholder: "Mon site — Description courte", hint: "55-60 caractères recommandés", max: 60 },
                { label: "Meta description", key: "desc", value: seoDesc, set: setSeoDesc, placeholder: "Description de votre site visible dans Google…", hint: "150-160 caractères recommandés", max: 160 },
                { label: "Mots-clés", key: "kw", value: seoKeywords, set: setSeoKeywords, placeholder: "mot-clé 1, mot-clé 2, …", hint: "Séparés par des virgules", max: 255 },
                { label: "og:title (réseaux sociaux)", key: "ogt", value: seoOgTitle, set: setSeoOgTitle, placeholder: "Titre pour Facebook, Twitter…", hint: "", max: 95 },
                { label: "og:description", key: "ogd", value: seoOgDesc, set: setSeoOgDesc, placeholder: "Description pour le partage social…", hint: "", max: 200 },
              ] as { label:string; key:string; value:string; set:(v:string)=>void; placeholder:string; hint:string; max:number }[]).map(f => (
                <div key={f.key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-foreground">{f.label}</label>
                    <span className={`text-[10px] ${f.value.length > f.max ? "text-red-400" : "text-muted-foreground"}`}>{f.value.length}/{f.max}</span>
                  </div>
                  <Input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder} className="bg-input border-border/60 text-xs h-8" />
                  {f.hint && <p className="text-[10px] text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
            <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-9"
              onClick={() => {
                // Inject SEO tags into <head> of htmlCode
                let code = htmlCode;
                const injectMeta = (pattern: RegExp, newTag: string, anchor = "</head>") => {
                  if (pattern.test(code)) { code = code.replace(pattern, newTag); }
                  else { code = code.replace(anchor, `  ${newTag}\n${anchor}`); }
                };
                if (seoTitle) { code = /<title[^>]*>[\s\S]*?<\/title>/i.test(code) ? code.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${seoTitle}</title>`) : code.replace("</head>", `  <title>${seoTitle}</title>\n</head>`); }
                if (seoDesc) injectMeta(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${seoDesc}">`);
                if (seoKeywords) injectMeta(/<meta\s+name=["']keywords["'][^>]*>/i, `<meta name="keywords" content="${seoKeywords}">`);
                if (seoOgTitle) injectMeta(/<meta\s+property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${seoOgTitle}">`);
                if (seoOgDesc) injectMeta(/<meta\s+property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${seoOgDesc}">`);
                setHtmlCode(code);
                if (selectedVersionId) {
                  const combined = `<!-- HTML -->\n${code}\n<!-- CSS -->\n${cssCode}\n<!-- JS -->\n${jsCode}`;
                  updateCode.mutate({ versionId: selectedVersionId, code: combined });
                }
                toast.success("SEO mis à jour et sauvegardé !");
                setShowSeoPanel(false);
              }}>
              <Save className="w-3.5 h-3.5 mr-1.5" /> Appliquer & Sauvegarder
            </Button>
          </div>
        </div>
      )}

      {/* ── Storage panel : bibliothèque d'images & de contenu ───────────────── */}
      {showStoragePanel && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowStoragePanel(false)}>
          <div className="bg-[#1a1a2e] border border-border/40 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border/30">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                  <HardDrive className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground text-sm">Storage</h2>
                  <p className="text-[10px] text-muted-foreground">Bibliothèque d'images & de contenu — modifiez tout facilement</p>
                </div>
              </div>
              <button onClick={() => setShowStoragePanel(false)} className="text-muted-foreground hover:text-foreground transition-colors"><XIcon className="w-4 h-4" /></button>
            </div>
            {/* Tabs */}
            <div className="flex gap-1 px-5 pt-3">
              <button onClick={() => setStorageTab("images")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${storageTab === "images" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>
                <ImageIcon className="w-3.5 h-3.5" /> Images <span className="opacity-60">({storageImages.length})</span>
              </button>
              <button onClick={() => setStorageTab("content")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${storageTab === "content" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>
                <TypeIcon className="w-3.5 h-3.5" /> Contenu <span className="opacity-60">({storageTexts.length})</span>
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {storageTab === "images" && (
                storageImages.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">Aucune image détectée dans ce site.</p>
                ) : (
                  storageImages.map((src) => {
                    const current = imgEdits[src] ?? src;
                    return (
                      <div key={src} className="flex items-center gap-3 rounded-xl bg-[#111] border border-border/30 p-2.5">
                        <div className="w-14 h-14 rounded-lg bg-black/40 border border-border/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                          <img src={current} alt="" className="max-w-full max-h-full object-contain"
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <p className="text-[10px] font-mono text-muted-foreground truncate" title={current}>
                            {current.startsWith("data:") ? `${current.slice(0, 40)}… (image intégrée)` : current}
                            {imgEdits[src] && <span className="text-emerald-400 ml-1">• modifiée</span>}
                          </p>
                          <Input
                            placeholder="Coller une nouvelle URL d'image…"
                            defaultValue={src.startsWith("data:") ? "" : src}
                            onChange={e => setImgEdits(prev => ({ ...prev, [src]: e.target.value }))}
                            className="bg-input border-border/60 text-[11px] h-7 font-mono"
                          />
                        </div>
                        <button
                          onClick={() => { storageUploadTargetRef.current = src; storageImgUploadRef.current?.click(); }}
                          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-medium transition-colors"
                          title="Uploader une image depuis votre ordinateur">
                          <Upload className="w-3.5 h-3.5" /> Upload
                        </button>
                      </div>
                    );
                  })
                )
              )}
              {storageTab === "content" && (
                storageTexts.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">Aucun texte éditable détecté.</p>
                ) : (
                  storageTexts.map((t) => (
                    <div key={t.idx} className="rounded-xl bg-[#111] border border-border/30 p-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-mono uppercase">{t.tag}</span>
                        {textEdits[t.idx] !== undefined && textEdits[t.idx] !== t.text && <span className="text-[9px] text-emerald-400">• modifié</span>}
                      </div>
                      <Textarea
                        defaultValue={t.text}
                        onChange={e => setTextEdits(prev => ({ ...prev, [t.idx]: e.target.value }))}
                        rows={t.text.length > 80 ? 3 : 1}
                        className="bg-input border-border/60 text-xs resize-y min-h-0 py-1.5"
                      />
                    </div>
                  ))
                )
              )}
            </div>
            {/* Footer */}
            <div className="flex items-center gap-2 p-4 border-t border-border/30">
              <p className="text-[10px] text-muted-foreground flex-1">
                Les modifications sont appliquées au code du site et sauvegardées.
              </p>
              <Button variant="ghost" className="h-9 text-xs text-muted-foreground" onClick={() => setShowStoragePanel(false)}>Fermer</Button>
              <Button className="h-9 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={() => {
                  let newHtml = htmlCode;
                  let newCss = cssCode;
                  // Images : remplacer chaque ancienne URL par la nouvelle (globalement)
                  for (const [oldSrc, newSrc] of Object.entries(imgEdits)) {
                    if (!newSrc || newSrc === oldSrc) continue;
                    newHtml = newHtml.split(oldSrc).join(newSrc);
                    newCss = newCss.split(oldSrc).join(newSrc);
                  }
                  // Contenu texte : réinjecter les textes modifiés
                  newHtml = applyTextEdits(newHtml, textEdits);
                  setHtmlCode(newHtml);
                  setCssCode(newCss);
                  const vId = selectedVersionId || project?.currentVersionId;
                  if (vId) {
                    const combined = `<!-- HTML -->\n${newHtml}\n<!-- CSS -->\n${newCss}\n<!-- JS -->\n${jsCode}`;
                    updateCode.mutate({ versionId: vId, code: combined });
                  }
                  buildPreview(newHtml, newCss, jsCode);
                  toast.success("Bibliothèque mise à jour et sauvegardée !");
                  setShowStoragePanel(false);
                }}>
                <Save className="w-3.5 h-3.5 mr-1.5" /> Appliquer & Sauvegarder
              </Button>
            </div>
          </div>
          {/* Hidden file input for image upload */}
          <input ref={storageImgUploadRef} type="file" accept="image/*" className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              const target = storageUploadTargetRef.current;
              if (!file || !target) return;
              const reader = new FileReader();
              reader.onload = ev => {
                setImgEdits(prev => ({ ...prev, [target]: ev.target?.result as string }));
                toast.success("Image importée — cliquez sur Appliquer pour sauvegarder");
              };
              reader.readAsDataURL(file);
              e.target.value = "";
              storageUploadTargetRef.current = null;
            }} />
        </div>
      )}

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
