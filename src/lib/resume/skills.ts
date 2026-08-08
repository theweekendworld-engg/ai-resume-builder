/**
 * The skills section, gated on evidence.
 *
 * ── The bug this exists to make impossible ──────────────────────────────────
 *
 * `improveResumeForLowAts` built a properly filtered `candidateSkills` list and
 * then threw the filter away, prepending the posting's `requiredSkills` and
 * `preferredSkills` unfiltered and letting `slice(0, 20)` push the evidenced
 * ones off the end. In the 7 Aug audit run, 10 of the 13 skills on the finished
 * resume had no evidence anywhere in the candidate's history — Go, Java,
 * PostgreSQL, AWS, Terraform, gRPC. The candidate had never written a line of
 * any of them.
 *
 * Nothing downstream caught it, because `collectClaimLines` walks experience
 * and projects only. The one section of a resume that is pure keyword surface
 * had no grounding check at all.
 *
 * So the gate lives here, at construction. There is no code path in this module
 * that can put an unevidenced skill on a resume — a wanted skill the candidate
 * cannot evidence comes back as a GAP, which is genuinely useful ("they want
 * Terraform and you have never mentioned it") and is the honest version of what
 * the old code was trying to do.
 *
 * ── Why not just add skills to the claim validator ──────────────────────────
 *
 * Because it would not help. That validator is line-oriented and skips any
 * claim under three tokens, so every one-word skill would pass untouched. A
 * check that cannot fail is worse than no check: it looks like coverage.
 */

import { extractSkills, normalizeSkill } from '@/lib/radar/skills';

/**
 * Slugs are lowercase, and title-casing renders "aws" as "Aws" and "sql" as
 * "Sql". A skills section that misspells the technology it is claiming is
 * worse than one that omits it.
 */
const SLUG_LABELS: Record<string, string> = {
    aws: 'AWS', gcp: 'GCP', sql: 'SQL', llm: 'LLM', rag: 'RAG', ci_cd: 'CI/CD',
    grpc: 'gRPC', graphql: 'GraphQL', seo: 'SEO', csharp: 'C#', cpp: 'C++',
    r_lang: 'R', c_lang: 'C', nextjs: 'Next.js', dbt: 'dbt', ml: 'ML',
    postgresql: 'PostgreSQL', mysql: 'MySQL', nodejs: 'Node.js', ios: 'iOS',
    ec2: 'EC2', s3: 'S3', api: 'API', etl: 'ETL', ui: 'UI', ux: 'UX',
    // The non-engineering vocabulary. Default title-casing renders these as
    // "Ab Testing", "Power Bi" and "Go To Market" — a skills section that
    // misspells its own entries reads as machine-written, which is the exact
    // impression the whole rebuild exists to avoid.
    swiftui: 'SwiftUI', ab_testing: 'A/B Testing', power_bi: 'Power BI',
    go_to_market: 'Go-to-Market', design_ops: 'DesignOps', ixd: 'Interaction Design',
    information_architecture: 'Information Architecture',
    adobe_creative_suite: 'Adobe Creative Suite', google_ads: 'Google Ads',
    meta_ads: 'Meta Ads', google_analytics: 'Google Analytics',
    budget_ownership: 'Budget Ownership', financial_modelling: 'Financial Modelling',
    machine_learning: 'Machine Learning', distributed_systems: 'Distributed Systems',
};

/** Human label for a canonical slug. */
export function displaySkill(slug: string): string {
    if (SLUG_LABELS[slug]) return SLUG_LABELS[slug];
    return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type SkillDecision = {
    /** Ships on the resume. Every one is evidenced. */
    skills: string[];
    /**
     * Wanted by the posting, not evidenced by the candidate. Shown in the
     * editor as "they asked for this and your history does not mention it".
     */
    gaps: string[];
};

/**
 * Does this text evidence this skill?
 *
 * Two routes, because the vocabulary has a head and a tail:
 *
 *   The curated alias map from Radar handles the head — it knows Postgres and
 *   PostgreSQL are the same thing, and it already solved the genuinely nasty
 *   cases where a skill name is a common English word. `go`, `r`, `c` and
 *   `rust` need context to match, and Radar's patterns do that. A naive
 *   substring check would find "Go" inside "going" and put it on the resume.
 *
 *   Anything the map does not know — "financial modelling", a niche library,
 *   a non-technical discipline — falls back to a word-boundary match. Non-
 *   engineering professions live almost entirely in this tail, so it has to
 *   work, not merely exist.
 */
export function isEvidenced(skill: string, corpus: string, evidencedSlugs: ReadonlySet<string>): boolean {
    const slug = normalizeSkill(skill);
    if (slug) return evidencedSlugs.has(slug);

    const needle = skill.trim().toLowerCase();
    if (needle.length < 2) return false;

    // Escape before building the pattern: "C++" and ".NET" are real skills and
    // both are regex syntax.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    // \b does not fire after "+" or "#", so the trailing boundary is "not a
    // word character" rather than a word boundary — otherwise "C++" never
    // matches.
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(corpus);
}

/**
 * Choose the skills section.
 *
 * Order is deliberate and matches what a person would do:
 *
 *   1. What the posting asked for AND the candidate can evidence. These are
 *      the ones being scanned for, and they are true.
 *   2. The candidate's own strongest skills that the posting did not name.
 *      A resume is not only an answer sheet; this is what makes it theirs.
 *
 * The posting's label wins on spelling. If the candidate wrote "Postgres" and
 * the posting says "PostgreSQL", the resume says PostgreSQL — same skill, and
 * matching the employer's vocabulary is the entire legitimate purpose of ATS
 * optimisation.
 */
export function chooseSkills(params: {
    /** Skills the posting names. Already cleaned by `posting.cleanSkills`. */
    wanted: readonly string[];
    /** Everything the candidate has ever written, joined. */
    corpus: string;
    /** Skills drawn from the candidate's own history. */
    candidateSkills: readonly string[];
    max: number;
}): SkillDecision {
    const corpus = params.corpus.toLowerCase();
    const evidencedSlugs = new Set(extractSkills(corpus, { max: 200 }));

    const skills: string[] = [];
    const gaps: string[] = [];
    const taken = new Set<string>();

    const claim = (label: string) => {
        const slug = normalizeSkill(label);
        // Key on the slug where we have one, so "Postgres" and "PostgreSQL"
        // cannot both occupy a line.
        const key = slug ?? label.trim().toLowerCase();
        if (taken.has(key)) return false;
        taken.add(key);
        return true;
    };

    for (const wanted of params.wanted) {
        const label = wanted.trim();
        if (!label) continue;
        if (isEvidenced(label, corpus, evidencedSlugs)) {
            if (claim(label)) skills.push(label);
        } else {
            const key = (normalizeSkill(label) ?? label.toLowerCase());
            if (!gaps.some((g) => (normalizeSkill(g) ?? g.toLowerCase()) === key)) {
                gaps.push(label);
            }
        }
    }

    for (const own of params.candidateSkills) {
        const label = own.trim();
        if (!label) continue;
        // Still evidence-checked. A skill the model proposed from the
        // candidate's history is a claim like any other.
        if (!isEvidenced(label, corpus, evidencedSlugs)) continue;
        if (claim(label)) skills.push(label);
    }

    // 3. Whatever else the candidate's own text demonstrably shows.
    //
    // Without this the section is starved. The first live v2 run produced a
    // two-item skills list — Kafka and Kubernetes — for a candidate whose
    // history plainly evidences EC2, caching, tracing and idempotency, because
    // the only inputs were the posting's list and a `technologies` array from
    // a project that selection had not picked. A two-line skills section reads
    // as a broken tool, and everything here is drawn from what they wrote.
    for (const slug of [...evidencedSlugs].sort()) {
        const label = displaySkill(slug);
        if (claim(label)) skills.push(label);
    }

    return { skills: skills.slice(0, params.max), gaps };
}
