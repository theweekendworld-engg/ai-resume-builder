'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { ProgressStages, typeStyles, type ProgressStage } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getPacketProgress } from '@/actions/packets';

import type { PacketProgress } from './types';

const POLL_MS = 1_500;

export interface PacketProgressViewProps {
    packetId: string;
    initialProgress: PacketProgress | null;
}

function toStages(progress: PacketProgress | null): ProgressStage[] {
    if (!progress) return [];
    return progress.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        status: stage.status,
        ...(stage.result ? { result: stage.result } : {}),
    }));
}

/**
 * §F2 — the generation theater.
 *
 * The wait is 30–60 seconds and a silent spinner reads as broken, so every
 * stage keeps its result inline. The state lives in the database rather than in
 * this component, which is what makes a mid-run refresh a non-event.
 */
export function PacketProgressView({ packetId, initialProgress }: PacketProgressViewProps) {
    const router = useRouter();
    const [progress, setProgress] = React.useState<PacketProgress | null>(initialProgress);
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            if (cancelled) return;
            const result = await getPacketProgress(packetId);
            if (cancelled) return;

            if (!result.success) {
                setFailed(true);
                return;
            }

            setProgress(result.data.progress);

            if (result.data.status === 'ready') {
                router.refresh();
                return;
            }
            if (result.data.status === 'failed') {
                setFailed(true);
                return;
            }
            timer = setTimeout(() => void poll(), POLL_MS);
        };

        timer = setTimeout(() => void poll(), POLL_MS);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [packetId, router]);

    return (
        <div className="mx-auto w-full max-w-[520px] px-4 py-16">
            <h1 className={cn(typeStyles.h1, 'mb-6 text-center text-foreground')}>Writing your packet</h1>
            <ProgressStages stages={toStages(progress)} />

            {failed ? (
                <div className="mt-6 rounded-lg border border-danger/20 bg-danger/10 p-4">
                    <p className={cn(typeStyles.small, 'text-foreground')}>
                        That run did not finish. Your log is untouched — nothing was lost.
                    </p>
                    <Button variant="outline" className="mt-3" onClick={() => router.refresh()}>
                        Reload
                    </Button>
                </div>
            ) : (
                <p className={cn(typeStyles.caption, 'mt-6 text-center text-muted-foreground')}>
                    You can leave this page. The packet keeps generating.
                </p>
            )}
        </div>
    );
}
