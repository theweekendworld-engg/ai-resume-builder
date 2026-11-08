import type { Metadata } from 'next';
import { AtsCheckerClient } from '@/components/marketing/score/AtsCheckerClient';

export const metadata: Metadata = {
    title: 'Free Resume ATS Score — Patronus',
    description:
        'Drop your resume (PDF or DOCX) and get an instant ATS and quality score with specific, prioritized fixes. Free, no sign-up.',
};

export default function ScorePage() {
    return (
        <section className="relative isolate overflow-hidden">
            {/* Background gradient orb, matching the marketing aesthetic */}
            <div
                className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.12),transparent_70%)] blur-2xl"
                aria-hidden
            />

            <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
                <div className="mb-10 text-center">
                    <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1 text-xs font-medium tracking-wide text-primary/90">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60" />
                        Free · No sign-up · Instant
                    </p>
                    <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
                        Is your resume{' '}
                        <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            ATS-ready?
                        </span>
                    </h1>
                    <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                        Drop your resume and get a score with specific, prioritized fixes in
                        seconds. No account needed.
                    </p>
                </div>

                <AtsCheckerClient />
            </div>
        </section>
    );
}
