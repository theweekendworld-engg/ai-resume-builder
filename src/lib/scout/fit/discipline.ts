/**
 * Broad disciplines ("backend engineering", "platform engineering") and
 * which of the user's roles were spent in one. Pure: no model, no IO.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * "2+ years of backend engineering" was judged against the one role its
 * cited line came from (14 months at Hyperbots) and came back partial, for an
 * engineer with about two and a half years full-time across two software
 * engineering roles, both of them backend work (live test, 2026-11-08).
 * Tailoring then asked "Do you have hands-on experience with Backend
 * engineering?", because the record never says the words.
 *
 * A discipline is not a skill that sits in one bullet; it is what a run of
 * roles was. So the years are summed over every full-time role that shows
 * the discipline, and a role shows it by its title or by its own lines:
 *
 *   - A title that names it ("Backend Engineer", "Platform Engineer") counts.
 *   - A general engineering title ("Software Engineer", "SDE", "Developer")
 *     counts when at least one of that role's lines shows the work
 *     (microservices, databases, APIs for backend).
 *   - A title that names a different specialty ("Frontend Engineer") never
 *     counts toward backend, platform, infrastructure or distributed systems,
 *     whatever its lines say. Over-crediting here tells someone they are
 *     qualified when they are not.
 *
 * A line that only mentions APIs alongside React ("Integrated REST APIs into
 * the React app") is frontend work consuming an API, not backend work.
 */

export type Discipline = 'backend' | 'frontend' | 'platform' | 'infrastructure' | 'distributed_systems';

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
    backend: 'backend',
    frontend: 'frontend',
    platform: 'platform',
    infrastructure: 'infrastructure',
    distributed_systems: 'distributed systems',
};

function normalize(value: string): string {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ───────────────────────────────────────────────────────────── naming one

/** Words that restate the discipline without narrowing it: "backend SYSTEMS", "BUILDING platform services". */
const DISCIPLINE_FILLER = new Set([
    'building', 'build', 'built', 'developing', 'designing', 'systems', 'system', 'services', 'service',
    'applications', 'application', 'apps', 'side', 'roles', 'role', 'based', 'scalable', 'large', 'scale',
    'production', 'engineering', 'engineer', 'engineers', 'development', 'developer', 'software', 'work',
    'experience', 'professional', 'hands', 'on', 'of', 'in', 'a', 'an', 'the', 'with', 'as', 'focused',
    'oriented', 'team', 'teams', 'web', 'cloud',
]);

const DISCIPLINE_WORDS: [Discipline, RegExp][] = [
    ['backend', /^(?:backend|back end|server|server backend)$/],
    ['frontend', /^(?:frontend|front end|ui)$/],
    ['platform', /^(?:platform|developer platform|internal platform)$/],
    ['infrastructure', /^(?:infrastructure|infra|devops|site reliability|sre|reliability)$/],
    ['distributed_systems', /^(?:distributed|distributed computing)$/],
];

/**
 * The discipline a phrase names, when that is ALL it names: "backend
 * engineering", "server-side development", "building distributed systems".
 * "Backend with Go" is a discipline plus a skill, and is null: the skill
 * still needs its own evidence.
 */
export function disciplineOf(phrase: string): Discipline | null {
    const words = normalize(phrase).split(' ').filter((w) => w && !DISCIPLINE_FILLER.has(w));
    if (words.length === 0) return null;
    const rest = words.join(' ');
    for (const [discipline, pattern] of DISCIPLINE_WORDS) if (pattern.test(rest)) return discipline;
    return null;
}

// ───────────────────────────────────────────────────────────── a role in one

/** Titles that name each discipline outright. */
const TITLE_NAMES: Record<Discipline, RegExp> = {
    backend: /\b(?:back[\s-]?end|server[\s-]?side|api (?:engineer|developer)|backend)\b/i,
    frontend: /\b(?:front[\s-]?end|ui (?:engineer|developer)|web developer|react (?:engineer|developer))\b/i,
    platform: /\bplatform\b/i,
    infrastructure: /\b(?:infrastructure|infra|devops|site reliability|sre|cloud engineer)\b/i,
    distributed_systems: /\b(?:distributed systems?|systems engineer)\b/i,
};

/** Titles of a specialty that is not this discipline. A frontend engineer's years are not backend years. */
const TITLE_OTHER: Record<Discipline, RegExp> = {
    backend: /\b(?:front[\s-]?end|ui|ux|designer|ios|android|mobile|qa|test(?:ing)?|data analyst|product manager)\b/i,
    frontend: /\b(?:back[\s-]?end|server[\s-]?side|devops|sre|infrastructure|data engineer|ml engineer|machine learning)\b/i,
    platform: /\b(?:front[\s-]?end|ui|ux|designer|ios|android|mobile|data analyst|product manager)\b/i,
    infrastructure: /\b(?:front[\s-]?end|ui|ux|designer|ios|android|mobile|data analyst|product manager)\b/i,
    distributed_systems: /\b(?:front[\s-]?end|ui|ux|designer|ios|android|mobile|data analyst|product manager)\b/i,
};

/** A general software title: counts with line evidence. */
const GENERAL_TITLE = /\b(?:software|sde|swe|developer|programmer|engineer|member of (?:the )?technical staff|mts|full[\s-]?stack|tech(?:nical)? lead|architect|cto)\b/i;

/** Line words that are frontend work. A backend word weaker than these does not outweigh them. */
const FRONTEND_LINE = /\b(?:react|angular|vue|svelte|frontend|front[\s-]end|ui|ux|css|html|tailwind|components?|dashboards?|flutter|swiftui|ios|android|mobile app|figma|design system|lighthouse|bundle|browser|responsive|accessibility|web app)\b/i;

/** Line evidence per discipline: strong words count on their own, weak ones only on a non-frontend line. */
const LINE_EVIDENCE: Record<Discipline, { strong: RegExp; weak: RegExp | null }> = {
    backend: {
        strong: /\b(?:back[\s-]?end|server[\s-]?side|servers?|micro[\s-]?services?|databases?|sql|postgres(?:ql)?|mysql|mongo(?:db)?|redis|kafka|rabbitmq|sqs|message queues?|grpc|cqrs|elasticsearch|spring boot|fastapi|django|flask|express(?:\.js)?|node(?:\.js)?|nodejs|event[\s-]driven|distributed)\b/i,
        weak: /\b(?:apis?|rest(?:ful)?|endpoints?|services?|sockets?|websockets?|throughput|latency|quer(?:y|ies)|indexes|schema|caching|cache|concurren\w*|pipelines?|queues?|infrastructure|kubernetes|docker)\b/i,
    },
    frontend: {
        strong: /\b(?:react|angular|vue|svelte|frontend|front[\s-]end|css|html|tailwind|next\.?js|ui components?|design system|web app)\b/i,
        weak: /\b(?:ui|ux|components?|dashboards?|browser|responsive|accessibility|lighthouse)\b/i,
    },
    platform: {
        strong: /\b(?:kubernetes|k8s|terraform|helm|ci\s?\/?\s?cd|jenkins|github actions|gitlab ci|argo(?:cd)?|internal (?:tools?|tooling|platform)|developer (?:platform|experience|productivity)|deploy(?:ment)? pipelines?|service mesh|observability|prometheus|grafana)\b/i,
        weak: /\b(?:docker|deploy\w*|infrastructure|automation|pipelines?)\b/i,
    },
    infrastructure: {
        strong: /\b(?:infrastructure|kubernetes|k8s|terraform|aws|gcp|azure|ec2|s3|cloud run|on[\s-]call|sre|reliability|networking|load balanc\w*|linux kernel|kernel|servers?|fleet)\b/i,
        weak: /\b(?:docker|deploy\w*|scaling|capacity|monitoring|observability|prometheus|grafana)\b/i,
    },
    distributed_systems: {
        strong: /\b(?:distributed|micro[\s-]?services?|kafka|rabbitmq|event[\s-]driven|cqrs|event sourcing|sharding|replication|consensus|raft|paxos|partition\w*|eventual(?:ly)? consisten\w*|message queues?)\b/i,
        weak: /\b(?:concurren\w*|high[\s-]throughput|throughput|events? a day|horizontal\w*|scal(?:e|able|ing))\b/i,
    },
};

export function lineShowsDiscipline(line: string, discipline: Discipline): boolean {
    const evidence = LINE_EVIDENCE[discipline];
    if (evidence.strong.test(line)) return true;
    if (!evidence.weak || !evidence.weak.test(line)) return false;
    return discipline === 'frontend' || !FRONTEND_LINE.test(line);
}

/**
 * Could this cited line, in a role with this title, be the discipline's work?
 * For a line the matcher chose that the lexicon above does not recognise
 * ("Built the payments ledger in Go"): trusted unless the title is another
 * specialty or the line reads as that other work ("…REST APIs into the React
 * checkout").
 */
export function lineMayShowDiscipline(line: string, title: string, discipline: Discipline): boolean {
    if (TITLE_OTHER[discipline].test(title)) return false;
    if (lineShowsDiscipline(line, discipline)) return true;
    return discipline === 'frontend' ? !LINE_EVIDENCE.backend.strong.test(line) : !FRONTEND_LINE.test(line);
}

/**
 * Was this role spent in the discipline? Title first; a general title needs
 * one of the role's own lines to show the work.
 */
export function roleShowsDiscipline(role: { title: string; lines: readonly string[] }, discipline: Discipline): boolean {
    const title = role.title ?? '';
    if (TITLE_NAMES[discipline].test(title)) return true;
    if (TITLE_OTHER[discipline].test(title)) return false;
    if (!GENERAL_TITLE.test(title)) return false;
    return role.lines.some((line) => lineShowsDiscipline(line, discipline));
}

// ───────────────────────────────────────────────────────────── a gap it answers

const GENERAL_SOFTWARE_WORDS = new Set(['software', 'engineering', 'development', 'developer', 'engineer', 'programming', 'coding', 'application', 'applications']);

/**
 * Does the user's work history already answer a skill gap that is really a
 * discipline ("Backend engineering", "Distributed systems", "Software
 * development")? Then tailoring must not ask "Do you have hands-on
 * experience with Backend engineering?" of someone whose two roles were
 * backend work. Any role counts here, internships included: the question is
 * whether they have done it, not for how long.
 */
export function rolesAnswerDiscipline(label: string, roles: readonly { title: string; lines: readonly string[] }[]): boolean {
    if (roles.length === 0) return false;
    const discipline = disciplineOf(label);
    if (discipline) return roles.some((role) => roleShowsDiscipline(role, discipline));
    const words = normalize(label).split(' ').filter(Boolean);
    if (words.length > 0 && words.every((w) => GENERAL_SOFTWARE_WORDS.has(w)) && words.some((w) => w === 'software' || w === 'programming' || w === 'coding')) {
        return roles.some((role) => GENERAL_TITLE.test(role.title) && !/\b(?:designer|product manager|analyst|recruiter|sales)\b/i.test(role.title));
    }
    return false;
}
