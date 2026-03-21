const DEFAULT_APP_BASE_URL = 'http://localhost:3000';
const APP_BASE_URL_KEY = 'appBaseUrl';

function normalizeAppBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return DEFAULT_APP_BASE_URL;

  const withProtocol = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, '');
}

export async function getAppBaseUrl() {
  const stored = await chrome.storage.local.get(APP_BASE_URL_KEY);
  const rawValue = stored?.[APP_BASE_URL_KEY];

  if (typeof rawValue === 'string' && rawValue.trim()) {
    return normalizeAppBaseUrl(rawValue);
  }

  return DEFAULT_APP_BASE_URL;
}

export async function setAppBaseUrl(value) {
  const normalized = normalizeAppBaseUrl(value);
  await chrome.storage.local.set({
    [APP_BASE_URL_KEY]: normalized,
  });
  return normalized;
}
