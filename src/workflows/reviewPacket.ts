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
/**
 * The stage sequence, as a plain function.
 *
 * Extracted so there is exactly ONE ordering of these steps. The workflow
 * wrapper below runs it durably in production; local development calls it
 * directly, because `start()` has no runner outside Vercel and silently
 * accepts a run that then never executes — a packet stuck on `generating`
 * forever with no error anywhere.
 *
 * Two copies of this sequence is what the previous arrangement amounted to,
 * and the dev copy was wrong (it called the workflow wrapper directly, which
 * the SDK rejects). Keep the single definition: a stage added here is a stage
 * both environments run.
 */
export async function runReviewPacketStages(packetId: string): Promise<void> {
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

export async function handleReviewPacketWorkflow(packetId: string) {
    'use workflow';

    await runReviewPacketStages(packetId);
}
