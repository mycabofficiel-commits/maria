import { useState, useRef } from "react";
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
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Plus, FolderOpen, Globe, Clock, CheckCircle2, AlertCircle,
  Loader2, Sparkles, Users, Eye, LayoutTemplate, ArrowLeft, ArrowRight,
  Link, X, Pencil, Mic, MicOff, Check, ChevronDown, ListChecks
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import ProjectCardMenu from "@/components/ProjectCardMenu";
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template, type TemplateCategory } from "@/data/templates";
import { TemplatePreviewThumb } from "@/components/TemplatePreviewThumb";

const SITE_TYPES = [
  "Landing page", "Site vitrine", "Portfolio", "Restaurant",
  "Artisan", "Agence", "SaaS", "E-commerce simple", "Blog", "Application mobile"
];

const PALETTE_PRESETS = [
  { label: "Bleu/Violet",     colors: ["#6366f1", "#8b5cf6", "#a78bfa"] },
  { label: "Vert/Émeraude",   colors: ["#10b981", "#059669", "#34d399"] },
  { label: "Orange/Ambre",    colors: ["#f59e0b", "#f97316", "#ef4444"] },
  { label: "Rose/Rouge",      colors: ["#ec4899", "#f43f5e", "#fb7185"] },
  { label: "Gris/Noir",       colors: ["#6b7280", "#374151", "#111827"] },
  { label: "Multicolore",     colors: ["#6366f1", "#10b981", "#f59e0b"] },
];

const LANGUAGES = [
  { code: "fr", label: "FR", full: "Français" },
  { code: "en", label: "EN", full: "English" },
  { code: "es", label: "ES", full: "Español" },
  { code: "de", label: "DE", full: "Deutsch" },
  { code: "it", label: "IT", full: "Italiano" },
  { code: "pt", label: "PT", full: "Português" },
  { code: "ar", label: "AR", full: "العربية" },
  { code: "zh", label: "ZH", full: "中文" },
  { code: "ja", label: "JA", full: "日本語" },
];
const STYLES = ["Moderne", "Minimaliste", "Luxe", "Corporate", "Startup", "Premium"];
const FRAMEWORKS = [
  { value: "html", label: "HTML/CSS/JS" },
  { value: "react", label: "React" },
  { value: "nextjs", label: "Next.js" },
];

// Réseaux sociaux proposés dans le sous-menu de l'option "social".
const SOCIAL_NETWORKS = [
  { id: "instagram", label: "Instagram",   icon: "📸" },
  { id: "facebook",  label: "Facebook",    icon: "📘" },
  { id: "x",         label: "X (Twitter)", icon: "✖️" },
  { id: "linkedin",  label: "LinkedIn",    icon: "💼" },
  { id: "tiktok",    label: "TikTok",      icon: "🎵" },
  { id: "youtube",   label: "YouTube",     icon: "▶️" },
  { id: "pinterest", label: "Pinterest",   icon: "📌" },
  { id: "snapchat",  label: "Snapchat",    icon: "👻" },
];

// Services d'emailing proposés dans le sous-menu de l'option "newsletter".
const NEWSLETTER_PROVIDERS = [
  { id: "simple",     label: "Simple (sans service)" },
  { id: "mailchimp",  label: "Mailchimp" },
  { id: "brevo",      label: "Brevo (ex-Sendinblue)" },
  { id: "convertkit", label: "ConvertKit" },
  { id: "mailerlite", label: "MailerLite" },
];

// Options « auxquelles l'utilisateur ne pense pas forcément ».
// Cochées → leur `directive` (enrichie par le sous-menu) est injectée dans le prompt.
// `def: true` = pré-cochée par défaut · `sub: true` = a un sous-menu de configuration.
const EXTRA_OPTIONS: { id: string; icon: string; label: string; desc: string; def: boolean; sub?: boolean; directive: string }[] = [
  { id: "footer",       icon: "📄", label: "Footer complet",        desc: "Liens, coordonnées, copyright", def: true,
    directive: "Ajoute un footer complet et soigné : navigation, coordonnées, copyright avec le nom exact du site, et liens vers les pages légales." },
  { id: "animations",   icon: "✨", label: "Animations",            desc: "Apparitions au scroll, transitions", def: true,
    directive: "Ajoute des animations modernes et fluides : apparition des sections au scroll (fade/slide), transitions au survol, micro-interactions sur les boutons. Subtiles et professionnelles, jamais clinquantes." },
  { id: "seo",          icon: "🔍", label: "SEO optimisé",          desc: "Meta tags, Open Graph, mots-clés", def: true, sub: true,
    directive: "Optimise le SEO : balises meta (title, description), Open Graph + Twitter Card, structure sémantique (un seul h1, hiérarchie h2/h3), attributs alt sur toutes les images." },
  { id: "video",        icon: "▶️", label: "Vidéo YouTube",         desc: "Intègre une ou plusieurs vidéos", def: false, sub: true,
    directive: "Intègre une section vidéo avec un lecteur YouTube responsive." },
  { id: "scrolltop",    icon: "⬆️", label: "Retour en haut",        desc: "Bouton scroll-to-top", def: true,
    directive: "Ajoute un bouton « retour en haut » discret qui apparaît après avoir scrollé." },
  { id: "social",       icon: "📱", label: "Réseaux sociaux",       desc: "Choisis les réseaux + leurs liens", def: false, sub: true,
    directive: "Ajoute des icônes de réseaux sociaux cliquables dans le header et/ou le footer." },
  { id: "cookies",      icon: "🍪", label: "Bandeau cookies",       desc: "Consentement RGPD", def: false,
    directive: "Ajoute un bandeau de consentement cookies (RGPD) avec boutons Accepter/Refuser, choix mémorisé en localStorage et masqué aux visites suivantes." },
  { id: "contact",      icon: "✉️", label: "Formulaire de contact", desc: "Nom, email, message", def: false, sub: true,
    directive: "Ajoute une section formulaire de contact (nom, email, message) avec validation côté client et message de confirmation à l'envoi." },
  { id: "whatsapp",     icon: "💬", label: "Bouton WhatsApp",       desc: "Contact rapide flottant", def: false, sub: true,
    directive: "Ajoute un bouton WhatsApp flottant en bas à droite, ouvrant une conversation (lien wa.me)." },
  { id: "faq",          icon: "❓", label: "FAQ",                   desc: "Tes questions fréquentes (accordéon)", def: false, sub: true,
    directive: "Ajoute une section FAQ avec questions/réponses en accordéon dépliable." },
  { id: "testimonials", icon: "⭐", label: "Témoignages",           desc: "Nombre d'avis clients", def: false, sub: true,
    directive: "Ajoute une section témoignages/avis clients : photos placeholder, noms, et notes en étoiles." },
  { id: "newsletter",   icon: "📧", label: "Newsletter",            desc: "Inscription email + service", def: false, sub: true,
    directive: "Ajoute un bloc d'inscription à la newsletter (champ email + bouton) dans le footer ou une section dédiée." },
  { id: "maps",         icon: "📍", label: "Google Maps",           desc: "Carte + adresse", def: false, sub: true,
    directive: "Ajoute une carte de localisation (iframe Google Maps) dans la section contact." },
  { id: "legal",        icon: "⚖️", label: "Pages légales",         desc: "Mentions, CGV, confidentialité", def: false,
    directive: "Ajoute des pages/sections légales (mentions légales, politique de confidentialité, CGV) accessibles depuis le footer." },
  { id: "loader",       icon: "⏳", label: "Écran de chargement",   desc: "Preloader animé", def: false,
    directive: "Ajoute un écran de chargement animé (preloader) au démarrage de la page, qui disparaît une fois le contenu prêt." },
];

const CATEGORY_COLORS: Record<string, string> = {
  Business: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Créatif: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Services: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Tech: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Mobile: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Brouillon", color: "text-muted-foreground", icon: Clock },
  generating: { label: "Génération…", color: "text-amber-400", icon: Loader2 },
  ready: { label: "Prêt", color: "text-emerald-400", icon: CheckCircle2 },
  published: { label: "Publié", color: "text-primary", icon: Globe },
  archived: { label: "Archivé", color: "text-muted-foreground", icon: Clock },
  error: { label: "Erreur", color: "text-destructive", icon: AlertCircle },
};

// ── Template config constants ────────────────────────────────────────────────
const TPL_COLOR_PRESETS = [
  { label:"Violet/Indigo", p:"#7c3aed", s:"#4f46e5", a:"#a78bfa" },
  { label:"Bleu/Cyan",     p:"#2563eb", s:"#06b6d4", a:"#60a5fa" },
  { label:"Vert/Émeraude", p:"#059669", s:"#10b981", a:"#34d399" },
  { label:"Rose/Rouge",    p:"#db2777", s:"#ef4444", a:"#f472b6" },
  { label:"Orange/Ambre",  p:"#ea580c", s:"#d97706", a:"#fb923c" },
  { label:"Gris/Noir",     p:"#374151", s:"#111827", a:"#6b7280" },
];
const TPL_AUTH_OPTS = [
  { id:"none",   label:"Sans auth",  icon:"🚫" },
  { id:"email",  label:"Email/mdp",  icon:"✉️"  },
  { id:"google", label:"Google",     icon:"🔵" },
  { id:"github", label:"GitHub",     icon:"⚫" },
  { id:"magic",  label:"Magic link", icon:"✨" },
];
const TPL_LANG_OPTS = [
  { code:"fr", flag:"🇫🇷", label:"Français" },
  { code:"en", flag:"🇬🇧", label:"English" },
  { code:"es", flag:"🇪🇸", label:"Español" },
  { code:"de", flag:"🇩🇪", label:"Deutsch" },
  { code:"it", flag:"🇮🇹", label:"Italiano" },
  { code:"pt", flag:"🇧🇷", label:"Português" },
  { code:"ar", flag:"🇸🇦", label:"عربي" },
  { code:"zh", flag:"🇨🇳", label:"中文" },
  { code:"ja", flag:"🇯🇵", label:"日本語" },
];

type DialogTab = "blank" | "template" | "tpl-confirm";

export default function Projects() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DialogTab>("blank");
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>("Tous");
  const [selectedTpl, setSelectedTpl] = useState<Template | null>(null);
  const [tplProjectName, setTplProjectName] = useState("");
  const [tplPrompt, setTplPrompt] = useState("");
  const [tplColorPreset, setTplColorPreset] = useState(0);
  const [tplAuthMethods, setTplAuthMethods] = useState<string[]>(["none"]);
  const [tplLangs, setTplLangs] = useState<string[]>(["fr"]);
  const [tplDarkMode, setTplDarkMode] = useState(false);
  const [tplDictating, setTplDictating] = useState(false);
  const tplDictRef = useRef<any>(null);
  const [isDictating, setIsDictating] = useState(false);
  const dictRecognitionRef = useRef<any>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    siteType: "Landing page",
    style: "Moderne",
    languages: ["fr"] as string[],
    colorPalette: "Bleu/Violet",
    customColors: ["#6366f1", "#8b5cf6", "#a78bfa"] as string[],
    useCustomColors: false,
    inspirationUrls: [""] as string[],
    framework: "html" as "html" | "react" | "nextjs" | "expo",
  });

  // ── Options supplémentaires (cochables + sous-menus) ──
  const [extras, setExtras] = useState<string[]>(EXTRA_OPTIONS.filter(o => o.def).map(o => o.id));
  // Sous-menus dépliés (indépendant du coché — tout replié par défaut pour ne pas masquer les autres options).
  const [expanded, setExpanded] = useState<string[]>([]);
  const [socialNets, setSocialNets] = useState<string[]>([]);
  const [socialUrls, setSocialUrls] = useState<Record<string, string>>({});
  const [mapsAddress, setMapsAddress] = useState("");
  const [seoKeywords, setSeoKeywords] = useState("");
  const [videoLinks, setVideoLinks] = useState<string[]>([""]);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [newsletterProvider, setNewsletterProvider] = useState("simple");
  const [testimonialsCount, setTestimonialsCount] = useState(3);
  const [faqItems, setFaqItems] = useState<string[]>([""]);

  const utils = trpc.useUtils();
  const { data: projects, isLoading } = trpc.projects.list.useQuery();
  const { data: sharedProjects } = trpc.share.sharedWithMe.useQuery();

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (data) => {
      resetDialog();
      utils.projects.list.invalidate();
      navigate(`/projects/${data.id}?autoGenerate=true`);
    },
    onError: (err: any) => toast.error(err.message),
  });


  const resetDialog = () => {
    setOpen(false);
    setTab("blank");
    setSelectedTpl(null);
    setTplProjectName("");
    setActiveCategory("Tous");
    setForm({ name: "", description: "", siteType: "Landing page", style: "Moderne", languages: ["fr"], colorPalette: "Bleu/Violet", customColors: ["#6366f1", "#8b5cf6", "#a78bfa"], useCustomColors: false, inspirationUrls: [""], framework: "html" });
    setExtras(EXTRA_OPTIONS.filter(o => o.def).map(o => o.id));
    setExpanded([]);
    setSocialNets([]); setSocialUrls({}); setMapsAddress(""); setSeoKeywords("");
    setVideoLinks([""]); setWhatsappPhone(""); setContactEmail("");
    setNewsletterProvider("simple"); setTestimonialsCount(3); setFaqItems([""]);
  };

  // ── Helpers options supplémentaires ──
  function toggleExtra(id: string) {
    setExtras(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  // Ouvre/ferme le sous-menu. À l'ouverture, coche l'option (configurer = vouloir l'option).
  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const opening = !prev.includes(id);
      if (opening) setExtras(e => e.includes(id) ? e : [...e, id]);
      return opening ? [...prev, id] : prev.filter(x => x !== id);
    });
  }
  function toggleSocialNet(id: string) {
    setSocialNets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function setVideoLink(i: number, val: string) {
    setVideoLinks(prev => prev.map((l, idx) => idx === i ? val : l));
  }
  function addVideoLink() { setVideoLinks(prev => [...prev, ""]); }
  function removeVideoLink(i: number) {
    setVideoLinks(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  }
  function setFaqItem(i: number, val: string) {
    setFaqItems(prev => prev.map((q, idx) => idx === i ? val : q));
  }
  function addFaqItem() { setFaqItems(prev => [...prev, ""]); }
  function removeFaqItem(i: number) {
    setFaqItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  }

  // Directive d'une option, enrichie par son sous-menu de configuration.
  function directiveFor(opt: typeof EXTRA_OPTIONS[number]): string {
    switch (opt.id) {
      case "social": {
        const nets = socialNets.length
          ? socialNets.map(id => {
              const n = SOCIAL_NETWORKS.find(x => x.id === id);
              const url = socialUrls[id]?.trim();
              return url ? `${n?.label} (${url})` : (n?.label ?? id);
            }).join(", ")
          : "Instagram, Facebook";
        return `Ajoute des icônes de réseaux sociaux cliquables (header et/ou footer) pour : ${nets}.`;
      }
      case "maps": {
        const addr = mapsAddress.trim();
        return addr
          ? `Ajoute une carte Google Maps (iframe) centrée sur l'adresse « ${addr} » dans la section contact, avec l'adresse affichée en texte juste à côté.`
          : opt.directive;
      }
      case "seo": {
        const kw = seoKeywords.trim();
        return opt.directive + (kw ? ` Mots-clés / hashtags à cibler dans les balises et le contenu : ${kw}.` : "");
      }
      case "video": {
        const links = videoLinks.map(l => l.trim()).filter(Boolean);
        return links.length
          ? `Intègre ${links.length > 1 ? "les vidéos YouTube suivantes" : "la vidéo YouTube suivante"} dans une section dédiée, avec un lecteur responsive (embed) : ${links.join(", ")}.`
          : opt.directive;
      }
      case "whatsapp": {
        const ph = whatsappPhone.trim();
        return ph
          ? `Ajoute un bouton WhatsApp flottant en bas à droite ouvrant une conversation avec le numéro ${ph} (lien wa.me).`
          : opt.directive;
      }
      case "contact": {
        const em = contactEmail.trim();
        return opt.directive + (em ? ` Les messages doivent être adressés à l'email ${em}.` : "");
      }
      case "newsletter": {
        if (newsletterProvider === "simple") return opt.directive;
        const label = NEWSLETTER_PROVIDERS.find(p => p.id === newsletterProvider)?.label ?? newsletterProvider;
        return `Ajoute un bloc d'inscription à la newsletter (champ email + bouton) conçu pour se connecter au service ${label} (structure de formulaire prête à brancher sur ${label}).`;
      }
      case "testimonials":
        return `Ajoute une section témoignages/avis clients comportant ${testimonialsCount} avis (photos placeholder, noms, et notes en étoiles).`;
      case "faq": {
        const qs = faqItems.map(q => q.trim()).filter(Boolean);
        return qs.length
          ? `Ajoute une section FAQ (accordéon dépliable) répondant précisément à ces questions : ${qs.map(q => `« ${q} »`).join(", ")}.`
          : opt.directive;
      }
      default:
        return opt.directive;
    }
  }

  // Sous-menu de configuration affiché quand une option `sub` est cochée.
  function renderSubMenu(id: string) {
    const inputCls = "bg-input border-border/60 text-foreground text-sm h-9";
    switch (id) {
      case "social":
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Choisis les réseaux à afficher (et leur lien, optionnel) :</p>
            <div className="flex flex-wrap gap-2">
              {SOCIAL_NETWORKS.map(n => {
                const on = socialNets.includes(n.id);
                return (
                  <button key={n.id} type="button" onClick={() => toggleSocialNet(n.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs transition-all ${on ? "border-primary bg-primary/10 text-primary font-medium" : "border-border/60 text-muted-foreground hover:border-border"}`}>
                    <span>{n.icon}</span><span>{n.label}</span>
                  </button>
                );
              })}
            </div>
            {socialNets.length > 0 && (
              <div className="space-y-2">
                {socialNets.map(nid => {
                  const n = SOCIAL_NETWORKS.find(x => x.id === nid);
                  return (
                    <div key={nid} className="flex items-center gap-2">
                      <span className="text-xs w-24 flex-shrink-0 text-muted-foreground flex items-center gap-1">{n?.icon} {n?.label}</span>
                      <Input value={socialUrls[nid] ?? ""} onChange={e => setSocialUrls(prev => ({ ...prev, [nid]: e.target.value }))}
                        placeholder="Lien (optionnel)" className={inputCls} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      case "maps":
        return (
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Adresse à afficher sur la carte</Label>
            <Input value={mapsAddress} onChange={e => setMapsAddress(e.target.value)}
              placeholder="Ex : 12 rue de la Paix, 75002 Paris" className={inputCls} />
          </div>
        );
      case "seo":
        return (
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Mots-clés / hashtags à cibler (séparés par des virgules)</Label>
            <Input value={seoKeywords} onChange={e => setSeoKeywords(e.target.value)}
              placeholder="Ex : VTC Paris, chauffeur privé, réservation en ligne" className={inputCls} />
          </div>
        );
      case "video":
        return (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground block">Lien(s) de vidéo YouTube</Label>
            {videoLinks.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={l} onChange={e => setVideoLink(i, e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…" className={inputCls} />
                {videoLinks.length > 1 && (
                  <button type="button" onClick={() => removeVideoLink(i)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 flex-shrink-0" title="Retirer">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addVideoLink} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus className="w-3.5 h-3.5" /> Ajouter une vidéo
            </button>
          </div>
        );
      case "whatsapp":
        return (
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Numéro WhatsApp (format international)</Label>
            <Input value={whatsappPhone} onChange={e => setWhatsappPhone(e.target.value)}
              placeholder="Ex : +33 6 12 34 56 78" className={inputCls} />
          </div>
        );
      case "contact":
        return (
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Email de réception des messages (optionnel)</Label>
            <Input value={contactEmail} onChange={e => setContactEmail(e.target.value)}
              placeholder="Ex : contact@monsite.fr" className={inputCls} />
          </div>
        );
      case "newsletter":
        return (
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Service d'emailing à connecter</Label>
            <div className="flex flex-wrap gap-2">
              {NEWSLETTER_PROVIDERS.map(p => {
                const on = newsletterProvider === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => setNewsletterProvider(p.id)}
                    className={`px-2.5 py-1.5 rounded-full border text-xs transition-all ${on ? "border-primary bg-primary/10 text-primary font-medium" : "border-border/60 text-muted-foreground hover:border-border"}`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "testimonials":
        return (
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Nombre d'avis à afficher</Label>
            <div className="flex flex-wrap gap-2">
              {[2, 3, 4, 6, 8].map(n => {
                const on = testimonialsCount === n;
                return (
                  <button key={n} type="button" onClick={() => setTestimonialsCount(n)}
                    className={`w-9 h-9 rounded-lg border text-sm transition-all ${on ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border/60 text-muted-foreground hover:border-border"}`}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "faq":
        return (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground block">Tes questions (laisse vide pour que Mar-ia les invente)</Label>
            {faqItems.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={q} onChange={e => setFaqItem(i, e.target.value)}
                  placeholder={`Question ${i + 1} — ex : Quels sont vos délais ?`} className={inputCls} />
                {faqItems.length > 1 && (
                  <button type="button" onClick={() => removeFaqItem(i)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 flex-shrink-0" title="Retirer">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addFaqItem} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus className="w-3.5 h-3.5" /> Ajouter une question
            </button>
          </div>
        );
      default:
        return null;
    }
  }

  const handleCreate = () => {
    if (!form.name.trim()) return toast.error("Donnez un nom à votre projet");
    const palette = form.useCustomColors
      ? form.customColors.filter(Boolean).join(",")
      : form.colorPalette;

    // Append valid inspiration URLs to the description so the generator can scrape them
    const validUrls = form.inspirationUrls.filter((u) => u.trim().match(/^https?:\/\/.+/));
    let finalDescription = validUrls.length > 0
      ? `${form.description}\n\n[INSPIRATION_URLS: ${validUrls.join(" ")}]`
      : form.description;

    // Options supplémentaires cochées → directives injectées dans le prompt.
    const chosen = EXTRA_OPTIONS.filter(o => extras.includes(o.id));
    if (chosen.length > 0) {
      finalDescription += `\n\nOptions à intégrer impérativement :\n` + chosen.map(o => `- ${directiveFor(o)}`).join("\n");
    }

    createProject.mutate({
      name: form.name,
      description: finalDescription,
      siteType: form.siteType,
      style: form.style,
      language: form.languages.join(","),
      colorPalette: palette,
      framework: form.framework,
    });
  };

  const handleSelectTemplate = (tpl: Template) => {
    setSelectedTpl(tpl);
    setTplProjectName(tpl.name);
    setTplPrompt(tpl.prompt);
    setTplColorPreset(0);
    setTplAuthMethods(["none"]);
    setTplLangs([tpl.language || "fr"]);
    setTplDarkMode(["violet","indigo","orange","monochrome"].includes(tpl.colorPalette));
    setTab("tpl-confirm");
  };

  function toggleTplAuth(id: string) {
    if (id === "none") { setTplAuthMethods(["none"]); return; }
    setTplAuthMethods(prev => {
      const without = prev.filter(a => a !== "none");
      return without.includes(id) ? (without.filter(a => a !== id).length ? without.filter(a => a !== id) : ["none"]) : [...without, id];
    });
  }

  function toggleTplLang(code: string) {
    setTplLangs(prev => prev.includes(code) ? (prev.length > 1 ? prev.filter(c => c !== code) : prev) : [...prev, code]);
  }

  function startTplDictation() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Dictée non supportée sur ce navigateur."); return; }
    const rec = new SR();
    rec.lang = "fr-FR"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join("");
      setTplPrompt(prev => {
        const base = prev.replace(/\s*\[dictée en cours…\]\s*$/, "");
        return base + (base && !base.endsWith(" ") ? " " : "") + transcript + (e.results[e.results.length-1].isFinal ? "" : " [dictée en cours…]");
      });
    };
    rec.onerror = () => setTplDictating(false);
    rec.onend = () => setTplDictating(false);
    tplDictRef.current = rec;
    rec.start();
    setTplDictating(true);
  }

  function stopTplDictation() {
    tplDictRef.current?.stop();
    setTplPrompt(prev => prev.replace(/\s*\[dictée en cours…\]\s*$/, "").trim());
    setTplDictating(false);
  }

  const handleCreateFromTemplate = () => {
    if (!selectedTpl) return;
    const preset = TPL_COLOR_PRESETS[tplColorPreset];
    let finalPrompt = tplPrompt.replace(/\s*\[dictée en cours…\]\s*$/, "").trim();
    const activeAuth = tplAuthMethods.filter(a => a !== "none");
    if (activeAuth.length > 0) {
      const labels = activeAuth.map(id => TPL_AUTH_OPTS.find(a => a.id === id)?.label ?? id);
      finalPrompt += `\n\nAuthentification : Intégrer un système d'authentification avec ${labels.join(", ")}.`;
    }
    if (tplLangs.length > 1) {
      const labels = tplLangs.map(c => TPL_LANG_OPTS.find(l => l.code === c)?.label ?? c);
      finalPrompt += `\n\nMulti-langues : L'interface doit être disponible en ${labels.join(", ")} avec sélecteur de langue.`;
    }
    finalPrompt += `\n\nCouleurs : ${preset.p} (primaire), ${preset.s} (secondaire), ${preset.a} (accent).`;
    if (tplDarkMode) finalPrompt += `\n\nThème : Design sombre (dark mode), fond très foncé.`;
    createProject.mutate({
      name: tplProjectName.trim() || selectedTpl.name,
      description: finalPrompt,
      siteType: selectedTpl.siteType,
      style: selectedTpl.style,
      colorPalette: preset.p,
      language: tplLangs[0] ?? "fr",
      framework: selectedTpl.framework,
    });
  };

  const filteredTpls = activeCategory === "Tous"
    ? TEMPLATES
    : TEMPLATES.filter((t) => t.category === activeCategory);

  return (
    <AppLayout title="Projets">
      <div className="max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-display font-bold text-foreground">Mes projets</h2>
            <p className="text-muted-foreground mt-1">{projects?.length || 0} projet{(projects?.length || 0) > 1 ? "s" : ""}</p>
          </div>
          <Dialog open={open} onOpenChange={(o) => { if (!o) resetDialog(); else setOpen(true); }}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau projet
              </Button>
            </DialogTrigger>
            <DialogContent className={`bg-card border-border/60 transition-all max-h-[92vh] overflow-y-auto ${tab === "template" ? "max-w-4xl" : tab === "tpl-confirm" ? "max-w-2xl" : "max-w-lg"}`}>
              <DialogHeader>
                <DialogTitle className="font-display text-foreground flex items-center gap-2">
                  {tab === "tpl-confirm" && (
                    <button onClick={() => setTab("template")} className="text-muted-foreground hover:text-foreground">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}
                  {tab === "tpl-confirm" ? (
                    <><span className="text-xl">{selectedTpl?.emoji}</span> {selectedTpl?.name}</>
                  ) : "Nouveau projet"}
                </DialogTitle>
              </DialogHeader>

              {/* Tabs */}
              {tab !== "tpl-confirm" && (
                <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40">
                  <button
                    onClick={() => setTab("blank")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                      tab === "blank" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" /> Projet vide
                  </button>
                  <button
                    onClick={() => setTab("template")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                      tab === "template" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" /> Templates
                  </button>
                </div>
              )}

              {/* ── Tab: Projet vide ── */}
              {tab === "blank" && (
                <div className="space-y-4 pt-1">
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Nom du projet *</Label>
                    <Input
                      placeholder="Mon site web"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="bg-input border-border/60"
                      autoFocus
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <Label className="text-sm text-foreground">Décrivez votre site *</Label>
                      <button
                        type="button"
                        title={isDictating ? "Arrêter la dictée" : "Dicter la description (voix)"}
                        onClick={() => {
                          const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                          if (!SR) { toast.error("Dictée non supportée dans ce navigateur (Chrome recommandé)"); return; }
                          if (isDictating) {
                            dictRecognitionRef.current?.stop();
                            setIsDictating(false);
                            return;
                          }
                          const rec = new SR();
                          rec.lang = "fr-FR";
                          rec.continuous = true;
                          rec.interimResults = true;
                          let base = form.description;
                          rec.onresult = (e: any) => {
                            const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join("");
                            setForm(prev => ({ ...prev, description: base + (base && !base.endsWith(" ") ? " " : "") + transcript }));
                          };
                          rec.onend = () => { setIsDictating(false); };
                          rec.onerror = () => { setIsDictating(false); toast.error("Erreur de dictée"); };
                          dictRecognitionRef.current = rec;
                          base = form.description;
                          rec.start();
                          setIsDictating(true);
                        }}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                          isDictating
                            ? "bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse"
                            : "text-muted-foreground hover:text-primary border border-border/40 hover:border-primary/40"
                        }`}
                      >
                        {isDictating ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                        {isDictating ? "Arrêter" : "Dicter"}
                      </button>
                    </div>
                    <textarea
                      placeholder="Ex: Une landing page pour une startup de livraison de repas sains, avec un hero accrocheur, section fonctionnalités et un CTA fort…"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={4}
                      className={`w-full rounded-md border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${
                        isDictating ? "border-red-500/40 ring-1 ring-red-500/20" : "border-border/60"
                      }`}
                    />
                    {isDictating && (
                      <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping inline-block" />
                        Dictée en cours… parlez maintenant
                      </p>
                    )}
                  </div>
                  {/* ── Inspiration URLs ── */}
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 flex items-center gap-1.5">
                      <Link className="w-3.5 h-3.5 text-primary" />
                      Inspiration <span className="text-muted-foreground font-normal text-xs">(optionnel — jusqu'à 4 sites)</span>
                    </Label>
                    <div className="space-y-1.5">
                      {form.inspirationUrls.map((url, i) => (
                        <div key={i} className="flex gap-1.5">
                          <Input
                            placeholder="https://exemple.com"
                            value={url}
                            onChange={(e) => {
                              const next = [...form.inspirationUrls];
                              next[i] = e.target.value;
                              setForm({ ...form, inspirationUrls: next });
                            }}
                            className="bg-input border-border/60 text-sm h-8"
                          />
                          {form.inspirationUrls.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, inspirationUrls: form.inspirationUrls.filter((_, j) => j !== i) })}
                              className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {form.inspirationUrls.length < 4 && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, inspirationUrls: [...form.inspirationUrls, ""] })}
                        className="mt-1.5 text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Ajouter un site
                      </button>
                    )}
                    {form.inspirationUrls.some((u) => u.trim().match(/^https?:\/\/.+/)) && (
                      <p className="text-[10px] text-emerald-400 mt-1">✦ Mar-ia analysera ces sites avant de générer</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm text-foreground mb-1.5 block">Type de site</Label>
                      <Select
                        value={form.siteType}
                        onValueChange={(v) => {
                          const isMobile = v === "Application mobile";
                          setForm({
                            ...form,
                            siteType: v,
                            framework: isMobile ? "expo" : (form.framework === "expo" ? "html" : form.framework),
                          });
                        }}
                      >
                        <SelectTrigger className="bg-input border-border/60"><SelectValue /></SelectTrigger>
                        <SelectContent>{SITE_TYPES.map((t) => <SelectItem key={t} value={t}>{t === "Application mobile" ? "📱 Application mobile" : t}</SelectItem>)}</SelectContent>
                      </Select>
                      {form.siteType === "Application mobile" && (
                        <p className="text-[10px] text-amber-400 mt-1">⚡ Génération Expo (iOS &amp; Android)</p>
                      )}
                    </div>
                    <div>
                      <Label className="text-sm text-foreground mb-1.5 block">Style</Label>
                      <Select value={form.style} onValueChange={(v) => setForm({ ...form, style: v })}>
                        <SelectTrigger className="bg-input border-border/60"><SelectValue /></SelectTrigger>
                        <SelectContent>{STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Langue(s) — multi-select pills */}
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Langue(s)</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {LANGUAGES.map(({ code, label, full }) => {
                        const selected = form.languages.includes(code);
                        return (
                          <button
                            key={code}
                            type="button"
                            title={full}
                            onClick={() => {
                              if (selected) {
                                if (form.languages.length === 1) return; // keep at least 1
                                setForm({ ...form, languages: form.languages.filter((l) => l !== code) });
                              } else {
                                setForm({ ...form, languages: [...form.languages, code] });
                              }
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                              selected
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {form.languages.length > 1 && (
                      <p className="text-[10px] text-muted-foreground mt-1">Site multilingue : {form.languages.map(l => LANGUAGES.find(x => x.code === l)?.full).join(", ")}</p>
                    )}
                  </div>

                  {/* Palette — presets + personnalisée */}
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 block">Palette de couleurs</Label>
                    <div className="flex flex-wrap gap-2">
                      {PALETTE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          title={preset.label}
                          onClick={() => setForm({ ...form, colorPalette: preset.label, useCustomColors: false })}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                            !form.useCustomColors && form.colorPalette === preset.label
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                          }`}
                        >
                          <span className="flex gap-0.5">
                            {preset.colors.map((c) => (
                              <span key={c} className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: c }} />
                            ))}
                          </span>
                          <span className="hidden sm:inline">{preset.label}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, useCustomColors: true })}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all ${
                          form.useCustomColors
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        🎨 Personnalisée
                      </button>
                    </div>
                    {form.useCustomColors && (
                      <div className="flex gap-2 mt-2">
                        {form.customColors.map((color, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <input
                              type="color"
                              value={color}
                              onChange={(e) => {
                                const next = [...form.customColors];
                                next[i] = e.target.value;
                                setForm({ ...form, customColors: next });
                              }}
                              className="w-full h-8 rounded cursor-pointer border border-border/60 bg-transparent p-0.5"
                            />
                            <span className="text-[10px] text-muted-foreground font-mono">{color.toUpperCase()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* ── Options supplémentaires ── */}
                  <div>
                    <Label className="text-sm text-foreground mb-1.5 flex items-center gap-1.5">
                      <ListChecks className="w-3.5 h-3.5 text-primary" />
                      Options supplémentaires
                      <span className="text-muted-foreground font-normal text-xs">(souvent oubliées — coche ce que Mar-ia doit intégrer)</span>
                    </Label>
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                      {EXTRA_OPTIONS.map(opt => {
                        const active = extras.includes(opt.id);
                        const hasSub = !!opt.sub;
                        const isOpen = expanded.includes(opt.id);
                        return (
                          <div key={opt.id} className={`rounded-xl border transition-all ${active ? "border-primary/70 bg-primary/5" : "border-border/60"}`}>
                            <div className="w-full flex items-start gap-3 p-2.5">
                              <button
                                type="button"
                                onClick={() => toggleExtra(opt.id)}
                                className="flex items-start gap-3 flex-1 min-w-0 text-left"
                              >
                                <span className={`mt-0.5 w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center border transition-colors ${active ? "bg-primary border-primary" : "border-border/70"}`}>
                                  {active && <Check className="w-3.5 h-3.5 text-primary-foreground" strokeWidth={3} />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className={`text-sm font-medium flex items-center gap-1.5 ${active ? "text-primary" : "text-foreground"}`}>
                                    <span>{opt.icon}</span>{opt.label}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                                </div>
                              </button>
                              {hasSub && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(opt.id)}
                                  title={isOpen ? "Replier la configuration" : "Configurer"}
                                  className="flex-shrink-0 mt-0.5 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                                >
                                  <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                </button>
                              )}
                            </div>
                            {hasSub && isOpen && (
                              <div className="px-3 pb-3 pt-1 border-t border-border/40">
                                {renderSubMenu(opt.id)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{extras.length} option(s) sélectionnée(s) — modifiable ensuite via le chat.</p>
                  </div>

                  <Button
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={handleCreate}
                    disabled={createProject.isPending || !form.name.trim() || !form.description.trim()}
                  >
                    {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    Créer et générer le site
                  </Button>
                </div>
              )}

              {/* ── Tab: Templates ── */}
              {tab === "template" && (
                <div className="space-y-4 pt-1">
                  {/* Category filter */}
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                          activeCategory === cat
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                        }`}
                      >
                        {cat}
                        {cat !== "Tous" && (
                          <span className="ml-1 opacity-60">{TEMPLATES.filter((t) => t.category === cat).length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {/* Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[65vh] overflow-y-auto pr-1">
                    {filteredTpls.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="group rounded-xl border border-border/60 bg-card/50 hover:border-primary/30 hover:bg-card transition-all flex flex-col cursor-pointer overflow-hidden"
                        onClick={() => handleSelectTemplate(tpl)}
                      >
                        {/* Miniature preview */}
                        <TemplatePreviewThumb template={tpl} />

                        {/* Info */}
                        <div className="p-3 flex flex-col gap-2 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{tpl.emoji}</span>
                              <h3 className="font-semibold text-foreground text-sm leading-tight">{tpl.name}</h3>
                            </div>
                            <Badge variant="outline" className={`text-[10px] font-medium flex-shrink-0 ${CATEGORY_COLORS[tpl.category]}`}>{tpl.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{tpl.description}</p>
                          <div className="flex items-center justify-between pt-1 border-t border-border/30 mt-auto">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{tpl.framework.toUpperCase()} · {tpl.style}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Tab: Configure template ── */}
              {tab === "tpl-confirm" && selectedTpl && (
                <div className="max-h-[80vh] overflow-y-auto space-y-5 pt-1 pr-1">

                  {/* Preview band */}
                  <div className="rounded-xl overflow-hidden border border-border/40 flex-shrink-0" style={{ height: 100 }}>
                    <TemplatePreviewThumb template={selectedTpl} height={100} showExpand={false} />
                  </div>

                  {/* Two-col layout */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

                    {/* LEFT: Name + Prompt */}
                    <div className="space-y-4 sm:col-span-2">
                      {/* Name */}
                      <div>
                        <Label className="text-sm text-foreground mb-1.5 block">Nom du projet</Label>
                        <Input
                          placeholder={selectedTpl.name}
                          value={tplProjectName}
                          onChange={(e) => setTplProjectName(e.target.value)}
                          className="bg-input border-border/60"
                          autoFocus
                        />
                      </div>

                      {/* Prompt with dictation */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <Label className="text-sm text-foreground">Instructions pour l'IA</Label>
                          <button
                            type="button"
                            onClick={tplDictating ? stopTplDictation : startTplDictation}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                              tplDictating
                                ? "bg-red-500/10 border-red-500/40 text-red-400 animate-pulse"
                                : "bg-muted/40 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                            }`}
                          >
                            {tplDictating ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                            {tplDictating ? "Arrêter" : "Dicter"}
                          </button>
                        </div>
                        <textarea
                          value={tplPrompt}
                          onChange={(e) => setTplPrompt(e.target.value)}
                          rows={5}
                          placeholder="Décris ton projet : nom, fonctionnalités, sections, contenu, architecture…"
                          className={`w-full rounded-xl bg-input border px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y transition-colors ${
                            tplDictating ? "border-red-500/40" : "border-border/60"
                          }`}
                        />
                        {tplDictating && <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />Dictée en cours…</p>}
                      </div>
                    </div>

                    {/* Couleurs */}
                    <div>
                      <Label className="text-sm text-foreground mb-2 block">Palette de couleurs</Label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {TPL_COLOR_PRESETS.map((preset, i) => (
                          <button
                            key={i}
                            onClick={() => setTplColorPreset(i)}
                            className={`flex items-center gap-1.5 p-2 rounded-lg border text-left transition-all ${
                              tplColorPreset === i ? "border-primary bg-primary/10" : "border-border/50 hover:border-border"
                            }`}
                          >
                            <div className="flex gap-0.5 flex-shrink-0">
                              {[preset.p, preset.s, preset.a].map((c,j) => (
                                <div key={j} style={{ background:c }} className="w-3 h-3 rounded-full" />
                              ))}
                            </div>
                            <span className="text-[10px] text-muted-foreground truncate">{preset.label}</span>
                          </button>
                        ))}
                      </div>
                      {/* Dark mode */}
                      <button
                        onClick={() => setTplDarkMode(!tplDarkMode)}
                        className={`mt-2 w-full flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-all ${
                          tplDarkMode ? "border-primary/60 bg-primary/8 text-foreground" : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <div className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${tplDarkMode ? "bg-primary" : "bg-muted-foreground/30"}`}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${tplDarkMode ? "translate-x-4" : "translate-x-0.5"}`} />
                        </div>
                        <span>Mode sombre</span>
                      </button>
                    </div>

                    {/* Auth */}
                    <div>
                      <Label className="text-sm text-foreground mb-2 block">Authentification</Label>
                      <div className="flex flex-col gap-1.5">
                        {TPL_AUTH_OPTS.map(opt => {
                          const active = tplAuthMethods.includes(opt.id);
                          return (
                            <button
                              key={opt.id}
                              onClick={() => toggleTplAuth(opt.id)}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-all text-left ${
                                active ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                              }`}
                            >
                              <span className="text-base">{opt.icon}</span>
                              <span className={active ? "font-medium" : ""}>{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Languages */}
                    <div className="sm:col-span-2">
                      <Label className="text-sm text-foreground mb-2 block">Langues de l'interface</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {TPL_LANG_OPTS.map(l => {
                          const active = tplLangs.includes(l.code);
                          return (
                            <button
                              key={l.code}
                              onClick={() => toggleTplLang(l.code)}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs transition-all ${
                                active ? "border-primary/60 bg-primary/10 text-primary font-medium" : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                              }`}
                            >
                              <span>{l.flag}</span> <span>{l.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      {tplLangs.length > 1 && (
                        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                          <Globe className="w-3 h-3" /> Sélecteur de langue intégré en {tplLangs.length} langues.
                        </p>
                      )}
                    </div>

                  </div>{/* end grid */}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1 border-t border-border/30">
                    <Button variant="outline" className="border-border/60" onClick={() => setTab("template")}>
                      <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Retour
                    </Button>
                    <Button
                      className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                      onClick={handleCreateFromTemplate}
                      disabled={createProject.isPending || !tplProjectName.trim()}
                    >
                      {createProject.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Création…</>
                        : <><Sparkles className="w-4 h-4 mr-2" />Créer et générer avec l'IA</>
                      }
                    </Button>
                  </div>
                </div>
              )}
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
            <Button onClick={() => { resetDialog(); setOpen(true); }} className="bg-primary hover:bg-primary/90 text-primary-foreground">
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
                  {/* Actions — 3-dot menu */}
                  <div className="absolute top-3 right-3">
                    <ProjectCardMenu
                      project={{ id: project.id, name: project.name, isPublished: project.isPublished, deployedUrl: (project as any).deployedUrl }}
                    />
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
              onClick={() => { resetDialog(); setOpen(true); }}
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
                          <><Pencil className="w-2.5 h-2.5 mr-1" />Éditeur</>
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
