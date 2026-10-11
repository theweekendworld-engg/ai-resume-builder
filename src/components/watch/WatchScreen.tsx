'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Building2, Check, ExternalLink, Play, Search, Telescope, Trash2, UserRound, X } from 'lucide-react';

import { addWatch, passOnMatch, removeWatch, runWatchNow, trackWatchMatch, type MatchView, type WatchedCompanyView } from '@/actions/jobWatch';
import { startScout } from '@/actions/scout';
import { EmptyState, InitialAvatar, PageBody, PageHeader, PageTabs, Pill } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type WatchTab = 'matches' | 'held' | 'companies';

type Prefs = { targetRoles: string[]; targetLocations: string[]; preferredWorkModes: string[] };

const PROVIDER_LABEL: Record<string, string> = {
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    ashby: 'Ashby',
    smartrecruiters: 'SmartRecruiters',
};

/**
 * The job watch (docs/prd/12-job-watch.md): what cleared the bar, what was
 * held back and why, and the companies being watched.
 *
 * "Held back" is shown on purpose. A filter you cannot inspect is a filter you
 * cannot trust; seeing "Scored 82, below your 85" or "Needs your location" is
 * what makes an empty morning believable.
 */
export function WatchScreen({
    tab,
    companies,
    matches,
    held,
    prefs,
}: {
    tab: WatchTab;
    companies: WatchedCompanyView[];
    matches: MatchView[];
    held: MatchView[];
    prefs: Prefs;
}) {
    const router = useRouter();
    const [running, startRun] = React.useTransition();

    const runNow = () =>
        startRun(async () => {
            const result = await runWatchNow();
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(result.data.queued ? 'Checking your companies now. New matches appear here in a few minutes.' : 'A check is already running.');
        });

    return (
        <>
            <PageHeader
                title="Job watch"
                description="New openings at the companies you name, scored against your record each night. Only 85+ matches are sent."
                actions={
                    <Button variant="outline" size="sm" onClick={runNow} disabled={running || (companies.length === 0 && prefs.targetRoles.length === 0)}>
                        <Play className="size-4" aria-hidden />
                        Check now
                    </Button>
                }
            >
                <PageTabs
                    label="Job watch views"
                    active={tab}
                    tabs={[
                        { key: 'matches', label: 'Matches', href: '/watch', count: matches.length },
                        { key: 'held', label: 'Held back', href: '/watch?tab=held' },
                        { key: 'companies', label: 'Companies', href: '/watch?tab=companies', count: companies.length },
                    ]}
                />
            </PageHeader>
            <PageBody className="space-y-6">
                <PreferencesNotice prefs={prefs} />
                {tab === 'matches' ? <Matches matches={matches} hasCompanies={companies.length > 0} onChanged={() => router.refresh()} /> : null}
                {tab === 'held' ? <Held held={held} /> : null}
                {tab === 'companies' ? <Companies companies={companies} onChanged={() => router.refresh()} /> : null}
            </PageBody>
        </>
    );
}

/** The gate holds anything that needs an unstated preference; say so up front. */
function PreferencesNotice({ prefs }: { prefs: Prefs }) {
    const missing = [
        prefs.targetRoles.length === 0 ? 'the roles you want' : null,
        prefs.targetLocations.length === 0 ? 'where you want to work' : null,
    ].filter(Boolean);
    if (missing.length === 0) return null;
    return (
        <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm">
            <span className="font-medium text-foreground">Tell Patronus {missing.join(' and ')}.</span>{' '}
            <span className="text-muted-foreground">
                Without {missing.length === 1 ? 'it' : 'them'}, a job whose fit depends on {missing.length === 1 ? 'it' : 'them'} is held back rather than sent.
            </span>{' '}
            <Link href="/settings/job-search" className="font-medium text-foreground underline underline-offset-4">
                Set preferences
            </Link>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────── matches */

function Matches({ matches, hasCompanies, onChanged }: { matches: MatchView[]; hasCompanies: boolean; onChanged: () => void }) {
    if (matches.length === 0) {
        return (
            <EmptyState
                icon={Telescope}
                title="No 85+ matches yet"
                description={
                    hasCompanies
                        ? 'Nothing new has cleared the bar. Each night the companies you watch are checked again; anything that does gets a message in the morning.'
                        : 'Add the companies you are aiming for. Their new openings are checked every night.'
                }
                action={hasCompanies ? undefined : { label: 'Add companies', href: '/watch?tab=companies' }}
            />
        );
    }
    return (
        <ul className="space-y-3">
            {matches.map((match) => <MatchCard key={match.id} match={match} onChanged={onChanged} />)}
        </ul>
    );
}

function MatchCard({ match, onChanged }: { match: MatchView; onChanged: () => void }) {
    const router = useRouter();
    const [pending, start] = React.useTransition();

    const analyse = () =>
        start(async () => {
            // A full Scout run: company research, people, and outreach drafts.
            const result = await startScout({ message: match.url });
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            router.push(`/scout/${result.data.run.id}`);
        });
    const trackIt = () =>
        start(async () => {
            const result = await trackWatchMatch(match.id);
            if (!result.success) toast.error(result.error);
            else {
                toast.success('Added to your jobs.');
                onChanged();
            }
        });
    const pass = () =>
        start(async () => {
            const result = await passOnMatch(match.id);
            if (!result.success) toast.error(result.error);
            else onChanged();
        });

    const people = match.people;
    return (
        <li className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start gap-3">
                <InitialAvatar name={match.company} />
                <div className="min-w-0 flex-1">
                    <a href={match.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">
                        {match.title}
                    </a>
                    <p className="text-sm text-muted-foreground">
                        {match.company}
                        {match.location ? ` · ${match.location}` : ''}
                        {match.origin === 'watchlist' ? ' · a company you watch' : ' · matches your target roles'}
                        {match.closed ? ' · closed' : ''}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {match.score !== null ? <Pill dot="success">Match <span className="text-muted-foreground">{match.score}</span></Pill> : null}
                    {match.status === 'tracked' ? <Pill dot="info">Tracked</Pill> : null}
                </div>
            </div>

            {match.coverage ? (
                <p className="mt-3 text-sm text-muted-foreground">
                    Evidence for {match.coverage.mustCovered} of {match.coverage.mustTotal} must-haves.
                </p>
            ) : null}

            {match.matched.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                    {match.matched.slice(0, 3).map((item) => (
                        <li key={item.requirementId} className="flex gap-2">
                            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                            <span>
                                <span className="text-foreground">{item.text}</span>
                                <span className="text-muted-foreground"> ← {item.evidence}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
            {match.gaps.length ? (
                <p className="mt-2 text-sm text-muted-foreground">Gap: {match.gaps.slice(0, 2).map((gap) => gap.text).join('; ')}</p>
            ) : null}

            {people && (people.targets.length || people.searchLinks.length) ? (
                <div className="mt-3 border-t border-border pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Who to contact</p>
                    <ul className="mt-1.5 space-y-1 text-sm">
                        {people.targets.slice(0, 3).map((person) => (
                            <li key={`${person.fullName}-${person.profileUrl ?? ''}`} className="flex gap-2">
                                <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                                <span>
                                    {person.profileUrl ? (
                                        <a href={person.profileUrl} target="_blank" rel="noreferrer" className="text-foreground hover:underline">{person.fullName}</a>
                                    ) : (
                                        <span className="text-foreground">{person.fullName}</span>
                                    )}
                                    <span className="text-muted-foreground"> · {person.why}</span>
                                </span>
                            </li>
                        ))}
                        {people.searchLinks.slice(0, people.targets.length ? 2 : 3).map((link) => (
                            <li key={link.url} className="flex gap-2">
                                <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                                <a href={link.url} target="_blank" rel="noreferrer" className="text-foreground hover:underline">{link.label}</a>
                            </li>
                        ))}
                    </ul>
                    {!people.hasContactsImported ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                            Import your LinkedIn connections in <Link href="/settings/job-search" className="underline underline-offset-4">Job search settings</Link> to see people you already know here.
                        </p>
                    ) : null}
                </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={analyse} disabled={pending}>Draft outreach and research</Button>
                {match.status !== 'tracked' ? (
                    <Button size="sm" variant="outline" onClick={trackIt} disabled={pending}>Track</Button>
                ) : null}
                <Button size="sm" variant="ghost" asChild>
                    <a href={match.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden />Posting</a>
                </Button>
                {match.status !== 'tracked' ? (
                    <Button size="sm" variant="ghost" onClick={pass} disabled={pending}><X className="size-4" aria-hidden />Not interested</Button>
                ) : null}
            </div>
        </li>
    );
}

/* ────────────────────────────────────────────────────────────────── held */

function Held({ held }: { held: MatchView[] }) {
    if (held.length === 0) {
        return <EmptyState icon={Telescope} title="Nothing held back" description="Jobs that were scored but did not clear the bar appear here, each with the reason." />;
    }
    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
                Anything that scored 60 or more is checked again the night after you confirm a Win or change a preference.
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
                <ul className="divide-y divide-border">
                    {held.map((match) => (
                        <li key={match.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <a href={match.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-foreground hover:underline">{match.title}</a>
                                <p className="text-xs text-muted-foreground">{match.company}{match.location ? ` · ${match.location}` : ''}</p>
                            </div>
                            <p className="max-w-md text-sm text-muted-foreground">{match.holdReason}</p>
                            {match.score !== null ? <Pill dot="muted">{match.score}</Pill> : null}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

/* ───────────────────────────────────────────────────────────── companies */

function Companies({ companies, onChanged }: { companies: WatchedCompanyView[]; onChanged: () => void }) {
    const [name, setName] = React.useState('');
    const [link, setLink] = React.useState('');
    const [note, setNote] = React.useState<string | null>(null);
    const [pending, start] = React.useTransition();

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) return;
        start(async () => {
            const result = await addWatch({ companyName: name, careersUrl: link.trim() || undefined });
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            setNote(result.data.note);
            if (!result.data.note) {
                toast.success(`Watching ${result.data.company.companyName}: ${result.data.company.openCount} open roles.`);
                setName('');
                setLink('');
            }
            onChanged();
        });
    };

    return (
        <div className="space-y-4">
            <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Company, e.g. Stripe or Swiggy" aria-label="Company name" maxLength={120} />
                    <Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Optional: any job link from their careers page" aria-label="Job link" type="url" />
                    <Button type="submit" disabled={pending || !name.trim()}>{pending ? 'Finding board…' : 'Watch'}</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                    Works with companies that post on Greenhouse, Lever, Ashby or SmartRecruiters. If the name is not found, paste a link to one of their job postings.
                </p>
                {note ? <p className="mt-2 text-sm text-foreground">{note}</p> : null}
            </form>

            {companies.length === 0 ? (
                <EmptyState icon={Building2} title="No companies yet" description="Add the companies you are aiming for. Their boards are checked every night." />
            ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                    <ul className="divide-y divide-border">
                        {companies.map((company) => <CompanyRow key={company.id} company={company} onChanged={onChanged} />)}
                    </ul>
                </div>
            )}
        </div>
    );
}

function CompanyRow({ company, onChanged }: { company: WatchedCompanyView; onChanged: () => void }) {
    const [pending, start] = React.useTransition();
    const remove = () =>
        start(async () => {
            const result = await removeWatch(company.id);
            if (!result.success) toast.error(result.error);
            else onChanged();
        });
    return (
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
            <InitialAvatar name={company.companyName} />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{company.companyName}</p>
                {company.status === 'watching' ? (
                    <p className="text-xs text-muted-foreground">
                        {company.openCount} open on {PROVIDER_LABEL[company.provider ?? ''] ?? company.provider}
                        {company.sampleTitles.length ? ` · e.g. ${company.sampleTitles.join(', ')}` : ''}
                    </p>
                ) : (
                    <p className="text-xs text-muted-foreground">No public board found. Add it again with a link to one of their job postings.</p>
                )}
            </div>
            {company.status === 'watching' ? <Pill dot="success">Watching</Pill> : <Pill dot="warning">Not found</Pill>}
            <Button size="sm" variant="ghost" onClick={remove} disabled={pending} aria-label={`Stop watching ${company.companyName}`}>
                <Trash2 className="size-4" aria-hidden />
            </Button>
        </li>
    );
}
