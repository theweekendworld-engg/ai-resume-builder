/**
 * The Mission catalog (PRD 05 §3).
 *
 * Templates live here rather than in the database because they change with
 * releases, not per user. Instantiating a mission COPIES a template into
 * `MissionStep` rows, so shipping a changed template can never reorder or
 * rename the steps of someone's in-flight mission. That copy is the whole
 * reason this file is data and not a query.
 *
 * ── The rule that shapes every template ─────────────────────────────────────
 *
 * §4: at least 60% of the steps in every mission must be `automatic` or
 * `threshold`. A mission that is mostly checkboxes is a to-do list, and this
 * product is not a to-do list — the point is that the graph already knows
 * whether you did the thing. `catalog.test.ts` enforces the ratio, so a new
 * mission cannot be merged as a checklist.
 *
 * The corollary is stricter than it looks. Every `automatic` step has to name
 * a real telemetry event, and every `threshold` step a query the evaluator can
 * actually run. A step whose condition nothing satisfies is worse than a
 * checkbox: it can never complete, and it silently strands the mission.
 * Both are checked by tests against `track.ts` and the evaluator's own
 * registry.
 */

import { MissionStepKind, MissionType } from '@prisma/client';
import type { ServerEvent } from '@/lib/track';

/**
 * The queries a `threshold` step may count.
 *
 * A closed set, not free-form SQL: the evaluator has to be pure and
 * idempotent (§6.1), which it cannot be if a template can ask it anything.
 * Adding a mission that needs a new count means adding a case to the
 * evaluator, and that is the correct amount of friction.
 */
export const THRESHOLD_QUERIES = [
    /** Confirmed Wins whose category matches `config.gapCategory`. */
    'confirmed_wins_in_gap_category',
    /** Confirmed Wins of any kind since the mission started. */
    'confirmed_wins_since_start',
    /** Application workspaces created since the mission started. */
    'applications_since_start',
    /** Workspaces that have reached an interview stage. */
    'interviews_reached',
    /** Wins carrying a `grew` / `led` / `influenced` signal — the management case. */
    'leadership_wins',
] as const;

export type ThresholdQuery = (typeof THRESHOLD_QUERIES)[number];

export type StepCondition =
    | { kind: 'automatic'; event: ServerEvent }
    | { kind: 'threshold'; query: ThresholdQuery; target: number }
    | { kind: 'attested' };

export type MissionStepTemplate = {
    /** Stable across releases. Progress keys off this, never the title. */
    key: string;
    title: string;
    /** One line under the title in the Home card. Omitted where the title says it all. */
    hint?: string;
    condition: StepCondition;
};

export type MissionTemplate = {
    type: MissionType;
    /** Catalog label. The user's own `Mission.title` overrides it on creation. */
    label: string;
    /** The sentence shown on the chooser card. Second person, no hype. */
    blurb: string;
    /** Shown on the card so nobody commits to a 9-month program by accident. */
    durationLabel: string;
    steps: MissionStepTemplate[];
};

const automatic = (event: ServerEvent): StepCondition => ({ kind: 'automatic', event });
const threshold = (query: ThresholdQuery, target: number): StepCondition => ({
    kind: 'threshold',
    query,
    target,
});
const attested = (): StepCondition => ({ kind: 'attested' });

/**
 * M1 — Get promoted. The flagship.
 *
 * The gap-closing loop is the mission, not the packet at the end of it. It is
 * the only step in this product that changes what someone DOES at work rather
 * than what they write down afterwards, and it is deliberately the longest.
 */
const GET_PROMOTED: MissionTemplate = {
    type: MissionType.get_promoted,
    label: 'Get promoted',
    blurb: 'Set the target level, find the gap in your evidence, and close it before the review.',
    durationLabel: '3–6 months',
    steps: [
        {
            key: 'set_target',
            title: 'Set your target level and rubric',
            hint: 'Upload or pick the ladder you are being measured against.',
            condition: automatic('framework_uploaded'),
        },
        {
            key: 'readiness',
            title: 'Run your readiness report',
            hint: 'Where the evidence is strong, and where it is thin.',
            condition: automatic('readiness_viewed'),
        },
        {
            key: 'close_gap',
            title: 'Close the gap',
            hint: 'Log evidence against the competency the report called thin.',
            condition: threshold('confirmed_wins_in_gap_category', 3),
        },
        {
            key: 'recheck',
            title: 'Re-run readiness',
            hint: 'Same report, after the work. This is the before-and-after.',
            condition: automatic('readiness_viewed'),
        },
        {
            key: 'packet',
            title: 'Generate your promotion packet',
            condition: automatic('packet_completed'),
        },
        {
            key: 'conversation',
            title: 'Have the conversation',
            hint: 'Only you know when this happened.',
            condition: attested(),
        },
    ],
};

/** M2 — Land a new role. Needs Search; the pacing layer is what it adds. */
const LAND_NEW_ROLE: MissionTemplate = {
    type: MissionType.land_new_role,
    label: 'Land a new role',
    blurb: 'Define the target, set a weekly application pace, and keep the pipeline honest.',
    durationLabel: '6–12 weeks',
    steps: [
        {
            key: 'define_target',
            title: 'Define the target',
            hint: 'Role, level, and a comp floor from Radar.',
            condition: automatic('radar_viewed'),
        },
        {
            key: 'refresh_resume',
            title: 'Refresh your master resume from the log',
            condition: automatic('resume_generated'),
        },
        {
            key: 'apply_loop',
            title: 'Work the application pace',
            hint: 'Your weekly target, tracked against what you actually sent.',
            condition: threshold('applications_since_start', 24),
        },
        {
            key: 'interviews',
            title: 'Get into interviews',
            condition: threshold('interviews_reached', 3),
        },
        {
            key: 'offer',
            title: 'Take the offer conversation',
            hint: 'Negotiating? Start the negotiate mission — it runs in days, not weeks.',
            condition: attested(),
        },
    ],
};

/** M3 — Switch domains. The gap analysis is Radar pointed at a role you don't have. */
const SWITCH_DOMAIN: MissionTemplate = {
    type: MissionType.switch_domain,
    label: 'Switch domains',
    blurb: 'Find what the target role asks for that you cannot yet evidence, then build it.',
    durationLabel: '3–9 months',
    steps: [
        {
            key: 'target_definition',
            title: 'Name the target and see the gap',
            hint: "Your skills against what the market asks for in the role you want.",
            condition: automatic('radar_viewed'),
        },
        {
            key: 'build_evidence',
            title: 'Build the missing evidence',
            hint: 'Internal work, side projects — anything real, logged as a win.',
            condition: threshold('confirmed_wins_since_start', 5),
        },
        {
            key: 'reframe',
            title: 'Reframe what you already have',
            hint: 'Most of the case is work you have already done, described for the new audience.',
            condition: automatic('resume_generated'),
        },
        {
            key: 'ready_to_apply',
            title: 'Decide you are ready to apply',
            condition: attested(),
        },
    ],
};

/** M5 — IC to manager. M1 with a different rubric and a different evidence target. */
const IC_TO_MANAGER: MissionTemplate = {
    type: MissionType.ic_to_manager,
    label: 'Move into management',
    blurb: 'Build the evidence a management ladder asks for, then have the conversation.',
    durationLabel: '3–9 months',
    steps: [
        {
            key: 'management_rubric',
            title: 'Set the management rubric',
            condition: automatic('framework_uploaded'),
        },
        {
            key: 'readiness',
            title: 'See where you stand against it',
            condition: automatic('readiness_viewed'),
        },
        {
            key: 'leadership_evidence',
            title: 'Build the leadership record',
            hint: 'Growing people, leading work, influencing decisions.',
            condition: threshold('leadership_wins', 4),
        },
        {
            key: 'packet',
            title: 'Make the case in writing',
            condition: automatic('packet_completed'),
        },
        {
            key: 'conversation',
            title: 'Have the conversation',
            condition: attested(),
        },
    ],
};

/** M6 — Return after a break. Underserved, high emotional stakes. */
const RETURN_FROM_BREAK: MissionTemplate = {
    type: MissionType.return_from_break,
    label: 'Return after a break',
    blurb: 'Reconstruct the record from before the break, then go back out with it intact.',
    durationLabel: '4–12 weeks',
    steps: [
        {
            key: 'reconstruct',
            title: 'Reconstruct what you did before',
            hint: 'We will walk your history with you. It is easier than starting from a blank page.',
            condition: automatic('backfill_completed'),
        },
        {
            key: 'rebuild_log',
            title: 'Get the record back to solid',
            condition: threshold('confirmed_wins_since_start', 8),
        },
        {
            key: 'refresh_skills',
            title: 'Check your skills against the market now',
            hint: 'What the role asks for today, not when you left.',
            condition: automatic('radar_viewed'),
        },
        {
            key: 'ready',
            title: 'Decide you are ready',
            condition: attested(),
        },
    ],
};

/**
 * M7 — Keep warm. The resting state, and every user has it from day one.
 *
 * Deliberately has no `attested` step and no end. §3: it is "not shown as a
 * mission with progress; it's the resting state". The steps exist so the Home
 * surface has something true to render for someone with no goal — not so that
 * anyone can finish it.
 */
const KEEP_WARM: MissionTemplate = {
    type: MissionType.keep_warm,
    label: 'Keep the record warm',
    blurb: 'No specific goal right now. Stay ready anyway — it costs a few minutes a week.',
    durationLabel: 'ongoing',
    steps: [
        {
            key: 'weekly_ritual',
            title: 'Confirm this week’s wins',
            condition: automatic('win_confirmed'),
        },
        {
            key: 'keep_logging',
            title: 'Keep the log current',
            condition: threshold('confirmed_wins_since_start', 12),
        },
        {
            key: 'market_check',
            title: 'Check the market monthly',
            condition: automatic('radar_viewed'),
        },
    ],
};

/**
 * M4 (negotiate an offer) is deliberately absent.
 *
 * PRD 05 calls it the highest value-per-minute mission in the product, and it
 * is — but it is unbuildable today and shipping it anyway would have meant
 * shipping a lie. Its steps are "enter the offer" and "record what happened",
 * and `OfferDataPoint` (PRD 04 §3.3) has ZERO writers: no action, no form, no
 * route creates one. Every automatic step would have had to become a checkbox,
 * putting the mission at 40% non-manual against a 60% floor — i.e. the rule in
 * §4 would itself have told us not to ship it.
 *
 * It needs an offer-capture surface first. The type stays in the enum so the
 * migration does not churn when that lands.
 */
export const MISSION_CATALOG: Record<Exclude<MissionType, 'negotiate_offer'>, MissionTemplate> = {
    [MissionType.get_promoted]: GET_PROMOTED,
    [MissionType.land_new_role]: LAND_NEW_ROLE,
    [MissionType.switch_domain]: SWITCH_DOMAIN,
    [MissionType.ic_to_manager]: IC_TO_MANAGER,
    [MissionType.return_from_break]: RETURN_FROM_BREAK,
    [MissionType.keep_warm]: KEEP_WARM,
};

/** The mission types that actually have a template today. */
export type BuiltMissionType = keyof typeof MISSION_CATALOG;

export function isBuiltMissionType(type: MissionType): type is BuiltMissionType {
    return type in MISSION_CATALOG;
}

/**
 * The template for a type, or null.
 *
 * Nullable rather than throwing because `negotiate_offer` is a live enum member
 * with no template (see above). A stored Mission row of that type would be
 * data we cannot render — the caller decides whether that is a skip or an
 * error, and neither should be a crash.
 */
export function missionTemplate(type: MissionType): MissionTemplate | null {
    return isBuiltMissionType(type) ? MISSION_CATALOG[type] : null;
}

/** Every mission a user can choose. M7 is the fallback, not a choice. */
export const SELECTABLE_MISSIONS: MissionType[] = [
    MissionType.get_promoted,
    MissionType.land_new_role,
    MissionType.switch_domain,
    MissionType.ic_to_manager,
    MissionType.return_from_break,
];

/** Map a template condition onto the Prisma enum the row stores. */
export function stepKindOf(condition: StepCondition): MissionStepKind {
    switch (condition.kind) {
        case 'automatic':
            return MissionStepKind.automatic;
        case 'threshold':
            return MissionStepKind.threshold;
        case 'attested':
            return MissionStepKind.attested;
    }
}

/** §4's design rule, as a number. Exported so the test and the doc agree. */
export const MIN_NON_MANUAL_RATIO = 0.6;

export function nonManualRatio(template: MissionTemplate): number {
    const nonManual = template.steps.filter((step) => step.condition.kind !== 'attested').length;
    return nonManual / template.steps.length;
}
