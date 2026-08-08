/**
 * Skill extraction and normalisation (PRD 04 §3.2).
 *
 * A curated alias map, not an embedding cluster. The spec is explicit about
 * why and it is the right call: precision matters more than coverage here, and
 * a map is auditable — when a user asks why we told them Kafka demand is up,
 * the answer has to be a list of postings, not a vector neighbourhood.
 *
 * ── The trap: short and ambiguous names ─────────────────────────────────
 *
 * "Go", "R", "C", and "Rust" are all real skills and all ordinary English.
 * A naive substring match finds "go" in "going", "R" in every sentence, and
 * "rust" in "trust". Matching those wrongly does not just add noise — it puts
 * a skill at the top of a trend chart on the strength of the word "going".
 *
 * So ambiguous names are matched only in contexts that disambiguate them:
 * next to a version, inside a delimited list, or beside a companion word
 * ("Go developer", "R and Python"). A skill we fail to spot costs one posting
 * of coverage; a skill we hallucinate corrupts a chart.
 */

/** Canonical skill slug → the strings that mean it. */
const SKILL_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
    // languages
    ['python', ['python', 'python3']],
    ['typescript', ['typescript', 'ts']],
    ['javascript', ['javascript', 'js', 'ecmascript']],
    ['java', ['java']],
    ['kotlin', ['kotlin']],
    // `swiftui` is NOT an alias of `swift`. It was, and a product designer's
    // generated resume shipped "Swift" — a programming language she does not
    // write — because her history mentioned SwiftUI. Technically evidenced,
    // materially a misrepresentation, and the single entry a hiring manager
    // would have probed first.
    ['swift', ['swift']],
    ['swiftui', ['swiftui', 'swift ui']],
    ['ruby', ['ruby', 'ruby on rails', 'rails']],
    ['php', ['php']],
    ['scala', ['scala']],
    ['elixir', ['elixir', 'phoenix framework']],
    ['csharp', ['c#', 'csharp', '.net', 'dotnet', 'asp.net']],
    ['cpp', ['c++', 'cpp']],

    // data stores
    ['postgresql', ['postgresql', 'postgres', 'psql', 'postgre sql']],
    ['mysql', ['mysql', 'mariadb']],
    ['mongodb', ['mongodb', 'mongo']],
    ['redis', ['redis']],
    ['elasticsearch', ['elasticsearch', 'elastic search', 'opensearch']],
    ['dynamodb', ['dynamodb']],
    ['snowflake', ['snowflake']],
    ['bigquery', ['bigquery', 'big query']],
    ['clickhouse', ['clickhouse']],
    ['cassandra', ['cassandra']],

    // infrastructure
    ['kubernetes', ['kubernetes', 'k8s', 'eks', 'gke']],
    ['docker', ['docker', 'containerization', 'containerisation']],
    ['terraform', ['terraform', 'hashicorp terraform']],
    ['aws', ['aws', 'amazon web services']],
    // Named AWS services. Real technologies that appear in postings by name,
    // and the ones a resume names when someone describes what they actually
    // operated. Added when the resume skills section came out with two
    // entries for a candidate whose history says "migrated 9 services from
    // EC2 to Kubernetes" — EC2 was simply not in the vocabulary.
    ['ec2', ['ec2', 'amazon ec2']],
    ['s3', ['s3', 'amazon s3']],
    ['lambda', ['aws lambda']],
    ['rds', ['rds', 'amazon rds']],
    ['gcp', ['gcp', 'google cloud', 'google cloud platform']],
    ['azure', ['azure', 'microsoft azure']],
    ['kafka', ['kafka', 'apache kafka']],
    ['airflow', ['airflow', 'apache airflow']],
    ['spark', ['spark', 'apache spark', 'pyspark']],
    ['grpc', ['grpc']],
    ['graphql', ['graphql']],
    ['ci_cd', ['ci/cd', 'cicd', 'continuous integration', 'continuous delivery']],

    // frontend
    ['react', ['react', 'react.js', 'reactjs']],
    ['nextjs', ['next.js', 'nextjs']],
    ['vue', ['vue', 'vue.js', 'vuejs']],
    ['angular', ['angular', 'angularjs']],
    ['svelte', ['svelte', 'sveltekit']],
    ['tailwind', ['tailwind', 'tailwindcss', 'tailwind css']],

    // ml / data
    ['pytorch', ['pytorch', 'torch']],
    ['tensorflow', ['tensorflow']],
    ['llm', ['llm', 'llms', 'large language model', 'large language models', 'genai', 'generative ai']],
    ['rag', ['rag', 'retrieval augmented generation', 'retrieval-augmented generation']],
    ['machine_learning', ['machine learning', 'ml engineering', 'deep learning']],
    ['dbt', ['dbt']],
    ['pandas', ['pandas']],
    ['sql', ['sql']],

    // practice
    ['distributed_systems', ['distributed systems', 'distributed system']],
    ['microservices', ['microservices', 'micro-services']],
    ['observability', ['observability', 'datadog', 'prometheus', 'grafana', 'opentelemetry']],
    ['security', ['appsec', 'application security', 'infosec', 'threat modeling', 'threat modelling']],
    ['accessibility', ['accessibility', 'a11y', 'wcag']],

    // non-engineering, because bands cover them too
    ['salesforce', ['salesforce', 'sfdc']],
    ['figma', ['figma']],
    ['product_analytics', ['amplitude', 'mixpanel', 'product analytics']],
    ['seo', ['seo', 'search engine optimization', 'search engine optimisation']],

    /*
     * ── Design, marketing, data and operations ──────────────────────────────
     *
     * Added after the 8 Aug audit, which ran the pipeline for three customers
     * who are not backend engineers — the one profession the vocabulary was
     * built against.
     *
     * `extractSkills` over a product designer's ENTIRE career returned three
     * slugs: accessibility, figma, swift. The cap is 20. Her posting named
     * "Design systems" as a must and her history says "Built and maintained
     * the design system in Figma — 90 components", and the section shipped
     * five entries, missing the three most relevant.
     *
     * This is a data problem, not a modelling one. Every entry below is a
     * nameable thing a practitioner would put in a skills section.
     */

    // design
    ['design_systems', ['design system', 'design systems', 'component library']],
    ['user_research', ['user research', 'ux research', 'user interviews']],
    ['usability_testing', ['usability testing', 'usability test', 'user testing']],
    ['wireframing', ['wireframing', 'wireframe', 'wireframes']],
    ['prototyping', ['prototyping', 'prototype', 'prototypes', 'interactive prototype']],
    ['interaction_design', ['interaction design', 'ixd']],
    ['information_architecture', ['information architecture', 'ia']],
    ['journey_mapping', ['journey mapping', 'user journey', 'customer journey', 'journey map']],
    ['visual_design', ['visual design', 'ui design', 'interface design']],
    ['design_ops', ['designops', 'design ops']],
    ['sketch', ['sketch app']],
    ['adobe_creative_suite', ['adobe creative suite', 'photoshop', 'illustrator', 'after effects', 'indesign']],
    ['framer', ['framer']],
    ['design_critique', ['design critique', 'design critiques', 'design review']],

    // marketing / growth
    ['paid_acquisition', ['paid acquisition', 'paid media', 'performance marketing', 'paid search', 'sem']],
    ['lifecycle_marketing', ['lifecycle marketing', 'crm marketing', 'email marketing', 'marketing automation']],
    ['hubspot', ['hubspot']],
    ['marketo', ['marketo']],
    ['braze', ['braze']],
    ['google_ads', ['google ads', 'adwords', 'google adwords']],
    ['meta_ads', ['meta ads', 'facebook ads']],
    ['google_analytics', ['google analytics', 'ga4']],
    ['content_marketing', ['content marketing', 'content strategy']],
    ['brand_marketing', ['brand marketing', 'brand strategy', 'positioning']],
    ['ab_testing', ['a/b testing', 'ab testing', 'split testing', 'experimentation']],
    ['attribution', ['attribution', 'attribution modeling', 'attribution modelling', 'marketing mix modeling']],
    ['demand_generation', ['demand generation', 'demand gen', 'pipeline generation']],
    ['go_to_market', ['go-to-market', 'go to market', 'gtm']],

    // data / analytics
    ['tableau', ['tableau']],
    ['looker', ['looker', 'looker studio']],
    ['power_bi', ['power bi', 'powerbi']],
    ['excel', ['excel', 'advanced excel', 'microsoft excel']],
    ['data_visualization', ['data visualization', 'data visualisation', 'dashboarding', 'dashboards']],
    ['statistics', ['statistics', 'statistical analysis', 'regression analysis']],
    ['forecasting', ['forecasting', 'demand forecasting', 'financial forecasting']],

    // operations / people
    ['project_management', ['project management', 'programme management', 'program management']],
    ['stakeholder_management', ['stakeholder management', 'stakeholder engagement']],
    ['process_improvement', ['process improvement', 'process design', 'operational excellence']],
    ['vendor_management', ['vendor management', 'supplier management']],
    ['financial_modelling', ['financial modelling', 'financial modeling', 'financial model']],
    ['budget_ownership', ['budget ownership', 'budget management', 'p&l ownership', 'p&l']],
    ['mentoring', ['mentoring', 'mentorship', 'coaching']],
    ['jira', ['jira', 'atlassian jira']],
    ['notion', ['notion']],
    ['asana', ['asana']],
];

/**
 * Names too short or too common to match on their own.
 *
 * Each needs a disambiguating neighbour. `Go` alone is a verb; `Go 1.21`,
 * `Golang`, and `Go developer` are the language.
 */
const AMBIGUOUS: ReadonlyArray<readonly [string, RegExp]> = [
    [
        'go',
        // golang, or Go followed by a version/role word, or Go in a delimited list.
        /\bgolang\b|\bgo\s*\d+\.\d+|\bgo\s+(?:developer|engineer|programmer|services?|routines?|modules?)\b|(?:^|[,/|·•])\s*go\s*(?:$|[,/|·•])/i,
    ],
    /*
     * Case-SENSITIVE on the `R` itself — a lowercase "r" is a letter, not a
     * language — while the companion words accept either case, because
     * "R and Python" capitalises the companion and an all-case-sensitive
     * pattern silently missed it.
     */
    [
        'r_lang',
        /\bR\s+(?:and|,|\/)\s*(?:[Pp]ython|SQL|sql|[Mm]atlab)\b|\b(?:[Pp]ython|SQL|sql|[Mm]atlab)\s*(?:and|,|\/)\s*R\b|\bR\s+(?:programming|language|studio)\b/,
    ],
    ['c_lang', /\bC\s+(?:and|or|\/)\s*C\+\+|\bC\s+(?:programming|language)\b|\bembedded\s+C\b/],
    ['rust', /\brust\b(?!\w)/i],
];

/** Longest alias first, so "google cloud platform" wins over "google cloud". */
const SORTED_ALIASES = SKILL_ALIASES.flatMap(([slug, aliases]) =>
    aliases.map((alias) => ({ slug, alias: alias.toLowerCase() })),
).sort((a, b) => b.alias.length - a.alias.length);

/** Escape a literal for use inside a RegExp. Same rule as the numeric guard. */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/**
 * Pre-compiled matchers.
 *
 * Word boundaries do not work for aliases ending in punctuation — `\bc++\b`
 * never matches, because `+` is not a word character. So the boundary is
 * asserted with explicit lookarounds on non-alphanumerics instead.
 */
const MATCHERS = SORTED_ALIASES.map(({ slug, alias }) => ({
    slug,
    /*
     * The boundaries are asymmetric, and both halves were fixed by a failing
     * test rather than reasoned out:
     *
     *   LEFT excludes a preceding dot, so the `js` alias does not fire inside
     *   "react.js" and invent JavaScript from a React mention.
     *
     *   RIGHT allows a following dot, because a skill at the end of a sentence
     *   ("…with Postgres.") is the common case and excluding it silently
     *   dropped those matches. `+` and `#` stay excluded so "c" cannot match
     *   inside "c++" or "c#".
     */
    pattern: new RegExp(`(?<![a-z0-9.])${escapeRegExp(alias)}(?![a-z0-9+#])`, 'i'),
}));

/**
 * Extract canonical skills from a posting description.
 *
 * Returns a stable, de-duplicated, sorted list — sorted so that two postings
 * with the same skills produce byte-identical arrays, which makes a change in
 * the stored value mean something changed in the posting.
 *
 * `companyName` exists because of a false positive found in real data, not in
 * theory: `figma` was extracted from 176 of 176 Figma postings, including a
 * Compensation Partner role and an Account Executive role. The company's own
 * name appears in the boilerplate of every posting it publishes, so on its own
 * board it reads as a universal requirement. Left in, the company that posts
 * the most jobs tops the skill trend chart — an artefact of hiring volume
 * presented as market demand.
 *
 * A skill that genuinely is the company's name (Figma, Salesforce) is still
 * counted from OTHER companies' boards, which is exactly where it means
 * something: someone else asking for it is the demand signal.
 */
export function extractSkills(
    text: string,
    options: { max?: number; companyName?: string | null } = {},
): string[] {
    const { max = 40, companyName } = options;
    if (!text) return [];
    const found = new Set<string>();

    // Slugs the company's own name resolves to, which this board cannot
    // evidence. Matched on the whole name and on its first word, so "Figma
    // Inc." and "Figma" both suppress `figma`.
    const selfSlugs = new Set<string>();
    if (companyName) {
        for (const candidate of [companyName, companyName.split(/[\s,]+/)[0]]) {
            const slug = normalizeSkill(candidate ?? '');
            if (slug) selfSlugs.add(slug);
        }
    }

    for (const { slug, pattern } of MATCHERS) {
        if (found.size >= max) break;
        if (selfSlugs.has(slug)) continue;
        if (pattern.test(text)) found.add(slug);
    }

    for (const [slug, pattern] of AMBIGUOUS) {
        if (found.size >= max) break;
        if (selfSlugs.has(slug)) continue;
        if (pattern.test(text)) found.add(slug);
    }

    return [...found].sort();
}

/** Canonical slug for a raw skill string, or null when we do not know it. */
/**
 * Singular form of the last word, for alias lookup only.
 *
 * "Design systems" failed to match the `design system` alias and was dropped
 * from a designer's resume over one letter — while the posting named it as a
 * must and her history said "Built and maintained the design system in Figma".
 *
 * Deliberately crude, and only ever used as a FALLBACK after an exact match
 * fails, so it cannot damage a name that is already correct. `kubernetes`,
 * `pandas` and `statistics` all match exactly and never reach this.
 */
function singularForm(value: string): string | null {
    const words = value.split(' ');
    const last = words[words.length - 1];
    if (!last || last.length < 4) return null;

    let singular: string | null = null;
    if (/[^aeiou]ies$/.test(last)) singular = `${last.slice(0, -3)}y`;
    else if (/(?:ch|sh|ss|x|z)es$/.test(last)) singular = last.slice(0, -2);
    else if (/[^s]s$/.test(last)) singular = last.slice(0, -1);

    if (!singular) return null;
    return [...words.slice(0, -1), singular].join(' ');
}

export function normalizeSkill(raw: string): string | null {
    const needle = raw.trim().toLowerCase();
    if (!needle) return null;
    for (const { slug, alias } of SORTED_ALIASES) {
        if (alias === needle) return slug;
    }

    // Only now, and only on the plural.
    const singular = singularForm(needle);
    if (singular) {
        for (const { slug, alias } of SORTED_ALIASES) {
            if (alias === singular) return slug;
        }
    }

    return null;
}

/** Every canonical slug, for iteration in the rollup. */
export function knownSkills(): string[] {
    return [...new Set(SKILL_ALIASES.map(([slug]) => slug))].sort();
}

/**
 * §3.2 — a trend is only shown above this many postings in BOTH comparison
 * windows. Below it the movement is noise, and charting noise is lying with a
 * chart.
 */
export const MIN_POSTINGS_FOR_TREND = 50;
