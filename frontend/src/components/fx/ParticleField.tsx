"use client";

import { useEffect, useRef } from "react";

/**
 * A quiet starfield on a cheap 2D canvas (after reflect.app): small twinkling points that drift and ease away
 * from the pointer. `links` draws faint lines between close points (off by default). Fills its (relative)
 * parent. Pauses off-screen; static when the viewer prefers reduced motion.
 */
export function ParticleField({ count = 48, color = "196, 181, 253", links = false, className }: { count?: number; color?: string; links?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const pointer = { x: -9999, y: -9999 };
    const pts = Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.12, r: 0.5 + Math.random() * 1.2, phase: Math.random() * Math.PI * 2 }));

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // first frame: spread the unit positions over the real size
      for (const p of pts) if (p.x <= 1 && p.y <= 1) Object.assign(p, { x: p.x * w, y: p.y * h });
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    };
    const onLeave = () => Object.assign(pointer, { x: -9999, y: -9999 });

    let raf = 0;
    let visible = true;
    const frame = (t = 0) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        if (!reduce) {
          // stars ease away from the pointer, then settle back to a slow drift
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 140 * 140) {
            p.vx += dx * 0.00004;
            p.vy += dy * 0.00004;
          }
          p.vx *= 0.98;
          p.vy *= 0.98;
          p.x += p.vx + 0.02;
          p.y += p.vy - 0.015;
          if (p.x < -10) p.x = w + 10;
          if (p.x > w + 10) p.x = -10;
          if (p.y < -10) p.y = h + 10;
          if (p.y > h + 10) p.y = -10;
        }
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        if (links) {
          for (let j = i + 1; j < pts.length; j++) {
            const b = pts[j]!;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 110) {
              ctx.strokeStyle = `rgba(${color}, ${0.12 * (1 - d / 110)})`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
        const twinkle = reduce ? 0.6 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t / 900 + a.phase));
        ctx.fillStyle = `rgba(${color}, ${twinkle})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(frame);
    });
    resize();
    io.observe(canvas);
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    parent.addEventListener("pointermove", onMove);
    parent.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      parent.removeEventListener("pointermove", onMove);
      parent.removeEventListener("pointerleave", onLeave);
    };
  }, [count, color, links]);

  return <canvas ref={ref} aria-hidden className={className ?? "pointer-events-none absolute inset-0"} />;
}
