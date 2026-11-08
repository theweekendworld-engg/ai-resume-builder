/**
 * Memory topics: how a question, a requirement or a Scout answer becomes a
 * key, and how a skill is recognised in the user's own record.
 *
 * Pure. No model, no database, no clock. The key is derived in CODE from the
 * thing that was asked about, never by a model, so the same requirement on
 * two postings a month apart lands on the same row (docs/impl/08-memory.md).
 *
 * ── Why aliases exist ───────────────────────────────────────────────────────
 *
 * Production, 2026-11-08: tailoring asked "Do you have hands-on experience
 * with Claude?" of a user whose record says his agent at Plivo runs on
 * Anthropic models. The gap check was a substring test for the word "claude",
 * and the record never says "claude". The aliases below are the short list of
 * names that mean the same thing (or something the record word implies), so
 * "Anthropic models" answers "Claude" and "k8s" answers "Kubernetes".
 * Deliberately short and directional: a term only appears where reading it in
 * a record genuinely evidences the skill.
 */

export type MemoryKind = 'skill' | 'pref' | 'fact';

/** Longest key segment kept. A requirement sentence is not a topic. */
export const KEY_SLUG_MAX = 48;

/** "Node.js" → "node_js", "C++" → "cpp", "CI/CD" → "ci_cd". */
export function slugify(label: string): string {
    return String(label ?? '')
        .toLowerCase()
        .replace(/\+\+/g, 'pp')
        .replace(/#/g, 'sharp')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, KEY_SLUG_MAX)
        .replace(/_+$/g, '');
}

/**
 * Synonyms folded onto one canonical slug, so `skill:k8s` and
 * `skill:kubernetes` are one memory.
 */
const CANONICAL: Record<string, string> = {
    k8s: 'kubernetes',
    kubernetes_k8s: 'kubernetes',
    postgresql: 'postgres',
    golang: 'go',
    nodejs: 'node',
    node_js: 'node',
    model_context_protocol: 'mcp',
    model_context_protocol_mcp: 'mcp',
    claude_ai: 'claude',
    claude_api: 'claude',
    anthropic_claude: 'claude',
    claude_models: 'claude',
    anthropic_api: 'anthropic',
    openai_api: 'openai',
    chat_gpt: 'chatgpt',
    llms: 'llm',
    large_language_model: 'llm',
    large_language_models: 'llm',
    large_language_models_llms: 'llm',
    genai: 'generative_ai',
    gen_ai: 'generative_ai',
    retrieval_augmented_generation: 'rag',
    retrieval_augmented_generation_rag: 'rag',
    amazon_web_services: 'aws',
    amazon_web_services_aws: 'aws',
    google_cloud: 'gcp',
    google_cloud_platform: 'gcp',
    cicd: 'ci_cd',
    ci_cd_pipelines: 'ci_cd',
    reactjs: 'react',
    react_js: 'react',
    nextjs: 'next_js',
    vector_databases: 'vector_database',
    vector_db: 'vector_database',
    vector_dbs: 'vector_database',
    js: 'javascript',
    ts: 'typescript',
    machine_learning: 'ml',
    ai_agent: 'ai_agents',
    agentic_ai: 'ai_agents',
};

/**
 * Words that, read in a record, evidence the canonical skill. Matched on word
 * boundaries against normalised text (lowercase, punctuation → space).
 */
const EVIDENCED_BY: Record<string, readonly string[]> = {
    claude: ['claude', 'anthropic'],
    anthropic: ['anthropic', 'claude'],
    openai: ['openai', 'gpt', 'chatgpt'],
    chatgpt: ['chatgpt', 'openai', 'gpt'],
    gpt: ['gpt', 'openai', 'chatgpt'],
    llm: ['llm', 'llms', 'large language model', 'large language models', 'gpt', 'claude', 'anthropic', 'openai', 'gemini', 'llama', 'mistral'],
    generative_ai: ['generative ai', 'genai', 'gen ai', 'llm', 'llms', 'gpt', 'claude', 'anthropic', 'openai'],
    kubernetes: ['kubernetes', 'k8s', 'eks', 'gke', 'aks'],
    postgres: ['postgres', 'postgresql', 'psql'],
    node: ['node js', 'nodejs'],
    go: ['golang'],
    mcp: ['mcp', 'model context protocol'],
    rag: ['rag', 'retrieval augmented'],
    aws: ['aws', 'amazon web services'],
    gcp: ['gcp', 'google cloud', 'bigquery'],
    ci_cd: ['ci cd', 'cicd', 'github actions', 'gitlab ci', 'jenkins', 'circleci'],
    react: ['react', 'reactjs', 'react js', 'next js', 'nextjs'],
    javascript: ['javascript', 'typescript'],
    vector_database: ['vector database', 'vector db', 'pgvector', 'pinecone', 'qdrant', 'weaviate', 'milvus', 'chroma'],
    ml: ['machine learning'],
    ai_agents: ['ai agent', 'ai agents', 'agentic', 'voice agent', 'llm agent'],
};

export function canonicalSlug(slug: string): string {
    return CANONICAL[slug] ?? slug;
}

/** The memory key for a skill or requirement: `skill:claude`. Null when nothing is left to key on. */
export function skillKey(label: string): string | null {
    const slug = canonicalSlug(slugify(label));
    return slug ? `skill:${slug}` : null;
}

export function memoryKey(kind: MemoryKind, label: string): string | null {
    const slug = kind === 'skill' ? canonicalSlug(slugify(label)) : slugify(label);
    return slug ? `${kind}:${slug}` : null;
}

/** A stored key folded onto its canonical form, so older aliases merge. */
export function canonicalKey(key: string): string {
    const [kind, ...rest] = key.split(':');
    const slug = rest.join(':');
    if (kind === 'skill') return `skill:${canonicalSlug(slug)}`;
    return key;
}

export function keyKind(key: string): MemoryKind {
    const kind = key.split(':')[0];
    return kind === 'pref' || kind === 'fact' ? kind : 'skill';
}

/** Lowercase, punctuation to spaces, one space between words. */
export function normalizeForMatch(value: string): string {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function containsWord(haystack: string, phrase: string): boolean {
    const needle = normalizeForMatch(phrase);
    if (!needle) return false;
    return ` ${haystack} `.includes(` ${needle} `);
}

/** The words that evidence a skill, its own name first. */
export function evidenceTerms(skill: string): string[] {
    const slug = canonicalSlug(slugify(skill));
    return [...new Set([normalizeForMatch(skill), ...(EVIDENCED_BY[slug] ?? [])].filter(Boolean))];
}

/**
 * Does the record already say this? `normalizedRecord` is
 * `normalizeForMatch(recordText)`. The skill's own name keeps the old
 * substring test (so "Postgres" is found inside "PostgreSQL"); aliases match
 * on word boundaries, so "go" never matches "google".
 */
export function recordEvidences(skill: string, normalizedRecord: string): boolean {
    const own = normalizeForMatch(skill);
    if (own && normalizedRecord.includes(own)) return true;
    return evidenceTerms(skill).slice(1).some((term) => containsWord(normalizedRecord, term));
}

/**
 * Keys whose memory also answers this skill: its own, then every alias that is
 * itself a topic (a memory under `skill:claude` answers "Anthropic", and "LLMs").
 */
export function relatedKeys(skill: string): string[] {
    const own = skillKey(skill);
    if (!own) return [];
    const slug = own.slice('skill:'.length);
    const related = (EVIDENCED_BY[slug] ?? []).map((term) => skillKey(term)).filter((key): key is string => Boolean(key));
    return [...new Set([own, ...related])];
}

/** Does a memory's text mention the skill (its name or an alias, on word boundaries)? */
export function textMentions(text: string, skill: string): boolean {
    const normalized = normalizeForMatch(text);
    return evidenceTerms(skill).some((term) => containsWord(normalized, term));
}

/**
 * Scout preference questions → memory keys. Comp and work authorisation are
 * private: neither belongs in an outreach email, and the query filters them.
 */
export const SCOUT_QUESTION_TOPICS: Record<string, { key: string; label: string; sensitivity: 'shareable' | 'private' }> = {
    'pref.location': { key: 'pref:location', label: 'Locations', sensitivity: 'shareable' },
    'pref.relocate': { key: 'pref:relocate', label: 'Relocation', sensitivity: 'shareable' },
    'pref.workAuth': { key: 'fact:work_auth', label: 'Work authorization', sensitivity: 'private' },
    'pref.workMode': { key: 'pref:work_mode', label: 'Work mode', sensitivity: 'shareable' },
    'pref.targetRoles': { key: 'pref:target_roles', label: 'Target roles', sensitivity: 'shareable' },
    'pref.minComp': { key: 'pref:min_comp', label: 'Minimum pay', sensitivity: 'private' },
};

/** "skill:ci_cd" → "ci cd", for a row stored without a label. */
export function labelFromKey(key: string): string {
    const slug = key.split(':').slice(1).join(':');
    return slug.replace(/_/g, ' ');
}
