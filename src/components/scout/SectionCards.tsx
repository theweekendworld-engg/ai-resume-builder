'use client';

import * as React from 'react';
import {
    Banknote,
    BookOpen,
    Briefcase,
    Building2,
    Check,
    ChevronDown,
    FileText,
    GraduationCap,
    Link2,
    ListChecks,
    Loader2,
    MessageSquareText,
    KanbanSquare,
    MinusCircle,
    NotebookPen,
    PenLine,
    Scale,
    Search,
    Upload,
    Users,
    XCircle,
    Youtube,
    type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { StoredSection } from '@/lib/agent/run';
import type {
    CompData,
    CompanyData,
    DigestData,
    DraftFormat,
    DraftTarget,
    FitData,
    InterviewSourceKind,
    InterviewsData,
    JdData,
    NetworkData,
    NetworkTarget,
    NetworkTier,
    OpeningsData,
    PreferenceCheck,
    ScoutSectionData,
    ScoutSectionName,
    ScoutSections,
    TalentData,
    WorkMode,
} from '@/lib/scout/types';
import { SCOUT_SECTION_LABELS } from '@/lib/scout/types';
import type { CaptureData, TrackData } from '@/lib/scout/types';
import { confirmChatNote, dismissChatNote } from '@/actions/inbox';

import {
    DRAFT_FORMAT_LABEL,
    formatCount,
    groupInterviewLinks,
    INTERVIEW_SOURCE_LABEL,
    provenanceLabel,
    safeHref,
    shortDate,
    VERDICT_LABEL,
} from './format';
import { Fact, SectionShell, SourceLink, SubHeading, VERDICT_TONE } from './parts';

/* ───────────────────────────────────────────────────────────── shared */

/** The data a section holds, whether it finished `ok` or kept partial data. */
function dataOf<K extends ScoutSectionName>(section: StoredSection | undefined): ScoutSectionData[K] | null {
    if (!section) return null;
    if (section.status === 'ok') return section.data as ScoutSectionData[K];
    if ((section.status === 'unavailable' || section.status === 'needs_input') && section.data) {
        return section.data as ScoutSectionData[K];
    }
    return null;
}

const SECTION_ICON: Record<ScoutSectionName, LucideIcon> = {
    ingest: Link2,
    classify: ListChecks,
    jd: FileText,
    fit: Scale,
    company: Building2,
    comp: Banknote,
    interviews: MessageSquareText,
    network: Users,
    talent: GraduationCap,
    openings: Briefcase,
    digest: BookOpen,
    capture: NotebookPen,
    track: KanbanSquare,
};

const WORK_MODE_LABEL: Record<WorkMode, string> = {
    remote: 'Remote',
    hybrid: 'Hybrid',
    onsite: 'Onsite',
    unknown: '',
};

function Bullets({ items, className }: { items: readonly string[]; className?: string }) {
    if (items.length === 0) return null;
    return (
        <ul className={cn('list-disc space-y-1 pl-5', typeStyles.body, 'text-foreground', className)}>
            {items.map((item, index) => (
                <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
            ))}
        </ul>
    );
}

/* ───────────────────────────────────────────────────────────────── jd */

function JdBody({ data }: { data: JdData }) {
    const must = data.requirements.filter((requirement) => requirement.kind === 'must');
    const nice = data.requirements.filter((requirement) => requirement.kind === 'nice');

    return (
        <div>
            <dl className="divide-y divide-border">
                <Fact label="Role" value={data.role} />
                <Fact label="Company" value={data.company} />
                <Fact label="Seniority" value={data.seniority} />
                <Fact label="Location" value={data.location} />
                <Fact label="Work mode" value={WORK_MODE_LABEL[data.workMode]} />
                <Fact label="Type" value={data.employmentType} />
                <Fact label="Experience" value={data.experienceText} />
                <Fact
                    label="Pay stated in the posting"
                    value={data.compensationText}
                    source={<span className={cn(typeStyles.caption, 'text-muted-foreground')}>quoted</span>}
                />
            </dl>

            {must.length ? (
                <>
                    <SubHeading>Must have</SubHeading>
                    <Bullets items={must.map((requirement) => requirement.text)} />
                </>
            ) : null}
            {nice.length ? (
                <>
                    <SubHeading>Nice to have</SubHeading>
                    <Bullets items={nice.map((requirement) => requirement.text)} />
                </>
            ) : null}
            {data.skills.length ? (
                <>
                    <SubHeading>Skills named</SubHeading>
                    <p className={cn(typeStyles.small, 'text-foreground')}>{data.skills.join(' · ')}</p>
                </>
            ) : null}
            {data.applyUrl ? (
                <div className="mt-4">
                    <Button asChild size="sm" variant="outline">
                        <a href={safeHref(data.applyUrl) ?? undefined} target="_blank" rel="noopener noreferrer nofollow">
                            Open the application
                        </a>
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

/* ──────────────────────────────────────────────────────────────── fit */

const PREFERENCE_LABEL: Record<PreferenceCheck['key'], string> = {
    role: 'Role',
    seniority: 'Seniority',
    work_mode: 'Work mode',
    location: 'Location',
    compensation: 'Pay',
    sponsorship: 'Sponsorship',
    company_size: 'Company size',
};

function PreferenceIcon({ status }: { status: PreferenceCheck['status'] }) {
    if (status === 'match') return <Check aria-label="Matches" className="size-3.5 shrink-0 text-success" />;
    if (status === 'conflict') return <XCircle aria-label="Conflicts" className="size-3.5 shrink-0 text-warning" />;
    return <MinusCircle aria-label="Unknown" className="size-3.5 shrink-0 text-muted-foreground" />;
}

function FitBody({ data }: { data: FitData }) {
    return (
        <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {data.score !== null ? (
                    <span className="num font-heading text-3xl font-semibold text-foreground">{data.score}</span>
                ) : null}
                <span className={cn(typeStyles.h3, VERDICT_TONE[data.verdict])}>{VERDICT_LABEL[data.verdict]}</span>
            </div>
            {data.summary ? <p className={cn(typeStyles.body, 'mt-2 text-foreground')}>{data.summary}</p> : null}

            {/* The "why not" is the most useful thing on the screen when it applies, so it leads. */}
            {data.notFitReasons.length ? (
                <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-4">
                    <p className={cn(typeStyles.h3, 'text-foreground')}>Why this isn&rsquo;t a fit</p>
                    <Bullets items={data.notFitReasons} className="mt-2" />
                </div>
            ) : null}

            {data.preferenceChecks.length ? (
                <>
                    <SubHeading>Against your preferences</SubHeading>
                    <ul className="space-y-1.5">
                        {data.preferenceChecks.map((check) => (
                            <li key={check.key} className={cn(typeStyles.small, 'flex items-start gap-2 text-foreground')}>
                                <span className="mt-0.5"><PreferenceIcon status={check.status} /></span>
                                <span>
                                    <span className="text-muted-foreground">{PREFERENCE_LABEL[check.key]}: </span>
                                    {check.detail}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}

            {data.matched.length ? (
                <>
                    <SubHeading>What you already have</SubHeading>
                    <ul className="space-y-2">
                        {data.matched.map((match) => (
                            <li key={match.requirementId} className={typeStyles.small}>
                                <p className="flex items-start gap-2 text-foreground">
                                    <Check
                                        aria-hidden
                                        className={cn('mt-0.5 size-3.5 shrink-0', match.strength === 'partial' ? 'text-muted-foreground' : 'text-success')}
                                    />
                                    <span>
                                        {match.text}
                                        {match.strength === 'partial' ? <span className="text-muted-foreground"> · partly</span> : null}
                                    </span>
                                </p>
                                {match.evidence ? (
                                    <p className="ml-5.5 mt-0.5 pl-0.5 text-muted-foreground">&ldquo;{match.evidence}&rdquo;</p>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}

            {data.gaps.length ? (
                <>
                    <SubHeading>Gaps</SubHeading>
                    <ul className="space-y-1.5">
                        {data.gaps.map((gap) => (
                            <li key={gap.requirementId} className={cn(typeStyles.small, 'flex items-start gap-2 text-foreground')}>
                                <MinusCircle
                                    aria-hidden
                                    className={cn('mt-0.5 size-3.5 shrink-0', gap.severity === 'blocking' ? 'text-warning' : 'text-muted-foreground')}
                                />
                                <span>
                                    {gap.text}
                                    {gap.severity === 'blocking' ? <span className="text-muted-foreground"> · required</span> : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}

            {data.softRequirements?.length ? (
                <>
                    <SubHeading>Also asks for</SubHeading>
                    <p className={cn(typeStyles.small, 'text-muted-foreground')}>
                        {data.softRequirements.join(' · ')}. Traits like these are not scored: no record can show them, so show them in the conversation instead.
                    </p>
                </>
            ) : null}
        </div>
    );
}

/* ──────────────────────────────────────────────────────────── company */

function CompanyBody({ data }: { data: CompanyData }) {
    const source = (field: string) => {
        const value = data.provenance[field];
        if (!value) return null;
        if (value.startsWith('http')) return <SourceLink url={value} />;
        return <span className={cn(typeStyles.caption, 'text-muted-foreground')}>{provenanceLabel(value)}</span>;
    };
    const size = data.employeeCountRange
        ? `${data.employeeCountRange} employees`
        : data.employeeCount !== null
          ? `~${formatCount(data.employeeCount)} employees`
          : null;

    return (
        <div>
            <dl className="divide-y divide-border">
                <Fact label="Size" value={size} source={source(data.employeeCountRange ? 'employeeCountRange' : 'employeeCount')} />
                <Fact label="Funding" value={data.fundingText} source={source('fundingText')} />
                <Fact label="Latest stage" value={data.latestFundingStage} source={source('latestFundingStage')} />
                <Fact label="Revenue" value={data.revenueText} source={source('revenueText')} />
                <Fact label="Industry" value={data.industry} source={source('industry')} />
                <Fact label="Headquarters" value={data.headquarters} source={source('headquarters')} />
                <Fact label="Founded" value={data.foundedYear ? String(data.foundedYear) : null} source={source('foundedYear')} />
                <Fact
                    label="Website"
                    value={data.website ? <SourceLink url={data.website.startsWith('http') ? data.website : `https://${data.website}`} /> : null}
                />
            </dl>

            {data.hiringStatement ? (
                <p className={cn(typeStyles.small, 'mt-3 text-muted-foreground')}>{data.hiringStatement}</p>
            ) : null}

            {data.growthNote ? (
                <>
                    <SubHeading>Growth</SubHeading>
                    <p className={cn(typeStyles.body, 'text-foreground')}>{data.growthNote}</p>
                </>
            ) : null}

            {data.facts.length ? (
                <>
                    <SubHeading>From public sources</SubHeading>
                    <ul className="space-y-2">
                        {data.facts.map((fact, index) => (
                            <li key={`${fact.sourceUrl}-${index}`} className={typeStyles.small}>
                                <span className="text-muted-foreground">{fact.label}: </span>
                                <span className="text-foreground">{fact.value}</span>{' '}
                                <SourceLink url={fact.sourceUrl} title={fact.sourceTitle} date={fact.asOf} />
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────── comp */

function CompBody({ data }: { data: CompData }) {
    return (
        <div>
            {data.observedBand ? (
                <p className={cn(typeStyles.body, 'text-foreground')}>
                    {data.observedBand.statement}{' '}
                    <span className="text-muted-foreground">({data.observedBand.n} postings we observed)</span>
                </p>
            ) : null}

            {data.figures.length ? (
                <ul className={cn('space-y-3', data.observedBand ? 'mt-4' : '')}>
                    {data.figures.map((figure, index) => (
                        <li key={`${figure.sourceUrl}-${index}`}>
                            <p className={cn(typeStyles.small, 'text-muted-foreground')}>{figure.label}</p>
                            <p className="flex flex-wrap items-baseline gap-x-2">
                                <span className="num font-heading text-lg font-semibold text-foreground">{figure.value}</span>
                                <SourceLink url={figure.sourceUrl} title={figure.sourceTitle} date={figure.asOf} />
                            </p>
                        </li>
                    ))}
                </ul>
            ) : !data.observedBand ? (
                <p className={cn(typeStyles.small, 'text-muted-foreground')}>No public figures found for this role.</p>
            ) : null}

            {data.caveat ? <p className={cn(typeStyles.caption, 'mt-4 border-t border-border pt-3 text-muted-foreground')}>{data.caveat}</p> : null}
        </div>
    );
}

/* ───────────────────────────────────────────────────────── interviews */

const INTERVIEW_ICON: Record<InterviewSourceKind, LucideIcon> = {
    reddit: MessageSquareText,
    leetcode: ListChecks,
    youtube: Youtube,
    glassdoor: Building2,
    geeksforgeeks: BookOpen,
    blind: Users,
    medium: PenLine,
    other: Link2,
};

function InterviewsBody({ data }: { data: InterviewsData }) {
    const groups = groupInterviewLinks(data.links);
    return (
        <div>
            {data.themes.length ? (
                <>
                    <SubHeading>What comes up</SubHeading>
                    <Bullets items={data.themes} />
                </>
            ) : null}

            {groups.map(({ source, links }) => {
                const Icon = INTERVIEW_ICON[source];
                return (
                    <div key={source}>
                        <SubHeading>
                            <span className="inline-flex items-center gap-1.5">
                                <Icon aria-hidden className="size-3.5" />
                                {INTERVIEW_SOURCE_LABEL[source]}
                            </span>
                        </SubHeading>
                        <ul className="space-y-3">
                            {links.map((link) => (
                                <li key={link.url}>
                                    <a
                                        href={safeHref(link.url) ?? undefined}
                                        target="_blank"
                                        rel="noopener noreferrer nofollow"
                                        className={cn(typeStyles.body, 'font-medium text-foreground hover:underline')}
                                    >
                                        {link.title}
                                    </a>
                                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                                        <SourceLink url={link.url} date={link.publishedAt} />
                                        {link.relevance ? (
                                            <span className={cn(typeStyles.caption, 'text-muted-foreground')}>{link.relevance}</span>
                                        ) : null}
                                    </div>
                                    {link.snippet ? (
                                        <p className={cn(typeStyles.small, 'mt-1 line-clamp-3 text-muted-foreground')}>&ldquo;{link.snippet}&rdquo;</p>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}

            {groups.length === 0 ? (
                <p className={cn(typeStyles.small, 'text-muted-foreground')}>No interview write-ups found for this role yet.</p>
            ) : null}
        </div>
    );
}

/* ──────────────────────────────────────────────────────────── network */

const TIER_LABEL: Record<NetworkTier, string> = {
    poster: 'Posted this',
    first_degree: '1st-degree connection',
    ex_colleague: 'Former colleague',
    alumni: 'Alumni',
    search: 'Suggested',
};

/** Which draft a person gets. The poster is asked directly; a connection is asked for a referral. */
const TIER_TARGET: Record<NetworkTier, DraftTarget> = {
    poster: 'poster',
    first_degree: 'referral',
    ex_colleague: 'referral',
    alumni: 'alumni',
    search: 'referral',
};

export type DraftRequest = {
    target: DraftTarget;
    format: DraftFormat;
    contactId: string | null;
    /** Display only, so the pending state can say who the draft is for. */
    label: string;
    /** Identifies the menu that asked, so only its button shows progress. */
    key: string;
};

function DraftMenu({
    draftKey,
    label,
    target,
    contactId,
    onDraft,
    pending,
    disabled,
}: {
    draftKey: string;
    label: string;
    target: DraftTarget;
    contactId: string | null;
    onDraft: (request: DraftRequest) => void;
    pending: boolean;
    disabled: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={pending || disabled}>
                    {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <PenLine aria-hidden className="size-3.5" />}
                    Draft message
                    <ChevronDown aria-hidden className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>{label}</DropdownMenuLabel>
                {(Object.keys(DRAFT_FORMAT_LABEL) as DraftFormat[]).map((format) => (
                    <DropdownMenuItem key={format} onSelect={() => onDraft({ target, format, contactId, label, key: draftKey })}>
                        {DRAFT_FORMAT_LABEL[format]}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function TargetRow({
    target,
    onDraft,
    pendingKey,
    draftsDisabled,
}: {
    target: NetworkTarget;
    onDraft: (request: DraftRequest) => void;
    pendingKey: string | null;
    draftsDisabled: boolean;
}) {
    const key = target.contactId ?? target.profileUrl ?? target.fullName;
    return (
        <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                <p className={cn(typeStyles.body, 'font-medium text-foreground')}>
                    {target.profileUrl ? (
                        <a href={safeHref(target.profileUrl) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                            {target.fullName}
                        </a>
                    ) : (
                        target.fullName
                    )}
                </p>
                <p className={cn(typeStyles.small, 'text-muted-foreground')}>
                    {[target.position, target.company].filter(Boolean).join(' · ')}
                </p>
                <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>
                    {TIER_LABEL[target.tier]}
                    {target.why ? ` · ${target.why}` : ''}
                </p>
            </div>
            <DraftMenu
                draftKey={key}
                label={`To ${target.fullName}`}
                target={TIER_TARGET[target.tier]}
                contactId={target.contactId}
                onDraft={onDraft}
                pending={pendingKey === key}
                disabled={draftsDisabled}
            />
        </li>
    );
}

function NetworkBody({
    data,
    onDraft,
    pendingKey,
    draftsDisabled,
}: {
    data: NetworkData;
    onDraft: (request: DraftRequest) => void;
    pendingKey: string | null;
    draftsDisabled: boolean;
}) {
    return (
        <div>
            {!data.hasContactsImported ? (
                <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className={cn(typeStyles.h3, 'text-foreground')}>Import your LinkedIn connections</p>
                        <p className={cn(typeStyles.small, 'mt-0.5 text-muted-foreground')}>
                            With your Connections.csv, Scout can name the people you already know here.
                        </p>
                    </div>
                    <Button asChild size="sm" variant="outline" className="gap-1.5 self-start sm:self-auto">
                        <Link href="/settings/job-search#connections">
                            <Upload aria-hidden className="size-3.5" />
                            Import
                        </Link>
                    </Button>
                </div>
            ) : null}

            {data.targets.length ? (
                <ul className="divide-y divide-border">
                    {data.targets.map((target) => (
                        <TargetRow
                            key={target.contactId ?? target.profileUrl ?? target.fullName}
                            target={target}
                            onDraft={onDraft}
                            pendingKey={pendingKey}
                            draftsDisabled={draftsDisabled}
                        />
                    ))}
                </ul>
            ) : (
                <p className={cn(typeStyles.small, 'text-muted-foreground')}>
                    {data.hasContactsImported
                        ? 'None of your connections work here yet. The searches below find people who do.'
                        : 'No one to name yet. The searches below find people who work here.'}
                </p>
            )}

            {/* Generic drafts need no specific person. */}
            <div className="mt-4 flex flex-wrap gap-2">
                <DraftMenu
                    draftKey="recruiter"
                    label="To a recruiter"
                    target="recruiter"
                    contactId={null}
                    onDraft={onDraft}
                    pending={pendingKey === 'recruiter'}
                    disabled={draftsDisabled}
                />
                <DraftMenu
                    draftKey="hiring_manager"
                    label="To the hiring manager"
                    target="hiring_manager"
                    contactId={null}
                    onDraft={onDraft}
                    pending={pendingKey === 'hiring_manager'}
                    disabled={draftsDisabled}
                />
            </div>

            {data.searchLinks.length ? (
                <>
                    <SubHeading>Find people on LinkedIn</SubHeading>
                    <div className="flex flex-wrap gap-2">
                        {data.searchLinks.map((link) => (
                            <Button key={link.url} asChild size="sm" variant="ghost" className="gap-1.5 border border-border">
                                <a href={safeHref(link.url) ?? undefined} target="_blank" rel="noopener noreferrer nofollow">
                                    <Search aria-hidden className="size-3.5" />
                                    {link.label}
                                </a>
                            </Button>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    );
}

/* ───────────────────────────────────────────────────────────── talent */

function TalentBody({ data }: { data: TalentData }) {
    return (
        <div>
            {data.note ? (
                <p className={cn(typeStyles.body, 'text-foreground')}>{data.note}</p>
            ) : (
                <p className={cn(typeStyles.small, 'text-muted-foreground')}>Not enough public evidence to say.</p>
            )}
            <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>Confidence: {data.confidence}</p>
            {data.facts.length ? (
                <ul className="mt-3 space-y-2">
                    {data.facts.map((fact, index) => (
                        <li key={`${fact.sourceUrl}-${index}`} className={typeStyles.small}>
                            <span className="text-muted-foreground">{fact.label}: </span>
                            <span className="text-foreground">{fact.value}</span>{' '}
                            <SourceLink url={fact.sourceUrl} title={fact.sourceTitle} date={fact.asOf} />
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────── openings */

function OpeningsBody({ data }: { data: OpeningsData }) {
    if (data.companies.length === 0) {
        return <p className={cn(typeStyles.small, 'text-muted-foreground')}>No companies to check.</p>;
    }
    return (
        <div className="space-y-5">
            {data.companies.map((company) => (
                <div key={company.name}>
                    <p className={cn(typeStyles.h3, 'flex items-center gap-2 text-foreground')}>
                        {company.name}
                        {company.tracked ? (
                            <span className={cn(typeStyles.caption, 'text-muted-foreground')}>· watched by Radar</span>
                        ) : null}
                    </p>
                    {company.openings.length ? (
                        <ul className="mt-2 space-y-1.5">
                            {company.openings.map((opening) => (
                                <li key={opening.url} className={cn(typeStyles.small, 'flex flex-wrap items-baseline gap-x-2')}>
                                    <a href={safeHref(opening.url) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="text-foreground hover:underline">
                                        {opening.title}
                                    </a>
                                    {opening.location ? <span className="text-muted-foreground">{opening.location}</span> : null}
                                    {opening.postedAt ? <span className="text-muted-foreground">· {shortDate(opening.postedAt)}</span> : null}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>{company.note ?? 'No matching openings found.'}</p>
                    )}
                </div>
            ))}
        </div>
    );
}

/* ───────────────────────────────────────────────────────────── digest */

function DigestBody({ data }: { data: DigestData }) {
    return (
        <div>
            <p className={cn(typeStyles.h3, 'text-foreground')}>{data.title}</p>
            <Bullets items={data.takeaways} className="mt-2" />
            {data.tags.length ? (
                <p className={cn(typeStyles.caption, 'mt-3 text-muted-foreground')}>{data.tags.join(' · ')}</p>
            ) : null}
            {data.savedInsightId ? (
                <p className={cn(typeStyles.caption, 'mt-3 text-muted-foreground')}>
                    Saved to your reading shelf. Kept apart from your Work Log: someone else&rsquo;s post is not your evidence.
                </p>
            ) : null}
        </div>
    );
}

/* ──────────────────────────────────────────────────────────── capture */

/**
 * A work note, drafted into the Work Log. Capture never confirms on its own:
 * confirming is what writes Evidence (CLAUDE.md rule 5), so it is the user's
 * click here, in the Work Log, or on the bot's button.
 */
function CaptureBody({ data }: { data: CaptureData }) {
    const [state, setState] = React.useState<'draft' | 'confirmed' | 'dismissed'>('draft');
    const [pending, setPending] = React.useState<'confirm' | 'dismiss' | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const act = async (kind: 'confirm' | 'dismiss') => {
        setPending(kind);
        setError(null);
        const result = kind === 'confirm' ? await confirmChatNote(data.winId) : await dismissChatNote(data.winId);
        setPending(null);
        if (!result.success) {
            setError(result.error);
            return;
        }
        setState(kind === 'confirm' ? 'confirmed' : 'dismissed');
    };

    return (
        <div>
            <p className={cn(typeStyles.h3, 'text-foreground')}>{data.title}</p>
            {data.narrative ? <p className={cn(typeStyles.body, 'mt-1 text-foreground')}>{data.narrative}</p> : null}
            <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>
                {[data.category.replace(/_/g, ' '), ...data.skills.slice(0, 6)].filter(Boolean).join(' · ')}
            </p>
            {data.degraded ? (
                <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>
                    A number your note did not state was left out. Add it in the Work Log if it is real.
                </p>
            ) : null}
            {data.status === 'merge_proposed' ? (
                <p className={cn(typeStyles.small, 'mt-3 text-muted-foreground')}>
                    This looks like a Win you already logged. Review it in the Work Log to merge or keep both.
                </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
                {state === 'draft' && data.status === 'draft' ? (
                    <>
                        <Button type="button" size="sm" className="gap-1.5" onClick={() => void act('confirm')} disabled={pending !== null}>
                            {pending === 'confirm' ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Check aria-hidden className="size-3.5" />}
                            Confirm
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void act('dismiss')} disabled={pending !== null}>
                            {pending === 'dismiss' ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
                            Dismiss
                        </Button>
                    </>
                ) : null}
                {state === 'confirmed' ? (
                    <span className={cn(typeStyles.small, 'inline-flex items-center gap-1.5 text-foreground')}>
                        <Check aria-hidden className="size-3.5 text-success" /> Confirmed. It now counts as evidence.
                    </span>
                ) : null}
                {state === 'dismissed' ? (
                    <span className={cn(typeStyles.small, 'text-muted-foreground')}>Dismissed.</span>
                ) : null}
                <Button asChild type="button" size="sm" variant="outline" className="gap-1.5">
                    <Link href={`/log?win=${encodeURIComponent(data.winId)}`}>
                        <PenLine aria-hidden className="size-3.5" />
                        Edit in Work Log
                    </Link>
                </Button>
            </div>
            {error ? <p className={cn(typeStyles.caption, 'mt-2 text-warning')} role="alert">{error}</p> : null}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────── track */

/** The status control lives in the page header; one control per value. */
function TrackBody({ data }: { data: TrackData }) {
    return (
        <p className={cn(typeStyles.small, 'text-muted-foreground')}>
            {data.created ? 'Added to your job tracker.' : 'Already in your job tracker; updated with this analysis.'}{' '}
            Change its status at the top of this page.{' '}
            <Link href="/scout" className="underline hover:text-foreground">See all jobs</Link>
        </p>
    );
}

/* ──────────────────────────────────────────────────────────── the list */

/** Sections the user reads. `ingest` and `classify` live in the header and timeline. */
export const CONTENT_SECTIONS: ScoutSectionName[] = ['capture', 'jd', 'fit', 'company', 'comp', 'interviews', 'network', 'talent', 'openings', 'digest', 'track'];

const CARD_TITLE: Partial<Record<ScoutSectionName, string>> = {
    jd: 'The job',
    fit: 'Your fit',
    company: 'The company',
    comp: 'Compensation',
    interviews: 'Interview experiences',
    network: 'Who to talk to',
    talent: 'Who works there',
    openings: 'Open roles',
    digest: 'Key takeaways',
    capture: 'Work Log draft',
    track: 'Job tracker',
};

export function SectionCard({
    name,
    sections,
    live,
    onDraft,
    pendingDraftKey,
    draftsDisabled,
}: {
    name: ScoutSectionName;
    sections: ScoutSections;
    live: boolean;
    onDraft: (request: DraftRequest) => void;
    pendingDraftKey: string | null;
    draftsDisabled: boolean;
}) {
    const section = sections[name] as StoredSection | undefined;
    const title = CARD_TITLE[name] ?? SCOUT_SECTION_LABELS[name];
    const icon = SECTION_ICON[name];

    let body: React.ReactNode = null;
    switch (name) {
        case 'jd': {
            const data = dataOf<'jd'>(section);
            body = data ? <JdBody data={data} /> : null;
            break;
        }
        case 'fit': {
            const data = dataOf<'fit'>(section);
            body = data ? <FitBody data={data} /> : null;
            break;
        }
        case 'company': {
            const data = dataOf<'company'>(section);
            body = data ? <CompanyBody data={data} /> : null;
            break;
        }
        case 'comp': {
            const data = dataOf<'comp'>(section);
            body = data ? <CompBody data={data} /> : null;
            break;
        }
        case 'interviews': {
            const data = dataOf<'interviews'>(section);
            body = data ? <InterviewsBody data={data} /> : null;
            break;
        }
        case 'network': {
            const data = dataOf<'network'>(section);
            body = data ? (
                <NetworkBody data={data} onDraft={onDraft} pendingKey={pendingDraftKey} draftsDisabled={draftsDisabled} />
            ) : null;
            break;
        }
        case 'talent': {
            const data = dataOf<'talent'>(section);
            body = data ? <TalentBody data={data} /> : null;
            break;
        }
        case 'openings': {
            const data = dataOf<'openings'>(section);
            body = data ? <OpeningsBody data={data} /> : null;
            break;
        }
        case 'digest': {
            const data = dataOf<'digest'>(section);
            body = data ? <DigestBody data={data} /> : null;
            break;
        }
        case 'capture': {
            const data = dataOf<'capture'>(section);
            body = data ? <CaptureBody data={data} /> : null;
            break;
        }
        case 'track': {
            const data = dataOf<'track'>(section);
            body = data ? <TrackBody data={data} /> : null;
            break;
        }
        default:
            body = null;
    }

    return (
        <SectionShell title={title} icon={icon} section={section} live={live}>
            {body}
        </SectionShell>
    );
}

export { SECTION_ICON };
