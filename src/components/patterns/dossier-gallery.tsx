'use client';

/**
 * The Dossier block of `/dev/patterns` (docs/design/03-dossier.md): the
 * palette with its measured contrast, the type roles, and every new pattern
 * in every state. Rendered once per theme pane by the gallery.
 */

import * as React from 'react';
import { Bell, Briefcase, Inbox, Mail } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { jobStages } from '@/lib/jobStages';
import { cn } from '@/lib/utils';

import { EmptyState } from './empty-state';
import { EvidenceChip, EvidenceChipRow } from './evidence-chip';
import { PageHeader, PageTabs, Pill, Segmented } from './page';
import { ProgressRail } from './progress-rail';
import { Section, SectionLink } from './section';
import { StatStrip } from './stat-strip';
import { typeStyles } from './tokens';

const SWATCHES: Array<{ token: string; name: string; light: string; dark: string; on: string }> = [
    { token: 'background', name: 'Paper', light: '#FAF8F5', dark: '#0F1524', on: 'foreground 15.0 / 15.1' },
    { token: 'card', name: 'Card', light: '#FFFFFF', dark: '#151E32', on: 'foreground 15.9 / 13.7' },
    { token: 'foreground', name: 'Ink', light: '#14213E', dark: '#EEEAE3', on: 'on paper 15.0 / 15.1' },
    { token: 'muted-foreground', name: 'Muted ink', light: '#585F6F', dark: '#A2A7B4', on: 'on paper 6.1 / 7.6' },
    { token: 'primary', name: 'Teal', light: '#0F756D', dark: '#5BC2B5', on: 'white on it 5.5 · as text 5.2' },
    { token: 'warning', name: 'Amber · needs you', light: '#A54C09', dark: '#E8A359', on: 'on paper 5.4 / 8.5' },
    { token: 'success', name: 'Success', light: '#1E6B44', dark: '#61C28E', on: 'on paper 6.1 / 8.3' },
    { token: 'danger', name: 'Danger', light: '#B42318', dark: '#F07F70', on: 'on paper 6.2 / 6.9' },
    { token: 'border', name: 'Hairline', light: '#E4DFD7', dark: '#26324A', on: 'decorative, 1.3' },
    { token: 'border-strong', name: 'Control edge', light: '#8B8579', dark: '#5F6C86', on: '3.7 / 3.1 on card' },
];

function Label({ children }: { children: React.ReactNode }) {
    return <p className={cn(typeStyles.eyebrow, 'mb-2')}>{children}</p>;
}

export function DossierSection() {
    const [segment, setSegment] = React.useState<'all' | 'review' | 'applied'>('all');
    return (
        <section className="space-y-8 border-t border-border pt-6">
            <div>
                <p className={typeStyles.eyebrow}>0 · Dossier</p>
                <h2 className={cn(typeStyles.h2, 'mt-1 text-foreground')}>Paper, ink and one accent</h2>
                <p className="mt-1 text-sm text-muted-foreground">docs/design/03-dossier.md · contrast measured light / dark</p>
            </div>

            <div>
                <Label>Palette</Label>
                <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
                    {SWATCHES.map((swatch) => (
                        <li key={swatch.token} className="bg-card p-3">
                            <span aria-hidden className="block h-10 rounded-sm border border-border" style={{ background: `hsl(var(--${swatch.token}))` }} />
                            <span className="mt-2 block text-[13px] font-medium text-foreground">{swatch.name}</span>
                            <span className="ledger block text-[11px] text-muted-foreground">--{swatch.token}</span>
                            <span className="ledger block text-[11px] text-muted-foreground">{swatch.light} · {swatch.dark}</span>
                            <span className="block text-[11px] text-muted-foreground">{swatch.on}</span>
                        </li>
                    ))}
                </ul>
            </div>

            <div>
                <Label>Type</Label>
                <div className="space-y-3 rounded-lg border border-border bg-card p-5">
                    <p className={typeStyles.eyebrow}>Eyebrow · 11/16 Inter 600 +0.08em</p>
                    <p className={typeStyles.display}>Welcome back, Jai.</p>
                    <p className={typeStyles.h1}>Work Log — page title 28/36</p>
                    <p className={typeStyles.h2}>Section heading 19/26</p>
                    <p className={typeStyles.h3}>Card title · Inter 15/22 600</p>
                    <p className={cn(typeStyles.body, 'max-w-prose text-muted-foreground')}>
                        Body 14/22. Patronus keeps every line as you wrote it, then checks any job against it and tailors a one-page resume.
                    </p>
                    <p className="flex items-baseline gap-6">
                        <span className={typeStyles.stat}>1,284</span>
                        <span className={typeStyles.stat}>82</span>
                        <span className={cn(typeStyles.ledger, 'text-muted-foreground')}>2026-11-04 · PR #482</span>
                    </p>
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-background">
                <div className="px-5 pt-4">
                    <Label>PageHeader + PageTabs</Label>
                </div>
                <PageHeader
                    eyebrow="Record"
                    title="Work Log"
                    description="What you actually did, confirmed and kept."
                    actions={
                        <>
                            <Button variant="outline">Import</Button>
                            <Button>Log a win</Button>
                        </>
                    }
                >
                    <PageTabs
                        label="Work Log views"
                        active="log"
                        tabs={[
                            { key: 'log', label: 'Log', onSelect: () => {}, count: 42 },
                            { key: 'review', label: 'To review', onSelect: () => {}, count: 3 },
                            { key: 'readiness', label: 'Readiness', onSelect: () => {} },
                        ]}
                    />
                </PageHeader>
                <div className="px-5 py-4">
                    <Segmented
                        label="Status"
                        value={segment}
                        onChange={setSegment}
                        options={[
                            { value: 'all', label: 'All', count: 12 },
                            { value: 'review', label: 'To review', count: 3 },
                            { value: 'applied', label: 'Applied', count: 5 },
                        ]}
                    />
                </div>
            </div>

            <div>
                <Label>StatStrip</Label>
                <StatStrip
                    label="Pipeline"
                    items={[
                        { label: 'To review', value: 3, href: '#', tone: 'attention', caption: 'Scored against your record' },
                        { label: 'Applied', value: 5, href: '#', caption: '2 this week' },
                        { label: 'Interviewing', value: 1, href: '#' },
                        { label: 'Offer', value: 0, href: '#' },
                    ]}
                />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div>
                    <Label>ProgressRail · default</Label>
                    <div className="space-y-6 rounded-lg border border-border bg-card p-5">
                        <ProgressRail label="Fresh job" steps={jobStages({ analyzed: true, tailored: false, email: false, applied: false })} />
                        <ProgressRail
                            label="Tailored, email next"
                            steps={jobStages({ analyzed: true, tailored: true, email: false, applied: false }).map((s, i) => ({
                                ...s,
                                detail: ['Nov 2', 'v3', undefined, undefined][i],
                            }))}
                        />
                        <ProgressRail
                            label="Ready to send"
                            steps={jobStages({ analyzed: true, tailored: true, email: true, applied: false }).map((s) =>
                                s.status === 'current' ? { ...s, tone: 'attention' as const } : s,
                            )}
                        />
                        <ProgressRail label="Applied with own resume" steps={jobStages({ analyzed: true, tailored: false, email: false, applied: true })} />
                    </div>
                </div>
                <div>
                    <Label>ProgressRail · compact (list rows)</Label>
                    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                        {[
                            { role: 'Senior Backend Engineer', co: 'Plivo', f: { analyzed: true, tailored: true, email: false, applied: false } },
                            { role: 'Staff Engineer, Media', co: 'Daily', f: { analyzed: true, tailored: true, email: true, applied: false } },
                            { role: 'Platform Engineer', co: 'Linear', f: { analyzed: true, tailored: true, email: true, applied: true } },
                        ].map((job) => (
                            <li key={job.co} className="flex items-center justify-between gap-4 px-4 py-3">
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{job.role}</span>
                                    <span className="block text-[13px] text-muted-foreground">{job.co}</span>
                                </span>
                                <ProgressRail
                                    size="compact"
                                    label={`${job.role} at ${job.co}`}
                                    steps={jobStages(job.f).map((s) => (s.status === 'current' && s.key === 'applied' ? { ...s, tone: 'attention' as const } : s))}
                                />
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div>
                <Label>EvidenceChip</Label>
                <EvidenceChipRow label="Evidence">
                    <EvidenceChip kind="company" source="Plivo" detail="media path" />
                    <EvidenceChip kind="repo" source="PR #482" detail="patronus/api" href="https://github.com" />
                    <EvidenceChip kind="document" source="resume.pdf" detail="p. 2" />
                    <EvidenceChip kind="interview_assertion" source="You said this" />
                    <EvidenceChip kind="url" source="greenhouse.io" detail="posting, Nov 4" href="https://example.com" />
                </EvidenceChipRow>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div>
                    <Label>Section · ruled</Label>
                    <Section eyebrow="Needs you" count={2} tone="attention" action={<SectionLink href="#">View all</SectionLink>}>
                        <ul className="divide-y divide-border">
                            {[
                                { icon: Mail, t: 'Reply to Priya at Plivo', d: 'Asked for times next week' },
                                { icon: Bell, t: 'Follow up on Staff Engineer at Daily', d: 'Applied 8 days ago' },
                            ].map((row) => (
                                <li key={row.t} className="relative flex items-center gap-3 py-3 pl-4">
                                    <span aria-hidden className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-warning" />
                                    <row.icon className="size-4 text-muted-foreground" aria-hidden />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium">{row.t}</span>
                                        <span className="block text-[13px] text-muted-foreground">{row.d}</span>
                                    </span>
                                    <Button size="sm" variant="outline">Draft</Button>
                                </li>
                            ))}
                        </ul>
                    </Section>
                </div>
                <div>
                    <Label>Section · boxed, with a title</Label>
                    <Section variant="boxed" eyebrow="Company" title="Plivo" description="Voice and messaging APIs · Bengaluru, San Francisco" action={<SectionLink href="#">Sources</SectionLink>}>
                        <div className="space-y-3 px-4 py-4 text-sm">
                            <p>Series B, 2014. The posting names the media path and SIP stack.</p>
                            <EvidenceChipRow>
                                <EvidenceChip kind="url" source="plivo.com" detail="careers" />
                                <EvidenceChip kind="url" source="crunchbase" detail="funding" />
                            </EvidenceChipRow>
                        </div>
                    </Section>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div>
                    <Label>Buttons · badges · pills</Label>
                    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                        <div className="flex flex-wrap gap-2">
                            <Button>Tailor resume</Button>
                            <Button variant="outline">Save</Button>
                            <Button variant="secondary">Later</Button>
                            <Button variant="ghost">Cancel</Button>
                            <Button variant="link">Open posting</Button>
                            <Button variant="destructive">Delete</Button>
                            <Button disabled>Disabled</Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Badge>Teal</Badge>
                            <Badge variant="secondary">Secondary</Badge>
                            <Badge variant="outline">Outline</Badge>
                            <Badge variant="attention">Needs you</Badge>
                            <Badge variant="success">Grounded</Badge>
                            <Badge variant="destructive">Unsupported</Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Pill dot="success">Applied</Pill>
                            <Pill dot="warning">Follow up</Pill>
                            <Pill dot="info">Interviewing</Pill>
                            <Pill dot="muted">Closed</Pill>
                        </div>
                    </div>
                </div>
                <div>
                    <Label>Card · input · skeleton</Label>
                    <Card>
                        <CardHeader>
                            <CardTitle>Job search</CardTitle>
                            <CardDescription>Roles, locations and pay you are looking for.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <label className="block text-[13px] font-medium" htmlFor={`dossier-role-${segment}`}>Target role</label>
                            <Input id={`dossier-role-${segment}`} placeholder="Senior backend engineer" />
                            <div className="space-y-2 pt-2">
                                <Skeleton className="h-4 w-2/5" />
                                <Skeleton className="h-4 w-11/12" />
                                <Skeleton className="h-4 w-3/5" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div>
                    <Label>EmptyState · page</Label>
                    <EmptyState
                        icon={Briefcase}
                        title="No jobs yet"
                        description="Share a job link and it lands here, scored against your record, with its stages tracked."
                        action={{ label: 'Paste a job link', onClick: () => {} }}
                        secondary={{ label: 'or connect Job watch', onClick: () => {} }}
                    />
                </div>
                <div>
                    <Label>EmptyState · inline (inside a list)</Label>
                    <div className="rounded-lg border border-border bg-card">
                        <EmptyState
                            size="inline"
                            icon={Inbox}
                            title="Nothing to review"
                            description="New wins land here every Monday. You will get an email when they do."
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}
