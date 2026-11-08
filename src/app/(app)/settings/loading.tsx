import { Skeleton } from '@/components/ui/skeleton';
import { pageContainer } from '@/components/patterns';
import { cn } from '@/lib/utils';

/**
 * The settings list's skeleton, at the Dossier page geometry: eyebrow, serif
 * title and description over a hairline, then a ruled list. Nested settings
 * pages without their own `loading.tsx` fall back to this one, which is close
 * enough: a header and a narrow column.
 */
export default function SettingsLoading() {
    return (
        <div aria-busy="true" aria-label="Loading settings">
            <div className="border-b border-border pb-6">
                <div className={cn(pageContainer, 'pt-7 md:pt-10')}>
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-2.5 h-8 w-48" />
                    <Skeleton className="mt-2.5 h-4 w-96 max-w-full" />
                </div>
            </div>
            <div className={cn(pageContainer, 'max-w-3xl py-6')}>
                <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="flex items-center gap-4 px-5 py-4">
                            <Skeleton className="size-9" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-40" />
                                <Skeleton className="h-3.5 w-4/5" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
