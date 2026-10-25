/**
 * A short light travelling along the parent's border. Approach after Magic UI's BorderBeam (MIT):
 * the parent must be `relative` and rounded; the mask keeps the beam on the 1px border only.
 * Used on exactly one element at a time: the proposal the watchdog is actively intercepting.
 */
export function BorderBeam({ color = "#B392FF", size = 140, duration = 7 }: { color?: string; size?: number; duration?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
    >
      <div
        className="absolute aspect-square animate-border-beam motion-safe-only"
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${color}, transparent)`,
          animationDuration: `${duration}s`,
        }}
      />
    </div>
  );
}
