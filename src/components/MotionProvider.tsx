"use client";

import { LazyMotion, domAnimation } from "framer-motion";

/**
 * Loads framer-motion's animation runtime asynchronously and shares it across
 * every `m.*`/`AnimatePresence` usage in the app (U4). Mounted once in the root
 * layout so no route pays for the full framer-motion bundle in its first-paint
 * JS — only the `domAnimation` feature set (opacity/transform/layout, no
 * drag/3D) is fetched, and only after first paint.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}
