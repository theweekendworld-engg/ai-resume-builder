/**
 * Design token bridges for the pattern library.
 *
 * These are class-name constants, not new CSS. They translate the roles named
 * in `docs/design/00-foundations.md` (§4 type, §5 space, §7 motion) into the
 * Tailwind utilities that express them, so twelve components cannot drift into
 * twelve slightly different definitions of "caption".
 *
 * Note on units: the design doc writes raw pixels (`py-12 px-16`). Tailwind's
 * scale is 4px-based, so those become `py-3 px-4`. The pixel value from the
 * doc is quoted in a comment wherever the mapping is not obvious.
 */

/** §4.1 — two families, nine roles. */
export const typeStyles = {
  /** 30 / 38 · Sora 600 */
  display: 'font-heading text-[30px] leading-[38px] font-semibold',
  /** 22 / 30 · Sora 600 */
  h1: 'font-heading text-[22px] leading-[30px] font-semibold',
  /** 17 / 24 · Sora 600 */
  h2: 'font-heading text-[17px] leading-6 font-semibold',
  /** 15 / 22 · Sora 500 */
  h3: 'font-heading text-[15px] leading-[22px] font-medium',
  /** 14 / 22 · Inter 400 — app default */
  body: 'text-sm leading-[22px]',
  /** 16 / 26 · Inter 400 — long-form reading surfaces only */
  bodyRead: 'text-base leading-[26px]',
  /** 13 / 18 · Inter 400 */
  small: 'text-[13px] leading-[18px]',
  /** 12 / 16 · Inter 500 · +0.01em */
  caption: 'text-xs leading-4 font-medium tracking-[0.01em]',
  /** 13 / 20 · ui-monospace */
  mono: 'font-mono text-[13px] leading-5',
} as const;

/**
 * §9 — the focus ring, identical on every custom interactive element so that
 * keyboard users get one visual language rather than a per-component lottery.
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Focus indicator for elements that ALSO carry `.surface-work`.
 *
 * `.surface-work` sets `box-shadow: none` outside any cascade layer, so it
 * beats the utilities layer — which is the point, since it exists to strip
 * marketing shadow and glow. Tailwind's ring is implemented as a box-shadow,
 * so a ring on such an element is silently erased. Outline is a separate
 * property, is unaffected, and renders identically at these values.
 *
 * Use `focusRing` everywhere else.
 */
export const focusRingOutline =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The same indicator, always on — for a forced or virtually-focused row. */
export const focusRingOutlineStatic = 'outline-2 outline-offset-2 outline-ring';

/**
 * §7.1 — motion durations, in milliseconds. Exported as numbers because the
 * confirm sequence (§7.2) is orchestrated in JS, not by a keyframe.
 */
export const duration = {
  /** Hover, focus, chip toggle. */
  micro: 120,
  /** Confirm, expand, row collapse. */
  state: 180,
  /** Drawer, sheet, dialog. */
  enter: 220,
  /** Always faster than enter. */
  exit: 160,
  /** Generation progress shimmer only. */
  ambient: 1600,
} as const;

export const easing = {
  micro: 'cubic-bezier(0, 0, 0.2, 1)',
  state: 'cubic-bezier(.2,0,0,1)',
  exit: 'cubic-bezier(.4,0,1,1)',
} as const;

/**
 * Expands a small control to the 44x44 touch target required by
 * `01-components.md` §1 without inflating its visual box. The pseudo-element
 * is centred on the control and carries the hit area.
 */
export const touchTarget =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";
