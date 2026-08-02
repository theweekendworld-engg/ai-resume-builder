'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';
import { getPacketScope, startPacket } from '@/actions/packets';

import {
    AUDIENCE_LABEL,
    PACKET_TYPE_BLURB,
    PACKET_TYPE_LABEL,
    type PacketAudience,
    type PacketScope,
    type PacketTypeValue,
} from './types';

/** §F1: presets, and one custom escape hatch. Sensible default is 6 months. */
const PERIOD_PRESETS = [
    { key: '6mo', label: 'Last 6 months', days: 182 },
    { key: '12mo', label: 'Last 12 months', days: 365 },
    { key: '3mo', label: 'Last 3 months', days: 91 },
] as const;

type PresetKey = (typeof PERIOD_PRESETS)[number]['key'];

function rangeFor(preset: PresetKey, now: Date): { start: Date; end: Date } {
    const days = PERIOD_PRESETS.find((entry) => entry.key === preset)?.days ?? 182;
    return { start: new Date(now.getTime() - days * 86_400_000), end: now };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rangeLabel(start: Date, end: Date): string {
    return `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}

export interface PacketScopeFormProps {
    initialScope: PacketScope;
    now: Date;
}

/**
 * §F1 — one screen, three interactions, and a live input count.
 *
 * The count is the point: it is the only place before generation where the user
 * finds out their log is thin enough to be a problem, and it warns rather than
 * blocks (a blocked packet teaches nothing).
 */
export function PacketScopeForm({ initialScope, now }: PacketScopeFormProps) {
    const router = useRouter();

    const [preset, setPreset] = React.useState<PresetKey>('6mo');
    const [scope, setScope] = React.useState<PacketScope>(initialScope);
    const [type, setType] = React.useState<PacketTypeValue>(
        initialScope.allowedTypes.includes('performance_review') ? 'performance_review' : 'brag_doc',
    );
    const [audience, setAudience] = React.useState<PacketAudience>('manager');
    const [employerId, setEmployerId] = React.useState<string>('all');
    const [frameworkId, setFrameworkId] = React.useState<string>('none');
    const [targetLevel, setTargetLevel] = React.useState<string>('');
    const [pending, setPending] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);

    const range = React.useMemo(() => rangeFor(preset, now), [preset, now]);

    // The count follows the scope. A stale "47 wins" under a changed date range
    // is worse than no count at all.
    React.useEffect(() => {
        let cancelled = false;
        setRefreshing(true);
        void getPacketScope({ periodStart: range.start, periodEnd: range.end })
            .then((result) => {
                if (cancelled || !result.success) return;
                setScope(result.data);
            })
            .finally(() => {
                if (!cancelled) setRefreshing(false);
            });
        return () => {
            cancelled = true;
        };
    }, [range.start, range.end]);

    const framework = scope.frameworks.find((item) => item.id === frameworkId) ?? null;
    const showTargetLevel = type === 'promotion_case';

    const submit = async () => {
        setPending(true);
        const result = await startPacket({
            periodStart: range.start,
            periodEnd: range.end,
            type,
            audience,
            employerId: employerId === 'all' ? null : employerId,
            frameworkId: frameworkId === 'none' ? null : frameworkId,
            targetLevel: showTargetLevel && targetLevel ? targetLevel : null,
        });
        setPending(false);

        if (!result.success) {
            toast.error(result.error);
            return;
        }
        router.push(`/packets/${result.data.packetId}`);
    };

    return (
        <div className="mx-auto w-full max-w-[560px] px-4 py-10">
            <h1 className={cn(typeStyles.h1, 'text-foreground')}>Generate a review packet</h1>
            <p className={cn(typeStyles.small, 'mt-1 text-muted-foreground')}>
                Walk into your review with a case, not a memory.
            </p>

            <div className="mt-8 space-y-5">
                <Field label="Period" hint={rangeLabel(range.start, range.end)}>
                    <Select value={preset} onValueChange={(value) => setPreset(value as PresetKey)}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PERIOD_PRESETS.map((entry) => (
                                <SelectItem key={entry.key} value={entry.key}>
                                    {entry.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                {scope.employers.length > 0 ? (
                    <Field label="For">
                        <Select value={employerId} onValueChange={setEmployerId}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Everywhere I worked</SelectItem>
                                {scope.employers.map((employer) => (
                                    <SelectItem key={employer.id} value={employer.id}>
                                        {employer.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                ) : null}

                <fieldset>
                    <legend className={cn(typeStyles.caption, 'mb-2 text-muted-foreground')}>Type</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {(['performance_review', 'promotion_case', 'self_appraisal', 'brag_doc'] as const).map(
                            (option) => {
                                const allowed = scope.allowedTypes.includes(option);
                                const selected = type === option;
                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        disabled={!allowed}
                                        onClick={() => setType(option)}
                                        className={cn(
                                            'surface-work rounded-lg border p-3 text-left transition-colors',
                                            selected ? 'border-primary bg-primary/5' : 'border-border bg-card',
                                            !allowed && 'cursor-not-allowed opacity-50',
                                        )}
                                    >
                                        <span className={cn(typeStyles.h3, 'block text-foreground')}>
                                            {PACKET_TYPE_LABEL[option]}
                                        </span>
                                        <span className={cn(typeStyles.caption, 'block text-muted-foreground')}>
                                            {allowed ? PACKET_TYPE_BLURB[option] : 'Paid plans'}
                                        </span>
                                    </button>
                                );
                            },
                        )}
                    </div>
                </fieldset>

                <Field label="Framework" hint={framework?.attribution ?? undefined}>
                    <Select value={frameworkId} onValueChange={setFrameworkId}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">General (Patronus default)</SelectItem>
                            {scope.frameworks.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                    {item.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Link
                        href="/packets/frameworks"
                        className={cn(typeStyles.caption, 'mt-1 inline-block text-primary underline-offset-2 hover:underline')}
                    >
                        Add your company&apos;s ladder
                    </Link>
                </Field>

                {showTargetLevel ? (
                    <Field label="Target level">
                        <Select
                            value={targetLevel || 'unset'}
                            onValueChange={(value) => setTargetLevel(value === 'unset' ? '' : value)}
                            disabled={!framework}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Pick a level" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="unset">Not set</SelectItem>
                                {(framework?.levels ?? []).map((level) => (
                                    <SelectItem key={level.key} value={level.key}>
                                        {level.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {!framework ? (
                            <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>
                                Pick a framework first — a target level only means something on a ladder.
                            </p>
                        ) : null}
                    </Field>
                ) : null}

                <Field label="Audience">
                    <Select value={audience} onValueChange={(value) => setAudience(value as PacketAudience)}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(Object.keys(AUDIENCE_LABEL) as PacketAudience[]).map((key) => (
                                <SelectItem key={key} value={key}>
                                    {AUDIENCE_LABEL[key]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            </div>

            <div className="mt-8 border-t border-border pt-4">
                <p className={cn(typeStyles.small, 'num text-muted-foreground', refreshing && 'opacity-60')}>
                    {scope.confirmedWins} confirmed win{scope.confirmedWins === 1 ? '' : 's'} ·{' '}
                    {scope.withEvidence} with evidence · {scope.withNumbers} with numbers
                </p>

                {scope.thin ? (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 p-3">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                        <p className={cn(typeStyles.small, 'text-foreground')}>
                            Thin log for a {PERIOD_PRESETS.find((entry) => entry.key === preset)?.label.toLowerCase()}{' '}
                            packet. Want to add a few first?{' '}
                            <Link href="/log/backfill" className="text-primary underline-offset-2 hover:underline">
                                Reconstruct this period
                            </Link>
                        </p>
                    </div>
                ) : null}

                <Button className="mt-5 w-full" onClick={submit} disabled={pending}>
                    {pending ? 'Starting…' : 'Generate'}
                </Button>
            </div>
        </div>
    );
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div>
            <Label className={cn(typeStyles.caption, 'mb-1.5 block text-muted-foreground')}>{label}</Label>
            {children}
            {hint ? <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>{hint}</p> : null}
        </div>
    );
}
