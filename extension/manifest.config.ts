import { defineManifest } from '@crxjs/vite-plugin';

/**
 * MV3 manifest defined in TS so crxjs can resolve entry paths and hash assets.
 *
 * ── Why this is not `<all_urls>` any more ───────────────────────────────────
 *
 * It was, for both `host_permissions` and the content-script `matches`. Chrome
 * renders that to the user as **"Read and change all your data on all
 * websites"** at install time.
 *
 * That is a hard sell for any extension and an absurd one for a product whose
 * entire brand is "we do not lie to you and we do not take more than we need"
 * — the same product that refuses to put an unevidenced skill on a resume was
 * asking for permission to read the user's bank, their email and their health
 * records. It is also a Chrome Web Store review risk: broad host permissions
 * draw manual review, and "our parser might run anywhere" is not a
 * justification that survives it.
 *
 * The parsers only ever do anything on a job posting or an application form.
 * `detectPlatform()` in `src/parsers/pageClassifier.ts` names the platforms we
 * actually support, and this list is that list.
 *
 * `activeTab` covers everything else: when someone opens a posting on a board
 * we have never heard of, clicking the toolbar icon grants access to that one
 * tab, for that one visit, at their explicit request. That is the correct
 * trade — the generic parser still works, and it works because the user asked
 * for it rather than because we hold a standing grant over the whole web.
 *
 * KEEP THIS LIST AND `detectPlatform()` IN SYNC. A platform with a parser and
 * no host entry silently falls back to activeTab-only; a host entry with no
 * parser asks for access we do not use.
 */

/** The boards we parse. Mirrors `detectPlatform()`. */
const JOB_HOSTS = [
    'https://*.linkedin.com/*',
    'https://*.greenhouse.io/*',
    'https://*.lever.co/*',
    'https://*.myworkdayjobs.com/*',
    'https://*.workday.com/*',
    'https://*.indeed.com/*',
    'https://*.wellfound.com/*',
    'https://*.angel.co/*',
    'https://*.ashbyhq.com/*',
];

export default defineManifest({
    manifest_version: 3,
    name: 'Patronus Job Copilot',
    version: '0.1.0',
    description:
        'Developer job application copilot for analysis, autofill, and resume tailoring.',
    permissions: ['storage', 'tabs', 'sidePanel', 'scripting', 'alarms', 'activeTab'],
    host_permissions: JOB_HOSTS,
    // Optional, so the generic parser can still be granted a board we have not
    // listed — by the user, at the moment they want it, from the extension's
    // own settings. Optional permissions do not appear in the install prompt.
    optional_host_permissions: ['https://*/*'],
    background: {
        service_worker: 'src/background/index.ts',
        type: 'module',
    },
    action: {
        default_title: 'Patronus Job Copilot',
        default_popup: 'src/popup/index.html',
    },
    side_panel: {
        default_path: 'src/sidepanel/index.html',
    },
    content_scripts: [
        {
            matches: JOB_HOSTS,
            // Phase 1 slice 2 ported the parsers to TS modules; Vite now bundles
            // the entire parser pipeline into the content script entry below.
            js: ['src/content/index.ts'],
            run_at: 'document_idle',
            all_frames: true,
        },
    ],
    web_accessible_resources: [
        {
            resources: ['src/sidepanel/index.html', 'src/popup/index.html'],
            matches: JOB_HOSTS,
        },
    ],
});
