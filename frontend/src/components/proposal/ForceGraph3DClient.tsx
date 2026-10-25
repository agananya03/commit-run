"use client";

import ForceGraph3D from "react-force-graph-3d";
import type { ComponentProps, MutableRefObject } from "react";

/**
 * Loaded with next/dynamic (WebGL, browser only). next/dynamic does not forward refs, so the graph's imperative
 * API (camera, controls, screen coordinates) comes back through `graphRef` instead.
 */
export default function ForceGraph3DClient({ graphRef, ...props }: ComponentProps<typeof ForceGraph3D> & { graphRef: MutableRefObject<unknown> }) {
  return <ForceGraph3D ref={graphRef as never} {...props} />;
}
