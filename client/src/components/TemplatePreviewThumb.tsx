import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import type { Template } from "@/data/templates";

// ── Palette map ─────────────────────────────────────────────────────────────
const PAL: Record<string, { p: string; g: string; bg: string; card: string; t: string; m: string }> = {
  violet:    { p:"#7c3aed", g:"#4f46e5", bg:"#0f0a1e", card:"#1e1535", t:"#e2e8f0", m:"#a78bfa" },
  monochrome:{ p:"#e5e7eb", g:"#6b7280", bg:"#030712", card:"#111827", t:"#f9fafb", m:"#9ca3af" },
  gold:      { p:"#d97706", g:"#a16207", bg:"#1a0f00", card:"#2d1800", t:"#fef3c7", m:"#fbbf24" },
  bleu:      { p:"#2563eb", g:"#1d4ed8", bg:"#eff6ff", card:"#dbeafe", t:"#1e3a5f", m:"#60a5fa" },
  vert:      { p:"#059669", g:"#047857", bg:"#f0fdf4", card:"#d1fae5", t:"#14532d", m:"#34d399" },
  rose:      { p:"#db2777", g:"#9d174d", bg:"#fff1f2", card:"#ffe4e6", t:"#881337", m:"#f472b6" },
  beige:     { p:"#a16207", g:"#78350f", bg:"#fafaf9", card:"#fef3c7", t:"#1c1917", m:"#d97706" },
  orange:    { p:"#ea580c", g:"#dc2626", bg:"#1c0800", card:"#431407", t:"#fed7aa", m:"#fb923c" },
  indigo:    { p:"#4f46e5", g:"#7c3aed", bg:"#0f0720", card:"#1e1b4b", t:"#e0e7ff", m:"#818cf8" },
  terre:     { p:"#b45309", g:"#78350f", bg:"#fef9ee", card:"#fef3c7", t:"#292524", m:"#d97706" },
};

function a(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Mobile phone wireframe ────────────────────────────────────────────────
function PhoneWire({ p: pal, h }: { p: typeof PAL[string]; h: number }) {
  const phoneH = h - 12;
  const phoneW = phoneH * 0.48;
  return (
    <div style={{ background:"#0d0d1a", width:"100%", height:h, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{
        width: phoneW, height: phoneH,
        background: pal.bg,
        border: "2.5px solid #555",
        borderRadius: phoneW * 0.22,
        overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
      }}>
        {/* Status bar */}
        <div style={{ height: phoneH * 0.065, background: pal.p, flexShrink: 0 }} />
        {/* Screen */}
        <div style={{ flex:1, padding: "5% 8%", display:"flex", flexDirection:"column", gap: phoneH * 0.03, overflow:"hidden" }}>
          <div style={{ height: phoneH * 0.045, background: pal.t, borderRadius: 2, opacity:.85, width:"55%" }} />
          {[0,1,2].map(i => (
            <div key={i} style={{ display:"flex", gap: "8%", alignItems:"center" }}>
              <div style={{ width: phoneH*0.12, height: phoneH*0.12, borderRadius:"22%", background: a(pal.p, 0.35+i*.1), flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div style={{ height: phoneH*0.03, background: pal.t, borderRadius:2, opacity:.75, marginBottom:"15%" }} />
                <div style={{ height: phoneH*0.025, background: pal.m, borderRadius:2, opacity:.45, width:"70%" }} />
              </div>
            </div>
          ))}
          {/* CTA */}
          <div style={{
            marginTop:"auto",
            height: phoneH * 0.08,
            background: `linear-gradient(90deg,${pal.p},${pal.g})`,
            borderRadius: 4, opacity:.95,
          }} />
        </div>
        {/* Tab bar */}
        <div style={{ height: phoneH*0.11, background: pal.card, borderTop:`1px solid ${a(pal.m,.2)}`, display:"flex", justifyContent:"space-around", alignItems:"center", flexShrink:0 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: phoneH*0.055, height: phoneH*0.055, borderRadius:"20%", background: i===0?pal.p:a(pal.m,.3) }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Web wireframe ─────────────────────────────────────────────────────────
function WebWire({ p: pal, h, siteType }: { p: typeof PAL[string]; h: number; siteType: string }) {
  const isBlog = siteType === "Blog";
  const isPortfolio = siteType === "Portfolio";
  const isRestaurant = siteType === "Restaurant";
  const isShop = siteType.includes("commerce") || siteType.includes("Boutique");

  return (
    <div style={{ background: pal.bg, width:"100%", height:h, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Nav */}
      <div style={{ height: h*0.13, background: pal.p, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between", padding:`0 ${h*0.09}px` }}>
        <div style={{ width: h*0.22, height: h*0.055, background:a("#fff",.9), borderRadius:2 }} />
        <div style={{ display:"flex", gap: h*0.06 }}>
          {[.14,.14,.17].map((w,i) => <div key={i} style={{ width:h*w, height:h*0.04, background:a("#fff",.5), borderRadius:2 }} />)}
        </div>
        <div style={{ width:h*0.22, height:h*0.1, border:`1px solid ${a("#fff",.4)}`, borderRadius:h*0.06, background:a("#fff",.15) }} />
      </div>

      {/* Hero */}
      <div style={{ height: isShop ? h*0.17 : h*0.32, background:`linear-gradient(135deg,${pal.p},${pal.g})`, flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap: h*0.025 }}>
        <div style={{ width:"58%", height: h*0.065, background:a("#fff",.95), borderRadius:3 }} />
        <div style={{ width:"76%", height: h*0.04, background:a("#fff",.55), borderRadius:2 }} />
        {!isPortfolio && <div style={{ width:h*0.28, height:h*0.1, border:`1.5px solid ${a("#fff",.45)}`, borderRadius:h*0.06, background:a("#fff",.18) }} />}
      </div>

      {/* Content */}
      {isPortfolio ? (
        <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", gap: h*0.04, padding: h*0.05 }}>
          {[pal.p, pal.g, pal.m, pal.p].map((bg,i) => (
            <div key={i} style={{ background: bg, borderRadius: h*0.04, opacity: i%2===0?.65:.45 }} />
          ))}
        </div>
      ) : isRestaurant ? (
        <div style={{ flex:1, padding: `${h*0.04}px ${h*0.06}px`, display:"flex", flexDirection:"column", gap: h*0.04 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ display:"flex", gap: h*0.06, alignItems:"center" }}>
              <div style={{ width:h*0.17, height:h*0.17, background:pal.card, borderRadius:h*0.04, border:`1px solid ${a(pal.p,.3)}`, flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div style={{ height:h*0.04, background:pal.t, borderRadius:2, opacity:.8, marginBottom:h*0.02, width:"60%" }} />
                <div style={{ height:h*0.03, background:pal.m, borderRadius:2, opacity:.4 }} />
              </div>
              <div style={{ width:h*0.16, height:h*0.04, background:pal.p, borderRadius:2, opacity:.8 }} />
            </div>
          ))}
        </div>
      ) : isShop ? (
        <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:h*0.035, padding:`${h*0.04}px ${h*0.05}px` }}>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ background:pal.card, borderRadius:h*0.04, overflow:"hidden" }}>
              <div style={{ height:h*0.18, background:a(pal.p,.2+(i%3)*.12) }} />
              <div style={{ padding:h*0.03 }}>
                <div style={{ height:h*0.03, background:pal.t, borderRadius:2, opacity:.8, marginBottom:h*0.02 }} />
                <div style={{ height:h*0.035, background:pal.p, borderRadius:2, opacity:.85, width:"50%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : isBlog ? (
        <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", gap:h*0.04, padding:h*0.05 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background:pal.card, borderRadius:h*0.04, overflow:"hidden" }}>
              <div style={{ height:h*0.18, background:a(pal.p,.2+(i%2)*.15) }} />
              <div style={{ padding:h*0.04 }}>
                <div style={{ height:h*0.035, background:pal.t, borderRadius:2, opacity:.85, marginBottom:h*0.02 }} />
                <div style={{ height:h*0.03, background:pal.m, borderRadius:2, opacity:.4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Default: 3 feature cards
        <div style={{ flex:1, display:"flex", gap:h*0.04, padding:h*0.05 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ flex:1, background:pal.card, borderRadius:h*0.05, padding:h*0.05, display:"flex", flexDirection:"column", gap:h*0.03 }}>
              <div style={{ width:h*0.1, height:h*0.1, background:pal.p, borderRadius:h*0.03, opacity:.7 }} />
              <div style={{ height:h*0.04, background:pal.t, borderRadius:2, opacity:.85, width:"78%" }} />
              <div style={{ height:h*0.03, background:pal.m, borderRadius:2, opacity:.4 }} />
              <div style={{ height:h*0.03, background:pal.m, borderRadius:2, opacity:.3, width:"85%" }} />
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ height:h*0.1, background:pal.card, flexShrink:0, borderTop:`1px solid ${a(pal.m,.15)}` }} />
    </div>
  );
}

// ── Wireframe dispatcher ──────────────────────────────────────────────────
function Wireframe({ template, height }: { template: Template; height: number }) {
  const pal = PAL[template.colorPalette] ?? PAL.violet;
  if (template.framework === "expo") {
    return <PhoneWire p={pal} h={height} />;
  }
  return <WebWire p={pal} h={height} siteType={template.siteType} />;
}

// ── Public export ─────────────────────────────────────────────────────────
export function TemplatePreviewThumb({
  template,
  height = 108,
  showExpand = true,
}: {
  template: Template;
  height?: number;
  showExpand?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        style={{ height, overflow:"hidden", position:"relative", cursor: showExpand ? "pointer" : "default" }}
        className="group/thumb"
        onClick={() => showExpand && setOpen(true)}
      >
        <Wireframe template={template} height={height} />

        {showExpand && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity backdrop-blur-sm"
          >
            <Maximize2 className="w-3 h-3 text-white" />
          </button>
        )}
      </div>

      {/* Expanded overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col"
            style={{ width: template.framework === "expo" ? 320 : 720, maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#111827] border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{template.emoji}</span>
                <div>
                  <p className="font-semibold text-white text-sm">{template.name}</p>
                  <p className="text-xs text-white/50">{template.siteType} · {template.framework.toUpperCase()} · {template.style}</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X className="w-3.5 h-3.5 text-white" />
              </button>
            </div>

            {/* Large preview */}
            <div style={{ height: template.framework === "expo" ? 440 : 420, flexShrink: 0, overflow:"hidden" }}>
              <Wireframe template={template} height={template.framework === "expo" ? 440 : 420} />
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-[#111827] border-t border-white/10 flex-shrink-0">
              <p className="text-sm text-white/70 mb-2">{template.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {template.tags.map(tag => (
                  <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/60">#{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
