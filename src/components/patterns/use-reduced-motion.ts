'use client';

import * as React from 'react';

/**
 * §7.3 — `prefers-reduced-motion: reduce`.
 *
 * The rule is *not* "turn animation off". Transforms and height animations go
 * to 0ms; opacity crossfades stay at 100ms. The confirm becomes flash-then-
 * remove. We never remove the feedback, only the movement.
 *
 * Returns `false` on the server and on the first client render so markup
 * matches; the effect corrects it before any animation can run.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Movement duration: collapses to 0 under reduced motion. */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/** Crossfade duration: clamped to 100ms under reduced motion, never to 0. */
export function fadeDuration(ms: number, reduced: boolean): number {
  return reduced ? Math.min(ms, 100) : ms;
}
