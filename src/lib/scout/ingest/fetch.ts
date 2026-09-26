/**
 * The one way Scout fetches a URL a user handed it.
 *
 * A user-supplied URL fetched from our servers is an SSRF vector by
 * definition: "analyse this link" with `http://169.254.169.254/` is a request
 * for our cloud metadata. So every hop — the first request and every redirect
 * — is checked before it is made:
 *
 *   - http(s) only, default ports only, no credentials in the URL;
 *   - the hostname must not be local by name (`localhost`, `*.internal`, …);
 *   - every address it resolves to must be public (loopback, RFC 1918,
 *     link-local, CGNAT, ULA, multicast are refused, and IPv4-mapped IPv6 is
 *     unwrapped first so `::ffff:127.0.0.1` is not a bypass).
 *
 * Residual risk, stated: DNS is resolved here and again by `fetch`, so a host
 * that answers differently the second time (rebinding) is not fully closed by
 * this. Closing it needs a custom dispatcher pinned to the checked address,
 * which Bun and Node's fetch expose differently; the check still stops every
 * static private target and every redirect into one.
 *
 * Also bounded: 3 redirects, 2 MB, a timeout, and the caller's AbortSignal.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Browser-like: LinkedIn's guest pages serve a stub to obvious bots. */
export const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 12_000;

export type Resolver = (host: string) => Promise<string[]>;

export type SafeFetchOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    accept?: string;
    userAgent?: string;
    /** Injected in tests. */
    fetchImpl?: typeof fetch;
    /** Injected in tests; defaults to DNS. */
    resolve?: Resolver;
};

export type SafeFetchResult =
    | { ok: true; status: number; url: string; contentType: string; body: string; truncated: boolean }
    | { ok: false; reason: SafeFetchFailure; status?: number; url: string; message: string };

export type SafeFetchFailure =
    | 'invalid_url'
    | 'blocked_host'
    | 'dns_failed'
    | 'too_many_redirects'
    | 'http_error'
    | 'timeout'
    | 'network';

const defaultResolver: Resolver = async (host) => {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map((record) => record.address);
};

// ─────────────────────────────────────────────────────────────── addresses

function ipv4Octets(address: string): number[] | null {
    const parts = address.split('.');
    if (parts.length !== 4) return null;
    const octets = parts.map((part) => Number(part));
    return octets.every((octet, i) => /^\d{1,3}$/.test(parts[i]) && octet >= 0 && octet <= 255) ? octets : null;
}

function isPrivateIpv4(address: string): boolean {
    const o = ipv4Octets(address);
    if (!o) return true; // unparseable: refuse
    const [a, b] = o;
    return a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127) // CGNAT
        || (a === 169 && b === 254) // link-local, incl. cloud metadata
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 192 && b === 0 && o[2] === 0)
        || (a === 198 && (b === 18 || b === 19)) // benchmarking
        || a >= 224; // multicast + reserved + broadcast
}

function isPrivateIpv6(address: string): boolean {
    const lower = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
    if (lower === '::' || lower === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIpv4(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(lower.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 // fc00::/7 ULA
        || (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
        || (first & 0xff00) === 0xff00 // multicast
        || lower.startsWith('64:ff9b:') // NAT64 can reach v4 internals
        || lower.startsWith('2001:db8:');
}

export function isPrivateAddress(address: string): boolean {
    const family = isIP(address.replace(/^\[|\]$/g, ''));
    if (family === 4) return isPrivateIpv4(address);
    if (family === 6) return isPrivateIpv6(address);
    return true;
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain)$/i;

/** Checks a URL without resolving. Returns a reason, or null if acceptable. */
export function staticUrlProblem(url: URL): string | null {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'only http(s) links can be read';
    if (url.username || url.password) return 'links with credentials are not read';
    if (url.port && url.port !== '80' && url.port !== '443') return 'links on non-standard ports are not read';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!host || LOCAL_NAME.test(host) || host === 'metadata.google.internal') return 'that host is not public';
    if (isIP(host) && isPrivateAddress(host)) return 'that address is not public';
    return null;
}

async function checkHost(url: URL, resolve: Resolver): Promise<{ ok: true } | { ok: false; reason: SafeFetchFailure; message: string }> {
    const problem = staticUrlProblem(url);
    if (problem) return { ok: false, reason: 'blocked_host', message: problem };
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return { ok: true };
    let addresses: string[];
    try {
        addresses = await resolve(host);
    } catch {
        return { ok: false, reason: 'dns_failed', message: `could not resolve ${host}` };
    }
    if (addresses.length === 0) return { ok: false, reason: 'dns_failed', message: `could not resolve ${host}` };
    if (addresses.some(isPrivateAddress)) return { ok: false, reason: 'blocked_host', message: 'that host resolves to a private address' };
    return { ok: true };
}

// ─────────────────────────────────────────────────────────────── body

async function readCapped(res: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
    if (!res.body) return { body: await res.text(), truncated: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        if (total + value.byteLength > maxBytes) {
            chunks.push(value.subarray(0, maxBytes - total));
            total = maxBytes;
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
        }
        chunks.push(value);
        total += value.byteLength;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { body: new TextDecoder('utf-8', { fatal: false }).decode(merged), truncated };
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ─────────────────────────────────────────────────────────────── fetch

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const resolve = options.resolve ?? defaultResolver;
    const signal = combineSignals(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let current: URL;
    try {
        current = new URL(String(rawUrl ?? '').trim());
    } catch {
        return { ok: false, reason: 'invalid_url', url: String(rawUrl), message: 'that is not a valid link' };
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if (signal.aborted) {
            return { ok: false, reason: 'timeout', url: current.toString(), message: 'the page took too long to respond' };
        }
        const check = await checkHost(current, resolve);
        if (!check.ok) return { ok: false, reason: check.reason, url: current.toString(), message: check.message };

        let res: Response;
        try {
            res = await fetchImpl(current.toString(), {
                redirect: 'manual',
                signal,
                headers: {
                    'User-Agent': options.userAgent ?? BROWSER_USER_AGENT,
                    Accept: options.accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });
        } catch (error) {
            const aborted = signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
            return {
                ok: false,
                reason: aborted ? 'timeout' : 'network',
                url: current.toString(),
                message: aborted ? 'the page took too long to respond' : 'the page could not be reached',
            };
        }

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            if (!location) {
                return { ok: false, reason: 'http_error', status: res.status, url: current.toString(), message: 'the page redirected nowhere' };
            }
            try {
                current = new URL(location, current);
            } catch {
                return { ok: false, reason: 'invalid_url', url: location, message: 'the page redirected to an invalid link' };
            }
            continue;
        }

        const { body, truncated } = await readCapped(res, options.maxBytes ?? MAX_BYTES).catch(() => ({ body: '', truncated: false }));
        if (!res.ok) {
            return { ok: false, reason: 'http_error', status: res.status, url: current.toString(), message: `the page answered ${res.status}` };
        }
        return {
            ok: true,
            status: res.status,
            url: current.toString(),
            contentType: res.headers.get('content-type') ?? '',
            body,
            truncated,
        };
    }

    return { ok: false, reason: 'too_many_redirects', url: current.toString(), message: 'the link redirected too many times' };
}
