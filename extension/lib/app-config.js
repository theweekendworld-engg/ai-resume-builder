const DEFAULT_APP_BASE_URL = 'http://localhost:3000';
const APP_BASE_URL_KEY = 'appBaseUrl';

export async function getAppBaseUrl() {
  const stored = await chrome.storage.local.get(APP_BASE_URL_KEY);
  const rawValue = stored?.[APP_BASE_URL_KEY];

  if (typeof rawValue === 'string' && rawValue.trim()) {
    return rawValue.trim().replace(/\/+$/, '');
  }

  return DEFAULT_APP_BASE_URL;
}

export async function setAppBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  await chrome.storage.local.set({
    [APP_BASE_URL_KEY]: normalized || DEFAULT_APP_BASE_URL,
  });
  return normalized || DEFAULT_APP_BASE_URL;
}
