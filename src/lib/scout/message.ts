/**
 * Turn a shared message into a Scout input.
 *
 * People share in three shapes, and all three arrive as one string on a chat
 * channel: a bare link; a link with a line of their own ("thoughts on this?");
 * or a pasted post that happens to contain a link. The first two are the
 * link. The third is the TEXT — the post body is the thing to analyse, and the
 * link inside it is usually an apply URL, not the post.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

/** Below this, surrounding text is commentary on the link, not the content. */
const COMMENTARY_MAX = 280;

export type SharedMessage = { url: string | null; text: string | null };

export function extractUrls(text: string): string[] {
    return [...new Set((text.match(URL_PATTERN) ?? []).map((url) => url.replace(/[.,;:!?]+$/, '')))];
}

export function parseSharedMessage(raw: string): SharedMessage {
    const text = String(raw ?? '').trim();
    if (!text) return { url: null, text: null };

    const urls = extractUrls(text);
    const rest = text.replace(URL_PATTERN, ' ').replace(/\s+/g, ' ').trim();

    if (urls.length === 0) return { url: null, text };
    // Prefer a LinkedIn link when there are several: it is what people share.
    const primary = urls.find((url) => /linkedin\.com/i.test(url)) ?? urls[0];
    if (rest.length <= COMMENTARY_MAX) return { url: primary, text: null };
    return { url: primary, text };
}
