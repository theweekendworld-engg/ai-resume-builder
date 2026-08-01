'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/** §5.4 — three density tokens, applied per surface. */
export type Density = 'compact' | 'default' | 'relaxed';

const DensityContext = React.createContext<Density>('default');

/**
 * Reads the ambient density, with an optional per-component override.
 *
 * Components take a `density` prop *and* consult the context so a surface can
 * set density once (`<DensityProvider density="compact">` around a review
 * queue) without every child threading the prop.
 */
export function useDensity(override?: Density): Density {
  const ambient = React.useContext(DensityContext);
  return override ?? ambient;
}

export interface DensityProviderProps {
  density: Density;
  children: React.ReactNode;
  className?: string;
  /** Render no wrapper element — context only. */
  asChild?: boolean;
}

/**
 * Provides density to descendants and applies the matching global utility
 * class (`density-compact` / `density-default` / `density-relaxed`) from
 * `globals.css`, so CSS-level rules and component-level padding agree.
 */
export function DensityProvider({
  density,
  children,
  className,
  asChild = false,
}: DensityProviderProps) {
  if (asChild) {
    return <DensityContext.Provider value={density}>{children}</DensityContext.Provider>;
  }
  return (
    <DensityContext.Provider value={density}>
      <div className={cn(`density-${density}`, className)}>{children}</div>
    </DensityContext.Provider>
  );
}

/**
 * Row padding per §5.4. Pixel values from the doc, translated to the 4px scale:
 * compact `py-8 px-12` -> `py-2 px-3`; default `py-12 px-16` -> `py-3 px-4`;
 * relaxed `py-20 px-24` -> `py-5 px-6`.
 */
export const densityPadding: Record<Density, string> = {
  compact: 'py-2 px-3',
  default: 'py-3 px-4',
  relaxed: 'py-5 px-6',
};

/** Minimum row height per §5.4. Relaxed is intentionally auto. */
export const densityRowMinHeight: Record<Density, string> = {
  compact: 'min-h-12',
  default: 'min-h-14',
  relaxed: 'min-h-0',
};

/** Vertical gap between rows in a list at each density. */
export const densityRowGap: Record<Density, string> = {
  compact: 'gap-0',
  default: 'gap-1',
  relaxed: 'gap-2',
};
