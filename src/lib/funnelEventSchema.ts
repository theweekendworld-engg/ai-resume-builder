import { z } from 'zod';

/**
 * Funnel events for the Phase 1 free-checker acquisition loop.
 * Anonymous-capable (sessionId is client-generated and persists across the
 * sign-up redirect via sessionStorage in the pendingScore handoff).
 */
export const FunnelEventTypeSchema = z.enum([
    'score_started',
    'score_completed',
    'score_failed',
    'score_rate_limited',
    'score_cta_clicked',
    'score_to_signup',
]);

export type FunnelEventType = z.infer<typeof FunnelEventTypeSchema>;

export const FunnelEventPayloadSchema = z
    .object({
        sessionId: z.string().min(8).max(64),
        type: FunnelEventTypeSchema,
        payload: z.record(z.string(), z.unknown()).optional().default({}),
        clientOccurredAt: z.string().datetime().optional(),
    })
    .strict();

export type FunnelEventInput = z.infer<typeof FunnelEventPayloadSchema>;
