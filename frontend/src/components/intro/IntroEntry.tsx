"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { SECTIONS } from "./sections";
import styles from "./intro.module.css";

// three.js touches window/document on import, so the 3D intro is client-only and loaded on demand.
const IntroExperience = dynamic(() => import("./IntroExperience"), {
  ssr: false,
  loading: () => <div className={styles.root} />,
});

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Plain scrolling version for reduced motion or no WebGL. Same story, no canvas. */
function StaticIntro() {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#03050a] text-[#e6f6ff]">
      <div className="mx-auto flex max-w-3xl flex-col gap-24 px-6 py-24">
        {SECTIONS.slice(0, -1).map((s, i) => (
          <section key={s.title} className="flex flex-col gap-5">
            <div className={styles.eyebrow}>{s.eyebrow}</div>
            {i === 0 ? <h1 className={styles.hero}>{s.title}</h1> : <h2 className={styles.title}>{s.title}</h2>}
            {s.body && <p className={styles.body}>{s.body}</p>}
          </section>
        ))}
        <section className="flex flex-col items-start gap-6">
          <h2 className={styles.title} style={{ color: "#ff2d55" }}>
            HALTED.
          </h2>
          <Link href="/dashboard" className={styles.cta}>
            Enter the watchdog <span aria-hidden>→</span>
          </Link>
        </section>
      </div>
    </div>
  );
}

export function IntroEntry() {
  const [mode, setMode] = useState<"pending" | "3d" | "static">("pending");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMode(!reduced && hasWebGL() ? "3d" : "static");
  }, []);

  if (mode === "pending") return <div className={styles.root} />;
  return mode === "3d" ? <IntroExperience /> : <StaticIntro />;
}
