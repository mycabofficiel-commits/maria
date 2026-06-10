import { useEffect, useRef } from "react";

export default function BrainAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    // ── Palette 100 % bleu électrique ──────────────────────────────────────
    const PAL = [
      { r: 40,  g: 160, b: 255 },   // bleu électrique
      { r:  0,  g: 200, b: 255 },   // cyan électrique
      { r: 70,  g: 185, b: 255 },   // bleu moyen
    ];

    // ── Forme cerveau ───────────────────────────────────────────────────────
    const LX = W * 0.365, LY = H * 0.50, LRX = W * 0.30, LRY = H * 0.42;
    const RX = W * 0.635, RY = H * 0.50, RRX = W * 0.30, RRY = H * 0.42;

    function inBrain(x: number, y: number) {
      return ((x - LX) / LRX) ** 2 + ((y - LY) / LRY) ** 2 <= 0.88
          || ((x - RX) / RRX) ** 2 + ((y - RY) / RRY) ** 2 <= 0.88;
    }

    // ── Neurones ────────────────────────────────────────────────────────────
    interface Neuron { x: number; y: number; energy: number; col: { r: number; g: number; b: number }; }
    const neurons: Neuron[] = [];
    let att = 0;
    while (neurons.length < 64 && att < 6000) {
      att++;
      const x = 16 + Math.random() * (W - 32);
      const y = 16 + Math.random() * (H - 32);
      if (!inBrain(x, y)) continue;
      if (neurons.some(n => Math.hypot(n.x - x, n.y - y) < 23)) continue;
      neurons.push({ x, y, energy: 0, col: PAL[Math.floor(Math.random() * PAL.length)] });
    }

    // ── Synapses — max 3 connexions par neurone ─────────────────────────────
    interface Synapse { a: number; b: number; }
    const synapses: Synapse[] = [];
    const adj: number[][] = neurons.map(() => []);
    for (let i = 0; i < neurons.length; i++) {
      const cands: { j: number; d: number }[] = [];
      for (let j = i + 1; j < neurons.length; j++) {
        const d = Math.hypot(neurons[i].x - neurons[j].x, neurons[i].y - neurons[j].y);
        if (d < 80) cands.push({ j, d });
      }
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands.slice(0, 3)) {
        synapses.push({ a: i, b: c.j });
        adj[i].push(c.j);
        adj[c.j].push(i);
      }
    }

    // ── Signaux — SANS propagation en cascade ──────────────────────────────
    // Principe : on spawn régulièrement depuis un neurone aléatoire.
    // Quand le signal arrive, la cible s'illumine mais ne re-propage PAS.
    // Résultat : flux continu et distribué, jamais d'explosion locale.
    interface Signal { from: number; to: number; t: number; spd: number; col: { r: number; g: number; b: number }; sz: number; }
    let signals: Signal[] = [];

    function spawnWave(srcIdx: number) {
      neurons[srcIdx].energy = Math.min(1, neurons[srcIdx].energy + 0.60);
      for (const j of adj[srcIdx]) {
        signals.push({
          from: srcIdx, to: j,
          t: 0,
          spd: 0.009 + Math.random() * 0.008,
          col: neurons[srcIdx].col,
          sz: 1.3 + Math.random() * 0.8,
        });
      }
    }

    // ── Dessin cerveau ──────────────────────────────────────────────────────
    function drawBrain() {
      [
        { cx: LX, cy: LY, rx: LRX, ry: LRY },
        { cx: RX, cy: RY, rx: RRX, ry: RRY },
      ].forEach(h => {
        const fg = ctx.createRadialGradient(h.cx, h.cy, 0, h.cx, h.cy, h.rx);
        fg.addColorStop(0, "rgba(10,60,160,0.07)");
        fg.addColorStop(1, "rgba(5,20,80,0.01)");
        ctx.beginPath();
        ctx.ellipse(h.cx, h.cy, h.rx, h.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = fg;
        ctx.fill();
        ctx.strokeStyle = "rgba(30,120,255,0.22)";
        ctx.lineWidth = 1.0;
        ctx.stroke();
      });

      // Fissure inter-hémisphérique
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W / 2, H * 0.10);
      ctx.bezierCurveTo(W / 2 - 4, H * 0.35, W / 2 + 4, H * 0.62, W / 2, H * 0.90);
      ctx.strokeStyle = "rgba(30,120,255,0.10)";
      ctx.lineWidth = 0.7;
      ctx.setLineDash([3, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Gyri
      const gyri: [number, number][][] = [
        [[LX - LRX * .55, LY - LRY * .62], [LX - LRX * .18, LY - LRY * .73], [LX + LRX * .06, LY - LRY * .56]],
        [[LX - LRX * .72, LY - LRY * .08], [LX - LRX * .36, LY - LRY * .20], [LX - LRX * .06, LY - LRY * .15]],
        [[LX - LRX * .70, LY + LRY * .28], [LX - LRX * .34, LY + LRY * .24], [LX - LRX * .04, LY + LRY * .20]],
        [[RX + RRX * .55, RY - RRY * .62], [RX + RRX * .18, RY - RRY * .73], [RX - RRX * .06, RY - RRY * .56]],
        [[RX + RRX * .72, RY - RRY * .08], [RX + RRX * .36, RY - RRY * .20], [RX + RRX * .06, RY - RRY * .15]],
        [[RX + RRX * .70, RY + RRY * .28], [RX + RRX * .36, RY + RRY * .24], [RX + RRX * .06, RY + RRY * .20]],
      ];
      ctx.strokeStyle = "rgba(30,120,255,0.07)";
      ctx.lineWidth = 0.7;
      gyri.forEach(pts => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
        ctx.stroke();
      });
    }

    // ── Boucle principale ───────────────────────────────────────────────────
    let frame = 0;
    let rafId = 0;

    function tick() {
      ctx.clearRect(0, 0, W, H);

      drawBrain();

      // Synapses de base
      for (const s of synapses) {
        const a = neurons[s.a], b = neurons[s.b];
        const act = (a.energy + b.energy) * 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(20,100,235,${0.07 + act * 0.16})`;
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }

      // Spawn : alternance hémisphère gauche / droit toutes les 22 frames
      if (frame % 22 === 0) {
        const pool = neurons.filter(n => n.x < W / 2);
        if (pool.length) spawnWave(neurons.indexOf(pool[Math.floor(Math.random() * pool.length)]));
      }
      if (frame % 22 === 11) {
        const pool = neurons.filter(n => n.x >= W / 2);
        if (pool.length) spawnWave(neurons.indexOf(pool[Math.floor(Math.random() * pool.length)]));
      }

      // Signaux
      const alive: Signal[] = [];
      for (const s of signals) {
        s.t += s.spd;
        if (s.t >= 1) {
          // Arrive → illumine la cible, pas de re-propagation
          neurons[s.to].energy = Math.min(1, neurons[s.to].energy + 0.40);
          continue;
        }

        const { r, g, b } = s.col;
        const nx = neurons[s.from].x + (neurons[s.to].x - neurons[s.from].x) * s.t;
        const ny = neurons[s.from].y + (neurons[s.to].y - neurons[s.from].y) * s.t;

        // Traîne courte
        const t0 = Math.max(0, s.t - 0.13);
        const tx = neurons[s.from].x + (neurons[s.to].x - neurons[s.from].x) * t0;
        const ty = neurons[s.from].y + (neurons[s.to].y - neurons[s.from].y) * t0;
        const tr = ctx.createLinearGradient(tx, ty, nx, ny);
        tr.addColorStop(0, `rgba(${r},${g},${b},0)`);
        tr.addColorStop(1, `rgba(${r},${g},${b},0.45)`);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = tr;
        ctx.lineWidth = 0.9;
        ctx.stroke();

        // Halo doux
        const hl = ctx.createRadialGradient(nx, ny, 0, nx, ny, s.sz * 3.0);
        hl.addColorStop(0, `rgba(${r},${g},${b},0.20)`);
        hl.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(nx, ny, s.sz * 3.0, 0, Math.PI * 2);
        ctx.fillStyle = hl;
        ctx.fill();

        // Point signal
        ctx.beginPath();
        ctx.arc(nx, ny, s.sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.88)`;
        ctx.fill();
        // Cœur blanc-ice
        ctx.beginPath();
        ctx.arc(nx, ny, s.sz * 0.40, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(215,242,255,0.92)";
        ctx.fill();

        alive.push(s);
      }
      signals = alive.length > 120 ? alive.slice(-120) : alive;

      // Neurones
      for (const n of neurons) {
        n.energy = Math.max(0, n.energy - 0.020);
        const { r, g, b } = n.col;
        const nr = 1.7 + n.energy * 2.0;

        // Halo si actif
        if (n.energy > 0.10) {
          const hg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, nr * 4.5);
          hg.addColorStop(0, `rgba(${r},${g},${b},${n.energy * 0.28})`);
          hg.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(n.x, n.y, nr * 4.5, 0, Math.PI * 2);
          ctx.fillStyle = hg;
          ctx.fill();
        }

        // Corps
        const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, nr);
        if (n.energy > 0.5) {
          ng.addColorStop(0, `rgba(210,238,255,${0.60 + n.energy * 0.30})`);
          ng.addColorStop(1, `rgba(${r},${g},${b},0.03)`);
        } else {
          ng.addColorStop(0, `rgba(${r},${g},${b},${0.22 + n.energy * 0.46})`);
          ng.addColorStop(1, `rgba(${r},${g},${b},0.02)`);
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, nr, 0, Math.PI * 2);
        ctx.fillStyle = ng;
        ctx.fill();

        // Bord fin
        ctx.beginPath();
        ctx.arc(n.x, n.y, nr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.16 + n.energy * 0.45})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
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
