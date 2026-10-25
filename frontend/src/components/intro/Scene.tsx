"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Line, MeshTransmissionMaterial, RoundedBox, useScroll } from "@react-three/drei";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { coreTexture, crackTexture, labelTexture, rng, sealTexture } from "./textures";

/*
 * One scroll timeline (offset 0 → 1 over 7 pages):
 *   0.00  monolith: the proposal as voters see it (frosted glass, polished promises)
 *   0.18  cracks spread; the red calldata glows through
 *   0.30  it shatters; the core shows what actually executes
 *   0.46  hash chain: every version linked and committed
 *   0.62  wallet graph: the hidden proposer → alt-wallet path lights up
 *   0.78  HALTED: GovernanceGuard stamps the operation
 */

const ICE = new THREE.Color("#9be7ff");
const DANGER = new THREE.Color("#ff2d55");

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (t: number) => t * t * (3 - 2 * t);
/** 0 → 1 between a and b (smoothstep). */
const ramp = (o: number, a: number, b: number) => smooth(clamp01((o - a) / (b - a)));
/** Fade in over a → b, hold, fade out over c → d. */
const span = (o: number, a: number, b: number, c: number, d: number) => ramp(o, a, b) * (1 - ramp(o, c, d));

/** Sets opacity on every material under an object (meshes, lines, points). */
function setOpacity(obj: THREE.Object3D | null, opacity: number) {
  if (!obj) return;
  obj.visible = opacity > 0.002;
  obj.traverse((child) => {
    const mats = (child as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      (m as THREE.Material).transparent = true;
      (m as THREE.Material).opacity = opacity;
    }
  });
}

function CameraRig() {
  const scroll = useScroll();
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, delta) => {
    const o = scroll.offset;
    const t = state.clock.elapsedTime;
    // Push in on the monolith, pull back for the shatter, drift through the chain and graph, settle on the seal.
    const z = 7 - 2.2 * ramp(o, 0, 0.28) + 2.6 * ramp(o, 0.28, 0.46) - 0.6 * ramp(o, 0.46, 0.62) + 0.4 * ramp(o, 0.62, 0.78) - 1.2 * ramp(o, 0.78, 1);
    const orbit = o * Math.PI * 0.9 + Math.sin(t * 0.15) * 0.05;
    const px = Math.sin(orbit) * 1.4 + state.pointer.x * 0.35;
    const py = 0.25 + Math.sin(o * Math.PI * 2) * 0.4 + state.pointer.y * 0.25;
    target.set(px, py, z);
    state.camera.position.lerp(target, 1 - Math.pow(0.0015, delta));
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

function Monolith() {
  const scroll = useScroll();
  const group = useRef<THREE.Group>(null);
  const label = useRef<THREE.Mesh>(null);
  const crack = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const textures = useMemo(() => ({ label: labelTexture(), crack: crackTexture(), core: coreTexture() }), []);
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);

  useFrame((state) => {
    const o = scroll.offset;
    const t = state.clock.elapsedTime;
    if (!group.current) return;
    const alive = 1 - ramp(o, 0.3, 0.36);
    group.current.visible = alive > 0.01;
    group.current.rotation.y = Math.sin(t * 0.25) * 0.25 + o * 1.2;
    group.current.rotation.x = Math.sin(t * 0.18) * 0.05;
    group.current.position.y = Math.sin(t * 0.6) * 0.06;
    // Tremble while cracking
    const shake = ramp(o, 0.2, 0.3) * 0.03;
    group.current.position.x = (Math.random() - 0.5) * shake;
    group.current.scale.setScalar(1 + ramp(o, 0.26, 0.32) * 0.04);
    setOpacity(label.current, (1 - ramp(o, 0.2, 0.3)) * 0.95);
    setOpacity(crack.current, ramp(o, 0.17, 0.3) * alive);
    setOpacity(core.current, ramp(o, 0.12, 0.3) * alive);
  });

  return (
    <group ref={group}>
      <RoundedBox args={[1.7, 3.3, 0.62]} radius={0.08} smoothness={4}>
        <MeshTransmissionMaterial
          backside
          samples={6}
          resolution={512}
          transmission={1}
          roughness={0.16}
          thickness={0.7}
          ior={1.3}
          chromaticAberration={0.06}
          anisotropy={0.25}
          distortion={0.18}
          distortionScale={0.35}
          temporalDistortion={0.08}
          color="#d7f3ff"
          attenuationColor="#9be7ff"
          attenuationDistance={2.2}
        />
      </RoundedBox>
      {/* Inside the glass: what actually executes */}
      <mesh ref={core} position={[0, 0, 0]}>
        <planeGeometry args={[1.45, 2.9]} />
        <meshBasicMaterial map={textures.core} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {/* On the face: what voters were told */}
      <mesh ref={label} position={[0, 0, 0.315]}>
        <planeGeometry args={[1.55, 3.1]} />
        <meshBasicMaterial map={textures.label} transparent depthWrite={false} />
      </mesh>
      <mesh ref={crack} position={[0, 0, 0.318]}>
        <planeGeometry args={[1.7, 3.3]} />
        <meshBasicMaterial map={textures.crack} transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

const SHARDS = 140;

function Shards() {
  const scroll = useScroll();
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => {
    const r = rng(21);
    return Array.from({ length: SHARDS }, () => {
      const base = new THREE.Vector3((r() - 0.5) * 1.6, (r() - 0.5) * 3.2, (r() - 0.5) * 0.55);
      // Mostly radial so the centre clears quickly and the text stays readable
      const dir = new THREE.Vector3(base.x * 2, base.y, 0.35 + r() * 0.5).add(new THREE.Vector3((r() - 0.5) * 0.5, (r() - 0.5) * 0.5, 0)).normalize();
      return {
        base,
        dir,
        speed: 2.6 + r() * 4,
        axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        spin: (r() - 0.5) * 9,
        scale: new THREE.Vector3(0.04 + r() * 0.12, 0.06 + r() * 0.18, 0.015 + r() * 0.03),
      };
    });
  }, []);

  useFrame(() => {
    const o = scroll.offset;
    if (!mesh.current) return;
    const appear = ramp(o, 0.3, 0.33);
    const fade = 1 - ramp(o, 0.44, 0.52);
    const t = ramp(o, 0.3, 0.5);
    const material = mesh.current.material as THREE.MeshPhysicalMaterial;
    material.opacity = appear * fade * 0.6;
    mesh.current.visible = material.opacity > 0.01;
    data.forEach((s, i) => {
      dummy.position.copy(s.base).addScaledVector(s.dir, t * s.speed);
      dummy.quaternion.setFromAxisAngle(s.axis, t * s.spin);
      dummy.scale.copy(s.scale);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SHARDS]}>
      <boxGeometry args={[1, 1, 1]} />
      {/* No transmission here: 180 instances through a second transmission pass costs too much on laptops */}
      <meshPhysicalMaterial color="#cfefff" roughness={0.08} metalness={0.3} clearcoat={1} transparent emissive={ICE} emissiveIntensity={0.12} />
    </instancedMesh>
  );
}

/** The calldata keeps glowing in space after the shell is gone. */
function FloatingCore() {
  const scroll = useScroll();
  const ref = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => coreTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame((state) => {
    const o = scroll.offset;
    if (!ref.current) return;
    setOpacity(ref.current, span(o, 0.3, 0.34, 0.44, 0.5));
    ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.15;
    ref.current.scale.setScalar(1 + ramp(o, 0.3, 0.44) * 0.15);
  });
  return (
    <mesh ref={ref}>
      <planeGeometry args={[1.45, 2.9]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

const BLOCKS = 5;

function HashChain() {
  const scroll = useScroll();
  const group = useRef<THREE.Group>(null);
  const blocks = useRef<(THREE.Group | null)[]>([]);
  const links = useRef<(THREE.Mesh | null)[]>([]);
  const pulse = useRef<THREE.Mesh>(null);
  const spacing = 1.15;
  const xs = useMemo(() => Array.from({ length: BLOCKS }, (_, i) => (i - (BLOCKS - 1) / 2) * spacing), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.57, 0.57, 0.57)), []);

  useFrame((state) => {
    const o = scroll.offset;
    if (!group.current) return;
    const vis = span(o, 0.44, 0.5, 0.6, 0.66);
    group.current.visible = vis > 0.01;
    group.current.rotation.y = -0.35 + Math.sin(state.clock.elapsedTime * 0.3) * 0.08;
    const build = clamp01((o - 0.42) / 0.08);
    blocks.current.forEach((b, i) => {
      if (!b) return;
      const p = smooth(clamp01(build * 1.8 - i * 0.18));
      b.position.set(xs[i]!, (1 - p) * 2.5, 0);
      b.rotation.set((1 - p) * 1.2, (1 - p) * 1.5 + state.clock.elapsedTime * 0.2, 0);
      setOpacity(b, p * vis);
    });
    links.current.forEach((l, i) => {
      if (!l) return;
      const p = smooth(clamp01(build * 1.8 - (i + 1) * 0.18));
      l.scale.set(1, Math.max(0.001, p), 1);
      setOpacity(l, p * vis);
    });
    if (pulse.current) {
      const run = (state.clock.elapsedTime * 0.35) % 1;
      pulse.current.position.x = THREE.MathUtils.lerp(xs[0]!, xs[BLOCKS - 1]!, run);
      setOpacity(pulse.current, vis * ramp(build, 0.85, 1));
    }
  });

  return (
    <group ref={group} position={[0, -0.5, 0]}>
      {xs.map((x, i) => (
        <group key={i} ref={(el) => { blocks.current[i] = el; }} position={[x, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.55, 0.55, 0.55]} />
            <meshPhysicalMaterial color="#0b1726" roughness={0.2} metalness={0.4} transparent emissive={ICE} emissiveIntensity={0.05} />
          </mesh>
          <lineSegments geometry={edges}>
            <lineBasicMaterial color={i === BLOCKS - 1 ? "#a5b4fc" : "#9be7ff"} transparent toneMapped={false} />
          </lineSegments>
        </group>
      ))}
      {xs.slice(0, -1).map((x, i) => (
        <mesh key={i} ref={(el) => { links.current[i] = el; }} position={[x + spacing / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, spacing - 0.57, 8]} />
          <meshBasicMaterial color="#9be7ff" transparent toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={pulse}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color="#e0f7ff" transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

const NODES = 14;
/** proposer → intermediary → recipient: the hidden path that lights up red. */
const HIDDEN_PATH = [0, 6, 11];

function WalletGraph() {
  const scroll = useScroll();
  const group = useRef<THREE.Group>(null);
  const hot = useRef<THREE.Group>(null);
  const nodes = useMemo(() => {
    // Fibonacci sphere: evenly spread, deterministic
    return Array.from({ length: NODES }, (_, i) => {
      const y = 1 - (i / (NODES - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = i * Math.PI * (3 - Math.sqrt(5));
      return new THREE.Vector3(Math.cos(theta) * r * 2.3, y * 1.6, Math.sin(theta) * r * 1.4);
    });
  }, []);
  const edges = useMemo(() => {
    const r = rng(5);
    const out: [number, number][] = [];
    for (let i = 0; i < NODES; i++) {
      const j = Math.floor(r() * NODES);
      if (j !== i) out.push([i, j]);
      if (r() > 0.55) out.push([i, (i + 3) % NODES]);
    }
    return out;
  }, []);
  const hotPoints = useMemo(() => HIDDEN_PATH.map((i) => nodes[i]!), [nodes]);

  useFrame((state) => {
    const o = scroll.offset;
    if (!group.current) return;
    const vis = span(o, 0.6, 0.66, 0.76, 0.82);
    group.current.visible = vis > 0.01;
    group.current.rotation.y = state.clock.elapsedTime * 0.12 + o * 2;
    setOpacity(group.current, vis * 0.55);
    const heat = ramp(o, 0.65, 0.72) * vis;
    setOpacity(hot.current, heat);
    if (hot.current) hot.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 4) * 0.02 * heat);
  });

  return (
    <group>
      <group ref={group}>
        {edges.map(([a, b], i) => (
          <Line key={i} points={[nodes[a]!, nodes[b]!]} color="#5b6b8c" lineWidth={1} transparent />
        ))}
        {nodes.map((p, i) => (
          <mesh key={i} position={p}>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshBasicMaterial color={HIDDEN_PATH.includes(i) ? "#ff8aa0" : "#9be7ff"} transparent toneMapped={false} />
          </mesh>
        ))}
        <group ref={hot}>
          <Line points={hotPoints} color={DANGER} lineWidth={3} transparent toneMapped={false} />
          {hotPoints.map((p, i) => (
            <mesh key={i} position={p}>
              <sphereGeometry args={[0.13, 20, 20]} />
              <meshBasicMaterial color={DANGER} transparent toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

function Seal() {
  const scroll = useScroll();
  const group = useRef<THREE.Group>(null);
  const shock = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => sealTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame((state) => {
    const o = scroll.offset;
    if (!group.current) return;
    const t = ramp(o, 0.78, 0.88);
    setOpacity(group.current, t);
    group.current.scale.setScalar(THREE.MathUtils.lerp(2.6, 1, t));
    group.current.rotation.z = (1 - t) * 1.4 + Math.sin(state.clock.elapsedTime * 0.5) * 0.02;
    if (shock.current) {
      const s = ramp(o, 0.86, 0.95);
      shock.current.scale.setScalar(1 + s * 2.5);
      setOpacity(shock.current, (1 - s) * (s > 0 ? 0.8 : 0));
    }
  });
  // Sits above centre so the CTA underneath doesn't cover the ring
  return (
    <group position={[0, 0.45, 0]}>
      <group ref={group}>
        <mesh>
          <planeGeometry args={[2.3, 2.3]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <mesh ref={shock}>
        <ringGeometry args={[1.1, 1.15, 96]} />
        <meshBasicMaterial color={DANGER} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Particles() {
  const scroll = useScroll();
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const r = rng(99);
    const arr = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i++) {
      const radius = 5 + r() * 10;
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      arr.set([Math.cos(th) * s * radius, u * radius * 0.7, Math.sin(th) * s * radius], i * 3);
    }
    return arr;
  }, []);
  useFrame((state) => {
    if (!ref.current) return;
    const o = scroll.offset;
    ref.current.rotation.y = state.clock.elapsedTime * 0.015 + o * 0.6;
    const m = ref.current.material as THREE.PointsMaterial;
    m.color.copy(ICE).lerp(DANGER, ramp(o, 0.8, 0.95));
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.025} sizeAttenuation transparent opacity={0.7} color={ICE} depthWrite={false} />
    </points>
  );
}

/** Bloom + noise + vignette, and chromatic aberration that spikes with scroll speed (the glitch). */
function Effects() {
  const scroll = useScroll();
  const last = useRef(0);
  // The effect keeps this exact Vector2 as its uniform value, so mutating it per frame drives the shader.
  const offset = useMemo(() => new THREE.Vector2(0.0006, 0.0006), []);
  useFrame((_, delta) => {
    const o = scroll.offset;
    const speed = Math.abs(o - last.current) / Math.max(delta, 1e-3);
    last.current = o;
    const target = 0.0006 + Math.min(speed * 0.02, 0.008) + ramp(o, 0.2, 0.3) * (1 - ramp(o, 0.32, 0.4)) * 0.004;
    const v = THREE.MathUtils.lerp(offset.x, target, 0.15);
    offset.set(v, v * 0.6);
  });
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.55} luminanceSmoothing={0.25} />
      <ChromaticAberration offset={offset} radialModulation={false} modulationOffset={0} />
      <Noise opacity={0.045} />
      <Vignette eskil={false} offset={0.25} darkness={0.75} />
    </EffectComposer>
  );
}

export function Scene({ onFrame }: { onFrame?: (offset: number) => void }) {
  const scroll = useScroll();
  useFrame(() => onFrame?.(scroll.offset));
  return (
    <>
      <color attach="background" args={["#03050a"]} />
      <fog attach="fog" args={["#03050a", 8, 22]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} color="#dff6ff" />
      <pointLight position={[-4, -2, 2]} intensity={6} color="#6366f1" distance={12} />
      {/* Procedural studio lighting for the glass reflections: no HDRI download */}
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2.2} rotation-x={Math.PI / 2} position={[0, 4, -6]} scale={[10, 1, 1]} />
        <Lightformer intensity={2.5} rotation-y={Math.PI / 2} position={[-5, 1, -1]} scale={[20, 0.3, 1]} color="#9be7ff" />
        <Lightformer intensity={1.8} rotation-y={-Math.PI / 2} position={[5, -1, 0]} scale={[20, 0.5, 1]} color="#818cf8" />
      </Environment>
      <CameraRig />
      <Particles />
      <Monolith />
      <Shards />
      <FloatingCore />
      <HashChain />
      <WalletGraph />
      <Seal />
      <Effects />
    </>
  );
}
