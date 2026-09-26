'use client';

import * as React from 'react';
import { Loader2, ShieldCheck, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCount, relativeTime } from '@/components/scout/format';
import { getContactStats, importLinkedInConnections, type ContactImportSummary } from '@/actions/scout';

/** The action's own ceiling; checked here too so a wrong file fails before upload. */
const MAX_BYTES = 5_000_000;

/**
 * First-degree connections, from the user's own LinkedIn data export.
 *
 * LinkedIn offers no API for connections to an app like this, and signing in
 * with LinkedIn returns a name and a photo, nothing more. The export is the
 * user's data, obtained by the user, and complete — so the screen says how to
 * get it, reads it in the browser, and sends the text.
 */
export function LinkedInConnectionsCard({
    initialStats,
}: {
    initialStats: { total: number; lastImportedAt: string | null } | null;
}) {
    const [stats, setStats] = React.useState(initialStats);
    const [busy, setBusy] = React.useState(false);
    const [summary, setSummary] = React.useState<ContactImportSummary | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const inputId = React.useId();

    const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setError(null);
        setSummary(null);

        if (file.size > MAX_BYTES) {
            setError('That file is larger than 5 MB. Upload Connections.csv on its own, not the whole export archive.');
            return;
        }
        if (!/\.csv$/i.test(file.name)) {
            setError('Upload Connections.csv from inside the export, not the .zip. Unzip it first.');
            return;
        }

        setBusy(true);
        const csv = await file.text();
        const result = await importLinkedInConnections({ csv });
        setBusy(false);
        if (!result.success) {
            setError(result.error);
            return;
        }
        setSummary(result.data);
        const next = await getContactStats();
        if (next.success) setStats(next.data);
    };

    return (
        <Card id="connections">
            <CardHeader>
                <CardTitle className="text-base">LinkedIn connections</CardTitle>
                <CardDescription>
                    With your connections, Scout names the people you already know at a company before suggesting strangers.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
                    <li>On LinkedIn, open <span className="font-medium">Settings &amp; Privacy</span> → <span className="font-medium">Data privacy</span>.</li>
                    <li>Choose <span className="font-medium">Get a copy of your data</span>.</li>
                    <li>Select <span className="font-medium">Connections</span> only, then <span className="font-medium">Request archive</span>.</li>
                    <li>LinkedIn emails a download link, usually within about 10 minutes. Unzip it and upload <span className="font-medium">Connections.csv</span> here.</li>
                </ol>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                        {stats && stats.total > 0
                            ? `${formatCount(stats.total)} connections${stats.lastImportedAt ? ` · last imported ${relativeTime(stats.lastImportedAt)}` : ''}`
                            : 'No connections imported yet.'}
                    </p>
                    <div>
                        <input
                            ref={inputRef}
                            id={inputId}
                            type="file"
                            accept=".csv,text/csv"
                            className="sr-only"
                            onChange={onFile}
                            disabled={busy}
                        />
                        <Button type="button" size="sm" className="gap-1.5" disabled={busy} onClick={() => inputRef.current?.click()}>
                            {busy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Upload aria-hidden className="size-3.5" />}
                            {stats && stats.total > 0 ? 'Upload a newer file' : 'Upload Connections.csv'}
                        </Button>
                    </div>
                </div>

                {summary ? (
                    <p className="text-sm text-foreground" role="status">
                        {formatCount(summary.imported)} added · {formatCount(summary.updated)} updated
                        {summary.skipped ? ` · ${formatCount(summary.skipped)} skipped (no name or profile link)` : ''}, from{' '}
                        {formatCount(summary.total)} rows.
                    </p>
                ) : null}
                {error ? <p className="text-sm text-warning" role="alert">{error}</p> : null}

                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    Stored only to match people to companies you are looking at. Patronus never messages anyone on your behalf:
                    drafts are yours to copy and send. Uploading a newer file updates what is here.
                </p>
            </CardContent>
        </Card>
    );
}
