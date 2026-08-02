import {
    composeStep,
    failPacketStep,
    groupThemesStep,
    mapCompetenciesStep,
    readWinsStep,
    verifyAndFinishStep,
} from '@/workflows/steps/reviewPacket';

/**
 * Review packet generation (PRD 03 §3.1).
 *
 * A user-watched long run, so it belongs to the `workflow` SDK rather than the
 * job queue: the person is on the progress screen for 30–60 seconds and a
 * refresh must not lose the run. Each stage is its own durable step, and every
 * one persists its result — a crash after theme grouping resumes at the
 * mapping, not at the beginning.
 */
export async function handleReviewPacketWorkflow(packetId: string) {
    'use workflow';

    try {
        await readWinsStep(packetId);
        await groupThemesStep(packetId);
        await mapCompetenciesStep(packetId);
        await composeStep(packetId);
        await verifyAndFinishStep(packetId);
    } catch (error: unknown) {
        await failPacketStep(
            packetId,
            error instanceof Error ? error.message : 'Packet generation failed',
        );
    }
}
