/**
 * The skills section, arranged the way a person arranges it.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * Two renderers disagreed about what a resume even looks like.
 *
 * The LaTeX template grouped skills under bold labels — but off a hardcoded
 * regex that knew about forty engineering terms and nothing else, so a
 * designer's or a marketer's entire section landed in one bucket called
 * "Other Tools".
 *
 * The live HTML preview — the one the user actually looks at while editing —
 * did `data.skills.join(' · ')`. One undifferentiated run of text, no labels,
 * no order. Since that is the preview, the section looked broken during the
 * whole editing session and only came right in the exported PDF, if at all.
 *
 * Both now call this. One document, two renderers.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 *
 * Category label in bold, then a comma-separated run:
 *
 *   Languages: Go, Python, Java, TypeScript, Rust, C++
 *   Databases & Search: PostgreSQL, MongoDB, Redis, Elasticsearch
 *
 * That is what a strong hand-built resume does, and it beats a flat list for
 * the two readers that matter: a human skims to the row they care about, and
 * an ATS still sees every term as plain text.
 */

import { normalizeSkill } from '@/lib/radar/skills';
import { isPlausibleSkill } from './skillVocab';
import { displaySkill } from './skills';

export type SkillGroup = {
    /** "Languages", "Cloud & Infrastructure". Rendered bold, then a colon. */
    label: string;
    skills: string[];
};

/**
 * Category per canonical slug.
 *
 * Keyed on the slug rather than the display string so "Postgres",
 * "PostgreSQL" and "postgres" all land in the same row. Every slug in
 * `knownSkills()` appears here; the parity is enforced by a test, because a
 * slug added to the taxonomy and missed here silently falls into the catch-all
 * and looks like the bug this module exists to fix.
 */
const CATEGORY_BY_SLUG: Record<string, string> = {
    // ── engineering
    // `go`, `rust`, `r_lang` and `c_lang` come from the AMBIGUOUS table rather
    // than SKILL_ALIASES, so they were absent from `knownSkills()` and the
    // parity test below could not have caught their omission. Go rendered
    // under the catch-all row.
    go: 'languages', rust: 'languages', r_lang: 'languages', c_lang: 'languages',
    python: 'languages', typescript: 'languages', javascript: 'languages',
    java: 'languages', kotlin: 'languages', swift: 'languages', ruby: 'languages',
    php: 'languages', scala: 'languages', elixir: 'languages', csharp: 'languages',
    cpp: 'languages', sql: 'languages',

    postgresql: 'data', mysql: 'data', mongodb: 'data', redis: 'data',
    elasticsearch: 'data', dynamodb: 'data', snowflake: 'data', bigquery: 'data',
    clickhouse: 'data', cassandra: 'data', dbt: 'data', pandas: 'data',
    spark: 'data', airflow: 'data',

    kubernetes: 'infra', docker: 'infra', terraform: 'infra', aws: 'infra',
    ec2: 'infra', s3: 'infra', lambda: 'infra', rds: 'infra', gcp: 'infra',
    azure: 'infra', ci_cd: 'infra',

    kafka: 'backend', grpc: 'backend', graphql: 'backend',
    microservices: 'backend', distributed_systems: 'backend',

    observability: 'observability',

    react: 'frontend', nextjs: 'frontend', vue: 'frontend', angular: 'frontend',
    svelte: 'frontend', tailwind: 'frontend', swiftui: 'frontend',
    accessibility: 'frontend',

    pytorch: 'ml', tensorflow: 'ml', llm: 'ml', rag: 'ml', machine_learning: 'ml',

    security: 'practice',

    // ── design
    design_systems: 'design', user_research: 'design', usability_testing: 'design',
    wireframing: 'design', prototyping: 'design', interaction_design: 'design',
    information_architecture: 'design', journey_mapping: 'design',
    visual_design: 'design', design_ops: 'design', design_critique: 'design',
    figma: 'designTools', sketch: 'designTools', framer: 'designTools',
    adobe_creative_suite: 'designTools',

    // ── marketing and growth
    paid_acquisition: 'growth', lifecycle_marketing: 'growth',
    content_marketing: 'growth', brand_marketing: 'growth',
    demand_generation: 'growth', go_to_market: 'growth', seo: 'growth',
    ab_testing: 'growth', attribution: 'growth',
    hubspot: 'growthTools', marketo: 'growthTools', braze: 'growthTools',
    google_ads: 'growthTools', meta_ads: 'growthTools',
    google_analytics: 'growthTools', product_analytics: 'growthTools',
    salesforce: 'growthTools',

    // ── data and analysis
    tableau: 'analytics', looker: 'analytics', power_bi: 'analytics',
    excel: 'analytics', data_visualization: 'analytics', statistics: 'analytics',
    forecasting: 'analytics',

    // ── operations and people
    project_management: 'ops', stakeholder_management: 'ops',
    process_improvement: 'ops', vendor_management: 'ops',
    financial_modelling: 'ops', budget_ownership: 'ops', mentoring: 'ops',
    jira: 'opsTools', notion: 'opsTools', asana: 'opsTools',
};

/**
 * Display order and label.
 *
 * Order is a judgement about what a reader scans for first, and it differs by
 * profession — but a single order that puts concrete, checkable things above
 * practices reads correctly for all of them. Empty categories never render, so
 * a designer simply never sees the engineering rows.
 */
const CATEGORIES: Array<{ key: string; label: string }> = [
    { key: 'languages', label: 'Languages' },
    { key: 'backend', label: 'Backend & Distributed Systems' },
    { key: 'data', label: 'Databases & Data' },
    { key: 'infra', label: 'Cloud & Infrastructure' },
    { key: 'observability', label: 'Observability' },
    { key: 'ml', label: 'AI & Machine Learning' },
    { key: 'frontend', label: 'Frontend' },
    { key: 'design', label: 'Design' },
    { key: 'designTools', label: 'Design Tools' },
    { key: 'growth', label: 'Growth & Marketing' },
    { key: 'growthTools', label: 'Marketing Platforms' },
    { key: 'analytics', label: 'Analytics' },
    { key: 'ops', label: 'Operations & Leadership' },
    { key: 'opsTools', label: 'Tools' },
    { key: 'practice', label: 'Practices' },
];

/** Everything the taxonomy does not recognise. Never the biggest row. */
const OTHER_LABEL = 'Also';

/**
 * A last-resort guess for a label the taxonomy has never seen.
 *
 * Deliberately small. The right fix for a miss is a taxonomy entry, not a
 * cleverer regex — this exists so a niche library lands somewhere sensible
 * rather than in the catch-all, and it is checked only after the slug lookup.
 */
const HEURISTIC: Array<[RegExp, string]> = [
    [/\b(sdk|api|framework|library)\b/i, 'backend'],
    [/\b(db|database|warehouse|sql)\b/i, 'data'],
    [/\b(cloud|server|deploy|infra|pipeline)\b/i, 'infra'],
    [/\b(design|ux|ui|research)\b/i, 'design'],
    [/\b(marketing|campaign|ads?|seo|growth)\b/i, 'growth'],
    [/\b(analytics|reporting|dashboard|forecast)\b/i, 'analytics'],
];

function categoryFor(label: string): string | null {
    const slug = normalizeSkill(label);
    if (slug && CATEGORY_BY_SLUG[slug]) return CATEGORY_BY_SLUG[slug];
    for (const [pattern, key] of HEURISTIC) {
        if (pattern.test(label)) return key;
    }
    return null;
}

/**
 * Is this a skill, or a sentence that escaped a filter upstream?
 *
 * A live resume shipped a SKILLS section reading "BA/BS in computer science or
 * related degree · Experience working on infrastructure for distributed
 * systems or cloud-native applications · …" — the job posting's requirement
 * list, verbatim, in the skills row.
 *
 * `posting.isPlausibleSkill` is the real gate and it rejects these. This is the
 * belt to that pair of braces, at the last point before ink: a renderer should
 * not be able to print a sentence in a comma-separated run whatever reaches
 * it, including a resume generated before that gate existed. Dropping is right
 * — the alternative is a document the candidate has to defend.
 */
export function isRenderableSkill(raw: string): boolean {
    const value = raw.trim();
    if (!value) return false;

    // The same definition the posting reader uses, rather than a second one.
    // Two filters that disagree about what a skill is would eventually
    // disagree about a real resume.
    if (!isPlausibleSkill(value)) return false;

    // A trailing clause marker means a sentence was split, not a name.
    if (/[.;:]$/.test(value)) return false;

    // Unbalanced brackets are the signature of a comma-split gone wrong —
    // "Strong coding skills (examples given: Go" and its orphaned "C++)".
    const opens = (value.match(/\(/g) ?? []).length;
    const closes = (value.match(/\)/g) ?? []).length;
    if (opens !== closes) return false;

    return true;
}

/**
 * Group a flat skills list for rendering.
 *
 * Order within a group is the order they arrived, which is `chooseSkills`'
 * order: what the posting asked for and the candidate can evidence, first.
 */
export function groupSkills(skills: readonly string[]): SkillGroup[] {
    const buckets = new Map<string, string[]>();
    const other: string[] = [];
    const seen = new Set<string>();

    for (const raw of skills) {
        const label = raw.trim();
        if (!isRenderableSkill(label)) continue;

        // De-duplicate on the slug so "Postgres" and "PostgreSQL" cannot both
        // appear — in different rows, which is how it would have looked.
        const key = normalizeSkill(label) ?? label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const display = normalizeSkill(label) ? displaySkill(normalizeSkill(label)!) : label;
        const category = categoryFor(label);
        if (!category) {
            other.push(display);
            continue;
        }
        const bucket = buckets.get(category);
        if (bucket) bucket.push(display);
        else buckets.set(category, [display]);
    }

    const groups: SkillGroup[] = CATEGORIES.filter((category) => buckets.has(category.key)).map(
        (category) => ({ label: category.label, skills: buckets.get(category.key)! }),
    );

    if (other.length > 0) groups.push({ label: OTHER_LABEL, skills: other });

    /*
     * One group is not a grouping — it is a list with a redundant label above
     * it. A candidate with six skills all in "Languages" should see them plain.
     */
    if (groups.length === 1) return [{ label: '', skills: groups[0].skills }];

    return groups;
}

/** Exported for the taxonomy-parity test. */
export const __testing = { CATEGORY_BY_SLUG, CATEGORIES };
