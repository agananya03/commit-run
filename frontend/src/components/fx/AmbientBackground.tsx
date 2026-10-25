"use client";

import { useEffect, useRef } from "react";
import { ParticleField } from "@/components/fx/ParticleField";

// Fixed layouts (not random) so server and client render the same markup.
const RAYS = [
  { left: "14%", width: 70, tilt: "-7deg", delay: "0s" },
  { left: "31%", width: 120, tilt: "-3deg", delay: "2.5s" },
  { left: "50%", width: 160, tilt: "0deg", delay: "1s" },
  { left: "67%", width: 110, tilt: "4deg", delay: "3.5s" },
  { left: "84%", width: 80, tilt: "8deg", delay: "5s" },
];
const METEORS = [
  { top: "8%", left: "78%", duration: "13s", delay: "1s" },
  { top: "22%", left: "96%", duration: "17s", delay: "6s" },
  { top: "4%", left: "52%", duration: "15s", delay: "10s" },
  { top: "35%", left: "88%", duration: "19s", delay: "14s" },
];

/**
 * Quiet motion behind every app page: a cursor spotlight, breathing light rays, two dim drifting auroras,
 * a sparse starfield and the odd shooting star, all in the single violet. Purely decorative; everything
 * stops under prefers-reduced-motion.
 */
export function AmbientBackground() {
  const spot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        spot.current?.style.setProperty("--mx", `${e.clientX}px`);
        spot.current?.style.setProperty("--my", `${e.clientY}px`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="ambient-aurora left-[-10vw] top-[-20vh] h-[60vh] w-[50vw] bg-[#8B5CF6]/[0.10]" />
      <div className="ambient-aurora bottom-[-25vh] right-[-10vw] h-[60vh] w-[55vw] bg-[#6D28D9]/[0.10]" style={{ animationDelay: "-18s", animationDuration: "52s" }} />

      {RAYS.map((r) => (
        <span key={r.left} className="ambient-ray" style={{ left: r.left, width: r.width, animationDelay: r.delay, ["--tilt" as string]: r.tilt }} />
      ))}

      <div className="absolute inset-0 opacity-70">
        <ParticleField count={42} />
      </div>

      {METEORS.map((m) => (
        <span key={m.left + m.top} className="meteor" style={{ top: m.top, left: m.left, animationDuration: m.duration, animationDelay: m.delay }} />
      ))}

      <div ref={spot} className="ambient-spotlight absolute inset-0" />
    </div>
  );
}
