import { WinSensitivity } from '@prisma/client';

import type { PacketContent, PacketWin } from './types';

/**
 * The packet as paper.
 *
 * ── Why the browser makes this PDF, and not us ──────────────────────────────
 *
 * Resume PDFs in this codebase are produced by POSTing LaTeX to
 * `latex.ytotech.com`. That is fine for a resume, which the user is about to
 * publish anyway. It is not fine for a review packet: a packet can carry wins
 * marked `internal_only` and `confidential`, and shipping those to a third
 * party to be typeset would leak exactly the material the sensitivity model
 * exists to protect. There is no version of "export to PDF" worth a
 * confidential win leaving the building.
 *
 * So the PDF is the browser's. The user gets the print dialog, picks Save as
 * PDF, and the document never leaves their machine. No new dependency, no
 * server cost, no headless Chrome on a serverless function, and page size and
 * margins stay under their control — which matters, because half of these get
 * pasted into a form and half get printed for a room.
 *
 * ── What this component is not ──────────────────────────────────────────────
 *
 * It is not the editor with the chrome hidden. The editor is a working
 * surface: hover targets back to source Wins, ground chips, dotted underlines
 * on ungrounded sentences, inline edit affordances. None of that means
 * anything on paper, and the amber underline in particular would print as an
 * unexplained mark on a document going to a manager. This renders the same
 * content as `renderMarkdown` — the same visibility rules, the same order —
 * as a plain document.
 *
 * Confidential wins carry a 🔒 in the markdown export. Here they do not: the
 * marker exists so the person exporting can see what they are about to share,
 * and by the time it is on the manager's desk it is only a distraction. The
 * decision was already made at the confirm prompt.
 */
export function PacketPrintDocument({
    content,
    wins,
    includeConfidential,
}: {
    content: PacketContent;
    wins: readonly PacketWin[];
    includeConfidential: boolean;
}) {
    const winById = new Map(wins.map((win) => [win.id, win]));
    const hidden = new Set(includeConfidential ? [] : content.confidentialWinIds);
    const visible = (id: string) => !hidden.has(id);

    const header = content.header;
    const themes = content.themes.filter((theme) => theme.winIds.some(visible));

    const appendixWins = content.appendix.winIds
        .filter(visible)
        .map((id) => winById.get(id))
        .filter((win): win is PacketWin => win !== undefined)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    return (
        <article className="packet-print mx-auto w-full max-w-[68ch] px-6 py-10 text-foreground">
            <header className="mb-8">
                <h1 className="font-heading text-2xl font-semibold tracking-tight">
                    {[header.typeLabel, header.periodLabel, header.employerName]
                        .filter(Boolean)
                        .join(' · ')}
                </h1>
                {header.targetLevelName ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                        Target level: {header.targetLevelName}
                    </p>
                ) : null}
                {header.frameworkName ? (
                    <p className="mt-1 text-sm text-muted-foreground">{header.frameworkName}</p>
                ) : null}
            </header>

            {content.summary.text.trim() ? (
                <Section title="Summary">
                    <p className="whitespace-pre-line">{content.summary.text.trim()}</p>
                </Section>
            ) : null}

            {themes.length > 0 ? (
                <Section title="Highlights">
                    {themes.map((theme) => {
                        const bullets = theme.bullets.filter((bullet) =>
                            bullet.sourceWinIds.every(visible),
                        );
                        return (
                            // `break-inside-avoid` keeps a theme whole where it
                            // fits on one page. A heading stranded at the foot of
                            // a page with its evidence overleaf reads as an
                            // orphaned claim.
                            <div key={theme.title} className="mb-5 break-inside-avoid">
                                <h3 className="font-heading text-base font-semibold">{theme.title}</h3>
                                {theme.outcome.text.trim() ? (
                                    <p className="mt-1 whitespace-pre-line">{theme.outcome.text.trim()}</p>
                                ) : null}
                                {bullets.length > 0 ? (
                                    <ul className="mt-2 list-disc space-y-1 pl-5">
                                        {bullets.map((bullet, index) => (
                                            <li key={index}>{bullet.text}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                {theme.impact?.text.trim() ? (
                                    <p className="mt-2 text-sm">
                                        <span className="font-semibold">Scope:</span>{' '}
                                        {theme.impact.text.trim()}
                                    </p>
                                ) : null}
                            </div>
                        );
                    })}
                </Section>
            ) : null}

            {content.coherenceNote ? (
                <p className="my-6 border-l-2 border-border pl-4 text-sm italic text-muted-foreground">
                    {content.coherenceNote}
                </p>
            ) : null}

            {content.competencies.length > 0 ? (
                <Section title="By competency">
                    <ul className="space-y-2">
                        {content.competencies.map((item) => (
                            <li key={item.name} className="break-inside-avoid">
                                <span className="font-semibold">{item.name}</span> — {item.verdict}.{' '}
                                {item.rationale}
                            </li>
                        ))}
                    </ul>
                </Section>
            ) : null}

            {content.growth.text.trim() ? (
                <Section title="Growth &amp; what's next">
                    <p className="whitespace-pre-line">{content.growth.text.trim()}</p>
                </Section>
            ) : null}

            {appendixWins.length > 0 ? (
                // The appendix is the receipts. It starts its own page so the
                // narrative reads as a document and the evidence reads as an
                // attachment to it.
                <section className="mt-8 break-before-page">
                    <h2 className="font-heading mb-3 text-lg font-semibold">
                        Appendix — full win list
                    </h2>
                    {content.appendix.note ? (
                        <p className="mb-3 text-sm italic text-muted-foreground">
                            {content.appendix.note}
                        </p>
                    ) : null}
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                        {appendixWins.map((win) => {
                            const trail = [win.metric, win.evidenceLabel, shortDate(win.occurredAt)]
                                .filter(Boolean)
                                .join(' · ');
                            return (
                                <li key={win.id} className="break-inside-avoid">
                                    {win.title}
                                    {trail ? ` — ${trail}` : ''}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ) : null}

            {/* Stated on the page rather than only in the export dialog. Whoever
                is holding this should be able to tell whether they are looking
                at the whole record or a redacted one. */}
            {!includeConfidential && content.confidentialWinIds.length > 0 ? (
                <p className="mt-8 border-t border-border pt-3 text-xs text-muted-foreground">
                    {content.confidentialWinIds.length} confidential{' '}
                    {content.confidentialWinIds.length === 1 ? 'win is' : 'wins are'} omitted from
                    this copy.
                </p>
            ) : null}
        </article>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mb-7">
            <h2 className="font-heading mb-2 text-lg font-semibold">{title}</h2>
            {children}
        </section>
    );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(value: Date): string {
    return `${MONTHS[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}

/** Re-exported so the page can keep the confidential default in one place. */
export function isConfidential(win: PacketWin): boolean {
    return win.sensitivity === WinSensitivity.confidential;
}
