/**
 * Server-side telemetry (impl/00 §P-4).
 *
 * The counterpart to `funnelEvents.ts`, which is client-only (`'use client'`,
 * sendBeacon). Server actions, job handlers, and route handlers write here.
 *
 * Two rules, both non-negotiable:
 *   1. Instrumentation never throws into the caller. A telemetry outage must
 *      not fail a user action.
 *   2. Instrumentation never blocks. Callers may fire-and-forget.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Event names used by the Career OS surfaces. A union rather than free strings
 * so a typo shows up at compile time instead of as a silently missing metric.
 * Names are the ones the PRDs specify — do not rename without updating them.
 */
export const SERVER_EVENTS = [
    // Work log — PRD 01 §11
    'win_drafted',
    'win_confirmed',
    'win_dismissed',
    'win_edited_field',
    'win_unconfirmed',
    'win_archived',
    'win_unarchived',
    'win_deleted',
    'win_merge_proposed',
    'quick_capture_submitted',
    'quantify_prompt_shown',
    'quantify_prompt_answered',
    'month_in_review_sent',

    // Digest ritual — PRD 01 §11
    'digest_sent',
    'digest_opened',
    'digest_action',

    // Capture — PRD 02 §10
    'source_connect_started',
    'source_connect_completed',
    'source_connect_abandoned',
    'source_repo_selection_saved',
    'capture_run_finished',
    'source_error',
    'source_disconnected',
    'noise_rule_added',

    // Packets — PRD 03 §9
    'packet_started',
    'packet_completed',
    'packet_exported',
    'packet_section_regenerated',
    /** High edit rates tell us which section we generate worst. */
    'packet_block_edited',
    'framework_uploaded',
    'framework_parsed',
    'framework_corrected',
    'readiness_viewed',
    /**
     * The loop-closing metric: a gap report that finds evidence the user
     * already has but hasn't logged, converting diagnosis into capture.
     */
    'readiness_capture_prompt_clicked',

    // Backfill — PRD 07 §7
    'backfill_started',
    'backfill_question_answered',
    'backfill_win_captured',
    'backfill_abandoned',
    /** Target >60%. Below 45% the conversation is too long or too dull. */
    'backfill_completed',
    'backfill_wins_confirmed',
    'backfill_resumed',

    // Entitlements — PRD 06 §7
    'paywall_shown',
    'paywall_cta_clicked',
    'quota_exhausted',
    'entitlement_soft_allowed',
    'checkout_started',
    'checkout_completed',
    'plan_changed',
    // The trust-building downgrade (PRD 06 §5.3). `search_reactivated` is the
    // thesis metric: if volunteering the downgrade does not increase lifetime
    // revenue, this is the number that tells us.
    'proactive_downgrade_offered',
    'proactive_downgrade_accepted',
    'proactive_downgrade_declined',
    'search_reactivated',
    'cancel_flow_entered',
    'cancel_flow_completed',
    'data_exported',

    // AI safety — PRD 08 §5
    'ai_guard_violation',
] as const;

export type ServerEvent = (typeof SERVER_EVENTS)[number];

/**
 * Record an event. Fire-and-forget: awaiting is optional and failures are
 * swallowed after logging.
 *
 * `sessionId` is required by the FunnelEvent model but meaningless for
 * server-originated events, so we tag them so client-funnel queries can
 * exclude them rather than silently mixing two populations.
 */
export async function track(
    userId: string | null,
    type: ServerEvent,
    payload: Record<string, unknown> = {},
): Promise<void> {
    try {
        await prisma.funnelEvent.create({
            data: {
                sessionId: 'server',
                userId: userId ?? undefined,
                type,
                payload: payload as Prisma.InputJsonValue,
            },
        });
    } catch (error: unknown) {
        console.warn('[track] event write failed', {
            type,
            error: error instanceof Error ? error.message : 'unknown error',
        });
    }
}

/**
 * Explicit fire-and-forget for hot paths where even the await is unwanted.
 * Returns void immediately; the write settles on its own.
 */
export function trackAsync(
    userId: string | null,
    type: ServerEvent,
    payload: Record<string, unknown> = {},
): void {
    void track(userId, type, payload);
}
