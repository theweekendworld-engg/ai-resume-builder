import type { Metadata } from 'next';
import { AtsCheckerClient } from '@/components/marketing/score/AtsCheckerClient';

export const metadata: Metadata = {
    title: 'Free Resume ATS Score — Patronus',
    description:
        'Drop your resume (PDF or DOCX) and get an instant ATS and quality score with specific, prioritized fixes. Free, no sign-up.',
};

export default function ScorePage() {
    return (
        <section className="border-b border-border">
            <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
                <div className="mb-10 text-center">
                    {/* The kicker, same as every section of the landing page. */}
                    <p className="mk-pill">Free · No sign-up · Instant</p>
                    <h1 className="mk-display mk-h2 mt-5">
                        Is your resume <span className="mk-quiet">ATS-ready?</span>
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
