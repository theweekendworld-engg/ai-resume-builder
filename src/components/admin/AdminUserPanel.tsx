'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
    adminDeleteUserData,
    resetUserUsage,
    suspendUser,
    unsuspendUser,
    type AdminUserDetail,
} from '@/actions/admin';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-3 text-lg font-semibold">{title}</h2>
            {children}
        </section>
    );
}

/** Operator actions and the user's recent activity, on /admin/[userId]. */
export function AdminUserPanel({ userId, detail }: { userId: string; detail: AdminUserDetail }) {
    const router = useRouter();
    const [busy, setBusy] = React.useState(false);
    const [reason, setReason] = React.useState('');
    const [confirm, setConfirm] = React.useState('');

    const run = async (label: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
        setBusy(true);
        const result = await fn();
        setBusy(false);
        if (!result.success) toast.error(result.error ?? `${label} failed`);
        else {
            toast.success(`${label}: done`);
            router.refresh();
        }
    };

    return (
        <div className="mb-8 space-y-4">
            <Section title="Account">
                <div className="flex flex-wrap items-start gap-6 text-sm">
                    <div>
                        <p className="text-muted-foreground">Plan</p>
                        <p className="font-medium">{detail.plan}</p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Status</p>
                        <p className={detail.suspension ? 'font-medium text-destructive' : 'font-medium'}>
                            {detail.suspension ? `Suspended ${when(detail.suspension.createdAt)}: ${detail.suspension.reason}` : 'Active'}
                        </p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Channels</p>
                        <p className="font-medium">
                            {detail.channels.length ? detail.channels.map((c) => `${c.channel}${c.verified ? '' : ' (unverified)'}`).join(', ') : 'Web only'}
                        </p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Extension tokens</p>
                        <p className="font-medium">{detail.extensionTokens.filter((t) => !t.revoked && new Date(t.expiresAt) > new Date()).length} live</p>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
                    {detail.suspension ? (
                        <button type="button" disabled={busy} onClick={() => void run('Unsuspend', () => unsuspendUser({ target: userId }))} className="rounded-md border border-border px-3 py-1.5 text-sm">
                            Unsuspend
                        </button>
                    ) : (
                        <>
                            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                            <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void run('Suspend', () => suspendUser({ target: userId, reason }))} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive disabled:opacity-50">
                                Suspend
                            </button>
                        </>
                    )}
                    <button type="button" disabled={busy} onClick={() => void run('Reset usage', () => resetUserUsage({ target: userId }))} className="rounded-md border border-border px-3 py-1.5 text-sm">
                        Reset this period&apos;s usage
                    </button>
                    <span className="ml-auto flex items-center gap-2">
                        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type the user id to delete" className="w-64 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs" />
                        <button type="button" disabled={busy || confirm !== userId} onClick={() => void run('Delete data', () => adminDeleteUserData({ target: userId, confirm }))} className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground disabled:opacity-50">
                            Delete all data
                        </button>
                    </span>
                </div>
            </Section>

            <div className="grid gap-4 lg:grid-cols-2">
                <Section title="Recent chat">
                    {detail.chat.length === 0 ? <p className="text-sm text-muted-foreground">No chat yet.</p> : (
                        <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
                            {detail.chat.map((m, i) => (
                                <li key={i} className={m.role === 'user' ? 'text-foreground' : 'text-muted-foreground'}>
                                    <span className="font-mono text-[11px]">{when(m.createdAt)} {m.role}{m.action ? ` · ${m.action}` : ''}</span>
                                    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
                <Section title="Agent runs">
                    {detail.runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs.</p> : (
                        <ul className="space-y-1 text-sm">
                            {detail.runs.map((r) => (
                                <li key={r.id} className="flex justify-between gap-3">
                                    <Link href={`/admin/runs/${r.id}`} className="text-primary hover:underline">{r.kind ?? 'run'} · {r.status}</Link>
                                    <span className="truncate text-xs text-muted-foreground">{r.error ?? when(r.createdAt)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
                <Section title="Jobs">
                    {detail.jobs.length === 0 ? <p className="text-sm text-muted-foreground">No tracked jobs.</p> : (
                        <ul className="space-y-1 text-sm">
                            {detail.jobs.map((j, i) => <li key={i}>{j.role ?? 'Role'}{j.company ? ` · ${j.company}` : ''} <span className="text-muted-foreground">· {j.status}</span></li>)}
                        </ul>
                    )}
                </Section>
                <Section title="Failed resume generations">
                    {detail.failedGenerations.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                        <ul className="space-y-1 text-sm">
                            {detail.failedGenerations.map((g) => <li key={g.id}><span className="font-mono text-xs">{g.errorStep ?? '—'}</span> {g.errorMessage ?? ''}</li>)}
                        </ul>
                    )}
                </Section>
            </div>

            <Section title="Admin actions on this user">
                {detail.actions.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                    <ul className="space-y-1 text-sm">
                        {detail.actions.map((a) => <li key={a.id}><span className="font-mono text-xs">{when(a.createdAt)}</span> {a.action} <span className="text-muted-foreground">by {a.adminUserId}</span></li>)}
                    </ul>
                )}
            </Section>
        </div>
    );
}
