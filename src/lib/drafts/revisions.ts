/**
 * The fixed revisions behind the Shorter / Stronger buttons. A constant
 * module on its own so the button handler can name them without loading the
 * model path (`src/lib/drafts/revise.ts`).
 *
 * Each is stored verbatim as the new version's `instruction`, which is also
 * what makes a second tap on the same button a replay rather than a new edit.
 */

import type { DraftRevision } from '@/lib/drafts/types';

export const REVISION_INSTRUCTIONS: Record<DraftRevision, string> = {
    shorter: 'Make it shorter: cut about a third of the words. Drop the weakest sentence and any repetition. Keep the greeting, the one concrete overlap, the ask and the sign-off.',
    stronger: 'Make it sound stronger and more confident: lead with the most relevant thing I have done, and cut hedging words like "just", "I think", "maybe", "hopefully" and "I was wondering". Do not add any fact, claim or number that is not already in the draft or the evidence.',
};
