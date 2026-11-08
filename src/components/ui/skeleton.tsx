import { cn } from '@/lib/utils';

/**
 * A loading placeholder at the final geometry, so nothing shifts when the
 * content lands. Warm paper grey, a slow pulse that the reduced-motion rule
 * in globals.css stops.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-secondary', className)} />;
}
