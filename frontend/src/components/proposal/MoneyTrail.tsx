"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, LocateFixed, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildTrail, ROLE_COLOR, type Trail, type TrailLink, type TrailNode } from "@/lib/moneyTrail";
import { MoneyTrailInspector } from "@/components/proposal/MoneyTrailInspector";
import { makeNode, type NodeLook } from "@/components/proposal/graphObjects";
import type { CoiReport, DecisionSummary, Finding } from "@/types/shared";

const ForceGraph3D = dynamic(() => import("@/components/proposal/ForceGraph3DClient"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center font-code text-xs text-ice/60">loading the money trail…</div>,
});

/** The bits of the 3d-force-graph API we use. */
interface GraphApi {
  cameraPosition: (pos: { x: number; y: number; z: number }, lookAt?: { x: number; y: number; z: number }, ms?: number) => void;
  zoomToFit: (ms?: number, padding?: number) => void;
  graph2ScreenCoords: (x: number, y: number, z: number) => { x: number; y: number };
  controls: () => { autoRotate?: boolean; autoRotateSpeed?: number; enableZoom?: boolean };
  camera: () => { position: { x: number; y: number; z: number } };
  d3ReheatSimulation: () => void;
  d3Force: (name: string, force?: unknown) => { strength?: (v: number) => unknown; distance?: (v: number) => unknown } | undefined;
}

const C = {
  hiddenLink: "#F0566A",
  grantLink: "#22D3EE",
  transferLink: "#6E6A92",
  dimLink: "#22203A",
};

type Body = TrailNode & { vx?: number; vy?: number; vz?: number };

/**
 * Pulls every wallet toward the centre, so unconnected groups don't drift off and shrink the view, and presses
 * the layout nearly flat (strong pull on z) so it faces the camera and fills the frame.
 */
function gravity(strength: number, depth: number) {
  let bodies: Body[] = [];
  const force = (alpha: number) => {
    for (const n of bodies) {
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * strength * alpha;
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * strength * alpha;
      n.vz = (n.vz ?? 0) - (n.z ?? 0) * depth * alpha;
    }
  };
  force.initialize = (nodes: Body[]) => {
    bodies = nodes;
  };
  return force;
}

export type Selection = { kind: "node"; node: TrailNode } | { kind: "link"; link: TrailLink } | null;

const endId = (e: string | TrailNode) => (typeof e === "string" ? e : e.id);

export function MoneyTrail({ proposalId, coi, summary, findings }: { proposalId: string; coi: CoiReport | null | undefined; summary: DecisionSummary | null | undefined; findings: Finding[] | undefined }) {
  const trail: Trail = useMemo(() => buildTrail(proposalId, coi, summary, findings), [proposalId, coi, summary, findings]);
  const graphRef = useRef<GraphApi | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [revealed, setRevealed] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [toast, setToast] = useState(false);

  const data = useMemo(
    () => ({ nodes: trail.nodes.filter((n) => revealed || !n.hidden), links: trail.links.filter((l) => revealed || !l.hidden) }),
    [trail, revealed],
  );

  // Who is involved in a hidden link (stays lit when the rest dims after the reveal).
  const involved = useMemo(() => {
    const s = new Set<string>(["treasury"]);
    for (const l of trail.links) if (l.hidden) [endId(l.source), endId(l.target)].forEach((id) => s.add(id));
    return s;
  }, [trail]);
  const neighbours = useMemo(() => {
    if (selection?.kind !== "node") return null;
    const s = new Set<string>([selection.node.id]);
    for (const l of data.links) {
      const a = endId(l.source);
      const b = endId(l.target);
      if (a === selection.node.id) s.add(b);
      if (b === selection.node.id) s.add(a);
    }
    return s;
  }, [selection, data]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // HTML labels that follow the key wallets in 3D (crisp text, no second three.js instance).
  const labelled = useMemo(() => data.nodes.filter((n) => n.role !== "voter" && n.role !== "hub"), [data]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const g = graphRef.current;
      if (g) {
        for (const n of labelled) {
          const el = labelRefs.current[n.id];
          if (!el || n.x === undefined) continue;
          const p = g.graph2ScreenCoords(n.x, n.y ?? 0, n.z ?? 0);
          const inside = p.x > -50 && p.y > -20 && p.x < size.w + 50 && p.y < size.h + 20;
          el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, 14px)`;
          el.style.opacity = inside ? "1" : "0";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [labelled, size]);

  // Once the graph exists: spread connected wallets apart but keep every group near the centre, then frame the
  // whole trail in the box. Polled because the graph loads asynchronously (next/dynamic).
  const framed = useRef(false);
  /** set once the viewer drags, zooms or reveals: the camera is theirs and no longer re-frames itself */
  const userMoved = useRef(false);
  const frame = useCallback((ms = 900) => {
    const g = graphRef.current;
    if (!g) return;
    g.zoomToFit(ms, 36);
    framed.current = true;
  }, []);
  useEffect(() => {
    let fitTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = setInterval(() => {
      const g = graphRef.current;
      if (!g) return;
      clearInterval(poll);
      g.d3Force("charge")?.strength?.(-90);
      // the treasury's grant gets a longer line so its two labels never collide
      g.d3Force("link")?.distance?.(((l: TrailLink) => (l.kind === "grant" ? 80 : 46)) as never);
      g.d3Force("gravity", gravity(0.09, 0.6));
      g.d3ReheatSimulation();
      // The page scrolls under the graph: the plain wheel must not be swallowed by camera zoom.
      Object.assign(g.controls(), { enableZoom: false });
      // fallback if the engine-stop event comes late
      fitTimer = setTimeout(() => {
        if (!framed.current) frame(1000);
      }, 2200);
    }, 150);
    return () => {
      clearInterval(poll);
      clearTimeout(fitTimer);
    };
  }, [frame]);

  // the box changed size (window resize, panel layout): frame the trail again
  useEffect(() => {
    if (framed.current && !userMoved.current) frame(500);
  }, [size, frame]);

  const stopSpin = useCallback(() => {
    userMoved.current = true;
    const c = graphRef.current?.controls();
    if (c) c.autoRotate = false;
  }, []);

  const focusOn = useCallback((ns: TrailNode[], distance: number, ms = 1300) => {
    const g = graphRef.current;
    const placed = ns.filter((n) => n.x !== undefined);
    if (!g || placed.length === 0) return;
    const c = placed.reduce((a, n) => ({ x: a.x + n.x! / placed.length, y: a.y + (n.y ?? 0) / placed.length, z: a.z + (n.z ?? 0) / placed.length }), { x: 0, y: 0, z: 0 });
    g.cameraPosition({ x: c.x + distance * 0.35, y: c.y + distance * 0.2, z: c.z + distance }, c, ms);
  }, []);

  const reveal = () => {
    stopSpin();
    if (revealed) {
      setRevealed(false);
      setSelection(null);
      setTimeout(() => frame(900), 300);
      return;
    }
    // new wallets emerge from the proposer, then the camera flies to the trail
    const origin = trail.nodes.find((n) => n.role === "proposer");
    for (const n of trail.nodes)
      if (n.hidden && origin?.x !== undefined) Object.assign(n, { x: origin.x + Math.random() * 6, y: (origin.y ?? 0) + Math.random() * 6, z: (origin.z ?? 0) + Math.random() * 6 });
    setRevealed(true);
    setSelection(null);
    setToast(true);
    setTimeout(() => setToast(false), 4200);
    setTimeout(() => focusOn(trail.nodes.filter((n) => involved.has(n.id) && n.id !== "treasury"), 190), 1100);
  };

  /** Dolly the camera toward (factor < 1) or away from (> 1) the origin it orbits. */
  const zoom = (factor: number) => {
    const g = graphRef.current;
    if (!g) return;
    stopSpin();
    const p = g.camera().position;
    g.cameraPosition({ x: p.x * factor, y: p.y * factor, z: p.z * factor }, undefined, 400);
  };

  const dimmed = (id: string) => (neighbours ? !neighbours.has(id) : revealed && trail.hiddenLinkCount > 0 && !involved.has(id));

  /** Each role has its own colour (ROLE_COLOR); size and an orbit ring mark the wallets that matter. */
  const nodeLook = (n: TrailNode): NodeLook => {
    const color = ROLE_COLOR[n.role];
    const base = { brightness: dimmed(n.id) ? 0.16 : 1, color, haloColor: color };
    switch (n.role) {
      case "treasury":
        return { ...base, core: 5.2, halo: 20, ring: true };
      case "proposer":
        return { ...base, core: 4.6, halo: 18, ring: true };
      case "beneficiary": {
        const exposed = revealed && n.onPath;
        return { ...base, core: exposed ? 5.2 : 4.6, halo: exposed ? 30 : 18, ring: true };
      }
      case "middleman":
      case "linked":
        return { ...base, core: 4, halo: 20 };
      case "voter": {
        const compromised = revealed && involved.has(n.id);
        return { ...base, core: 2.2 + n.mrd / 1.5e7, halo: compromised ? 16 : 9, color: compromised ? ROLE_COLOR.middleman : color, haloColor: compromised ? ROLE_COLOR.middleman : color };
      }
      default:
        return { ...base, core: 2.4, halo: 8 };
    }
  };
  const linkColor = (l: TrailLink) => {
    const a = endId(l.source);
    const b = endId(l.target);
    if (neighbours ? !(neighbours.has(a) && neighbours.has(b)) : revealed && trail.hiddenLinkCount > 0 && !l.hidden && l.kind !== "grant") return C.dimLink;
    return l.kind === "hidden" ? C.hiddenLink : l.kind === "grant" ? C.grantLink : C.transferLink;
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div
        ref={boxRef}
        onPointerDown={stopSpin}
        // capture phase runs before the orbit controls' own wheel listener on the canvas
        onWheelCapture={(e) => {
          const c = graphRef.current?.controls();
          if (c) c.enableZoom = e.ctrlKey || e.metaKey;
        }}
        className="relative h-[min(640px,72vh)] min-h-[440px] overflow-hidden rounded-[22px] bg-[radial-gradient(60%_55%_at_50%_50%,rgba(139,92,246,0.16),transparent_70%)]"
      >
        {/* Reflect's horizontal lens flare, behind the transparent canvas */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
          <div className="mx-auto h-px w-[85%] bg-gradient-to-r from-transparent via-[#C4B5FD]/70 to-transparent" />
          <div className="mx-auto -mt-6 h-12 w-[60%] rounded-full bg-[#8B5CF6]/25 blur-2xl" />
        </div>
        <ForceGraph3D
          graphRef={graphRef as never}
          width={size.w}
          height={size.h}
          graphData={data as never}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          controlType="orbit"
          nodeThreeObject={(n: object) => makeNode(nodeLook(n as TrailNode))}
          nodeLabel={(n: object) => {
            const node = n as TrailNode;
            return `<div style="font:12px ui-sans-serif;padding:6px 10px;border-radius:10px;background:#100F22;color:#EEECFB;border:1px solid rgba(255,255,255,.1)">${node.name}</div>`;
          }}
          // ordinary transfers stay thin; the grant and the hidden money trail are thicker and carry moving particles
          linkColor={(l: object) => linkColor(l as TrailLink)}
          linkWidth={(l: object) => ((l as TrailLink).kind === "hidden" ? 1.4 : (l as TrailLink).kind === "grant" ? 1 : 0.35)}
          linkOpacity={0.85}
          linkCurvature={(l: object) => ((l as TrailLink).kind === "hidden" ? 0.18 : 0)}
          linkDirectionalArrowLength={(l: object) => ((l as TrailLink).kind === "transfer" ? 0 : 4)}
          linkDirectionalArrowRelPos={0.92}
          linkDirectionalArrowColor={(l: object) => linkColor(l as TrailLink)}
          linkDirectionalParticles={(l: object) => ((l as TrailLink).kind === "hidden" ? 4 : (l as TrailLink).kind === "grant" ? 2 : 0)}
          linkDirectionalParticleWidth={(l: object) => ((l as TrailLink).kind === "hidden" ? 2.4 : 1.8)}
          linkDirectionalParticleSpeed={0.005}
          linkDirectionalParticleColor={(l: object) => ((l as TrailLink).kind === "hidden" ? "#FFD1D7" : "#A5F3FC")}
          // the layout has settled: frame the whole trail in the box (until the viewer takes the camera)
          onEngineStop={() => {
            if (!userMoved.current) frame(framed.current ? 700 : 900);
          }}
          onNodeClick={(n: object) => {
            stopSpin();
            const node = n as TrailNode;
            setSelection({ kind: "node", node });
            focusOn([node], 95, 1000);
          }}
          onLinkClick={(l: object) => {
            stopSpin();
            setSelection({ kind: "link", link: l as TrailLink });
          }}
          onBackgroundClick={() => setSelection(null)}
          cooldownTicks={160}
        />

        {/* labels for the wallets that matter */}
        <div className="pointer-events-none absolute inset-0">
          {labelled.map((n) => (
            <div
              key={n.id}
              ref={(el) => {
                labelRefs.current[n.id] = el;
              }}
              className={cn(
                "absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-night/80 px-2.5 py-1 text-[12px] font-medium opacity-0 backdrop-blur-sm transition-[opacity,color] duration-300",
                dimmed(n.id) ? "text-ice-light/30" : "text-ice-light",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: ROLE_COLOR[n.role], boxShadow: `0 0 8px ${ROLE_COLOR[n.role]}` }} />
              {n.name}
              {n.hidden && <span className="rounded-full bg-[#F0566A]/20 px-1.5 text-[10px] text-[#FFB4BE]">new</span>}
            </div>
          ))}
        </div>

        {/* controls */}
        <div className="absolute left-4 right-4 top-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/[0.07] bg-night/70 p-2 text-[11px] text-ice-light/85 backdrop-blur">
            {(
              [
                ["Treasury", ROLE_COLOR.treasury],
                ["Proposer", ROLE_COLOR.proposer],
                ["Gets paid / control", ROLE_COLOR.beneficiary],
                ["Voter", ROLE_COLOR.voter],
                ...(revealed && trail.hiddenNodeCount ? [["Hidden wallet", ROLE_COLOR.middleman]] : []),
              ] as [string, string][]
            ).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5 px-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                {label}
              </span>
            ))}
            {revealed && trail.hiddenLinkCount > 0 && (
              <span className="flex items-center gap-1.5 px-1.5">
                <span className="h-0.5 w-4 rounded" style={{ background: C.hiddenLink }} /> undisclosed payment
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {[
              ["+", 0.75, "Zoom in"],
              ["−", 1.33, "Zoom out"],
            ].map(([sym, f, title]) => (
              <button
                key={title as string}
                onClick={() => zoom(f as number)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-ice/25 bg-night/60 text-lg leading-none text-ice-light/80 backdrop-blur transition-colors hover:border-ice/60 hover:text-white"
                title={title as string}
              >
                {sym}
              </button>
            ))}
            <button
              onClick={() => {
                stopSpin();
                setSelection(null);
                frame(900);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-ice/25 bg-night/60 text-ice-light/80 backdrop-blur transition-colors hover:border-ice/60 hover:text-white"
              title="Reset view"
            >
              <LocateFixed className="h-4 w-4" />
            </button>
            <button onClick={reveal} className={cn("pill-cta !px-5 !py-2.5", trail.hiddenLinkCount > 0 && !revealed ? "pill-danger" : "pill-ice")}>
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {revealed ? "Hide again" : "Reveal hidden links"}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-night/80 px-5 py-2.5 text-sm text-ice-light backdrop-blur"
            >
              <Sparkles className={cn("h-4 w-4", trail.hiddenLinkCount ? "text-[#A78BFA]" : "text-verified")} />
              {trail.hiddenLinkCount
                ? `Found ${trail.hiddenNodeCount ? `${trail.hiddenNodeCount} hidden wallet${trail.hiddenNodeCount > 1 ? "s" : ""} and ` : ""}${trail.hiddenLinkCount} undisclosed payment${trail.hiddenLinkCount > 1 ? "s" : ""}`
                : "Nothing hidden: no undisclosed links to the proposer"}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="pointer-events-none absolute bottom-4 left-4 text-[11px] text-ice-light/45">drag to orbit · ctrl + scroll or +/− to zoom · click a wallet</div>
      </div>

      <MoneyTrailInspector trail={trail} revealed={revealed} selection={selection} onReveal={reveal} onClear={() => setSelection(null)} />
    </div>
  );
}
