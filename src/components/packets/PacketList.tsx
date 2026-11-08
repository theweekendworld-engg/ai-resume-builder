'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, PageBody, PageHeader, Pill, typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';

import { PACKET_TYPE_LABEL, type PacketSummary } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function label(start: Date | string, end: Date | string): string {
    const from = start instanceof Date ? start : new Date(start);
    const to = end instanceof Date ? end : new Date(end);
    return `${MONTHS[from.getUTCMonth()]} – ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
}

const STATUS_COPY: Record<string, string> = {
    generating: 'Generating',
    ready: 'Ready',
    failed: 'Did not finish',
};

const STATUS_DOT: Record<string, 'success' | 'info' | 'warning'> = {
    generating: 'info',
    ready: 'success',
    failed: 'warning',
};

export interface PacketListProps {
    packets: PacketSummary[];
}

/** `/packets` — every review packet, newest first (Dossier, 2026-11-08). */
export function PacketList({ packets }: PacketListProps) {
    const header = (
        <PageHeader width="narrow"
            eyebrow="Your career"
            title="Review prep"
            description="Your confirmed wins, arranged for a performance review or a promotion case."
            actions={
                packets.length > 0 ? (
                    <Button asChild>
                        <Link href="/packets/new">New packet</Link>
                    </Button>
                ) : null
            }
        />
    );

    if (packets.length === 0) {
        return (
            <div>
                {header}
                <PageBody width="narrow">
                    <EmptyState
                        icon={FileText}
                        title="No packets yet"
                        description="Turn six months of log entries into a case you can hand your manager."
                        action={{ label: 'Generate a packet', href: '/packets/new' }}
                        secondary={{ label: 'See your level readiness', href: '/log/readiness' }}
                    />
                </PageBody>
            </div>
        );
    }

    return (
        <div>
            {header}
            <PageBody width="narrow">
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                    {packets.map((packet) => (
                        <li key={packet.id}>
                            <Link
                                href={`/packets/${packet.id}`}
                                className="group flex items-center justify-between gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-offset-[-2px]"
                            >
                                <div className="min-w-0">
                                    <p className={cn(typeStyles.h3, 'truncate text-foreground')}>{PACKET_TYPE_LABEL[packet.type]}</p>
                                    <p className="ledger mt-0.5 text-xs text-muted-foreground">
                                        {label(packet.periodStart, packet.periodEnd)}
                                        {packet.wordCount > 0 ? ` · ${packet.wordCount} words` : ''}
                                    </p>
                                </div>
                                <span className="flex shrink-0 items-center gap-3">
                                    <Pill dot={STATUS_DOT[packet.status]}>{STATUS_COPY[packet.status] ?? packet.status}</Pill>
                                    <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>

                <p className="mt-4 text-[13px] text-muted-foreground">
                    Two packets for the same period is normal — drafts and redos both live here.
                </p>
            </PageBody>
        </div>
    );
}
