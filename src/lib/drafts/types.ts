/**
 * One version of a message the user sends themselves (`MessageDraft`,
 * docs/impl/07-telegram-apply.md §3), as every surface reads it.
 *
 * Patronus never sends these. An email draft becomes a compose link the user
 * opens in their own mail app (`src/lib/drafts/compose.ts`).
 */

import type { DraftFormat, DraftTarget } from '@/lib/scout/types';

export type DraftView = {
    id: string;
    /** 1 for the first draft; each revision is a new row, `version + 1`. */
    version: number;
    runId: string | null;
    workspaceId: string | null;
    format: DraftFormat;
    target: DraftTarget;
    /** From the posting by code, or typed by the user. Never model-written. */
    toEmail: string | null;
    subject: string | null;
    body: string;
    createdAt: string;
    /** The version this one revised; null for a first draft. */
    parentId?: string | null;
    /** The instruction that produced this version, verbatim ("Make it shorter: …"). */
    instruction?: string | null;
};

/** The fixed revisions behind the Shorter / Stronger buttons. */
export type DraftRevision = 'shorter' | 'stronger';
