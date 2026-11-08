import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The Patronus mark outside the app: a serif "P" on an ink tab, then the name in the
 * display serif. The same monogram the app sidebar draws, so the mark a
 * visitor sees on the landing page, the sign-in card and the app is one mark.
 *
 * It replaced `/logo.png` here (2026-11-08): a 550KB raster with a glow and a
 * grey canvas baked into it, which sat on paper as a dark tile in a grey box
 * and was the heaviest request on the page. Live text renders crisply at every
 * size and costs nothing.
 */
export function Wordmark({
    href = '/',
    size = 'md',
    onClick,
    className,
}: {
    href?: string;
    size?: 'md' | 'lg';
    onClick?: () => void;
    className?: string;
}) {
    const large = size === 'lg';
    return (
        <Link
            href={href}
            onClick={onClick}
            aria-label="Patronus home"
            className={cn('inline-flex items-center gap-2.5 rounded-md text-foreground', className)}
        >
            <span
                aria-hidden
                className={cn(
                    // Ink, not teal: the mark is not an action, and teal is kept for actions.
                    'grid shrink-0 place-items-center rounded-md bg-foreground font-display font-semibold leading-none text-background',
                    large ? 'size-9 text-[19px]' : 'size-8 text-[17px]',
                )}
            >
                P
            </span>
            <span className={cn('font-display font-semibold tracking-[-0.01em]', large ? 'text-xl' : 'text-[17px]')}>
                Patronus
            </span>
        </Link>
    );
}
