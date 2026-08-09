/**
 * Is this string something a person would write in a skills section?
 *
 * ── Why it does not live in `posting.ts` ────────────────────────────────────
 *
 * It used to, next to the model call that reads a job posting. `skillGroups.ts`
 * imported it, `templates/latex.ts` imports `skillGroups`, and `EditorLayout`
 * is a client component that imports the template — so a pure regex predicate
 * dragged `posting.ts` into the browser bundle, and with it `structured.ts`,
 * `usageTracker.ts` and a module-scope `new OpenAI()`. The editor failed to
 * load with the SDK refusing to construct in a browser, which is the SDK doing
 * exactly its job.
 *
 * Nothing here touches a model, a database or an environment variable. Keeping
 * it that way is what makes it safe to import from a component.
 */

const VERB_PHRASE = /\b(build|building|design|designing|develop|operate|operating|own|owning|improve|improving|deliver|delivering|drive|driving|manage|managing|partner|mentor|mentoring|ship|shipping|scale|scaling|work|working|ensure|maintain|maintaining|lead|leading|collaborate|support)\b/i;

/** Conjunctions and prepositions that only appear inside sentences. */
const SENTENCE_GLUE = /\b(and|or|with|for|that|which|across|within|from|into|to)\b/i;

const MAX_SKILL_WORDS = 4;
const MAX_SKILL_CHARS = 34;

/**
 * Single words that are only skills as part of a longer name.
 *
 * "Paid search" and "paid social" are real disciplines; "Search" and "Social"
 * on their own are the leftovers of a comma-split and belong to nobody. Kept
 * short and specific — this is not a general stopword list, and a word only
 * earns a place here after it has actually shipped on someone's resume.
 */
const FRAGMENT_WORDS = new Set([
    'search',
    'social',
    'programmatic',
    'paid',
    'organic',
    'digital',
    'content',
    'brand',
    'growth',
    'strategy',
    'operations',
    'analytics',
    'marketing',
    'engineering',
    'leadership',
    'communication',
    'collaboration',
    'ownership',
]);

/**
 * Would a person write this in a skills section?
 *
 * Deliberately strict, and asymmetric on purpose: dropping a real skill costs
 * one line on the resume, while keeping a fake one costs the reader's trust in
 * the whole document. When in doubt, drop.
 *
 * Multi-word names are allowed — "Google Cloud Platform", "React Native",
 * "Adobe Illustrator" are all skills — so the test is not word count alone.
 * It is: does this read like a name, or like a sentence?
 */
export function isPlausibleSkill(raw: string): boolean {
    const value = raw.trim();
    if (!value) return false;
    if (value.length > MAX_SKILL_CHARS) return false;

    const words = value.split(/\s+/);
    if (words.length > MAX_SKILL_WORDS) return false;

    // A single word is almost always a real skill name, even if it collides
    // with a verb — "Design" is a discipline, "Scala" is a language. The
    // sentence tests below only make sense on phrases.
    //
    // The exception is a word that only means something inside the phrase it
    // came from. A live run put "Search" and "Social" on a marketer's resume:
    // both were split out of the posting's "paid acquisition across search,
    // social and programmatic", where the skill is the whole phrase and the
    // fragments name nothing a person would claim.
    if (words.length === 1) return !FRAGMENT_WORDS.has(value.toLowerCase());

    if (VERB_PHRASE.test(value)) return false;
    if (SENTENCE_GLUE.test(value)) return false;

    return true;
}
