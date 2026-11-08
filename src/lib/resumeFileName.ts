/**
 * The file name a resume PDF travels under. Recruiters see it in their inbox
 * and their ATS, so "tailored-resume.pdf" (the live test, 2026-11-08) reads
 * as a template, and "Backend Engineer — Acme.pdf" carries a dash and spaces
 * some systems mangle. It is built from the record: the person's name and the
 * company, `Jai_Shankar_Resume_iServeWorld.pdf`.
 *
 * Pure and client-safe: the editor's export uses it too.
 */

const MAX_NAME_PARTS = 4;
const MAX_FILE_NAME = 80;

/** Words that name a company's legal form, not the company. */
const LEGAL_SUFFIX = /^(?:inc|llc|llp|ltd|limited|pvt|private|plc|corp|corporation|co|gmbh|ag|sa|bv|pte|pty)$/i;

/** ASCII letters and digits only: "José" → "Jose", "Zoë" → "Zoe", anything else drops. */
function ascii(value: string): string {
    return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
}

function words(value: string | null | undefined): string[] {
    return ascii(String(value ?? '')).split(/\s+/).filter(Boolean);
}

/** "jai shankar" → "Jai_Shankar"; a name keeps its own capitals ("McKenzie"). */
function nameToken(fullName: string | null | undefined): string {
    return words(fullName)
        .slice(0, MAX_NAME_PARTS)
        .map(titleCaseName)
        .join('_');
}

/**
 * "jai" and "JAI" both become "Jai": names parsed from a resume header often
 * arrive in capitals, and "JAI_SHANKAR_Resume_SarvamLabs.pdf" was the file a
 * recruiter received (live test 2026-11-08). Mixed case is the person's own
 * ("McDonald", "DeSouza") and is kept.
 */
function titleCaseName(word: string): string {
    const lower = word.toLowerCase();
    if (word === lower || (word === word.toUpperCase() && word.length > 1)) {
        return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    }
    return word;
}

/** "Goldman Sachs Pvt. Ltd." → "GoldmanSachs"; "iServeWorld" stays as written. */
function companyToken(company: string | null | undefined): string {
    const parts = words(company);
    while (parts.length > 1 && LEGAL_SUFFIX.test(parts[parts.length - 1])) parts.pop();
    return parts
        .map((word, index) => (index > 0 && word === word.toLowerCase() ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
        .join('');
}

/**
 * `Jai_Shankar_Resume_iServeWorld.pdf`. Without a company,
 * `Jai_Shankar_Resume.pdf`; without a name, `Resume_iServeWorld.pdf`;
 * with neither, `Resume.pdf`.
 */
export function resumeFileName(params: { fullName?: string | null; company?: string | null }): string {
    const name = nameToken(params.fullName);
    const company = companyToken(params.company);
    const stem = [name, 'Resume', company].filter(Boolean).join('_');
    const capped = stem.length > MAX_FILE_NAME - 4 ? stem.slice(0, MAX_FILE_NAME - 4).replace(/_+$/, '') : stem;
    return `${capped}.pdf`;
}
