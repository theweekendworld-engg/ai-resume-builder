import { getAppBaseUrl, setAppBaseUrl } from './lib/app-config.js';

const status = document.getElementById('status');
const details = document.getElementById('details');
const accessPill = document.getElementById('access-pill');
const accessMessage = document.getElementById('access-message');
const appBaseUrlInput = document.getElementById('app-base-url');
const appBaseUrlNote = document.getElementById('app-base-url-note');
const saveAppUrlButton = document.getElementById('save-app-url');
const openDashboardButton = document.getElementById('open-dashboard');
const openSignInButton = document.getElementById('open-sign-in');

function appendRow(label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  details.append(dt, dd);
}

function renderContext(context) {
  details.replaceChildren();

  if (!context) {
    status.textContent = 'No parsed page context has been captured for this tab yet.';
    return;
  }

  status.textContent = context.metadata?.roleTitle || context.heading || context.visibleTitle || 'Page detected';

  appendRow('Platform', context.classification?.platform || 'unknown');
  appendRow('Page kind', context.classification?.pageKind || 'unknown');
  appendRow('Company', context.metadata?.companyName || 'unknown');
  appendRow('Location', context.metadata?.location || 'unknown');
  appendRow('Fields', String(context.stats?.visibleFieldCount ?? context.fields?.length ?? 0));
  appendRow('Questions', String(context.stats?.questionCount ?? context.questions?.length ?? 0));
  appendRow('JD', context.jobDescription?.confidenceBand || 'missing');
  appendRow('Updated', context.updatedAt ? new Date(context.updatedAt).toLocaleTimeString() : 'unknown');
}

function setAccessState(state) {
  accessPill.dataset.tone = state.tone;
  accessPill.textContent = state.label;
  accessMessage.textContent = state.message;
}

async function openUrl(url) {
  if (!url) return;
  await chrome.runtime.sendMessage({
    type: 'OPEN_URL',
    url,
  });
}

async function refreshContext() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTEXT' });
  if (!response?.ok) {
    status.textContent = response?.error || 'Unable to read tab context.';
    return;
  }

  renderContext(response.context);
}

async function refreshAccess() {
  setAccessState({
    tone: 'warn',
    label: 'Checking App',
    message: 'Verifying the saved app URL and browser session...',
  });

  const response = await chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_ACCESS' });
  const appBaseUrl = response?.appBaseUrl || await getAppBaseUrl();
  appBaseUrlInput.value = appBaseUrl;

  if (!response?.ok) {
    setAccessState({
      tone: 'bad',
      label: 'App Error',
      message: response?.error || 'Unable to verify extension access right now.',
    });
    return;
  }

  if (response.status === 'authenticated') {
    const expiryText = response.expiresAt
      ? ` Token active until ${new Date(response.expiresAt).toLocaleString()}.`
      : '';
    setAccessState({
      tone: 'good',
      label: response.authType === 'extension_token' ? 'Token Ready' : 'Signed In',
      message: `Backend access is ready for autofill, answers, workspace sync, and resume generation.${expiryText}`,
    });
    return;
  }

  if (response.status === 'unauthenticated') {
    setAccessState({
      tone: 'warn',
      label: 'Sign In',
      message: 'Open the app sign-in page in this browser first, then return to the extension.',
    });
    return;
  }

  setAccessState({
    tone: 'bad',
    label: 'Unreachable',
    message: response.message || 'The saved app URL could not be reached from the extension.',
  });
}

saveAppUrlButton.addEventListener('click', async () => {
  const saved = await setAppBaseUrl(appBaseUrlInput.value);
  appBaseUrlInput.value = saved;
  appBaseUrlNote.textContent = `Saved app base URL: ${saved}`;
  await refreshAccess();
});

openDashboardButton.addEventListener('click', async () => {
  const appBaseUrl = appBaseUrlInput.value.trim() || await getAppBaseUrl();
  await openUrl(appBaseUrl);
});

openSignInButton.addEventListener('click', async () => {
  const appBaseUrl = appBaseUrlInput.value.trim() || await getAppBaseUrl();
  await openUrl(`${appBaseUrl.replace(/\/+$/, '')}/sign-in`);
});

Promise.all([
  refreshContext(),
  refreshAccess(),
]).catch((error) => {
  const message = error instanceof Error ? error.message : 'Failed to initialize the extension popup.';
  status.textContent = message;
  setAccessState({
    tone: 'bad',
    label: 'Init Failed',
    message,
  });
});
