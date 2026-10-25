import * as THREE from "three";

/**
 * Procedural canvas textures for the intro scene. Everything is drawn locally with system fonts, so the
 * intro needs no network (no font CDN, no HDRI) and works on venue Wi-Fi.
 */

export const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace";
export const SANS = "Inter, 'Segoe UI', system-ui, sans-serif";

/** Small deterministic PRNG so shards, cracks and the graph look the same on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** The proposal as voters see it, etched on the monolith's face. */
export function labelTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 2048, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(155, 231, 255, 0.95)";
    ctx.font = `600 64px ${MONO}`;
    ctx.fillText("MIP-21", 96, 220);
    ctx.fillStyle = "rgba(225, 245, 255, 0.92)";
    ctx.font = `700 92px ${SANS}`;
    ctx.fillText("VaultV2", 96, 340);
    ctx.font = `400 46px ${SANS}`;
    ctx.fillStyle = "rgba(200, 230, 245, 0.8)";
    ctx.fillText("storage packing &", 96, 420);
    ctx.fillText("gas optimisation", 96, 476);

    ctx.strokeStyle = "rgba(155, 231, 255, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(96, 560);
    ctx.lineTo(w - 96, 560);
    ctx.stroke();

    ctx.font = `500 40px ${MONO}`;
    const promises = ["no change to ownership", "storage layout preserved", "~1% cheaper deposits"];
    promises.forEach((p, i) => {
      const y = 660 + i * 84;
      ctx.fillStyle = "rgba(110, 231, 183, 0.95)";
      ctx.fillText("✓", 96, y);
      ctx.fillStyle = "rgba(220, 240, 250, 0.85)";
      ctx.fillText(p, 156, y);
    });

    ctx.font = `400 30px ${MONO}`;
    ctx.fillStyle = "rgba(155, 231, 255, 0.45)";
    ctx.fillText("PROPOSED BY kestrel.eth", 96, h - 260);
    ctx.fillText("VOTE: 70.6M FOR · 15.5M AGAINST", 96, h - 210);
  });
}

/** What the calldata actually does: revealed inside the glass when it cracks. */
export function coreTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 2048, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.shadowColor = "rgba(255, 45, 85, 0.9)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#ff3b5f";
    ctx.font = `700 40px ${MONO}`;
    ctx.fillText("// what executes", 80, 220);
    const lines = [
      "upgradeToAndCall(",
      "  VaultV2,",
      "  reinitializeV2(",
      "    0xdF3e…7097",
      "  )",
      ")",
      "",
      "treasury.approve(",
      "  USDC,",
      "  0xdF3e…7097,",
      "  type(uint256).max",
      ")",
      "",
      "owner  → 0xdF3e…7097",
      "added  → migrateReserves()",
    ];
    ctx.font = `600 50px ${MONO}`;
    lines.forEach((l, i) => ctx.fillText(l, 80, 330 + i * 92));
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 59, 95, 0.35)";
    ctx.fillRect(80, h - 220, w - 160, 4);
  });
}

/** Jagged crack lines that spread over the monolith before it shatters. */
export function crackTexture(seed = 7): THREE.CanvasTexture {
  const rand = rng(seed);
  return canvasTexture(1024, 2048, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(235, 250, 255, 0.95)";
    ctx.shadowColor = "rgba(155, 231, 255, 1)";
    ctx.shadowBlur = 18;
    ctx.lineCap = "round";
    const origin = { x: w * 0.55, y: h * 0.42 };
    for (let i = 0; i < 22; i++) {
      let x = origin.x;
      let y = origin.y;
      const angle = (i / 22) * Math.PI * 2 + rand() * 0.4;
      ctx.lineWidth = 2 + rand() * 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 6 + Math.floor(rand() * 8);
      for (let s = 0; s < steps; s++) {
        const len = 40 + rand() * 120;
        const a = angle + (rand() - 0.5) * 1.1;
        x += Math.cos(a) * len;
        y += Math.sin(a) * len * 1.6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

/** The HALTED seal stamped at the end. */
export function sealTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    ctx.shadowColor = "rgba(255, 45, 85, 1)";
    ctx.shadowBlur = 30;
    ctx.strokeStyle = "#ff2d55";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, 440, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, 360, 0, Math.PI * 2);
    ctx.stroke();

    // Text around the ring
    const ring = " GOVERNANCEGUARD · OPERATION FLAGGED · EXECUTION REVERTS ·";
    ctx.fillStyle = "#ff4d6d";
    ctx.font = `700 40px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < ring.length; i++) {
      const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * 400, cy + Math.sin(a) * 400);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(ring[i] ?? "", 0, 0);
      ctx.restore();
    }

    ctx.font = `800 150px ${SANS}`;
    ctx.fillStyle = "#ff2d55";
    ctx.fillText("HALTED", cx, cy - 10);
    ctx.font = `600 38px ${MONO}`;
    ctx.fillStyle = "rgba(255, 120, 140, 0.95)";
    ctx.fillText("GuardFlagged(0x8b1f…33d3)", cx, cy + 110);
  });
}
