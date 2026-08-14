import Link from 'next/link';
import { ArrowUpRight, Compass, Info, Lock, TrendingUp } from 'lucide-react';
import type { RadarBand, RadarMatch, RadarSkill, RadarView } from '@/actions/radar';

/**
 * Career Radar (PRD 04 §2).
 *
 * Four panels, and one rule that outranks any layout decision: a number never
 * appears without the evidence behind it. `n`, the window and the geography
 * sit next to every band, because the product's whole claim is that its
 * figures can be checked.
 *
 * The panels are equally willing to say nothing. A suppressed band with an
 * honest reason is a better screen than a confident number from four postings,
 * and the empty states here are written as information rather than apology.
 */

function money(amount: number, currency: string | null): string {
    const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
    const value = amount >= 1000 ? `${Math.round(amount / 1000)}k` : String(amount);
    return symbol ? `${symbol}${value}` : `${value} ${currency ?? ''}`.trim();
}

function prettyGeo(bucket: string | null): string {
    if (!bucket) return 'location not set';
    return bucket
        .replace(/^multi_/, 'multiple sites · ')
        .replace(/^remote_/, 'remote · ')
        .replace(/_/g, ' ');
}

/**
 * Skill slugs are lowercase, and CSS `capitalize` renders "llm" as "Llm" and
 * "sql" as "Sql". Acronyms need their real casing — a market chart that
 * misspells the technology it is charting is not credible.
 */
const SKILL_LABELS: Record<string, string> = {
    llm: 'LLM',
    sql: 'SQL',
    rag: 'RAG',
    aws: 'AWS',
    gcp: 'GCP',
    ci_cd: 'CI/CD',
    grpc: 'gRPC',
    graphql: 'GraphQL',
    seo: 'SEO',
    csharp: 'C#',
    cpp: 'C++',
    r_lang: 'R',
    c_lang: 'C',
    nextjs: 'Next.js',
    dbt: 'dbt',
    ml: 'ML',
};

function prettySkill(slug: string): string {
    if (SKILL_LABELS[slug]) return SKILL_LABELS[slug];
    return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyLevel(level: string): string {
    if (level === 'unlevelled') return 'level not stated';
    if (level === 'staff_plus') return 'staff+';
    if (level === 'director_plus') return 'director+';
    return level;
}

/* ────────────────────────────────────────────────────────── market band */

function BandPanel({ band, cell }: { band: RadarBand; cell: string }) {
    return (
        <section className="surface-work rounded-xl border p-5">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-sm font-semibold">What this role pays</h2>
                <span className="text-xs text-muted-foreground">{cell}</span>
            </div>

            {band.ok ? (
                <>
                    <p className="mt-4 font-heading text-3xl font-semibold tabular-nums">
                        {money(band.band.low, band.band.currency)}
                        <span className="mx-2 text-muted-foreground">–</span>
                        {money(band.band.high, band.band.currency)}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Typically {money(band.band.median, band.band.currency)}
                    </p>

                    {/* Provenance is not a footnote here — it is the reason to believe the number. */}
                    <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                        {band.provenance}
                        {band.band.droppedForCurrency > 0
                            ? ` ${band.band.droppedForCurrency} range${band.band.droppedForCurrency === 1 ? '' : 's'} in another currency were left out rather than converted.`
                            : ''}
                    </p>
                </>
            ) : (
                <div className="mt-4">
                    <p className="text-sm font-medium">Not enough public data yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {band.refusal.reason === 'insufficient_data'
                            ? `We found ${band.refusal.n} disclosed range${band.refusal.n === 1 ? '' : 's'} for this role and location. We show a band at ${band.refusal.needed} or more, because fewer than that is one company's opinion rather than a market.`
                            : band.refusal.reason === 'currency_split'
                              ? `We found ${band.refusal.n} ranges, but no single currency reached ${band.refusal.needed}. We never convert between currencies, so these cannot be pooled.`
                              : 'No disclosed ranges match this role and location yet.'}
                    </p>
                </div>
            )}
        </section>
    );
}

/* ─────────────────────────────────────────────────────── matched roles */

function MatchesPanel({ matches, locked }: { matches: RadarMatch[]; locked: boolean }) {
    return (
        <section className="surface-work rounded-xl border p-5">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-sm font-semibold">Roles you&rsquo;d likely win</h2>
                <span className="text-xs text-muted-foreground">
                    {matches.length > 0 ? `${matches.length} of the last 30 days` : 'none right now'}
                </span>
            </div>

            {matches.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                    Nothing worth showing you this month. We only surface roles that match what your
                    log actually evidences, and an empty list is a real answer.
                </p>
            ) : (
                <ul className="mt-4 space-y-3">
                    {matches.map((match) => (
                        <li key={match.url} className="border-t pt-3 first:border-t-0 first:pt-0">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <a
                                        href={match.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="group inline-flex items-baseline gap-1 text-sm font-medium hover:underline"
                                    >
                                        <span className="truncate">{match.title}</span>
                                        <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    </a>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        {match.companyName} · {match.ageDays === 0 ? 'today' : `${match.ageDays}d ago`}
                                        {match.compLow && match.compHigh
                                            ? ` · ${money(match.compLow, match.currency)}–${money(match.compHigh, match.currency)}`
                                            : ''}
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                                    {match.fitScore}
                                </span>
                            </div>

                            {/* Why this one. A match without a reason is a guess. */}
                            {match.matched.length > 0 ? (
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    Matches your evidence for{' '}
                                    <span className="text-foreground">
                                        {match.matched.slice(0, 4).map(prettySkill).join(', ')}
                                    </span>
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}

            {locked ? (
                <p className="mt-4 flex items-start gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    Refreshed monthly on your plan. Search refreshes on demand.
                </p>
            ) : null}
        </section>
    );
}

/* ──────────────────────────────────────────────────── skill economics */

function SkillsPanel({ skills, geo }: { skills: RadarSkill[]; geo: string }) {
    return (
        <section className="surface-work rounded-xl border p-5">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-sm font-semibold">What&rsquo;s being asked for</h2>
                <span className="text-xs text-muted-foreground">{geo} · last 90 days</span>
            </div>

            {skills.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                    We haven&rsquo;t collected enough postings for your area yet.
                </p>
            ) : (
                <table className="mt-4 w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                            <th className="pb-2 font-normal">Skill</th>
                            <th className="pb-2 text-right font-normal">Postings</th>
                            <th className="pb-2 text-right font-normal">Typical pay</th>
                            <th className="pb-2 text-right font-normal">Trend</th>
                        </tr>
                    </thead>
                    <tbody>
                        {skills.map((s) => (
                            <tr key={s.skill} className="border-t">
                                <td className="py-2">{prettySkill(s.skill)}</td>
                                <td className="py-2 text-right tabular-nums text-muted-foreground">
                                    {s.postingCount}
                                </td>
                                <td className="py-2 text-right tabular-nums text-muted-foreground">
                                    {s.medianLow && s.medianHigh
                                        ? `${money(s.medianLow, s.currency)}–${money(s.medianHigh, s.currency)}`
                                        : '—'}
                                </td>
                                <td className="py-2 text-right tabular-nums text-muted-foreground">
                                    {/*
                                     * A trend needs two observations a month apart. Until then
                                     * this is a dash, not a zero and not an arrow — we do not
                                     * know the direction, and saying so is the honest cell.
                                     */}
                                    {s.trendPercent === null
                                        ? '—'
                                        : `${s.trendPercent > 0 ? '+' : ''}${s.trendPercent}%`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Counts are postings that named the skill. A trend appears once we have measured the
                same market twice, about a month apart.
            </p>
        </section>
    );
}

/* ───────────────────────────────────────────────────────── your position */

function PositionPanel({ view }: { view: RadarView }) {
    const thin = view.winCount < 8;

    return (
        <section className="surface-work rounded-xl border p-5">
            <h2 className="font-heading text-sm font-semibold">Where you stand</h2>

            <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">We read your role as</dt>
                    <dd className="text-right">
                        {view.profile.family === 'unknown'
                            ? 'not set'
                            : view.profile.family.replace(/_/g, ' ')}
                        <span className="text-muted-foreground"> · {prettyLevel(view.profile.seniority)}</span>
                    </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Market</dt>
                    <dd className="text-right">{prettyGeo(view.profile.geoBucket)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Evidence behind your matches</dt>
                    <dd className="text-right tabular-nums">
                        {view.winCount} confirmed win{view.winCount === 1 ? '' : 's'}
                    </dd>
                </div>
            </dl>

            {thin ? (
                <p className="mt-4 flex items-start gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    Matching reads your confirmed wins. With {view.winCount}, these results lean on
                    your profile more than your record —{' '}
                    <Link href="/log" className="underline">
                        confirm a few more
                    </Link>{' '}
                    and they sharpen.
                </p>
            ) : null}

            {view.profile.family === 'unknown' || !view.profile.geoBucket ? (
                <p className="mt-3 text-xs text-muted-foreground">
                    Set your title and location in{' '}
                    <Link href="/account" className="underline">
                        your profile
                    </Link>{' '}
                    so we can place you in the right market.
                </p>
            ) : null}
        </section>
    );
}

/* ──────────────────────────────────────────────────────────────── screen */

export function RadarScreen({ view }: { view: RadarView }) {
    const cell = `${prettyLevel(view.profile.seniority)} · ${prettyGeo(view.profile.geoBucket)}`;

    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
            <header className="mb-6">
                <div className="flex items-center gap-2">
                    <Compass className="h-4 w-4 text-primary" aria-hidden />
                    <h1 className="font-heading text-2xl font-semibold tracking-tight">Career Radar</h1>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                    Where you stand in the market, from public job postings.
                    {view.postingsAsOf
                        ? ` Postings last collected ${view.postingsAsOf.toISOString().slice(0, 10)}.`
                        : ''}
                </p>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
                <BandPanel band={view.band} cell={cell} />
                <PositionPanel view={view} />
                <MatchesPanel matches={view.matches} locked={view.locked} />
                <SkillsPanel skills={view.skills} geo={prettyGeo(view.profile.geoBucket)} />
            </div>

            <p className="mt-6 flex items-start gap-1.5 text-xs text-muted-foreground">
                <TrendingUp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Every figure here is arithmetic over ranges employers published themselves. Nothing
                on this screen is estimated by a model.
            </p>
        </div>
    );
}
