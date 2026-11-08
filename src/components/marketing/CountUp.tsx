'use client';

import * as React from 'react';

/**
 * A number that counts up when it scrolls into view.
 *
 * ── Why this is worth a component ───────────────────────────────────────────
 *
 * It is the most visible piece of motion on a page of this shape. Blurred
 * blobs drifting at 18-second periods register subconsciously at best; a
 * figure ticking from 0 to 100 is unmistakably alive, and it lands exactly
 * where the reader's eye already is. The reference page drives four of them
 * off framer-motion's `animate()` + `useInView`.
 *
 * We do it with `requestAnimationFrame`, for the same reason `Reveal` uses an
 * IntersectionObserver instead of `whileInView`: this is the only thing on the
 * page that needs it, and it is about twenty lines.
 *
 * ── The details ─────────────────────────────────────────────────────────────
 *
 * - `easeOutCubic`. A linear count arrives at its target at full speed and
 *   stops dead, which reads as a glitch. Decelerating into the final value is
 *   what makes it feel like it settled there.
 * - The final frame assigns `to` exactly rather than the eased value, because
 *   floating-point easing lands on 99.99999 and `Math.round` hiding that is a
 *   coincidence, not a guarantee.
 * - `decimals` is explicit rather than inferred from the target, so 4.0 can
 *   render as "4.0" instead of "4".
 * - SSR and the pre-reveal state render the FINAL value, not zero. A crawler,
 *   a reader with JS off, and anyone who never scrolls this far all see the
 *   real number. Motion is decoration here; the figure is the content.
 * - Reduced motion skips straight to the value. The observer still runs so the
 *   code path is identical either way.
 * - `tabular-nums` via `.num`, or the row of figures visibly shifts width as
 *   digits change — the whole band jitters while it counts.
 */
export function CountUp({
    to,
    prefix = '',
    suffix = '',
    decimals = 0,
    durationMs = 1800,
    className,
}: {
    to: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    durationMs?: number;
    className?: string;
}) {
    const ref = React.useRef<HTMLSpanElement | null>(null);
    const [value, setValue] = React.useState<number | null>(null);

    React.useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const settle = () => setValue(to);

        if (
            typeof IntersectionObserver === 'undefined' ||
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
            settle();
            return;
        }

        let frame = 0;
        let start: number | null = null;

        const tick = (now: number) => {
            if (start === null) start = now;
            const t = Math.min(1, (now - start) / durationMs);
            // easeOutCubic
            const eased = 1 - Math.pow(1 - t, 3);
            if (t >= 1) {
                setValue(to);
                return;
            }
            setValue(to * eased);
            frame = requestAnimationFrame(tick);
        };

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    observer.disconnect();
                    setValue(0);
                    frame = requestAnimationFrame(tick);
                }
            },
            { threshold: 0, rootMargin: '0px 0px -60px 0px' },
        );

        observer.observe(el);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [to, durationMs]);

    const shown = (value ?? to).toFixed(decimals);

    return (
        <span ref={ref} className={className}>
            {prefix}
            {shown}
            {suffix}
        </span>
    );
}
