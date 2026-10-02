'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { searchAdminUsers, setFeatureFlagAllowList, type AdminUserSearch } from '@/actions/admin';

/**
 * Every user, searchable by name, email or id, with what they have done and
 * which features they can see. One tap gives a user Chat while it is off for
 * everyone else (the allow-list, src/lib/flags.ts).
 */

const SEARCH_DELAY_MS = 300;

function ago(iso: string | null): string {
    if (!iso) return '—';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function AdminUsersPanel({ initial }: { initial: AdminUserSearch }) {
    const [query, setQuery] = React.useState('');
    const [result, setResult] = React.useState(initial);
    const [loading, setLoading] = React.useState(false);
    const [busyUser, setBusyUser] = React.useState<string | null>(null);
    const latest = React.useRef(0);

    const load = React.useCallback(async (q: string, page: number) => {
        const ticket = ++latest.current;
        setLoading(true);
        try {
            const next = await searchAdminUsers({ q, page });
            // A slower earlier search must not overwrite a newer one.
            if (ticket === latest.current) setResult(next);
        } catch {
            toast.error('Could not load users.');
        } finally {
            if (ticket === latest.current) setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        const timer = setTimeout(() => void load(query, 0), SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
        // The first render shows `initial`; only a typed query searches.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    const toggleChat = async (userId: string, on: boolean) => {
        setBusyUser(userId);
        const res = await setFeatureFlagAllowList({ key: 'chat', entry: userId, op: on ? 'add' : 'remove' });
        setBusyUser(null);
        if (!res.success) {
            toast.error(res.error);
            return;
        }
        toast.success(on ? 'Chat is on for this user. Live within a minute.' : 'Chat is off for this user.');
        setResult((prev) => ({
            ...prev,
            rows: prev.rows.map((row) => row.userId !== userId ? row : {
                ...row,
                allowedFlags: on ? [...new Set([...row.allowedFlags, 'chat'])] : row.allowedFlags.filter((f) => f !== 'chat'),
            }),
        }));
    };

    const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Users</h2>
                    <p className="text-sm text-muted-foreground">
                        {result.total.toLocaleString('en-IN')} total
                        {result.source === 'profiles' ? ' · Clerk unavailable, showing profiles only' : ''}
                    </p>
                </div>
                <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, email or user id"
                    className="w-72 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                    aria-label="Search users"
                />
            </div>

            <div className={loading ? 'overflow-x-auto opacity-60' : 'overflow-x-auto'}>
                <table className="w-full min-w-[900px] text-sm">
                    <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-4">User</th>
                            <th className="py-2 pr-4">Plan</th>
                            <th className="py-2 pr-4">Joined</th>
                            <th className="py-2 pr-4">Last seen</th>
                            <th className="py-2 pr-4 text-right">Wins</th>
                            <th className="py-2 pr-4 text-right">Jobs</th>
                            <th className="py-2 pr-4 text-right">Chats</th>
                            <th className="py-2 pr-4">Channels</th>
                            <th className="py-2 pr-4">Chat</th>
                            <th className="py-2">Open</th>
                        </tr>
                    </thead>
                    <tbody>
                        {result.rows.map((row) => {
                            const hasChat = row.allowedFlags.includes('chat');
                            return (
                                <tr key={row.userId} className="border-b border-border/60 align-top">
                                    <td className="py-2 pr-4">
                                        <p className="font-medium">{row.name || '—'}</p>
                                        <p className="text-xs text-muted-foreground">{row.email || '—'}</p>
                                        <p className="font-mono text-[11px] text-muted-foreground">{row.userId}</p>
                                    </td>
                                    <td className="py-2 pr-4">{row.plan}</td>
                                    <td className="py-2 pr-4">{ago(row.joinedAt)}</td>
                                    <td className="py-2 pr-4">{ago(row.lastSeenAt)}</td>
                                    <td className="py-2 pr-4 text-right tabular-nums">{row.wins}</td>
                                    <td className="py-2 pr-4 text-right tabular-nums">{row.jobs}</td>
                                    <td className="py-2 pr-4 text-right tabular-nums">{row.chatMessages}</td>
                                    <td className="py-2 pr-4 text-xs">{row.channels.join(', ') || '—'}</td>
                                    <td className="py-2 pr-4">
                                        <button
                                            type="button"
                                            disabled={busyUser === row.userId}
                                            onClick={() => void toggleChat(row.userId, !hasChat)}
                                            className={hasChat
                                                ? 'rounded-md border border-success/30 bg-success/10 px-2 py-1 text-xs text-success disabled:opacity-50'
                                                : 'rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50'}
                                        >
                                            {hasChat ? 'On · remove' : 'Give chat'}
                                        </button>
                                    </td>
                                    <td className="py-2">
                                        <Link href={`/admin/${row.userId}`} className="text-primary hover:underline">View</Link>
                                    </td>
                                </tr>
                            );
                        })}
                        {result.rows.length === 0 ? (
                            <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">No users match.</td></tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {pages > 1 ? (
                <div className="mt-3 flex items-center justify-end gap-2 text-sm">
                    <button type="button" disabled={result.page === 0 || loading} onClick={() => void load(query, result.page - 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-50">Previous</button>
                    <span className="text-muted-foreground">Page {result.page + 1} of {pages}</span>
                    <button type="button" disabled={result.page + 1 >= pages || loading} onClick={() => void load(query, result.page + 1)} className="rounded-md border border-border px-2 py-1 disabled:opacity-50">Next</button>
                </div>
            ) : null}
        </section>
    );
}
