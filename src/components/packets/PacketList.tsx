'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';

import { PACKET_TYPE_LABEL, type PacketSummary } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function label(start: Date | string, end: Date | string): string {
    const from = start instanceof Date ? start : new Date(start);
    const to = end instanceof Date ? end : new Date(end);
    return `${MONTHS[from.getUTCMonth()]} – ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
}

const STATUS_COPY: Record<string, string> = {
    generating: 'generating…',
    ready: 'ready',
    failed: 'did not finish',
};

export interface PacketListProps {
    packets: PacketSummary[];
}

export function PacketList({ packets }: PacketListProps) {
    if (packets.length === 0) {
        return (
            <div className="mx-auto w-full max-w-[640px] px-4 py-10">
                <EmptyState
                    icon={FileText}
                    title="No packets yet"
                    description="Turn six months of log entries into a case you can hand your manager."
                    action={{ label: 'Generate a packet', href: '/packets/new' }}
                    secondary={{ label: 'See your level readiness', href: '/log/readiness' }}
                />
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-[640px] px-4 py-10">
            <header className="mb-6 flex items-center justify-between gap-3">
                <h1 className={cn(typeStyles.h1, 'text-foreground')}>Review packets</h1>
                <Button asChild size="sm">
                    <Link href="/packets/new">New packet</Link>
                </Button>
            </header>

            <ul className="space-y-2">
                {packets.map((packet) => (
                    <li key={packet.id}>
                        <Link
                            href={`/packets/${packet.id}`}
                            className="surface-work flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 hover:border-primary/40"
                        >
                            <div className="min-w-0">
                                <p className={cn(typeStyles.h3, 'truncate text-foreground')}>
                                    {PACKET_TYPE_LABEL[packet.type]}
                                </p>
                                <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>
                                    {label(packet.periodStart, packet.periodEnd)}
                                    {packet.wordCount > 0 ? ` · ${packet.wordCount} words` : ''}
                                </p>
                            </div>
                            <span
                                className={cn(
                                    typeStyles.caption,
                                    'shrink-0',
                                    packet.status === 'failed' ? 'text-warning' : 'text-muted-foreground',
                                )}
                            >
                                {STATUS_COPY[packet.status] ?? packet.status}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>

            <p className={cn(typeStyles.caption, 'mt-6 text-muted-foreground')}>
                Two packets for the same period is normal — drafts and redos both live here.
            </p>
        </div>
    );
}
