import { Skeleton } from '@/components/ui/skeleton';
import { pageContainer } from '@/components/patterns';
import { cn } from '@/lib/utils';

/**
 * Home's skeleton, at the final geometry (eyebrow, display greeting, status
 * line, the ruled pipeline strip, then the two columns of ruled sections).
 * Without it a click on "Home" in the sidebar did nothing visible until the
 * server answered (UI audit 2026-11-07, loading feedback).
 */
export default function OverviewLoading() {
    return (
        <div aria-busy="true" aria-label="Loading Home">
            <div className="border-b border-border pb-6">
                <div className={cn(pageContainer, 'pt-7 md:pt-10')}>
                    <Skeleton className="h-3 w-44" />
                    <Skeleton className="mt-2.5 h-9 w-72 max-w-full" />
                    <Skeleton className="mt-2.5 h-4 w-96 max-w-full" />
                </div>
            </div>
            <div className={cn(pageContainer, 'space-y-8 py-6')}>
                <Skeleton className="h-12 rounded-lg" />
                <div className="grid grid-cols-2 border-y border-border sm:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className={cn('px-5 py-4', i > 0 && 'border-l border-border')}>
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="mt-2.5 h-7 w-10" />
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-3">
                    <div className="space-y-8 lg:col-span-2">
                        {[3, 4].map((rows, s) => (
                            <div key={s} className="border-t border-border pt-5">
                                <Skeleton className="h-3 w-24" />
                                <div className="mt-4 space-y-4">
                                    {Array.from({ length: rows }, (_, i) => (
                                        <Skeleton key={i} className="h-10" />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="space-y-8">
                        {[2, 3].map((rows, s) => (
                            <div key={s} className="border-t border-border pt-5">
                                <Skeleton className="h-3 w-20" />
                                <div className="mt-4 space-y-3">
                                    {Array.from({ length: rows }, (_, i) => (
                                        <Skeleton key={i} className="h-8" />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
