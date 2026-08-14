import { useCallback, useEffect, useState } from 'react';
import { Globe, X } from 'lucide-react';

/**
 * Which sites Patronus can read, and taking them back.
 *
 * A product that asks for access one site at a time has to let you undo it one
 * site at a time — otherwise "you can remove it any time in Settings", which
 * the grant prompt says, is a claim with nothing behind it.
 *
 * The nine job boards in the manifest are NOT listed here. They were granted
 * at install, Chrome will not let an extension revoke its own required
 * permissions, and showing a remove button that silently fails is worse than
 * showing nothing. Only the optional grants appear.
 */

/** Origins the manifest requires. Not revocable, so not listed. */
function requiredOrigins(): Set<string> {
    const manifest = chrome.runtime.getManifest();
    return new Set(manifest.host_permissions ?? []);
}

function hostOf(pattern: string): string {
    // "https://*.example.com/*" -> "example.com"
    return pattern
        .replace(/^https?:\/\//, '')
        .replace(/^\*\./, '')
        .replace(/\/\*$/, '')
        .replace(/\/$/, '');
}

export function SiteAccessSection() {
    const [origins, setOrigins] = useState<string[] | null>(null);

    const load = useCallback(async () => {
        const all = await chrome.permissions.getAll();
        const required = requiredOrigins();
        setOrigins((all.origins ?? []).filter((origin) => !required.has(origin)).sort());
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
        const onChange = () => void load();
        chrome.permissions.onAdded.addListener(onChange);
        chrome.permissions.onRemoved.addListener(onChange);
        return () => {
            chrome.permissions.onAdded.removeListener(onChange);
            chrome.permissions.onRemoved.removeListener(onChange);
        };
    }, [load]);

    const revoke = async (origin: string) => {
        await chrome.permissions.remove({ origins: [origin] });
        await load();
    };

    return (
        <section className="card p-3">
            <h3 className="mb-1 text-sm font-semibold">Sites you have enabled</h3>
            <p className="mb-2 text-xs text-muted-foreground">
                Patronus reads the job boards it knows by default. These are the extra sites
                you turned on yourself.
            </p>

            {origins === null ? (
                <p className="text-xs text-muted-foreground">Checking…</p>
            ) : origins.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    None yet. When you open a job on a site we do not know, the panel offers to
                    enable it for that site only.
                </p>
            ) : (
                <ul className="space-y-1">
                    {origins.map((origin) => (
                        <li
                            key={origin}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5"
                        >
                            <span className="flex min-w-0 items-center gap-1.5 text-xs">
                                <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{hostOf(origin)}</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => void revoke(origin)}
                                className="btn-ghost shrink-0 px-1.5 py-0.5 text-xs"
                                aria-label={`Remove access to ${hostOf(origin)}`}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
