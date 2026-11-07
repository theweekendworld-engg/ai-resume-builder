/**
 * Reading a resume's own text, deterministically.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Import used to hand the extracted text to a model and store whatever came
 * back. On the owner's own resume (QA 2026-11-07, finding 1) that invented a
 * first bullet for two roles out of the company's tag line and the stack line,
 * printed each one-line internship twice (once without its metric), merged a
 * project's bullets into one paragraph and dropped two of them, and regrouped
 * the skills under labels the resume never used.
 *
 * Almost all of that is structure the text already states: bullets start with
 * a glyph, skills rows start with their label and a colon, section headings
 * are a known vocabulary. Code can read those and cannot invent anything, so
 * code reads them. The model is left with the genuinely fuzzy part (which
 * line is a company, which is a role) and everything it writes is checked
 * against this text before it is stored. See `faithfulImport.ts`.
 *
 * Pure: no IO, no model, no clock.
 */

// ───────────────────────────────────────────────────────────── normalising

const PAGE_MARKER = /^--\s*\d+\s+of\s+\d+\s*--$/i;
/** Glyphs that start a bullet. Hyphen-like marks only count with a space after. */
const MARKER = /^(?:[•●▪◦‣∙■□➢➤►▶✓✔❖○]\s*|[-–—*]\s+)/;
const INLINE_MARKER = /\s+[•●▪◦‣■➢➤►▶]\s+/g;

/**
 * Whitespace and glyph clean-up only. Never changes a word.
 *
 * Ligatures are expanded because pdfjs emits "ﬁ" for "fi" in some fonts, and
 * a bullet that cannot be matched against its own source would be rejected.
 */
export function normalizeSourceText(raw: string): string {
    const text = (raw ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[  -   　\t]/g, ' ')
        .replace(/­/g, '')
        .replace(/ﬀ/g, 'ff')
        .replace(/ﬁ/g, 'fi')
        .replace(/ﬂ/g, 'fl')
        .replace(/ﬃ/g, 'ffi')
        .replace(/ﬄ/g, 'ffl');

    const lines: string[] = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/ {2,}/g, ' ').trim();
        if (PAGE_MARKER.test(line)) continue;
        // Text extracted with no line structure at all (one line per page)
        // still marks its bullets; give each its own line.
        if (line.length > 400 && (line.match(INLINE_MARKER)?.length ?? 0) >= 2) {
            lines.push(...line.replace(INLINE_MARKER, (m) => `\n${m.trim()} `).split('\n').map((part) => part.trim()));
            continue;
        }
        lines.push(line);
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** One line, whitespace collapsed. What a stored bullet looks like. */
export function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function isBulletLine(line: string): boolean {
    return MARKER.test(line);
}

export function stripMarker(line: string): string {
    return line.replace(MARKER, '').trim();
}

// ───────────────────────────────────────────────────────────── matching

type Token = { t: string; s: number; e: number };

function tokenize(text: string): Token[] {
    const out: Token[] = [];
    for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        const s = match.index ?? 0;
        out.push({ t: match[0].toLowerCase(), s, e: s + match[0].length });
    }
    return out;
}

/** Lower-case words, punctuation dropped. For comparing, never for storing. */
export function matchKey(text: string): string {
    return tokenize(text).map((token) => token.t).join(' ');
}

const hasDigit = (token: string) => /\d/.test(token);

function lcsLength(a: readonly string[], b: readonly string[]): number {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i += 1) {
        let diagonal = 0;
        for (let j = 1; j <= b.length; j += 1) {
            const above = row[j];
            row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
            diagonal = above;
        }
    }
    return row[b.length];
}

/** Characters that belong to the text either side of a matched run of words. */
const TRAILING = /[%+)\]}"'’”.!?]/;
const LEADING = /[($~∼#@"'‘“[]/;

export type SourceSpan = { start: number; end: number; exact: boolean };

/**
 * Where `candidate` occurs in `source`, by words.
 *
 * Exact when every word appears contiguously and in order (case, spacing and
 * punctuation ignored). Otherwise near: a window holding at least
 * `minRatio` of the candidate's words in order, AND containing every number
 * the candidate has. The number rule is what makes "near" safe: a model that
 * fixes a typo still matches, a model that changes "40%" to "45%" never does.
 */
export function findSpan(candidate: string, source: string, minRatio = 0.85): SourceSpan | null {
    const want = tokenize(candidate);
    if (want.length === 0) return null;
    const have = tokenize(source);
    const words = want.map((token) => token.t);
    const m = words.length;

    const widen = (startToken: number, endToken: number, exact: boolean): SourceSpan => {
        let start = have[startToken].s;
        let end = have[endToken].e;
        while (start > 0 && LEADING.test(source[start - 1])) start -= 1;
        while (end < source.length && TRAILING.test(source[end])) end += 1;
        return { start, end, exact };
    };

    for (let i = 0; i + m <= have.length; i += 1) {
        let j = 0;
        while (j < m && have[i + j].t === words[j]) j += 1;
        if (j === m) return widen(i, i + m - 1, true);
    }

    if (m < 5) return null;

    const numbers = words.filter(hasDigit);
    let best: { ratio: number; from: number; to: number } | null = null;
    const consider = (from: number, length: number) => {
        if (from < 0 || length <= 0 || from + length > have.length) return;
        const window = have.slice(from, from + length).map((token) => token.t);
        if (numbers.some((number) => !window.includes(number))) return;
        const ratio = lcsLength(words, window) / Math.max(m, length);
        if (ratio >= minRatio && (!best || ratio > best.ratio)) best = { ratio, from, to: from + length - 1 };
    };

    for (let i = 0; i < have.length; i += 1) {
        const startsLike = have[i].t === words[0] || have[i].t === words[1];
        const endsLike = have[i].t === words[m - 1] || have[i].t === words[m - 2];
        if (!startsLike && !endsLike) continue;
        for (let length = Math.max(1, m - 3); length <= m + 3; length += 1) {
            if (startsLike) consider(have[i].t === words[0] ? i : i - 1, length);
            if (endsLike) consider((have[i].t === words[m - 1] ? i : i + 1) - length + 1, length);
        }
    }

    const found = best as { ratio: number; from: number; to: number } | null;
    return found ? widen(found.from, found.to, false) : null;
}

/** The source's own words for `candidate`, or null when the source does not say it. */
export function verbatimFromSource(candidate: string, source: string, minRatio?: number): string | null {
    const span = findSpan(candidate, source, minRatio);
    return span ? collapseWhitespace(source.slice(span.start, span.end)) : null;
}

/** The verbatim guard: is this text (near-)present in the source? */
export function isPresentInSource(text: string, source: string): boolean {
    return findSpan(text, source) !== null;
}

/**
 * Grow a span to whole sentences, staying inside `region`.
 *
 * A model asked for a one-line role's sentence sometimes returns its first
 * clause only — "Built a safe, fast ... execution engine" without
 * ", cutting cost 70%." — which is in the source and would pass a presence
 * check while dropping the outcome. Reading to the sentence's end is how the
 * source decides where the bullet stops, not the model.
 */
export function extendToSentence(region: string, span: SourceSpan): string {
    const isBoundary = (index: number) =>
        /[.!?]/.test(region[index]) && (index + 1 >= region.length || /\s/.test(region[index + 1]));
    const lineBefore = (index: number) => region.slice(0, index).split('\n').pop() ?? '';
    const lineAfter = (index: number) => region.slice(index + 1).split('\n')[0] ?? '';
    const headerLike = isHeaderLike;

    let start = span.start;
    while (start > 0 && !isBoundary(start - 1)) {
        // Crossing up a line is a wrapped sentence, unless that line is a header.
        if (region[start - 1] === '\n' && headerLike(lineBefore(start - 1))) break;
        start -= 1;
    }
    while (start < span.start && /\s/.test(region[start])) start += 1;

    let end = span.end;
    if (!(end > 0 && isBoundary(end - 1))) {
        while (end < region.length) {
            if (isBoundary(end)) {
                end += 1;
                break;
            }
            // A blank, a header or a bare date range ends the sentence without a full stop.
            if (region[end] === '\n') {
                const next = lineAfter(end);
                if (!next.trim() || isDateOnlyLine(next) || headerLike(next) || isBulletLine(next)) break;
            }
            end += 1;
        }
    }
    return collapseWhitespace(region.slice(start, end));
}

// ───────────────────────────────────────────────────────────── structure

export type SectionKind = 'summary' | 'experience' | 'projects' | 'skills' | 'education' | 'other';

const HEADINGS: Record<string, SectionKind> = {};
const addHeadings = (kind: SectionKind, names: string[]) => names.forEach((name) => (HEADINGS[name] = kind));
addHeadings('summary', ['summary', 'professional summary', 'profile', 'professional profile', 'about', 'about me', 'objective', 'career objective', 'career summary']);
addHeadings('experience', ['experience', 'work experience', 'professional experience', 'relevant experience', 'employment', 'employment history', 'work history', 'internships', 'internship experience', 'career history']);
addHeadings('projects', ['projects', 'personal projects', 'selected projects', 'key projects', 'academic projects', 'side projects', 'project experience', 'open source', 'open source projects']);
addHeadings('skills', ['skills', 'technical skills', 'core skills', 'key skills', 'skills and tools', 'tools and technologies', 'technologies', 'tech stack', 'core competencies', 'competencies', 'expertise']);
addHeadings('education', ['education', 'academics', 'academic background', 'education and training']);
addHeadings('other', ['achievements', 'awards', 'honors', 'honours', 'awards and achievements', 'achievements and awards', 'certifications', 'certificates', 'licenses and certifications', 'publications', 'open source contributions', 'volunteering', 'volunteer experience', 'leadership', 'activities', 'extracurricular activities', 'interests', 'languages', 'coursework', 'relevant coursework', 'references', 'contact', 'positions of responsibility']);

/** A section heading's kind, or null when the line is not a heading. */
export function headingKind(line: string): SectionKind | null {
    const trimmed = line.trim().replace(/:$/, '');
    if (!trimmed || trimmed.length > 40 || trimmed.includes(':')) return null;
    const key = trimmed.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return HEADINGS[key] ?? null;
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_RANGE = new RegExp(
    `\\b(?:${MONTH}\\s*(?:\\d{4}|'\\d{2})?|\\d{4})\\s*(?:[-–—]|to)\\s*(?:present|current|now|today|(?:${MONTH}\\s*)?(?:\\d{4}|'\\d{2}))\\b`,
    'i',
);

export function hasDateRange(line: string): boolean {
    return DATE_RANGE.test(line);
}

/** A date range at the right edge of a line, where headers put them. */
export function endsWithDateRange(line: string): boolean {
    const trimmed = line.trim();
    const match = trimmed.match(new RegExp(`${DATE_RANGE.source}\\W{0,2}$`, 'i'));
    return Boolean(match);
}

/** A header line: a ` | ` separator, or dates at the end. */
export function isHeaderLike(line: string): boolean {
    return / \| /.test(line) || endsWithDateRange(line);
}

/** "Mar – May 2024" on its own line: the tail of a one-line role. */
export function isDateOnlyLine(line: string): boolean {
    const match = line.trim().match(DATE_RANGE);
    return Boolean(match && match[0].length >= line.trim().length - 1);
}

/** Strip a trailing date range from a header fragment. */
export function withoutDateRange(text: string): string {
    return text.replace(new RegExp(`\\s*${DATE_RANGE.source}\\s*$`, 'i'), '').trim();
}

export type SourceLine = {
    index: number;
    text: string;
    /** Section the line sits in, from the nearest heading above. Null before any heading. */
    section: SectionKind | null;
    heading: boolean;
};

export function readLines(text: string): SourceLine[] {
    let section: SectionKind | null = null;
    return text.split('\n').map((line, index) => {
        const kind = headingKind(line);
        if (kind) section = kind;
        return { index, text: line, section, heading: Boolean(kind) };
    });
}

const endsSentence = (line: string) => /[.!?]["'’”)]*$/.test(line.trim());
const startsLower = (line: string) => /^[a-z0-9(,;&%$]/.test(line.trim());

export type SourceBullet = {
    text: string;
    /** First and last line index the bullet occupies. */
    startLine: number;
    endLine: number;
    section: SectionKind | null;
};

/**
 * Every glyph-marked bullet, with its wrapped lines joined.
 *
 * A non-marker line after a bullet is a continuation when the bullet's last
 * line had not finished its sentence, or when the line (with any lines after
 * it) reads as a further sentence of the same bullet. It is a boundary when it
 * is a heading, a blank, one of `stops` (entry headers the caller located), or
 * looks like a header: a ` | ` separator or a date range.
 */
export function extractBullets(lines: readonly SourceLine[], stops: ReadonlySet<number> = new Set()): SourceBullet[] {
    const bullets: SourceBullet[] = [];
    const isBoundary = (line: SourceLine) =>
        line.heading || !line.text.trim() || stops.has(line.index) || isBulletLine(line.text);

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!isBulletLine(line.text) || line.section === 'skills') continue;
        const parts = [stripMarker(line.text)];
        let last = i;
        let j = i + 1;
        while (j < lines.length && !isBoundary(lines[j])) {
            const next = lines[j].text;
            if (isHeaderLike(next)) break;
            // After a finished sentence, only a lower-case start continues it:
            // a digit there is as likely "2Sigma School, …" as more bullet.
            if (!endsSentence(lines[last].text) || /^[a-z(,;&%]/.test(next.trim())) {
                parts.push(next);
                last = j;
                j += 1;
                continue;
            }
            // The previous line finished a sentence. Take the next one only if
            // it, with the lines after it, finishes a sentence of its own
            // before anything that looks like a header.
            let k = j;
            const run: string[] = [];
            while (k < lines.length && !isBoundary(lines[k]) && !isHeaderLike(lines[k].text)) {
                run.push(lines[k].text);
                if (endsSentence(lines[k].text)) break;
                k += 1;
            }
            if (run.length === 0 || !endsSentence(run[run.length - 1])) break;
            // A run followed by a bare date range was a one-line role
            // ("2Sigma School, SDE Intern. Built … 70%." / "Mar – May 2024"),
            // not more of this bullet.
            const after = lines[j + run.length];
            if (after && isDateOnlyLine(after.text)) break;
            parts.push(...run);
            last = j + run.length - 1;
            j = last + 1;
        }
        const text = collapseWhitespace(parts.join(' '));
        if (text) bullets.push({ text, startLine: i, endLine: last, section: line.section });
        i = last;
    }
    return bullets;
}

// ───────────────────────────────────────────────────────────── skills

export type SourceSkillGroup = { label: string; items: string[] };

/** Split at commas and separators outside brackets: "ASR (Conformer, CTC)" stays one item. */
export function splitItems(text: string): string[] {
    const items: string[] = [];
    let depth = 0;
    let current = '';
    const flush = () => {
        const item = current.trim().replace(/[.;,]+$/, '').trim();
        if (item) items.push(item);
        current = '';
    };
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if ('([{'.includes(char)) depth += 1;
        if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
        const separator =
            depth === 0 &&
            (char === ',' || char === ';' || ((char === '|' || char === '•' || char === '·') && text[i - 1] === ' '));
        if (separator) flush();
        else current += char;
    }
    flush();
    return items;
}

/**
 * The skills section, row by row, as the resume labels it.
 *
 * "Speech / AI: PyTorch, ASR (Conformer, CTC), TTS" is a row whose label is
 * the candidate's own grouping. Regrouping it into a vocabulary's buckets is
 * how "Speech / AI" became "Observability: Observability".
 */
export function extractSkillGroups(lines: readonly SourceLine[]): SourceSkillGroup[] {
    const groups: SourceSkillGroup[] = [];
    let previous = '';
    for (const line of lines) {
        if (line.section !== 'skills' || line.heading) continue;
        const text = stripMarker(line.text).trim();
        if (!text) continue;
        const labelled = text.match(/^([^:,]{1,40}):\s*(.*)$/);
        if (labelled) {
            groups.push({ label: labelled[1].trim(), items: splitItems(labelled[2]) });
        } else if (groups.length > 0 && (/,\s*$/.test(previous) || startsLower(text))) {
            // A wrapped row: "..., Prometheus," / "Grafana".
            groups[groups.length - 1].items.push(...splitItems(text));
        } else {
            groups.push({ label: '', items: splitItems(text) });
        }
        previous = text;
    }
    return groups.filter((group) => group.items.length > 0);
}

// ───────────────────────────────────────────────────────────── headers

/** Line index whose text starts with (or, failing that, contains) `needle`. */
export function locateLine(
    lines: readonly SourceLine[],
    needle: string,
    options: { sections?: readonly SectionKind[]; used?: ReadonlySet<number> } = {},
): number {
    const key = matchKey(needle);
    if (!key) return -1;
    const eligible = lines.filter(
        (line) =>
            !line.heading &&
            !options.used?.has(line.index) &&
            (!options.sections || line.section === null || options.sections.includes(line.section)),
    );
    const startsWith = eligible.find((line) => (matchKey(stripMarker(line.text)) + ' ').startsWith(`${key} `));
    if (startsWith) return startsWith.index;
    const contains = eligible.find((line) => !isBulletLine(line.text) && ` ${matchKey(line.text)} `.includes(` ${key} `));
    return contains ? contains.index : -1;
}

/** "(established CPaaS, AI voice agents)" printed right after the company name. */
export function noteAfter(line: string, name: string): string {
    const span = findSpan(name, line);
    if (!span || !span.exact) return '';
    const rest = line.slice(span.end).trimStart();
    if (!rest.startsWith('(')) return '';
    let depth = 0;
    for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === '(') depth += 1;
        if (rest[i] === ')') {
            depth -= 1;
            if (depth === 0) return collapseWhitespace(rest.slice(1, i));
        }
    }
    return '';
}

/** "Go, C, Python" from "Software Engineer I | Go, C, Python Sep 2025 – Present". */
export function stackAfter(line: string, role: string): string {
    const span = findSpan(role, line);
    if (!span || !span.exact) return '';
    const rest = line.slice(span.end);
    const separated = rest.match(/^\s*[|·]\s*(.+)$/);
    if (!separated) return '';
    return withoutDateRange(separated[1]).replace(/\s*[|·]\s*$/, '').trim();
}
