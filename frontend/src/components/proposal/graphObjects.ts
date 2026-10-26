import * as THREE from "three";

/**
 * Reflect-style graph nodes: a luminous core in the wallet's role colour, a soft additive halo of the same
 * colour, and (for the wallets that matter) a hairline orbit ring. Textures are drawn once on a canvas and shared. Uses the same three.js
 * instance as 3d-force-graph (npm dedupes both to the intro's three 0.170), so objects mix safely.
 */

let glow: THREE.Texture | null = null;
let ring: THREE.Texture | null = null;
const spheres = new Map<number, THREE.SphereGeometry>();

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.Texture {
  glow ??= canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(237,233,254,0.75)");
    g.addColorStop(0.42, "rgba(167,139,250,0.25)");
    g.addColorStop(1, "rgba(139,92,246,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  return glow;
}

function ringTexture(): THREE.Texture {
  ring ??= canvasTexture(256, (ctx, s) => {
    ctx.strokeStyle = "rgba(237,233,254,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
    ctx.stroke();
    // a brighter arc on the orbit, like Reflect's capture icon
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.44, -0.9, 0.2);
    ctx.stroke();
  });
  return ring;
}

export interface NodeLook {
  core: number;
  halo: number;
  color: string;
  haloColor: string;
  /** 0..1: dimmed nodes fade out */
  brightness: number;
  ring?: boolean;
}

export function makeNode(look: NodeLook): THREE.Object3D {
  const group = new THREE.Group();
  const r = Math.round(look.core * 10) / 10;
  if (!spheres.has(r)) spheres.set(r, new THREE.SphereGeometry(r, 18, 18));
  group.add(new THREE.Mesh(spheres.get(r)!, new THREE.MeshBasicMaterial({ color: look.color, transparent: true, opacity: Math.max(0.15, look.brightness) })));

  // a soft halo: strong enough to glow, weak enough that the core keeps its colour instead of blooming to white
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: look.haloColor, transparent: true, opacity: 0.42 * look.brightness, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  halo.scale.set(look.halo, look.halo, 1);
  group.add(halo);

  if (look.ring) {
    const orbit = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: look.color, transparent: true, opacity: 0.7 * look.brightness, depthWrite: false }));
    orbit.scale.set(look.core * 6, look.core * 6, 1);
    group.add(orbit);
  }
  return group;
}
