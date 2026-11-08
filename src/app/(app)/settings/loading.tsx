import { Skeleton } from '@/components/ui/skeleton';

/**
 * The settings list's skeleton. Nested settings pages without their own
 * `loading.tsx` fall back to this one, which is close enough: a heading and
 * cards in a narrow column.
 */
export default function SettingsLoading() {
    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-8" aria-busy="true" aria-label="Loading settings">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="mt-6 h-[520px] rounded-xl" />
        </div>
    );
}
