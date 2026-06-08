import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import type { Template } from "@/data/templates";

// ── Colour palettes ─────────────────────────────────────────────────────────
const PAL: Record<string, { p: string; g: string; bg: string; card: string; t: string; m: string }> = {
  violet:    { p:"#7c3aed", g:"#4f46e5", bg:"#0f0a1e", card:"#1e1535", t:"#e2e8f0", m:"#a78bfa" },
  monochrome:{ p:"#e5e7eb", g:"#6b7280", bg:"#030712", card:"#111827", t:"#f9fafb", m:"#9ca3af" },
  gold:      { p:"#d97706", g:"#a16207", bg:"#1a0f00", card:"#2d1800", t:"#fef3c7", m:"#fbbf24" },
  bleu:      { p:"#2563eb", g:"#1d4ed8", bg:"#f0f7ff", card:"#dbeafe", t:"#0f172a", m:"#60a5fa" },
  vert:      { p:"#059669", g:"#047857", bg:"#f0fdf4", card:"#d1fae5", t:"#14532d", m:"#34d399" },
  rose:      { p:"#db2777", g:"#9d174d", bg:"#fff1f2", card:"#ffe4e6", t:"#881337", m:"#f472b6" },
  beige:     { p:"#a16207", g:"#78350f", bg:"#fafaf9", card:"#fef3c7", t:"#1c1917", m:"#d97706" },
  orange:    { p:"#ea580c", g:"#dc2626", bg:"#1c0800", card:"#431407", t:"#fed7aa", m:"#fb923c" },
  indigo:    { p:"#4f46e5", g:"#7c3aed", bg:"#0f0720", card:"#1e1b4b", t:"#e0e7ff", m:"#818cf8" },
  terre:     { p:"#b45309", g:"#78350f", bg:"#fef9ee", card:"#fef3c7", t:"#292524", m:"#d97706" },
};

type C = typeof PAL[string];

function rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Tiny building blocks ────────────────────────────────────────────────────
function Pill({ w, h, color, opacity = 1, radius = 3, style = {} }: {
  w: number | string; h: number; color: string; opacity?: number; radius?: number; style?: React.CSSProperties;
}) {
  return <div style={{ width: typeof w === "number" ? w : w, height: h, background: color, borderRadius: radius, opacity, flexShrink: 0, ...style }} />;
}

function Row({ items, gap = 5, style = {} }: { items: React.ReactNode[]; gap?: number; style?: React.CSSProperties }) {
  return <div style={{ display:"flex", gap, alignItems:"center", ...style }}>{items}</div>;
}

// ── Nav bar (shared) ────────────────────────────────────────────────────────
function Nav({ c, large }: { c: C; large: boolean }) {
  const s = large ? 2 : 1;
  return (
    <div style={{ background: c.p, padding: `${5*s}px ${10*s}px`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
      <Pill w={36*s} h={7*s} color="#fff" opacity={.9} />
      <Row items={[18,18,22].map((w,i) => <Pill key={i} w={w*s} h={5*s} color="#fff" opacity={.55} />)} gap={6*s} />
      <div style={{ width:38*s, height:16*s, border:`1px solid ${rgba("#fff",.45)}`, borderRadius:8*s, background:rgba("#fff",.15) }} />
    </div>
  );
}

// ── Layout: Landing page ────────────────────────────────────────────────────
function LandingLayout({ c, large }: { c: C; large: boolean }) {
  const s = large ? 2.4 : 1;
  return (
    <div style={{ background:c.bg, display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <Nav c={c} large={large} />

      {/* Hero */}
      <div style={{ background:`linear-gradient(135deg,${c.p},${c.g})`, padding:`${18*s}px ${14*s}px`, textAlign:"center", flexShrink:0 }}>
        <div style={{ width:"62%", height:9*s, background:rgba("#fff",.95), borderRadius:5*s, margin:`0 auto ${7*s}px` }} />
        <div style={{ width:"78%", height:6*s, background:rgba("#fff",.6), borderRadius:3*s, margin:`0 auto ${5*s}px` }} />
        <div style={{ width:"50%", height:5*s, background:rgba("#fff",.45), borderRadius:3*s, margin:`0 auto ${12*s}px` }} />
        <Row items={[
          <div key="a" style={{ width:48*s, height:16*s, background:rgba("#fff",.95), borderRadius:8*s }} />,
          <div key="b" style={{ width:36*s, height:16*s, border:`1.5px solid ${rgba("#fff",.5)}`, borderRadius:8*s, background:rgba("#fff",.15) }} />,
        ]} gap={8*s} style={{ justifyContent:"center" }} />
      </div>

      {/* Features */}
      <div style={{ display:"flex", gap:6*s, padding:8*s, flex:1, alignItems:"stretch" }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ flex:1, background:c.card, borderRadius:7*s, padding:7*s, display:"flex", flexDirection:"column", gap:4*s }}>
            <div style={{ width:14*s, height:14*s, background:c.p, borderRadius:4*s, opacity:.7 }} />
            <Pill w="78%" h={5*s} color={c.t} opacity={.85} />
            <Pill w="100%" h={4*s} color={c.m} opacity={.4} />
            <Pill w="88%" h={4*s} color={c.m} opacity={.3} />
          </div>
        ))}
      </div>

      {/* CTA band */}
      <div style={{ background:`linear-gradient(90deg,${c.p},${c.g})`, height:26*s, display:"flex", alignItems:"center", justifyContent:"center", gap:10*s, flexShrink:0 }}>
        <Pill w={58*s} h={6*s} color="#fff" opacity={.85} />
        <div style={{ width:40*s, height:15*s, border:`1.5px solid ${rgba("#fff",.45)}`, borderRadius:8*s, background:rgba("#fff",.2) }} />
      </div>

      {/* Footer */}
      <div style={{ background:c.card, height:18*s, display:"flex", alignItems:"center", justifyContent:"center", gap:12*s, flexShrink:0, borderTop:`1px solid ${rgba(c.m,.15)}` }}>
        {[28,20,26,18].map((w,i) => <Pill key={i} w={w*s} h={4*s} color={c.m} opacity={.4} />)}
      </div>
    </div>
  );
}

// ── Layout: Portfolio ────────────────────────────────────────────────────────
function PortfolioLayout({ c, large }: { c: C; large: boolean }) {
  const s = large ? 2.4 : 1;
  return (
    <div style={{ background:c.bg, display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {/* Nav */}
      <div style={{ padding:`${5*s}px ${10*s}px`, display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${rgba(c.m,.2)}`, flexShrink:0 }}>
        <Pill w={46*s} h={8*s} color={c.t} opacity={.9} />
        <Row items={[20,20,20,30].map((w,i) => <Pill key={i} w={w*s} h={5*s} color={c.m} opacity={.5} />)} gap={6*s} />
      </div>

      {/* Name hero */}
      <div style={{ padding:`${16*s}px ${14*s}px ${10*s}px`, flexShrink:0 }}>
        <Pill w="52%" h={12*s} color={c.t} opacity={.9} style={{ marginBottom:6*s }} />
        <Pill w="68%" h={6*s} color={c.m} opacity={.5} />
      </div>

      {/* Mosaic */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5*s, padding:8*s, flex:1 }}>
        {([c.p, c.g, c.m, c.p] as string[]).map((bg,i) => (
          <div key={i} style={{ background:bg, opacity:i%2===0?.7:.5, borderRadius:6*s, position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", bottom:5*s, left:5*s, right:5*s }}>
              <Pill w="70%" h={5*s} color="#fff" opacity={.9} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Layout: Restaurant ────────────────────────────────────────────────────────
function RestaurantLayout({ c, large }: { c: C; large: boolean }) {
  const s = large ? 2.4 : 1;
  return (
    <div style={{ background:c.bg, display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {/* Hero */}
      <div style={{ background:`linear-gradient(180deg,${rgba(c.bg,1)} 0%,${c.p} 55%,${c.g} 100%)`, flex:"0 0 48%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:5*s }}>
        <Pill w={60*s} h={10*s} color={rgba("#fff",.95)} radius={5*s} />
        <Pill w={80*s} h={6*s} color={rgba("#fff",.6)} radius={3*s} />
        <div style={{ marginTop:4*s, width:50*s, height:16*s, border:`1.5px solid ${rgba("#fff",.5)}`, borderRadius:9*s, background:rgba("#fff",.15) }} />
      </div>

      {/* Menu items */}
      <div style={{ padding:8*s, display:"flex", flexDirection:"column", gap:5*s, flex:1 }}>
        {[0,1,2].map(i => (
          <Row key={i} items={[
            <div key="img" style={{ width:28*s, height:28*s, background:c.card, borderRadius:5*s, border:`1px solid ${rgba(c.p,.35)}`, flexShrink:0 }} />,
            <div key="txt" style={{ flex:1, display:"flex", flexDirection:"column", gap:3*s }}>
              <Pill w="62%" h={5*s} color={c.t} opacity={.85} />
              <Pill w="88%" h={4*s} color={c.m} opacity={.45} />
            </div>,
            <Pill key="price" w={26*s} h={6*s} color={c.p} radius={3*s} opacity={.85} />,
          ]} gap={8*s} />
        ))}
      </div>

      <div style={{ height:14*s, background:c.card, flexShrink:0 }} />
    </div>
  );
}

// ── Layout: E-commerce ────────────────────────────────────────────────────────
function EcommerceLayout({ c, large }: { c: C; large: boolean }) {
  const s = large ? 2.4 : 1;
  return (
    <div style={{ background:c.bg, display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <Nav c={c} large={large} />

      {/* Banner */}
      <div style={{ background:`linear-gradient(90deg,${c.p},${c.g})`, padding:`${10*s}px ${14*s}px`, flexShrink:0 }}>
        <Pill w="45%" h={7*s} color="#fff" opacity={.95} style={{ marginBottom:4*s }} />
        <Pill w="58%" h={5*s} color="#fff" opacity={.6} />
      </div>

      {/* Product grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5*s, padding:6*s, flex:1, alignContent:"start" }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{ background:c.card, borderRadius:6*s, overflow:"hidden" }}>
            <div style={{ height:28*s, background:rgba(c.p, .18+(i%3)*.12) }} />
            <div style={{ padding:4*s, display:"flex", flexDirection:"column", gap:3*s }}>
              <Pill w="90%" h={4*s} color={c.t} opacity={.8} />
              <Pill w="50%" h={5*s} color={c.p} opacity={.9} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Layout: Blog ─────────────────────────────────────────────────────────────
function BlogLayout({ c, large }: { c: C; large: boolean }) {
  const s = large ? 2.4 : 1;
  return (
    <div style={{ background:c.bg, display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {/* Nav */}
      <div style={{ padding:`${5*s}px ${10*s}px`, display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${rgba(c.m,.2)}`, flexShrink:0 }}>
        <Pill w={52*s} h={9*s} color={c.p} opacity={.9} />
        <Row items={[18,18,18].map((w,i) => <Pill key={i} w={w*s} h={5*s} color={c.m} opacity={.5} />)} gap={6*s} />
      </div>

      {/* Featured */}
      <div style={{ background:`linear-gradient(135deg,${c.p},${c.g})`, padding:`${14*s}px ${12*s}px`, flexShrink:0 }}>
        <div style={{ background:rgba("#fff",.18), borderRadius:4*s, padding:`2*s 7*s`, display:"inline-flex", marginBottom:6*s }}>
          <Pill w={30*s} h={5*s} color="#fff" opacity={.85} />
        </div>
        <Pill w="68%" h={9*s} color="#fff" opacity={.95} style={{ marginBottom:5*s }} />
        <Pill w="90%" h={5*s} color="#fff" opacity={.6} />
      </div>

      {/* Article grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6*s, padding:8*s, flex:1, alignContent:"start" }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ background:c.card, borderRadius:6*s, overflow:"hidden" }}>
            <div style={{ height:24*s, background:rgba(c.p, .2+(i%2)*.15) }} />
            <div style={{ padding:5*s, display:"flex", flexDirection:"column", gap:3*s }}>
              <Pill w="85%" h={5*s} color={c.t} opacity={.85} />
              <Pill w="100%" h={4*s} color={c.m} opacity={.4} />
              <Pill w="60%" h={4*s} color={c.m} opacity={.35} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Layout: Service / Vitrine ─────────────────────────────────────────────────
function ServiceLayout({ c, large }: { c: C; large: boolean }) {
  const s = large ? 2.4 : 1;
  return (
    <div style={{ background:c.bg, display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {/* Nav */}
      <div style={{ padding:`${5*s}px ${10*s}px`, display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${rgba(c.m,.15)}`, flexShrink:0 }}>
        <Pill w={38*s} h={7*s} color={c.p} opacity={.9} />
        <div style={{ width:38*s, height:15*s, background:c.p, borderRadius:8*s, opacity:.85 }} />
      </div>

      {/* Split hero */}
      <div style={{ display:"flex", flex:"0 0 44%", overflow:"hidden" }}>
        <div style={{ flex:1, background:`linear-gradient(135deg,${c.p},${c.g})`, padding:`${12*s}px`, display:"flex", flexDirection:"column", gap:5*s, justifyContent:"center" }}>
          <Pill w="78%" h={9*s} color="#fff" opacity={.95} />
          <Pill w="95%" h={5*s} color="#fff" opacity={.6} />
          <Pill w="95%" h={5*s} color="#fff" opacity={.5} />
          <div style={{ width:50*s, height:17*s, border:`1.5px solid ${rgba("#fff",.5)}`, borderRadius:9*s, background:rgba("#fff",.2), marginTop:4*s }} />
        </div>
        <div style={{ width:56*s, background:rgba(c.p,.15), display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ width:36*s, height:52*s, background:rgba(c.p,.35), borderRadius:9*s }} />
        </div>
      </div>

      {/* Service cards */}
      <div style={{ display:"flex", gap:6*s, padding:8*s, flex:1 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ flex:1, background:c.card, borderRadius:7*s, padding:6*s, display:"flex", flexDirection:"column", gap:3*s }}>
            <div style={{ width:18*s, height:18*s, borderRadius:"50%", background:rgba(c.p,.2), display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ width:8*s, height:8*s, borderRadius:"50%", background:c.p }} />
            </div>
            <Pill w="80%" h={5*s} color={c.t} opacity={.85} />
            <Pill w="100%" h={4*s} color={c.m} opacity={.4} />
          </div>
        ))}
      </div>

      <div style={{ height:14*s, background:c.card, flexShrink:0, borderTop:`1px solid ${rgba(c.m,.15)}` }} />
    </div>
  );
}

// ── Layout: Mobile (phone frame) ─────────────────────────────────────────────
function MobileLayout({ c, large }: { c: C; large: boolean }) {
  const phoneW = large ? 200 : 74;
  const phoneH = large ? 400 : 140;
  const br = large ? 30 : 13;
  const bw = large ? 6 : 3;
  const s = large ? 2.6 : 1;

  return (
    <div style={{ background:"#12101e", display:"flex", alignItems:"center", justifyContent:"center", height:"100%", padding: large ? 20 : 6 }}>
      <div style={{ width:phoneW, height:phoneH, background:c.bg, borderRadius:br, border:`${bw}px solid #555`, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"0 8px 32px rgba(0,0,0,0.7)" }}>
        {/* Status bar */}
        <div style={{ height:8*s, background:c.p, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"flex-end", paddingRight:6*s }}>
          <Row items={[0,1,2].map(i => <div key={i} style={{ width:3*s, height:3*s, borderRadius:"50%", background:rgba("#fff",.7) }} />)} gap={2*s} />
        </div>
        {/* Screen */}
        <div style={{ flex:1, padding:`${5*s}px ${4*s}px`, display:"flex", flexDirection:"column", gap:4*s, overflow:"hidden" }}>
          <Pill w="60%" h={6*s} color={c.t} opacity={.9} />
          {[0,1,2,3].map(i => (
            <Row key={i} items={[
              <div key="ic" style={{ width:16*s, height:16*s, borderRadius:4*s, background:rgba(c.p,.28+(i%2)*.2), flexShrink:0 }} />,
              <div key="tx" style={{ flex:1, display:"flex", flexDirection:"column", gap:2*s }}>
                <Pill w="80%" h={4*s} color={c.t} opacity={.8} />
                <Pill w="58%" h={3*s} color={c.m} opacity={.5} />
              </div>,
            ]} gap={4*s} />
          ))}
          {/* CTA */}
          <div style={{ marginTop:"auto", background:`linear-gradient(90deg,${c.p},${c.g})`, borderRadius:6*s, height:14*s, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Pill w="45%" h={5*s} color="#fff" opacity={.95} />
          </div>
        </div>
        {/* Tab bar */}
        <div style={{ height:16*s, background:c.card, borderTop:`1px solid ${rgba(c.m,.25)}`, display:"flex", justifyContent:"space-around", alignItems:"center", flexShrink:0, padding:`0 ${4*s}px` }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1*s }}>
              <div style={{ width:8*s, height:8*s, borderRadius:2*s, background:i===0?c.p:rgba(c.m,.45) }} />
              {large && <Pill w={20*s} h={4*s} color={i===0?c.p:c.m} opacity={i===0?1:.4} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Dispatcher ───────────────────────────────────────────────────────────────
function WireframeFor({ template, large }: { template: Template; large: boolean }) {
  const c = PAL[template.colorPalette] ?? PAL.violet;
  const { siteType, framework } = template;

  if (framework === "expo") return <MobileLayout c={c} large={large} />;
  if (siteType === "Portfolio")          return <PortfolioLayout  c={c} large={large} />;
  if (siteType === "Restaurant")         return <RestaurantLayout c={c} large={large} />;
  if (siteType === "Blog")               return <BlogLayout       c={c} large={large} />;
  if (siteType.toLowerCase().includes("e-commerce") || siteType === "Boutique")
                                         return <EcommerceLayout  c={c} large={large} />;
  if (["Site vitrine","Artisan","Agence","Artisan"].includes(siteType))
                                         return <ServiceLayout    c={c} large={large} />;
  return <LandingLayout c={c} large={large} />;
}

// ── Public component ─────────────────────────────────────────────────────────
export function TemplatePreviewThumb({ template }: { template: Template }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Thumbnail */}
      <div
        className="relative overflow-hidden rounded-t-xl cursor-pointer group/thumb"
        style={{ height: 108 }}
        onClick={() => setOpen(true)}
      >
        <WireframeFor template={template} large={false} />

        {/* hover expand button */}
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 hover:bg-black/75 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity backdrop-blur-sm"
        >
          <Maximize2 className="w-3 h-3 text-white" />
        </button>
        {/* Subtle hover overlay */}
        <div className="absolute inset-0 bg-primary/0 group-hover/thumb:bg-primary/5 transition-colors pointer-events-none" />
      </div>

      {/* Expanded overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-md"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative rounded-2xl overflow-hidden shadow-2xl border border-white/10"
            style={{ width: template.framework === "expo" ? 340 : 740, maxHeight: "90vh", display:"flex", flexDirection:"column" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#1a1a2e] border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{template.emoji}</span>
                <div>
                  <p className="font-semibold text-white text-sm">{template.name}</p>
                  <p className="text-xs text-white/50">{template.siteType} · {template.framework.toUpperCase()}</p>
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
            <div
              className="overflow-y-auto"
              style={{ height: template.framework === "expo" ? 460 : 440, flexShrink: 0 }}
            >
              <div style={{ height: template.framework === "expo" ? 460 : 440 }}>
                <WireframeFor template={template} large={true} />
              </div>
            </div>

            {/* Footer info */}
            <div className="px-4 py-3 bg-[#1a1a2e] border-t border-white/10 flex-shrink-0">
              <p className="text-sm text-white/70 mb-2">{template.description}</p>
              <div className="flex flex-wrap gap-1">
                {template.tags.map((tag) => (
                  <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/60">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
