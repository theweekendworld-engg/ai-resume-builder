/**
 * Sensitivity enforcement — ADR-8, PRD 01 §4.3, CLAUDE.md rule 3.
 *
 * Sensitivity is a QUERY concern. Nothing in this file talks to a model, and
 * nothing anywhere should ever instruct a model to "skip confidential items".
 * Every retrieval that feeds an *external* artifact (resume, cover letter,
 * apply answer) composes its `where` from here, and the Qdrant payload carries
 * `sensitivity` so the vector filter is the same filter as the SQL one.
 *
 * Tests assert the filter, not the output text. A test that checks "the resume
 * didn't mention it" is a test that passes by luck.
 */

import { Prisma, WinSensitivity, WinStatus } from '@prisma/client';

/** The one sensitivity that may leave the building. */
export const EXTERNAL_SAFE = { sensitivity: WinSensitivity.shareable } as const;

/** Everything the external filter must exclude. Kept explicit so adding a new
 *  enum member is a compile error here rather than a silent leak. */
export const EXTERNAL_BLOCKED_SENSITIVITIES: readonly WinSensitivity[] = [
    WinSensitivity.internal_only,
    WinSensitivity.confidential,
];

/**
 * Only a confirmed Win is externally usable. A draft is an unreviewed model
 * guess; a dismissed one was rejected; an archived one was deliberately taken
 * out of circulation (it stays available to packets and exports, which are
 * internal surfaces, via {@link internalRetrievalFilter}).
 */
export const EXTERNAL_SAFE_STATUSES: readonly WinStatus[] = [WinStatus.confirmed];

/** Qdrant payload discriminator for Win points (PRD 01 §7.2). */
export const WIN_POINT_TYPE = 'win';

export type QdrantMatchCondition = { key: string; match: { value: string } };
export type QdrantFilter = { must: QdrantMatchCondition[] };

export function isExternallyShareable(sensitivity: WinSensitivity): boolean {
    return sensitivity === WinSensitivity.shareable;
}

/**
 * The SQL half of ADR-8. Compose, never hand-roll:
 *
 *   prisma.win.findMany({ where: { ...externalRetrievalFilter(userId), category } })
 */
export function externalRetrievalFilter(userId: string): Prisma.WinWhereInput {
    return {
        userId,
        sensitivity: WinSensitivity.shareable,
        status: { in: [...EXTERNAL_SAFE_STATUSES] },
    };
}

/**
 * Packets and 1:1 prep may show `internal_only`; they may not show
 * `confidential` without an explicit flag, so `confidential` is excluded here
 * too and callers that genuinely need it must ask for it by name.
 */
export function internalRetrievalFilter(userId: string): Prisma.WinWhereInput {
    return {
        userId,
        sensitivity: { in: [WinSensitivity.shareable, WinSensitivity.internal_only] },
        status: { in: [WinStatus.confirmed, WinStatus.archived] },
    };
}

/**
 * The vector half of ADR-8 — the same predicate, expressed for Qdrant. The
 * payload written by the embed handler carries `userId`, `type` and
 * `sensitivity` precisely so this can exist.
 */
export function qdrantExternalFilter(userId: string): QdrantFilter {
    return {
        must: [
            { key: 'userId', match: { value: userId } },
            { key: 'type', match: { value: WIN_POINT_TYPE } },
            { key: 'sensitivity', match: { value: WinSensitivity.shareable } },
        ],
    };
}

/**
 * True when a Win may be written to the vector store at all. Anything else is
 * never embedded — not embedded-then-filtered, never embedded (PRD 01 §4.3).
 */
export function mayEmbed(win: { status: WinStatus; sensitivity: WinSensitivity }): boolean {
    return win.status === WinStatus.confirmed && isExternallyShareable(win.sensitivity);
}
