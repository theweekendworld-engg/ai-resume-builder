/**
 * §K4 budgets this page at under 500ms, and the whole promise is "twenty
 * seconds". A spinner would be the wrong instrument: it says "wait", when what
 * we want to say is "this is already happening". So the skeleton holds the
 * exact geometry of the result — brand line, headline, title, button — and the
 * real content swaps in without anything moving.
 */
export default function MagicLinkLoading() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
            <div className="w-full max-w-md text-center" aria-busy="true" aria-live="polite">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Patronus</p>
                <div className="mx-auto mt-6 h-8 w-32 animate-pulse rounded bg-muted" />
                <div className="mx-auto mt-4 h-6 w-full animate-pulse rounded bg-muted" />
                <div className="mx-auto mt-2 h-6 w-3/4 animate-pulse rounded bg-muted" />
                <div className="mx-auto mt-8 h-11 w-[200px] animate-pulse rounded-lg bg-muted" />
                <span className="sr-only">Recording your answer…</span>
            </div>
        </main>
    );
}
