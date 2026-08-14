/**
 * Client-safe view types for the packet surfaces.
 *
 * Everything here is `import type` from the service layer: type-only imports are
 * erased at compile time, so a client component can name a `PacketContent`
 * without dragging Prisma into the browser bundle.
 */

import type {
    PacketAudience,
    PacketBlock,
    PacketContent,
    PacketProgress,
    PacketStageState,
    PacketTheme,
    PacketTypeValue,
    PacketWin,
    ReadinessReport,
    UnloggedEvidence,
} from '@/services/reviewPacket';
import type { CompetencyAssessment, FrameworkShape, FrameworkView, Verdict } from '@/services/competency';
import type { PacketScope, PacketSummary, PacketView } from '@/actions/packets';

export type {
    CompetencyAssessment,
    FrameworkShape,
    FrameworkView,
    PacketAudience,
    PacketBlock,
    PacketContent,
    PacketProgress,
    PacketScope,
    PacketStageState,
    PacketSummary,
    PacketTheme,
    PacketTypeValue,
    PacketView,
    PacketWin,
    ReadinessReport,
    UnloggedEvidence,
    Verdict,
};

export const PACKET_TYPE_LABEL: Record<PacketTypeValue, string> = {
    performance_review: 'Performance review',
    promotion_case: 'Promotion case',
    self_appraisal: 'Self-appraisal',
    brag_doc: 'Brag doc',
};

export const PACKET_TYPE_BLURB: Record<PacketTypeValue, string> = {
    performance_review: 'Balanced across your work, with a growth section.',
    promotion_case: 'Filtered to evidence at the level you are going for.',
    self_appraisal: 'Short blocks that fit a form.',
    brag_doc: 'Just the list, in order. No narrative.',
};

export const AUDIENCE_LABEL: Record<PacketAudience, string> = {
    manager: 'My manager',
    skip_level: 'Skip-level / committee',
    self: 'Just me',
};

/**
 * Plain words, never grades. §G: "no score out of 100 — a number invites
 * optimising the number."
 */
export const VERDICT_LABEL: Record<Verdict, string> = {
    strong: 'strong',
    adequate: 'adequate',
    thin: 'thin',
    absent: 'no evidence',
};

export const VERDICT_GLYPH: Record<Verdict, string> = {
    strong: '✓',
    adequate: '~',
    thin: '✗',
    absent: '✗',
};

export function verdictTone(verdict: Verdict): string {
    switch (verdict) {
        case 'strong':
            return 'text-success';
        case 'adequate':
            return 'text-muted-foreground';
        case 'thin':
        case 'absent':
            return 'text-warning';
    }
}
