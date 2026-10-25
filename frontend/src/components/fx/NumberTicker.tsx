"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, useReducedMotion, useSpring } from "framer-motion";

/** Counts up to `value` with a short spring; jumps straight there when the viewer prefers reduced motion. */
export function NumberTicker({ value, format = (v) => Math.round(v).toLocaleString("en-US"), className }: { value: number; format?: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const target = useMotionValue(0);
  const spring = useSpring(target, { damping: 38, stiffness: 120 });

  useEffect(() => {
    if (reduce && ref.current) ref.current.textContent = format(value);
    else target.set(value);
  }, [value, reduce, target, format]);

  useEffect(
    () =>
      spring.on("change", (v) => {
        if (ref.current) ref.current.textContent = format(v);
      }),
    [spring, format],
  );

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {format(reduce ? value : 0)}
    </span>
  );
}
