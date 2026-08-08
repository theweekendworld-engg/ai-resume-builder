'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { seedFeatureFlags, setFeatureFlag, type FeatureFlagRow } from '@/actions/admin';

/**
 * The one admin operation that gates the entire product.
 *
 * Every feature the pricing page sells sits behind a flag, and until this
 * panel existed there was no write path — flags could be changed by SQL
 * against production and by nothing else.
 *
 * A row with `seeded: false` has no database row at all, which is a strictly
 * worse state than disabled: `decideFlag` returns false for a missing row
 * before it consults the allow-list, so not even an admin can see the feature.
 * Those are called out separately rather than rendered as "off", because "off"
 * suggests someone chose it.
 */

const LABELS: Record<string, string> = {
    work_log: 'Work Log',
    github_capture: 'GitHub capture',
    weekly_digest: 'Weekly digest',
    review_packet: 'Review packets',
    month_in_review: 'Month in Review',
    backfill: 'Backfill',
    career_radar: 'Career Radar',
    missions: 'Missions',
};

function FlagRow({ row, onChanged }: { row: FeatureFlagRow; onChanged: () => void }) {
    const [busy, setBusy] = React.useState(false);
    const [rollout, setRollout] = React.useState(row.rolloutPercent);

    const save = async (next: { enabled?: boolean; rolloutPercent?: number }) => {
        setBusy(true);
        const result = await setFeatureFlag({
            key: row.key,
            enabled: next.enabled ?? row.enabled,
            rolloutPercent: next.rolloutPercent ?? rollout,
        });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error ?? 'Could not save that flag.');
            return;
        }
        toast.success(`${LABELS[row.key] ?? row.key} updated.`);
        onChanged();
    };

    const live = row.enabled && rollout > 0;

    return (
        <tr className="border-b border-border/60">
            <td className="py-3 pr-4">
                <p className="font-medium text-foreground">{LABELS[row.key] ?? row.key}</p>
                <p className="font-mono text-xs text-muted-foreground">{row.key}</p>
            </td>
            <td className="py-3 pr-4">
                {row.seeded ? (
                    <span
                        className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                            live
                                ? 'border-success/30 bg-success/10 text-success'
                                : 'border-border bg-muted text-muted-foreground',
                        )}
                    >
                        {live ? 'live' : 'off'}
                    </span>
                ) : (
                    <span className="inline-flex items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        no row
                    </span>
                )}
            </td>
            <td className="py-3 pr-4">
                <Switch
                    checked={row.enabled}
                    disabled={busy}
                    onCheckedChange={(checked) => void save({ enabled: checked })}
                    aria-label={`Enable ${LABELS[row.key] ?? row.key}`}
                />
            </td>
            <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        min={0}
                        max={100}
                        value={rollout}
                        disabled={busy}
                        onChange={(event) => setRollout(Number(event.target.value))}
                        onBlur={() => {
                            if (rollout !== row.rolloutPercent) void save({ rolloutPercent: rollout });
                        }}
                        className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
                        aria-label={`Rollout percent for ${LABELS[row.key] ?? row.key}`}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                </div>
            </td>
            <td className="py-3 text-xs text-muted-foreground">
                {row.allowUserIds.length > 0
                    ? `${row.allowUserIds.length} on the allow-list`
                    : '—'}
            </td>
        </tr>
    );
}

export function FeatureFlagPanel({ initial }: { initial: FeatureFlagRow[] }) {
    const [rows, setRows] = React.useState(initial);
    const [seeding, setSeeding] = React.useState(false);
    const missing = rows.filter((row) => !row.seeded);

    React.useEffect(() => setRows(initial), [initial]);

    const seed = async () => {
        setSeeding(true);
        const result = await seedFeatureFlags();
        setSeeding(false);
        toast.success(
            result.seeded > 0
                ? `Created ${result.seeded} missing flag row${result.seeded === 1 ? '' : 's'}.`
                : 'Every declared flag already has a row.',
        );
        // The rows come from a server component above; a refresh is the
        // honest way to show what the database now holds.
        window.location.reload();
    };

    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Feature flags</h2>
                    <p className="text-sm text-muted-foreground">
                        Every feature the pricing page sells is gated here. A flag that is off
                        makes its surface unreachable for customers who were sold it.
                    </p>
                </div>
                <Button variant="outline" size="sm" disabled={seeding} onClick={() => void seed()}>
                    {seeding ? 'Seeding…' : 'Seed missing rows'}
                </Button>
            </div>

            {missing.length > 0 ? (
                <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
                    {missing.length} declared flag{missing.length === 1 ? ' has' : 's have'} no
                    database row: <span className="font-mono">{missing.map((row) => row.key).join(', ')}</span>.
                    A missing row is off for <em>everyone</em>, allow-list included, and cannot be
                    turned on until it exists. Seeding creates them disabled.
                </p>
            ) : null}

            <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-4">Feature</th>
                            <th className="py-2 pr-4">State</th>
                            <th className="py-2 pr-4">Enabled</th>
                            <th className="py-2 pr-4">Rollout</th>
                            <th className="py-2">Allow-list</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <FlagRow
                                key={row.key}
                                row={row}
                                onChanged={() => setRows((prev) => [...prev])}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
                Enabled with a 0% rollout is still off for everyone outside the allow-list. Set
                both.
            </p>
        </section>
    );
}
