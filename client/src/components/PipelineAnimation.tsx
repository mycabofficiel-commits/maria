import { useEffect, useRef } from "react";

/* ── Couleurs ── */
const NODES_DATA = [
  { col: "#c084fc", base: "#7e22ce" }, // top    – violet
  { col: "#818cf8", base: "#3730a3" }, // right  – indigo
  { col: "#22d3ee", base: "#0e7490" }, // bottom – cyan
  { col: "#34d399", base: "#065f46" }, // left   – emerald
];

function hexAlpha(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

export default function PipelineAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2 - 5;
    const R = Math.min(W, H) * 0.31;

    const NODES = [
      { x: cx,     y: cy - R, ...NODES_DATA[0] },
      { x: cx + R, y: cy,     ...NODES_DATA[1] },
      { x: cx,     y: cy + R, ...NODES_DATA[2] },
      { x: cx - R, y: cy,     ...NODES_DATA[3] },
    ];

    const CONN: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];
    const SPAWN_EVERY = 90;

    interface Trail { x: number; y: number; }
    interface Particle {
      fi: number; ti: number;
      fx: number; fy: number;
      tx: number; ty: number;
      t: number; spd: number; r: number;
      col: string; trail: Trail[];
    }

    let particles: Particle[] = [];
    let nodeEnergy = [0, 0, 0, 0];
    let frame = 0;
    let rafId = 0;

    function spawnParticle(fi: number, ti: number, tOffset: number): Particle {
      return {
        fi, ti,
        fx: NODES[fi].x, fy: NODES[fi].y,
        tx: NODES[ti].x, ty: NODES[ti].y,
        t: tOffset, spd: 0.006 + Math.random() * 0.004,
        r: 2.5 + Math.random() * 1.5,
        col: NODES[fi].col, trail: [],
      };
    }

    function drawConnections() {
      CONN.forEach(([fi, ti]) => {
        const f = NODES[fi], t = NODES[ti];
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = "rgba(100,80,200,0.12)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    function drawIcon(id: number, x: number, y: number, col: string, e: number) {
      const s = 12 + e * 3;
      const alpha = 0.45 + e * 0.55;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = hexAlpha(col, alpha);
      ctx.fillStyle = hexAlpha(col, alpha);
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (id === 0) {
        /* Raisonneur – ondes concentriques */
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(0, 0, i * s / 3, -Math.PI * 0.65, Math.PI * 0.65);
          ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
      } else if (id === 1) {
        /* Agent – réseau triangulaire */
        const pts = [
          { x: 0,          y: -s * 0.78 },
          { x:  s * 0.7,   y:  s * 0.45 },
          { x: -s * 0.7,   y:  s * 0.45 },
        ];
        pts.forEach((a, i) => {
          const b = pts[(i + 1) % 3];
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
        pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); });
      } else if (id === 2) {
        /* Actionneur – crochets </> */
        const q = s * 0.68;
        ctx.beginPath(); ctx.moveTo(-q * 0.3, -q * 0.55); ctx.lineTo(-q * 0.75, 0); ctx.lineTo(-q * 0.3, q * 0.55); ctx.stroke();
        ctx.beginPath(); ctx.moveTo( q * 0.3, -q * 0.55); ctx.lineTo( q * 0.75, 0); ctx.lineTo( q * 0.3, q * 0.55); ctx.stroke();
        ctx.beginPath(); ctx.moveTo( q * 0.22, -q * 0.6); ctx.lineTo(-q * 0.22,  q * 0.6); ctx.stroke();
      } else {
        /* Vérificateur – bouclier + coche */
        const q = s * 0.76;
        ctx.beginPath();
        ctx.moveTo(0, -q);
        ctx.lineTo(q * 0.72, -q * 0.45);
        ctx.lineTo(q * 0.72,  q * 0.18);
        ctx.quadraticCurveTo(q * 0.72,  q * 0.72, 0, q);
        ctx.quadraticCurveTo(-q * 0.72, q * 0.72, -q * 0.72, q * 0.18);
        ctx.lineTo(-q * 0.72, -q * 0.45);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-q * 0.28, q * 0.02); ctx.lineTo(-q * 0.04, q * 0.32); ctx.lineTo(q * 0.36, -q * 0.22); ctx.stroke();
      }
      ctx.restore();
    }

    function drawNode(n: typeof NODES[0], i: number) {
      const energy = nodeEnergy[i];
      const nr = 30 + energy * 5;

      /* halo extérieur */
      if (energy > 0.05) {
        const g = ctx.createRadialGradient(n.x, n.y, nr * 0.6, n.x, n.y, nr * 3);
        g.addColorStop(0, hexAlpha(n.col, energy * 0.3));
        g.addColorStop(1, hexAlpha(n.col, 0));
        ctx.beginPath(); ctx.arc(n.x, n.y, nr * 3, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
      }

      /* disque fond */
      const bg = ctx.createRadialGradient(n.x - nr * 0.3, n.y - nr * 0.3, nr * 0.05, n.x, n.y, nr);
      bg.addColorStop(0, energy > 0.3 ? hexAlpha(n.col, 0.22) : "#16162a");
      bg.addColorStop(1, "#0c0c1e");
      ctx.beginPath(); ctx.arc(n.x, n.y, nr, 0, Math.PI * 2);
      ctx.fillStyle = bg; ctx.fill();

      /* bordure */
      ctx.beginPath(); ctx.arc(n.x, n.y, nr, 0, Math.PI * 2);
      ctx.strokeStyle = hexAlpha(n.col, 0.25 + energy * 0.75);
      ctx.lineWidth = 1.5 + energy * 1.5;
      ctx.stroke();

      /* anneau animé */
      ctx.beginPath(); ctx.arc(n.x, n.y, nr + 7 + energy * 5, 0, Math.PI * 2);
      ctx.strokeStyle = hexAlpha(n.col, energy * 0.28);
      ctx.lineWidth = 1;
      ctx.stroke();

      drawIcon(i, n.x, n.y, n.col, energy);
    }

    function drawParticle(p: Particle) {
      if (p.trail.length < 2) return;
      for (let i = 0; i < p.trail.length; i++) {
        const pct = i / (p.trail.length - 1);
        ctx.beginPath();
        ctx.arc(p.trail[i].x, p.trail[i].y, Math.max(pct * p.r, 0.3), 0, Math.PI * 2);
        ctx.fillStyle = hexAlpha(p.col, pct * 0.92);
        ctx.fill();
      }
    }

    function tick() {
      ctx.clearRect(0, 0, W, H);

      /* orbe central */
      const gc = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
      gc.addColorStop(0, "rgba(120,80,220,0.06)");
      gc.addColorStop(1, "rgba(120,80,220,0)");
      ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2);
      ctx.fillStyle = gc; ctx.fill();

      /* spawn */
      const slot = Math.floor(frame / SPAWN_EVERY) % CONN.length;
      if (frame % SPAWN_EVERY === 0) {
        for (let k = 0; k < 3; k++) {
          const p = spawnParticle(CONN[slot][0], CONN[slot][1], k * 0.12);
          particles.push(p);
        }
        nodeEnergy[CONN[slot][0]] = Math.max(nodeEnergy[CONN[slot][0]], 1);
      }

      /* énergie */
      nodeEnergy = nodeEnergy.map((e, i) => {
        const arriving = particles.some((p) => p.ti === i && p.t > 0.85);
        if (arriving) return Math.min(1, e + 0.04);
        return Math.max(0, e - 0.018);
      });

      /* update particles */
      const alive: Particle[] = [];
      for (const p of particles) {
        p.t += p.spd;
        const et = easeInOut(Math.min(p.t, 1));
        p.trail.push({ x: p.fx + (p.tx - p.fx) * et, y: p.fy + (p.ty - p.fy) * et });
        if (p.trail.length > 18) p.trail.shift();
        if (p.t < 1) alive.push(p);
      }
      particles = alive;

      drawConnections();
      particles.forEach(drawParticle);
      NODES.forEach((n, i) => drawNode(n, i));

      frame++;
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={420}
      height={380}
      className="w-full max-w-[420px] mx-auto"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
