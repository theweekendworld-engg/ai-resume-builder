'use client';

import * as React from 'react';

/**
 * Enter-on-scroll, as one component.
 *
 * ── Why not a motion library ────────────────────────────────────────────────
 *
 * The obvious implementation is framer-motion's `whileInView`, which is what
 * most pages with this feel are built on. It is ~34kB gzipped of runtime
 * shipped to a logged-out visitor so that some divs can fade upward — on the
 * one page in the product where time-to-interactive is the conversion metric.
 *
 * The whole behaviour is an IntersectionObserver adding a class. The transition
 * itself belongs in CSS (`[data-reveal]` in (marketing)/marketing.css) where the compositor
 * runs it off the main thread, so the JS here only has to decide *when*.
 *
 * ── The details that matter ─────────────────────────────────────────────────
 *
 * - `once`: the observer disconnects on first intersection. Re-animating on
 *   scroll-up is a novelty the second time and an irritation the fifth.
 * - `rootMargin` pulls the trigger line 10% up from the bottom edge, so an
 *   element starts moving just after it enters rather than exactly at the fold.
 *   Triggering at the boundary looks like the page is lagging behind you.
 * - Reduced motion is handled in CSS, but the class is still applied here so
 *   that `.is-in` is the single "revealed" state either way.
 * - The observer is created in a layout effect and elements already on screen
 *   at mount reveal on the first callback, which fires synchronously-ish —
 *   above-the-fold content does not wait a frame to appear.
 */

type RevealDirection = 'up' | 'left' | 'right' | 'scale';

export function Reveal({
    children,
    className,
    delay = 0,
    direction = 'up',
    as: Tag = 'div',
    ...rest
}: {
    children: React.ReactNode;
    className?: string;
    /** Stagger, in ms. The reference page uses index * 100. */
    delay?: number;
    direction?: RevealDirection;
    as?: 'div' | 'li' | 'section' | 'article' | 'p' | 'span';
} & React.HTMLAttributes<HTMLElement>) {
    const ref = React.useRef<HTMLElement | null>(null);

    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // No observer (old browser, jsdom) means the content must still be
        // visible. Failing open is the only acceptable direction here.
        if (typeof IntersectionObserver === 'undefined') {
            el.classList.add('is-in');
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    entry.target.classList.add('is-in');
                    observer.disconnect();
                }
            },
            /*
              `threshold: 0` — fire as soon as any part of the element crosses
              the line. The previous 0.12 required 12% of the element's AREA to
              be visible, which for anything approaching viewport height meant
              the reveal fired well after the element was plainly on screen: the
              hero's resume card sat blank in the middle of the fold, reading as
              a rendering failure rather than as an animation waiting its turn.
              A tall element cannot be 12% visible until it is already a
              problem.

              The bottom inset does the "just after it enters" work instead, and
              in pixels rather than a percentage so it behaves the same on a
              phone and a monitor.
            */
            { threshold: 0, rootMargin: '0px 0px -80px 0px' },
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <Tag
            // @ts-expect-error — one ref across a small union of intrinsic tags.
            ref={ref}
            data-reveal={direction}
            className={className}
            style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}
            {...rest}
        >
            {children}
        </Tag>
    );
}
