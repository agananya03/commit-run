"use client";

import { useId, useRef } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Headline lines that slide up out of a mask when they scroll into view (after lusion.co). The wrapper watches
 * the viewport: the lines themselves start clipped by their masks, so they would never count as visible.
 */
export function RevealLines({ lines, className, lineClassName, delay = 0 }: { lines: React.ReactNode[]; className?: string; lineClassName?: string; delay?: number }) {
  return (
    <motion.span className={cn("block", className)} initial="hidden" whileInView="shown" viewport={{ once: true, margin: "-10% 0px" }}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className={cn("block", lineClassName)}
            variants={{ hidden: { y: "110%" }, shown: { y: "0%" } }}
            transition={{ duration: 0.9, delay: delay + i * 0.09, ease: EASE }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

/** Fades and lifts children in when they enter the viewport. */
export function Rise({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** A card that tilts toward the pointer with a soft moving glare. */
export function TiltCard({ children, className, glare = "rgba(255,255,255,0.55)" }: { children: React.ReactNode; className?: string; glare?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [6, -6]), { stiffness: 180, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-8, 8]), { stiffness: 180, damping: 18 });
  const gx = useTransform(px, (v) => `${v * 100}%`);
  const gy = useTransform(py, (v) => `${v * 100}%`);
  const glareBg = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, ${glare}, transparent 45%)`;

  return (
    <motion.div
      ref={ref}
      onPointerMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width);
        py.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
      }}
      style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 1000 }}
      className={cn("group relative", className)}
    >
      {children}
      {!reduce && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: glareBg }} />}
    </motion.div>
  );
}

/** Pulls its child a few pixels toward the pointer, like Lusion's buttons. */
export function Magnetic({ children, strength = 0.25, className }: { children: React.ReactNode; strength?: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 220, damping: 15 });
  const y = useSpring(0, { stiffness: 220, damping: 15 });
  return (
    <motion.div
      ref={ref}
      className={cn("inline-block", className)}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

const RING_STROKE = { danger: "#B392FF", caution: "#8E7FC4", verified: "#7E7A9E", muted: "#6F6C8C" } as const;

/** Hairline progress bar (after reflect.app): a faint track, a thin glowing fill and a bright head dot. */
export function GlowBar({ value, color = "#A78BFA", className, delay = 0.2 }: { value: number; color?: string; className?: string; delay?: number }) {
  const pct = `${Math.min(100, Math.max(0, value * 100))}%`;
  return (
    <div className={cn("relative h-2", className)}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
      <motion.div
        className="absolute left-0 top-1/2 h-[2px] rounded-full"
        style={{ marginTop: -1, background: `linear-gradient(90deg, rgba(255,255,255,0.35), ${color})`, boxShadow: `0 0 8px ${color}` }}
        initial={{ width: 0 }}
        whileInView={{ width: pct }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: EASE, delay }}
      />
      <motion.span
        className="absolute top-1/2 h-2 w-2 rounded-full bg-white"
        style={{ marginTop: -4, marginLeft: -4, boxShadow: `0 0 10px 2px ${color}` }}
        initial={{ left: "0%", opacity: 0 }}
        whileInView={{ left: pct, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: EASE, delay }}
      />
    </div>
  );
}

/**
 * Reflect-style orbit gauge: a faint outer orbit, a hairline track, a thin glowing arc that fills to `value`
 * (0..1) the first time it scrolls into view, and a bright dot riding at the arc's head.
 */
export function RiskRing({ value, tone, size = 132, label }: { value: number | null; tone: keyof typeof RING_STROKE; size?: number; label?: string }) {
  const id = useId().replace(/:/g, "");
  const r = 48;
  const v = value === null ? 0 : Math.max(0.02, value);
  const color = RING_STROKE[tone];
  const anim = { duration: 1.6, ease: EASE, delay: 0.2 };
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90 overflow-visible">
        <defs>
          <linearGradient id={`arc-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="57" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" />
        {value !== null && (
          <>
            <motion.circle
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={`url(#arc-${id})`}
              strokeWidth="2.6"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: v }}
              viewport={{ once: true }}
              transition={anim}
              style={{ filter: `drop-shadow(0 0 5px ${color}aa)` }}
            />
            {/* the head of the arc */}
            <motion.g initial={{ rotate: 0 }} whileInView={{ rotate: v * 360 }} viewport={{ once: true }} transition={anim} style={{ originX: "60px", originY: "60px" }}>
              <circle cx={60 + r} cy="60" r="6" fill={color} opacity="0.25" />
              <circle cx={60 + r} cy="60" r="2.6" fill="#FFFFFF" />
            </motion.g>
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-medium tracking-tight text-ink">{value === null ? "—" : `${Math.round(value * 100)}%`}</span>
        {label && <span className="mt-0.5 text-[11px]" style={{ color }}>{label}</span>}
      </div>
    </div>
  );
}
