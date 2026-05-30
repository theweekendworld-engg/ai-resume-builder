import { defineManifest } from '@crxjs/vite-plugin';

// MV3 manifest defined in TS so crxjs can resolve entry paths and hash assets.
// Replaces the static manifest.json under the legacy vanilla extension.
export default defineManifest({
    manifest_version: 3,
    name: 'Patronus Job Copilot',
    version: '0.1.0',
    description:
        'Developer job application copilot for analysis, autofill, and resume tailoring.',
    permissions: ['storage', 'tabs', 'sidePanel', 'scripting', 'alarms'],
    host_permissions: ['<all_urls>'],
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
            matches: ['<all_urls>'],
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
            matches: ['<all_urls>'],
        },
    ],
});
