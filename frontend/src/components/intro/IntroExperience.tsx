"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { Preload, Scroll, ScrollControls } from "@react-three/drei";
import { Scene } from "./Scene";
import { SECTIONS } from "./sections";
import styles from "./intro.module.css";

const LAST = SECTIONS.length - 1;

const BOOT_LINES = [
  "> connecting hardhat://127.0.0.1:8545",
  "> loading MIP-21 · forum · pdf · socials · calldata",
  "> canonicalising evidence (RFC 8785)",
  "> committing merkle root → ProposalRegistry",
  "> simulating timelock payload on fork",
  "> ready",
];
const BOOT_MIN_MS = 1700;

export function IntroExperience() {
  const router = useRouter();
  const [firstFrame, setFirstFrame] = useState(false);
  const sawFrame = useRef(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const railRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const lastIndex = useRef(-1);
  // The boot screen stays up until the GPU has compiled shaders and drawn a frame, not just until the canvas exists
  const ready = firstFrame && minElapsed;

  useEffect(() => {
    router.prefetch("/dashboard");
    const t = setTimeout(() => setMinElapsed(true), BOOT_MIN_MS);
    return () => clearTimeout(t);
  }, [router]);

  const enter = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => router.push("/dashboard"), 650);
  }, [leaving, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enter]);

  /** Runs every frame from inside the canvas: drives the HTML overlay without React re-renders. */
  const onFrame = useCallback((offset: number) => {
    if (!sawFrame.current) {
      sawFrame.current = true;
      setFirstFrame(true);
    }
    const pos = offset * LAST;
    sectionRefs.current.forEach((el, i) => {
      if (!el) return;
      const d = pos - i;
      const a = Math.max(0, 1 - Math.max(0, Math.abs(d) - 0.12) * 1.9);
      el.style.opacity = String(a * a * (3 - 2 * a));
      el.style.transform = `translate3d(0, ${d * -70}px, 0)`;
      el.style.filter = a < 0.98 ? `blur(${(1 - a) * 5}px)` : "none";
    });
    if (railRef.current) railRef.current.style.transform = `scaleY(${offset})`;
    if (hintRef.current) hintRef.current.style.opacity = String(Math.max(0, 1 - offset * 25));
    const idx = Math.round(pos);
    if (idx !== lastIndex.current && indexRef.current) {
      lastIndex.current = idx;
      indexRef.current.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(SECTIONS.length).padStart(2, "0")}`;
    }
  }, []);

  return (
    <div className={styles.root}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0.25, 7], fov: 40, near: 0.1, far: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      >
        <ScrollControls pages={SECTIONS.length} damping={0.22}>
          <Scene onFrame={onFrame} />
          <Preload all />
          <Scroll html style={{ width: "100vw" }}>
            {SECTIONS.map((s, i) => (
              <div
                key={s.title}
                ref={(el) => {
                  sectionRefs.current[i] = el;
                }}
                className={styles.section}
                style={{
                  top: `${i * 100}vh`,
                  justifyContent: s.align === "right" ? "flex-end" : s.align === "center" ? "center" : "flex-start",
                  textAlign: s.align === "center" ? "center" : "left",
                  opacity: i === 0 ? 1 : 0,
                }}
              >
                {i === LAST ? (
                  <div className="flex flex-col items-center gap-8 mt-[46vh]">
                    <div className={styles.eyebrow}>{s.eyebrow}</div>
                    <p className={styles.body} style={{ maxWidth: "44ch" }}>
                      MIP-21 never executes. Every claim, link and simulation behind that call is in the dossier.
                    </p>
                    <button type="button" className={styles.cta} onClick={enter}>
                      Enter the watchdog <span aria-hidden>→</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6" style={{ maxWidth: i === 0 ? "none" : "min(640px, 84vw)" }}>
                    <div className={styles.eyebrow}>{s.eyebrow}</div>
                    {i === 0 ? (
                      <h1 className={styles.hero}>
                        PROOF
                        <br />
                        OF INTENT
                      </h1>
                    ) : (
                      <h2 className={styles.title}>{s.title}</h2>
                    )}
                    {s.body && <p className={styles.body}>{s.body}</p>}
                  </div>
                )}
              </div>
            ))}
          </Scroll>
        </ScrollControls>
      </Canvas>

      <div className={styles.chrome}>
        <span className={styles.corner} style={{ top: 18, left: 18, borderTopWidth: 1, borderLeftWidth: 1 }} />
        <span className={styles.corner} style={{ top: 18, right: 18, borderTopWidth: 1, borderRightWidth: 1 }} />
        <span className={styles.corner} style={{ bottom: 18, left: 18, borderBottomWidth: 1, borderLeftWidth: 1 }} />
        <span className={styles.corner} style={{ bottom: 18, right: 18, borderBottomWidth: 1, borderRightWidth: 1 }} />

        <div className="absolute top-7 left-9 flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-[#9be7ff] shadow-[0_0_12px_#9be7ff]" />
          <span>ProofOfIntent</span>
        </div>
        <div className="absolute top-6 right-9">
          <button type="button" className={styles.skip} onClick={enter}>
            Skip intro
          </button>
        </div>
        <div className="absolute bottom-7 left-9">
          <span ref={indexRef}>01 / {String(SECTIONS.length).padStart(2, "0")}</span>
        </div>
        {/* Outer div fades with scroll; the inner span bobs (its animation owns opacity) */}
        <div ref={hintRef} className="absolute bottom-7 left-1/2 -translate-x-1/2">
          <span className={`inline-block ${styles.hint}`}>Scroll ↓</span>
        </div>
        <div className={styles.rail}>
          <div ref={railRef} className={styles.railFill} />
        </div>
      </div>

      <div className={`${styles.boot} ${ready ? styles.bootDone : ""}`} aria-hidden={ready}>
        {BOOT_LINES.map((line, i) => (
          <div key={line} className={styles.bootLine} style={{ animationDelay: `${i * 0.24}s` }}>
            {line}
          </div>
        ))}
        <div className={styles.bootBar}>
          <div className={styles.bootBarFill} />
        </div>
      </div>

      <div className={`${styles.flash} ${leaving ? styles.flashOn : ""}`} />
    </div>
  );
}

export default IntroExperience;
