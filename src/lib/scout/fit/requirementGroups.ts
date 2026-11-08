/**
 * Examples and alternatives belong to the requirement they illustrate.
 * Pure: no model, no IO.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * A Sarvam posting asked for "experience with real-time audio or telephony
 * (RTP, SIP, FreeSWITCH)". The posting reader, told to split compound
 * sentences, returned four must-haves: the parent, RTP, SIP and FreeSWITCH.
 * An engineer who had shipped a FreeSWITCH module on the RTP path was then
 * told SIP was a hard gap (live test, 2026-11-08). The employer listed SIP as
 * one example of what counts, not as a fourth thing to check. "Go or Python"
 * split into Go and Python is the same mistake: either one meets it.
 *
 * The reader's prompt now says so, but a model told something still does it
 * sometimes, so code settles it after the read, deterministically:
 *
 *   - A requirement's own examples (in parentheses, after "e.g.", "such as",
 *     "like", "including") and its "X or Y" alternatives become `anyOf`: the
 *     requirement is met by evidence for the parent or for ANY one of them.
 *   - A sibling requirement that is only one of those options is folded into
 *     the requirement that lists it.
 *   - The posting text is read the same way, so a parent the model trimmed of
 *     its list gets the list back, and children the model split off a parent
 *     it dropped are put back together under the posting's own words.
 *
 * What is never merged: "Kubernetes and AWS" outside an example list (two
 * things the employer checks), and a sibling the posting also names on its
 * own somewhere else ("Strong Python skills required" beside "languages such
 * as Python or Java" keeps Python a requirement of its own).
 */

import type { ScoutRequirement } from '@/lib/scout/types';

// ───────────────────────────────────────────────────────────── normalising

/** "C++" → "cpp", "C#" → "csharp", ".NET" → "dotnet", then lowercase words. Keeps C, C++ and C# apart. */
export function normalizeOption(value: string): string {
    return String(value ?? '')
        .toLowerCase()
        .replace(/(^|[^a-z0-9])c\+\+/g, '$1 cpp ')
        .replace(/(^|[^a-z0-9])c#/g, '$1 csharp ')
        .replace(/(^|[^a-z0-9])f#/g, '$1 fsharp ')
        .replace(/\.net\b/g, ' dotnet ')
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** `phrase` appears in `normalized` on word boundaries. Both already normalised. */
function containsPhrase(normalized: string, phrase: string): boolean {
    return phrase.length > 0 && ` ${normalized} `.includes(` ${phrase} `);
}

// ───────────────────────────────────────────────────────────── vocabulary

/** Slash pairs that are one thing, not two options. */
const SLASH_WHOLE = /^(?:ci\/cd|tcp\/ip|a\/b|i\/o|ui\/ux|pl\/sql|b2b\/b2c|r\/w|24\/7)$/i;

/** List items that are not options: "etc.", "or similar", "related fields". */
const FILLER_ITEM = /^(?:etc\.?|and so on|others?|similar|equivalent|the like|more|any|other|other \w+|related|related \w+|equivalent \w+|similar \w+|and more|so on|higher|above|better)$/i;

/** A parenthesis that qualifies rather than lists: "(preferred)", "(3+ years)", "(remote)". */
const QUALIFIER_PAREN = /^(?:preferred|required|mandatory|optional|a plus|plus|nice to have|bonus|must|must have|ideally|if applicable|or equivalent(?: experience)?|or similar|or related(?: field)?|or higher|or above|or more|minimum|min|remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|any|see below)$/i;

/** Words that end an item when walking out from "or". */
const ITEM_STOP = new Set([
    'with', 'in', 'of', 'on', 'using', 'use', 'for', 'to', 'at', 'as', 'by', 'from', 'into', 'via',
    'experience', 'experienced', 'expertise', 'knowledge', 'familiarity', 'familiar', 'proficiency', 'proficient',
    'skills', 'skill', 'comfortable', 'comfort', 'background', 'either', 'strong', 'solid', 'deep', 'good',
    'excellent', 'working', 'understanding', 'exposure', 'and', 'the', 'a', 'an', 'any', 'is', 'are', 'be',
    'must', 'should', 'have', 'has', 'you', 'we', 'plus', 'preferred', 'required', 'years', 'year', 'yrs',
    'development', 'programming', 'hands-on', 'hands', 'ability', 'able', 'fluency', 'fluent', 'like', 'such',
    'including', 'languages', 'language', 'frameworks', 'framework', 'tools', 'tooling',
]);

/** Right-hand words that make "or" a quantifier, not a choice: "or more", "or equivalent". */
const NOT_A_CHOICE = /^(?:equivalent|similar|related|higher|above|more|other|others|better|greater|so|less|fewer)$/i;

const DEGREE = /\bdegree\b|\bbachelor|\bmaster|\bph\.?\s?d\b|\bb\.?\s?tech\b|\bb\.?s\.?\b|\bm\.?s\.?\b|\bdiploma\b/i;

/** Lead-ins that introduce examples. "like" only where it cannot be "would like". */
const LEAD_IN = /(,\s*)?\b(e\.\s?g\.?|i\.\s?e\.?|eg\.|for example|for instance|such as|including|incl\.|(?<!(?:would|'d|you|we|feel|look|looks|seem|seems|just)\s)like\b)\s*[:,]?\s+/gi;

/** A word that starts a new clause, ending an example list. */
const LIST_END_WORD = /^(?:strong|solid|experience|knowledge|familiarity|ability|excellent|good|proven|deep|a|an|the|must|you|we|our|plus|is|are|will|should|preferred|required)\b/i;

/** The part of a requirement that names what is asked for: "Experience with X" → "X". */
const LEADS: RegExp[] = [
    /^(?:must have|must|required|requires|requirement|preferred|nice to have|bonus|plus)\s*[:\-–]?\s+/i,
    /^(?:(?:strong|solid|deep|proven|good|excellent|working|hands[\s-]on|practical|demonstrated|prior|some|basic|advanced|professional|extensive|production)\s+)*(?:experience|proficiency|expertise|knowledge|familiarity|exposure|background|skills?|fluency|understanding|competence|comfort|grounding)\s+(?:with|in|of|on|using|around|across|to)\s+/i,
    /^(?:(?:be|are|is)\s+)?(?:very\s+)?(?:comfortable|familiar|proficient|experienced|fluent|skilled|well[\s-]versed|adept|competent)\s+(?:with|in|using|on|at)\s+/i,
    /^(?:experience|exposure)\s+(?:developing|building|writing|working|designing|shipping|running|operating)\s+(?:\w+\s+)?(?:with|in|on|using)\s+/i,
    /^(?:ability|able)\s+to\s+(?:work|code|program|develop|build)\s+(?:with|in|using)\s+/i,
];
const TRAILS = /\s+(?:experience|skills?|knowledge|proficiency|expertise|development|programming|background|is (?:a )?(?:big |huge |strong )?plus|a plus|is preferred|preferred|is required|required|nice to have|is a bonus|bonus|highly desirable|desirable)$/i;

function stripLeads(value: string): string {
    let text = value.trim();
    for (let pass = 0; pass < 3; pass += 1) {
        const before = text;
        for (const lead of LEADS) text = text.replace(lead, '');
        text = text.replace(TRAILS, '').replace(/^(?:and|or|&)\s+/i, '').trim();
        if (text === before) break;
    }
    return text.replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '');
}

// ───────────────────────────────────────────────────────────── items

function splitSlashes(item: string): string[] {
    if (!item.includes('/') || SLASH_WHOLE.test(item.trim())) return [item];
    return item.split('/').map((part) => part.trim()).filter(Boolean);
}

function cleanItem(raw: string): string {
    return raw
        .replace(/\s+(?:to|for|that|which|in order|when|where|while|is|are)\b.*$/i, '')
        .replace(/\betc\.?$/i, '')
        .replace(/^(?:and|or|&|e\.\s?g\.?|i\.\s?e\.?)\s+/i, '')
        .replace(/^[\s,;:.\-–]+|[\s,;:\-–]+$/g, '')
        .replace(/\.$/, '')
        .trim();
}

/** "RTP, SIP, or FreeSWITCH" → ["RTP", "SIP", "FreeSWITCH"]. Stops at the first thing that is not an item. */
function splitItems(list: string): string[] {
    const out: string[] = [];
    for (const piece of list.split(/\s*,\s*|\s*;\s*|\s+(?:and\/or|or|and|&)\s+/i)) {
        const item = cleanItem(piece);
        if (!item) continue;
        if (LIST_END_WORD.test(item) && out.length > 0) break;
        if (item.split(/\s+/).length > 4) {
            if (out.length > 0) break;
            continue;
        }
        if (FILLER_ITEM.test(item)) continue;
        for (const part of splitSlashes(item)) if (part && !FILLER_ITEM.test(part)) out.push(part);
    }
    return out;
}

// ───────────────────────────────────────────────────────────── lists

export type OptionList = {
    kind: 'examples' | 'alternatives';
    items: string[];
    /** What the examples are examples OF, in the posting's words ("experience with real-time audio or telephony"). */
    parent: string;
    /** The list as written, to append to a parent that lost it: " (RTP, SIP, FreeSWITCH)". */
    tail: string;
    /** Parent and list together: the requirement in the posting's own words. */
    whole: string;
    /** The exact text the list occupies, removed when asking "is this named anywhere else?". */
    region: string;
};

/** The last comma-separated piece before `index`: the parent of a list that starts there. */
function parentBefore(clause: string, index: number): string {
    const before = clause.slice(0, index).replace(/[\s,]+$/, '');
    const segment = before.split(/,\s*/).at(-1) ?? '';
    return segment.replace(/^(?:and|or|&)\s+/i, '').trim();
}

function parenLists(clause: string): OptionList[] {
    const out: OptionList[] = [];
    for (const match of clause.matchAll(/\(([^()]{1,200})\)/g)) {
        const inner = match[1].trim();
        if (QUALIFIER_PAREN.test(inner) || /\byears?\b|\byrs?\b|\d+\s*\+/.test(inner)) continue;
        const listText = inner.replace(/^(?:e\.\s?g\.?|i\.\s?e\.?|eg\.?|for example|for instance|such as|including|incl\.|like)\s*[:,]?\s*/i, '');
        const items = splitItems(listText);
        if (items.length === 0) continue;
        const parent = parentBefore(clause, match.index ?? 0);
        const tail = ` (${inner})`;
        out.push({ kind: 'examples', items, parent, tail, whole: `${parent}${tail}`.trim(), region: match[0] });
    }
    return out;
}

/** Parentheses blanked out, same length, so indices still point into the clause. */
function withoutParens(clause: string): string {
    return clause.replace(/\([^()]*\)/g, (m) => ' '.repeat(m.length));
}

type LeadInList = OptionList & { start: number; end: number };

function leadInLists(clause: string): LeadInList[] {
    const out: LeadInList[] = [];
    const text = withoutParens(clause);
    for (const match of text.matchAll(LEAD_IN)) {
        const at = match.index ?? 0;
        const start = at + match[0].length;
        const rest = text.slice(start);
        const stop = rest.search(/[;()\n]|\.(?=\s|$)/);
        const listText = (stop >= 0 ? rest.slice(0, stop) : rest).trimEnd();
        const items = splitItems(listText);
        if (items.length === 0) continue;
        // The list ends after its last item, not at the end of the clause.
        const lastItem = items.at(-1)!;
        const lastAt = listText.toLowerCase().lastIndexOf(lastItem.toLowerCase());
        const written = lastAt >= 0 ? listText.slice(0, lastAt + lastItem.length) : listText;
        const end = start + written.length;
        const parent = parentBefore(clause, at);
        const tail = `${match[1] ? ',' : ''} ${match[2]} ${clause.slice(start, end)}`;
        out.push({ kind: 'examples', items, parent, tail, whole: `${parent}${tail}`.trim(), region: clause.slice(at, end), start: at, end });
    }
    return out;
}

type Token = { text: string; start: number; end: number };

function tokens(text: string): Token[] {
    return [...text.matchAll(/[^\s,]+|,/g)].map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

const word = (token: Token | undefined) => token && token.text !== ',' && !ITEM_STOP.has(token.text.toLowerCase().replace(/[.:;]+$/, ''));

/** Up to three words walking from `from` in `step` direction. */
function itemAt(list: Token[], from: number, step: 1 | -1): { tokens: Token[]; next: number } {
    const taken: Token[] = [];
    let i = from;
    while (taken.length < 3 && word(list[i])) {
        taken.push(list[i]);
        i += step;
    }
    return { tokens: step === 1 ? taken : taken.reverse(), next: i };
}

/** "Go or Python", "Python, Java, C#, or JavaScript": choices joined by "or", never "and". */
function alternativeLists(clause: string): OptionList[] {
    if (DEGREE.test(clause)) return [];
    // Example lists are read separately; their words are not choices of the parent.
    let masked = withoutParens(clause);
    for (const lead of leadInLists(clause)) {
        masked = masked.slice(0, lead.start) + ' '.repeat(lead.end - lead.start) + masked.slice(lead.end);
    }
    const list = tokens(masked);
    const out: OptionList[] = [];
    for (let i = 0; i < list.length; i += 1) {
        const t = list[i].text.toLowerCase();
        if (t !== 'or' && t !== 'and/or') continue;
        const right = itemAt(list, i + 1, 1);
        if (right.tokens.length === 0 || NOT_A_CHOICE.test(right.tokens[0].text)) continue;
        let j = i - 1;
        if (list[j]?.text === ',') j -= 1;
        const groups: Token[][] = [];
        let left = itemAt(list, j, -1);
        if (left.tokens.length === 0 || /^\d/.test(left.tokens.at(-1)!.text)) continue;
        groups.unshift(left.tokens);
        while (list[left.next]?.text === ',') {
            left = itemAt(list, left.next - 1, -1);
            if (left.tokens.length === 0) break;
            groups.unshift(left.tokens);
        }
        groups.push(right.tokens);
        const items = groups
            .map((group) => cleanItem(clause.slice(group[0].start, group.at(-1)!.end)))
            .flatMap(splitSlashes)
            .filter((item) => item && !FILLER_ITEM.test(item));
        if (items.length < 2) continue;
        const startAt = groups[0][0].start;
        const endAt = right.tokens.at(-1)!.end;
        // The clause piece around the choice, read on the masked text so a
        // comma inside "(RTP, SIP)" does not cut it short.
        const segStart = Math.max(0, masked.lastIndexOf(',', startAt - 1) + 1, masked.lastIndexOf(';', startAt - 1) + 1);
        const nextComma = masked.slice(endAt).search(/[,;]/);
        const segEnd = nextComma >= 0 ? endAt + nextComma : clause.length;
        const whole = clause.slice(segStart, segEnd).replace(/^\s*(?:and|or|&)\s+/i, '').trim().replace(/[.;:]+$/, '');
        out.push({ kind: 'alternatives', items, parent: '', tail: '', whole, region: clause.slice(startAt, endAt) });
        i = right.next - 1;
    }
    return out;
}

/** Every example list and "or" choice in one clause (or one requirement's text). */
export function listsIn(clause: string): OptionList[] {
    return [...parenLists(clause), ...leadInLists(clause), ...alternativeLists(clause)];
}

/** The options that meet a requirement: its examples and its alternatives. Empty when it has none. */
export function optionsIn(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const list of listsIn(text)) {
        for (const item of list.items) {
            const key = normalizeOption(item);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(item);
        }
    }
    return out;
}

/**
 * Still an "and" once the lists are taken out: "message queues (Kafka,
 * RabbitMQ) and caching (Redis)" needs both halves, so one example (Redis)
 * cannot meet it. Its examples still fold siblings in; it just gets no
 * `anyOf`, and the model judges it whole.
 */
export function isConjunctive(text: string): boolean {
    let rest = text;
    for (const list of listsIn(text)) rest = rest.replace(list.region, ' ');
    return /\band\b(?!\/or)|&/i.test(rest.replace(/\([^()]*\)/g, ' '));
}

/** The requirement with its example lists removed: what the examples are examples of. */
export function parentText(text: string): string {
    let out = text;
    for (const list of [...parenLists(text), ...leadInLists(text)]) out = out.replace(list.region, ' ');
    return out.replace(/\s+/g, ' ').trim();
}

/**
 * What a requirement names, as normalised parts: "Experience with SIP" →
 * ["sip"], "Knowledge of RTP and SIP" → ["rtp", "sip"]. Empty when it names
 * nothing a list item could be.
 */
export function partsOf(text: string): string[] {
    const core = stripLeads(text.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' '));
    if (!core) return [];
    return core
        .split(/\s*,\s*|\s+(?:and\/or|or|and|&)\s+/i)
        .flatMap((piece) => splitSlashes(cleanItem(piece)))
        .map(normalizeOption)
        .filter(Boolean);
}

// ───────────────────────────────────────────────────────────── the posting

function clausesOf(text: string): string[] {
    const shielded = text
        .replace(/\b([ei])\.\s?([ge])\./gi, '$1·$2·')
        .replace(/\b(etc|vs|incl|approx)\./gi, '$1·');
    return shielded
        .split(/\r?\n|[•●▪◦]|(?<=[.!?])\s+(?=[A-Z0-9])|;\s+/)
        .map((clause) => clause.replace(/·/g, '.').replace(/^[\s\-*–—>]+/, '').trim())
        // "Requirements: …" — the header is not part of the requirement.
        .map((clause) => clause.replace(/^[A-Z][\w '&/()-]{0,40}:\s+/, ''))
        .filter((clause) => clause.length > 0);
}

export type PostingLists = {
    lists: OptionList[];
    /** The posting with every list removed, normalised: where a skill named on its own still shows. */
    remainder: string;
};

export function readPostingLists(postingText: string): PostingLists {
    const lists: OptionList[] = [];
    let remainder = '';
    for (const clause of clausesOf(postingText)) {
        const found = listsIn(clause);
        lists.push(...found);
        let rest = clause;
        for (const list of found) rest = rest.split(list.region).join(' | ');
        remainder += ` | ${rest}`;
    }
    return { lists, remainder: normalizeOption(remainder.replace(/\|/g, ' . ')) };
}

// ───────────────────────────────────────────────────────────── grouping

type Work = ScoutRequirement & { options: string[]; gone: boolean };

function addOptions(target: Work, items: readonly string[]) {
    const have = new Set(target.options.map(normalizeOption));
    for (const item of items) {
        const key = normalizeOption(item);
        if (key && !have.has(key)) {
            have.add(key);
            target.options.push(item);
        }
    }
}

function covers(options: readonly string[], parts: readonly string[]): boolean {
    if (parts.length === 0 || options.length === 0) return false;
    const keys = new Set(options.map(normalizeOption));
    return parts.every((part) => keys.has(part));
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Fold examples and alternatives into the requirement they belong to, and
 * record them as `anyOf`. Order is kept (the posting's emphasis); an absorbed
 * requirement's id disappears. Idempotent: grouping grouped output changes
 * nothing. Responsibilities pass through untouched.
 */
export function groupRequirements(requirements: readonly ScoutRequirement[], postingText = ''): ScoutRequirement[] {
    const work: Work[] = requirements.map((requirement) => ({
        ...requirement,
        options: requirement.kind === 'responsibility' ? [] : optionsIn(requirement.text),
        gone: false,
    }));
    const live = (r: Work) => r.kind !== 'responsibility' && !r.gone;
    const posting = postingText.trim() ? readPostingLists(postingText) : null;
    // The posting names it on its own somewhere else: a requirement of its own, never folded away.
    const namedApart = (r: Work) => Boolean(posting) && partsOf(r.text).some((part) => containsPhrase(posting!.remainder, part));

    const absorb = (owner: Work, child: Work, kindFromChild: boolean) => {
        child.gone = true;
        if (kindFromChild && child.kind === 'must') owner.kind = 'must';
    };

    // 1. A sibling that is only one of a requirement's own options.
    work.forEach((child, childIndex) => {
        if (!live(child)) return;
        const parts = partsOf(child.text);
        const ownerIndex = work.findIndex((owner, ownerIndex) => {
            if (owner === child || !live(owner) || !covers(owner.options, parts)) return false;
            // Two that list each other ("Go or Python", "Python or Go"): the earlier one stays.
            const mutual = covers(child.options, partsOf(owner.text));
            return !mutual || ownerIndex < childIndex;
        });
        if (ownerIndex < 0 || namedApart(child)) return;
        absorb(work[ownerIndex], child, false);
    });

    // 2. The posting's lists: a parent the model trimmed, children it split off.
    for (const list of posting?.lists ?? []) {
        const itemKeys = list.items.map(normalizeOption);
        // A requirement that already lists all of these holds them.
        const holder = work.find((r) => live(r) && covers(r.options, itemKeys));
        const parentCore = normalizeOption(stripLeads(list.parent));
        const parent = holder ?? (list.kind === 'examples' && parentCore.length >= 4
            ? work.find((r) => live(r) && containsPhrase(normalizeOption(r.text), parentCore) && !covers(list.items, partsOf(r.text)))
            : undefined);
        const children = work.filter((r) => {
            if (!live(r) || r === parent) return false;
            const parts = partsOf(r.text);
            return parts.length > 0 && parts.every((part) => itemKeys.includes(part)) && !namedApart(r);
        });

        if (parent) {
            const lost = !list.items.some((item) => containsPhrase(normalizeOption(parent.text), normalizeOption(item)));
            if (lost && list.tail) parent.text = `${parent.text.replace(/[\s.;,]+$/, '')}${list.tail}`;
            addOptions(parent, list.items);
            for (const child of children) absorb(parent, child, false);
            continue;
        }
        if (children.length === 0) continue;
        // No parent left: the first child becomes the requirement, in the posting's words.
        const [first, ...rest] = children;
        first.text = capitalize(list.whole);
        first.options = optionsIn(first.text);
        addOptions(first, list.items);
        for (const child of rest) absorb(first, child, true);
    }

    return work
        .filter((r) => !r.gone)
        .map((r): ScoutRequirement => {
            const out: ScoutRequirement = { id: r.id, text: r.text, kind: r.kind };
            if (r.kind === 'responsibility') return out;
            // The text's own order first, so grouping grouped output is a no-op.
            const options: Work = { ...r, options: optionsIn(r.text) };
            addOptions(options, r.options);
            if (options.options.length > 0 && !isConjunctive(r.text)) out.anyOf = options.options;
            return out;
        });
}
