import { useEffect, useRef } from "react";

const COLS = ["#818cf8", "#a78bfa", "#67e8f9", "#c084fc", "#6ee7b7", "#f472b6"];

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export default function BrainAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    /* ── Brain shape ── */
    const LX = W * 0.365, LY = H * 0.50, LRX = W * 0.30, LRY = H * 0.42;
    const RX = W * 0.635, RY = H * 0.50, RRX = W * 0.30, RRY = H * 0.42;

    function inBrain(x: number, y: number) {
      const l = ((x - LX) / LRX) ** 2 + ((y - LY) / LRY) ** 2;
      const r = ((x - RX) / RRX) ** 2 + ((y - RY) / RRY) ** 2;
      return l <= 0.90 || r <= 0.90;
    }

    /* ── Neurons ── */
    interface Neuron { x: number; y: number; energy: number; ref: number; }
    const neurons: Neuron[] = [];
    let att = 0;
    while (neurons.length < 72 && att < 4000) {
      att++;
      const x = 18 + Math.random() * (W - 36);
      const y = 18 + Math.random() * (H - 36);
      if (!inBrain(x, y)) continue;
      if (neurons.some(n => Math.hypot(n.x - x, n.y - y) < 20)) continue;
      neurons.push({ x, y, energy: 0, ref: 0 });
    }

    /* ── Synapses ── */
    interface Synapse { a: number; b: number; }
    const synapses: Synapse[] = [];
    const adj: number[][] = neurons.map(() => []);
    for (let i = 0; i < neurons.length; i++) {
      const cands: { j: number; d: number }[] = [];
      for (let j = i + 1; j < neurons.length; j++) {
        const d = Math.hypot(neurons[i].x - neurons[j].x, neurons[i].y - neurons[j].y);
        if (d < 90) cands.push({ j, d });
      }
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands.slice(0, 5)) {
        synapses.push({ a: i, b: c.j });
        adj[i].push(c.j);
        adj[c.j].push(i);
      }
    }

    /* ── Signals ── */
    interface Signal { from: number; to: number; t: number; spd: number; col: string; sz: number; a: number; }
    let signals: Signal[] = [];

    function spawnSignal(from: number, to: number) {
      signals.push({
        from, to, t: 0,
        spd: 0.016 + Math.random() * 0.024,
        col: COLS[Math.floor(Math.random() * COLS.length)],
        sz:  1.6 + Math.random() * 1.6,
        a:   0.72 + Math.random() * 0.28,
      });
    }

    function fire(idx: number) {
      const n = neurons[idx];
      if (n.ref > 0) return;
      n.energy = 1; n.ref = 26;
      for (const j of adj[idx]) spawnSignal(idx, j);
    }

    /* ── Brain outline ── */
    function drawBrain() {
      // fills
      const fillL = ctx.createRadialGradient(LX, LY, 0, LX, LY, LRX);
      fillL.addColorStop(0, "rgba(99,102,241,0.05)");
      fillL.addColorStop(1, "rgba(60,50,130,0.01)");
      ctx.beginPath(); ctx.ellipse(LX, LY, LRX, LRY, 0, 0, Math.PI * 2);
      ctx.fillStyle = fillL; ctx.fill();

      const fillR = ctx.createRadialGradient(RX, RY, 0, RX, RY, RRX);
      fillR.addColorStop(0, "rgba(139,92,246,0.05)");
      fillR.addColorStop(1, "rgba(60,50,130,0.01)");
      ctx.beginPath(); ctx.ellipse(RX, RY, RRX, RRY, 0, 0, Math.PI * 2);
      ctx.fillStyle = fillR; ctx.fill();

      // outlines
      ctx.strokeStyle = "rgba(129,140,248,0.18)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(LX, LY, LRX, LRY, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(RX, RY, RRX, RRY, 0, 0, Math.PI * 2); ctx.stroke();

      // fissure
      ctx.beginPath();
      ctx.moveTo(W / 2, H * 0.08);
      ctx.bezierCurveTo(W / 2 - 5, H * 0.35, W / 2 + 5, H * 0.62, W / 2, H * 0.90);
      ctx.strokeStyle = "rgba(129,140,248,0.09)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      // gyri
      const gyri: [number, number][][] = [
        [[LX - LRX * 0.55, LY - LRY * 0.62], [LX - LRX * 0.18, LY - LRY * 0.72], [LX + LRX * 0.06, LY - LRY * 0.56]],
        [[LX - LRX * 0.72, LY - LRY * 0.08], [LX - LRX * 0.38, LY - LRY * 0.20], [LX - LRX * 0.08, LY - LRY * 0.16]],
        [[LX - LRX * 0.70, LY + LRY * 0.28], [LX - LRX * 0.36, LY + LRY * 0.24], [LX - LRX * 0.06, LY + LRY * 0.20]],
        [[RX + RRX * 0.55, RY - RRY * 0.62], [RX + RRX * 0.18, RY - RRY * 0.72], [RX - RRX * 0.06, RY - RRY * 0.56]],
        [[RX + RRX * 0.72, RY - RRY * 0.08], [RX + RRX * 0.38, RY - RRY * 0.20], [RX + RRX * 0.08, RY - RRY * 0.16]],
        [[RX + RRX * 0.70, RY + RRY * 0.28], [RX + RRX * 0.36, RY + RRY * 0.24], [RX + RRX * 0.06, RY + RRY * 0.20]],
      ];
      ctx.strokeStyle = "rgba(129,140,248,0.065)";
      ctx.lineWidth = 0.9;
      for (const pts of gyri) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
        ctx.stroke();
      }
    }

    let frame = 0;
    let rafId = 0;

    function tick() {
      ctx.clearRect(0, 0, W, H);
      drawBrain();

      // synapses
      for (const s of synapses) {
        const a = neurons[s.a], b = neurons[s.b];
        const act = (a.energy + b.energy) * 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(99,102,241,${0.04 + act * 0.11})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // spontaneous firing
      if (frame % 15 === 0 && Math.random() < 0.52) {
        fire(Math.floor(Math.random() * neurons.length));
      }

      // signals
      const alive: Signal[] = [];
      for (const s of signals) {
        s.t += s.spd;
        if (s.t >= 1) {
          if (neurons[s.to].ref === 0 && Math.random() < 0.40) fire(s.to);
          continue;
        }
        const [r, g, b] = hexRgb(s.col);
        const nx = neurons[s.from].x + (neurons[s.to].x - neurons[s.from].x) * s.t;
        const ny = neurons[s.from].y + (neurons[s.to].y - neurons[s.from].y) * s.t;

        const gr = ctx.createRadialGradient(nx, ny, 0, nx, ny, s.sz * 4);
        gr.addColorStop(0, `rgba(${r},${g},${b},${s.a * 0.5})`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath(); ctx.arc(nx, ny, s.sz * 4, 0, Math.PI * 2);
        ctx.fillStyle = gr; ctx.fill();

        ctx.beginPath(); ctx.arc(nx, ny, s.sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${s.a})`;
        ctx.fill();

        alive.push(s);
      }
      signals = alive.length > 200 ? alive.slice(-200) : alive;

      // neurons
      for (const n of neurons) {
        n.energy = Math.max(0, n.energy - 0.030);
        if (n.ref > 0) n.ref--;
        const nr = 2.0 + n.energy * 2.2;
        if (n.energy > 0.08) {
          const hue = n.energy > 0.65 ? "192,132,252" : "129,140,248";
          const hg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, nr * 4.5);
          hg.addColorStop(0, `rgba(${hue},${n.energy * 0.52})`);
          hg.addColorStop(1, `rgba(${hue},0)`);
          ctx.beginPath(); ctx.arc(n.x, n.y, nr * 4.5, 0, Math.PI * 2);
          ctx.fillStyle = hg; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, nr, 0, Math.PI * 2);
        ctx.fillStyle = n.energy > 0.55
          ? `rgba(192,132,252,${0.5 + n.energy * 0.5})`
          : `rgba(129,140,248,${0.20 + n.energy * 0.80})`;
        ctx.fill();
      }

      frame++;
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={252}
      className="mx-auto"
      style={{ width: 300, height: 252 }}
    />
  );
}
