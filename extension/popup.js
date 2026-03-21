const status = document.getElementById('status');
const details = document.getElementById('details');

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

chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTEXT' }, (response) => {
  if (!response?.ok) {
    status.textContent = response?.error || 'Unable to read tab context.';
    return;
  }

  renderContext(response.context);
});
