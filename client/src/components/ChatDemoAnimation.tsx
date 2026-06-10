import { useState, useEffect, useRef } from "react";
import { Code2, Sparkles, Send } from "lucide-react";
import { useLang } from "@/i18n/LangContext";

// ── Mini site previews ────────────────────────────────────────────────────────

interface SiteTexts {
  nav: [string, string, string];
  welcome: string;
  tagline: string;
  cta1: string;
  cta2: string;
  badge: string;
  tags: [string, string, string];
}

function SiteV0({ tx }: { tx: SiteTexts }) {
  return (
    <div className="w-full h-full flex flex-col bg-slate-100 text-gray-800 text-[9px]">
      <nav className="h-7 bg-white border-b border-gray-200 flex items-center px-3 gap-2 shrink-0">
        <span className="font-bold text-gray-700">MonSite</span>
        <div className="flex gap-3 ml-auto">
          {tx.nav.map((l) => (
            <span key={l} className="text-gray-400">{l}</span>
          ))}
        </div>
      </nav>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6">
        <p className="text-[11px] font-bold text-gray-800 text-center">{tx.welcome}</p>
        <p className="text-gray-400 text-center leading-relaxed max-w-[110px]">{tx.tagline}</p>
        <div className="flex gap-2 mt-1">
          <span className="px-3 py-1 bg-blue-500 text-white rounded font-medium">{tx.cta1}</span>
          <span className="px-3 py-1 border border-gray-300 text-gray-500 rounded">{tx.cta2}</span>
        </div>
      </div>
    </div>
  );
}

function SiteV1({ tx }: { tx: SiteTexts }) {
  return (
    <div className="w-full h-full flex flex-col bg-gradient-to-br from-violet-950 via-purple-900 to-indigo-950 text-white text-[9px]">
      <nav className="h-7 bg-white/10 border-b border-white/10 flex items-center px-3 gap-2 shrink-0">
        <span className="font-bold text-white">MonSite</span>
        <div className="flex gap-3 ml-auto">
          {tx.nav.map((l) => (
            <span key={l} className="text-white/50">{l}</span>
          ))}
        </div>
      </nav>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 relative overflow-hidden">
        <div className="absolute w-40 h-40 bg-violet-500/25 rounded-full blur-3xl top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <p className="text-[11px] font-bold text-white text-center drop-shadow relative z-10">{tx.welcome}</p>
        <p className="text-white/50 text-center leading-relaxed max-w-[110px] relative z-10">{tx.tagline}</p>
        <div className="flex gap-2 mt-1 relative z-10">
          <span className="px-3 py-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded font-medium shadow-lg shadow-violet-500/40">
            {tx.cta1}
          </span>
          <span className="px-3 py-1 border border-white/20 text-white/60 rounded backdrop-blur-sm">
            {tx.cta2}
          </span>
        </div>
      </div>
    </div>
  );
}

function SiteV2({ tx }: { tx: SiteTexts }) {
  return (
    <div className="w-full h-full flex flex-col bg-gradient-to-br from-violet-950 via-purple-900 to-indigo-950 text-white text-[9px]">
      <nav className="h-7 bg-white/10 border-b border-white/10 flex items-center px-3 gap-2 shrink-0">
        <span className="font-bold text-white">MonSite</span>
        <div className="flex gap-3 ml-auto">
          {tx.nav.map((l) => (
            <span key={l} className="text-white/50">{l}</span>
          ))}
        </div>
      </nav>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 relative overflow-hidden">
        <div className="absolute w-40 h-40 bg-violet-500/25 rounded-full blur-3xl top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="px-2.5 py-0.5 bg-violet-500/20 border border-violet-400/30 rounded-full text-violet-300 flex items-center gap-1 relative z-10">
          {tx.badge}
        </div>
        <p className="text-[11px] font-bold text-white text-center drop-shadow relative z-10">{tx.welcome}</p>
        <p className="text-white/50 text-center leading-relaxed max-w-[110px] relative z-10">{tx.tagline}</p>
        <div className="flex gap-2 mt-1 relative z-10">
          <span className="px-3 py-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full font-medium shadow-lg shadow-violet-500/40">
            {tx.cta1}
          </span>
          <span className="px-3 py-1 border border-white/20 text-white/60 rounded-full backdrop-blur-sm">
            {tx.cta2}
          </span>
        </div>
      </div>
    </div>
  );
}

function SiteV3({ tx }: { tx: SiteTexts }) {
  return (
    <div className="w-full h-full flex flex-col bg-gradient-to-br from-violet-950 via-purple-900 to-indigo-950 text-white text-[9px]">
      <nav className="h-7 bg-white/10 border-b border-white/10 flex items-center px-3 gap-2 shrink-0">
        <span className="font-bold text-white">MonSite</span>
        <div className="flex gap-3 ml-auto">
          {tx.nav.map((l) => (
            <span key={l} className="text-white/50">{l}</span>
          ))}
        </div>
      </nav>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 relative overflow-hidden">
        <div className="absolute w-40 h-40 bg-violet-500/25 rounded-full blur-3xl top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="px-2.5 py-0.5 bg-violet-500/20 border border-violet-400/30 rounded-full text-violet-300 flex items-center gap-1 relative z-10">
          {tx.badge}
        </div>
        <p className="text-[12px] font-bold text-white text-center drop-shadow relative z-10">{tx.welcome}</p>
        <p className="text-white/50 text-center leading-relaxed max-w-[110px] relative z-10">{tx.tagline}</p>
        <div className="flex gap-2 relative z-10">
          <span className="px-3 py-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full font-medium shadow-lg shadow-violet-500/40">
            {tx.cta1}
          </span>
          <span className="px-3 py-1 border border-white/20 text-white/60 rounded-full backdrop-blur-sm">
            {tx.cta2}
          </span>
        </div>
        <div className="flex gap-2 relative z-10">
          {tx.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 bg-white/10 border border-white/10 rounded-full text-white/50 text-[7px]">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMsg {
  role: "user" | "ai";
  text: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChatDemoAnimation() {
  const { t } = useLang();

  // Always up-to-date ref so the animation loop reads the current language
  const tRef = useRef(t);
  tRef.current = t;

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [previewVariant, setPreviewVariant] = useState(0);
  const [previewFading, setPreviewFading] = useState(false);

  // Preview texts are reactive (re-render on lang change)
  const siteTexts: SiteTexts = {
    nav: [t("demo_site_nav1"), t("demo_site_nav2"), t("demo_site_nav3")],
    welcome: t("demo_site_welcome"),
    tagline: t("demo_site_tagline"),
    cta1: t("demo_site_cta1"),
    cta2: t("demo_site_cta2"),
    badge: t("demo_site_badge"),
    tags: [t("demo_site_tag1"), t("demo_site_tag2"), t("demo_site_tag3")],
  };

  useEffect(() => {
    let active = true;

    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function run() {
      while (active) {
        // Build STEPS fresh each loop using the current language via tRef
        const tr = tRef.current;
        const steps = [
          { user: tr("demo_step1_user"), ai: tr("demo_step1_ai"), variant: 1 },
          { user: tr("demo_step2_user"), ai: tr("demo_step2_ai"), variant: 2 },
          { user: tr("demo_step3_user"), ai: tr("demo_step3_ai"), variant: 3 },
        ];

        // ── Reset ──
        setMessages([]);
        setPreviewVariant(0);
        setInputValue("");
        setIsThinking(false);
        setStreamingText("");

        await wait(900);

        for (const step of steps) {
          if (!active) return;

          // 1. Type user message char by char
          for (let i = 1; i <= step.user.length; i++) {
            if (!active) return;
            setInputValue(step.user.slice(0, i));
            await wait(48);
          }
          await wait(300);

          // 2. "Send" user message
          if (!active) return;
          setMessages((prev) => [...prev, { role: "user", text: step.user }]);
          setInputValue("");
          await wait(350);

          // 3. AI thinking
          if (!active) return;
          setIsThinking(true);
          await wait(1100);

          // 4. Stream AI response
          if (!active) return;
          setIsThinking(false);
          setStreamingText("");

          for (let i = 1; i <= step.ai.length; i++) {
            if (!active) return;
            setStreamingText(step.ai.slice(0, i));
            await wait(16);
          }
          await wait(150);

          // 5. Commit AI message
          if (!active) return;
          setMessages((prev) => [...prev, { role: "ai", text: step.ai }]);
          setStreamingText("");

          // 6. Fade preview → update
          setPreviewFading(true);
          await wait(280);
          if (!active) return;
          setPreviewVariant(step.variant);
          setPreviewFading(false);

          await wait(2400);
        }

        await wait(1200);
      }
    }

    run().catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const previews = [
    <SiteV0 tx={siteTexts} />,
    <SiteV1 tx={siteTexts} />,
    <SiteV2 tx={siteTexts} />,
    <SiteV3 tx={siteTexts} />,
  ];

  return (
    <div className="grid grid-cols-5 min-h-[340px]">

      {/* ── File sidebar ─────────────────────────────────── */}
      <div className="col-span-1 bg-card/30 border-r border-border/50 p-3 flex flex-col gap-1.5">
        {["index.html", "style.css", "script.js"].map((f, i) => (
          <div
            key={f}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
              i === 0
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{f}</span>
          </div>
        ))}
        <div className="mt-auto pt-3 border-t border-border/40">
          <div className="text-[10px] text-muted-foreground/60 font-mono px-1">v3 • live</div>
        </div>
      </div>

      {/* ── Website preview ──────────────────────────────── */}
      <div className="col-span-2 border-r border-border/50 overflow-hidden relative">
        <div
          className="w-full h-full transition-opacity duration-500"
          style={{ opacity: previewFading ? 0 : 1 }}
        >
          {previews[previewVariant] ?? previews[0]}
        </div>
        {previewFading && (
          <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
        )}
      </div>

      {/* ── Chat panel ───────────────────────────────────── */}
      <div className="col-span-2 flex flex-col bg-background/30">

        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card/20 shrink-0">
          <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-2.5 h-2.5 text-primary" />
          </div>
          <span className="text-[11px] font-medium text-foreground">{t("demo_chat_title")}</span>
          <div className="ml-auto flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] text-emerald-400">{t("demo_chat_online")}</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2 min-h-0">
          {messages.length === 0 && !isThinking && !streamingText && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[10px] text-muted-foreground/50 text-center px-4">
                {t("demo_chat_idle")}
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-1.5 items-end ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {msg.role === "ai" && (
                <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mb-0.5">
                  <Sparkles className="w-2.5 h-2.5 text-primary" />
                </div>
              )}
              <div
                className={`text-[10px] leading-relaxed px-2.5 py-1.5 rounded-2xl max-w-[82%] ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-card border border-border/60 text-foreground rounded-bl-sm"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {/* Thinking dots */}
          {isThinking && (
            <div className="flex gap-1.5 items-end">
              <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mb-0.5">
                <Sparkles className="w-2.5 h-2.5 text-primary" />
              </div>
              <div className="bg-card border border-border/60 px-3 py-2 rounded-2xl rounded-bl-sm flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "160ms" }} />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "320ms" }} />
              </div>
            </div>
          )}

          {/* Streaming AI message */}
          {streamingText && (
            <div className="flex gap-1.5 items-end">
              <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mb-0.5">
                <Sparkles className="w-2.5 h-2.5 text-primary" />
              </div>
              <div className="bg-card border border-border/60 text-foreground text-[10px] leading-relaxed px-2.5 py-1.5 rounded-2xl rounded-bl-sm max-w-[82%]">
                {streamingText}
                <span className="inline-block w-0.5 h-3 bg-primary ml-0.5 animate-pulse align-text-bottom rounded-full" />
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-border/50 p-2 flex gap-2 items-center shrink-0 bg-card/10">
          <div className="flex-1 bg-muted/50 border border-border/40 rounded-xl px-3 py-1.5 text-[10px] text-foreground min-h-[30px] flex items-center">
            {inputValue ? (
              <>
                {inputValue}
                <span className="inline-block w-0.5 h-3 bg-primary ml-0.5 animate-pulse align-text-bottom rounded-full" />
              </>
            ) : (
              <span className="text-muted-foreground/50">{t("demo_chat_placeholder")}</span>
            )}
          </div>
          <button
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              inputValue
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
                : "bg-muted/50 text-muted-foreground/40"
            }`}
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
