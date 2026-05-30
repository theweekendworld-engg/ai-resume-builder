const APP_BASE_KEY = 'config.appBase';
const DEFAULT_APP_BASE = 'http://localhost:3000';

export async function getAppBaseUrl(): Promise<string> {
    const out = await chrome.storage.local.get([APP_BASE_KEY]);
    const stored = out[APP_BASE_KEY] as string | undefined;
    if (stored && /^https?:\/\//i.test(stored)) return stored.replace(/\/$/, '');
    return DEFAULT_APP_BASE;
}

export async function setAppBaseUrl(value: string): Promise<void> {
    const trimmed = value.replace(/\/$/, '');
    await chrome.storage.local.set({ [APP_BASE_KEY]: trimmed });
}
