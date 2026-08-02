import { Skeleton } from '@/components/ui/skeleton';

/**
 * Card geometry held at final size so nothing jumps when the preferences land.
 * Three cards, because the page always has exactly three (design/02 §J2).
 */
export default function NotificationsLoading() {
    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-[320px] w-full rounded-xl" />
            <Skeleton className="h-[280px] w-full rounded-xl" />
            <Skeleton className="h-[160px] w-full rounded-xl" />
        </div>
    );
}
