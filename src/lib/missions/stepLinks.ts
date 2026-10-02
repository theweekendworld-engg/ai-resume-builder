/**
 * Where you do each mission step. Steps named a task ("Run your readiness
 * report") with only Done/Skip beside them, and some of the pages they meant
 * were reachable from nowhere else (launch audit 2026-10-02).
 *
 * Keyed by step key; a key used by several missions means the same place.
 * Steps that happen outside the product ("Have the conversation") have none.
 */
export const STEP_HREF: Readonly<Record<string, string>> = {
    set_target: '/packets/frameworks',
    management_rubric: '/packets/frameworks',
    readiness: '/log/readiness',
    recheck: '/log/readiness',
    close_gap: '/log',
    leadership_evidence: '/log',
    build_evidence: '/log',
    rebuild_log: '/log',
    keep_logging: '/log',
    weekly_ritual: '/log',
    reconstruct: '/log/backfill',
    packet: '/packets/new',
    reframe: '/packets/new',
    define_target: '/settings/job-search',
    target_definition: '/radar',
    refresh_skills: '/radar',
    market_check: '/radar',
    refresh_resume: '/build',
    apply_loop: '/scout',
    interviews: '/scout',
};
