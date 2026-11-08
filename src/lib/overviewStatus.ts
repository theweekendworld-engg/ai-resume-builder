/**
 * Home's one-line status, under the greeting (Dossier, 2026-11-08). Counts,
 * not adjectives (design/00 §10: numbers are specific or absent).
 *
 *   "2 things need you, and 3 jobs are in motion."
 *   "Nothing needs you right now. 14 confirmed wins on record."
 *
 * Pure and structural, so it is tested without the database.
 */
export function overviewStatusLine(data: {
    needsYou: readonly unknown[];
    pipeline: ReadonlyArray<{ count: number }> | null;
    jobs: readonly unknown[] | null;
    record: { confirmed: number } | null;
}): string {
    const needs = data.needsYou.length;
    const inMotion = data.pipeline ? data.pipeline.reduce((sum, stage) => sum + stage.count, 0) : (data.jobs?.length ?? 0);
    const first = needs === 0 ? 'Nothing needs you right now' : `${needs} ${needs === 1 ? 'thing needs' : 'things need'} you`;
    if (inMotion > 0) return `${first}, and ${inMotion} ${inMotion === 1 ? 'job is' : 'jobs are'} in motion.`;
    if (data.record && data.record.confirmed > 0) {
        const n = data.record.confirmed;
        return `${first}. ${n} confirmed ${n === 1 ? 'win' : 'wins'} on record.`;
    }
    return `${first}.`;
}
