import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const DEBUG_PORT = 9223;
const FIXTURE_PORT = 4010;
const FIXTURE_URL = `http://www.linkedin.com:${FIXTURE_PORT}/jobs/view/123`;
const PAGE_SCRIPT_FILES = [
  'extension/parsers/utils.js',
  'extension/parsers/page-classifier.js',
  'extension/parsers/dom-reducer.js',
  'extension/parsers/jd-extractor.js',
  'extension/parsers/field-detector.js',
  'extension/parsers/index.js',
  'extension/fill/fill-executor.js',
];

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Back End Developer | Flexiple</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; color: #1f2328; }
      .page { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
      .sidebar { border-right: 1px solid #ddd; padding: 16px; }
      .content { padding: 24px; max-width: 860px; }
      .job-card h1 { font-size: 32px; margin: 12px 0 8px; }
      .meta { color: #666; margin-bottom: 16px; }
      .pill-row { display: flex; gap: 8px; margin-bottom: 16px; }
      .pill { border: 1px solid #999; border-radius: 999px; padding: 6px 12px; }
      .form-card { margin-top: 24px; border: 1px solid #ddd; border-radius: 12px; padding: 16px; }
      label, legend { display: block; font-weight: 600; margin-bottom: 6px; }
      input, textarea, select { width: 100%; box-sizing: border-box; margin-bottom: 14px; padding: 10px; }
      textarea { min-height: 120px; }
    </style>
  </head>
  <body>
    <div class="page">
      <aside class="sidebar">
        <h2>Top job picks for you</h2>
        <p>Back End Developer</p>
      </aside>
      <main class="content">
        <section class="job-card">
          <div>Flexiple</div>
          <h1>Back End Developer</h1>
          <div class="meta">India · Remote · Full-time</div>
          <div class="pill-row">
            <span class="pill">Remote</span>
            <span class="pill">Full-time</span>
          </div>
          <button type="button">Apply</button>
          <h2>About the job</h2>
          <p>We are hiring a backend engineer to design, build, and maintain scalable backend components using AWS technologies.</p>
          <p>Responsibilities include API architecture, troubleshooting production issues, and collaborating on architectural decisions.</p>
          <p>Requirements include Node.js, TypeScript, PostgreSQL, AWS, distributed systems, and strong communication.</p>
        </section>

        <form class="form-card" aria-label="Easy Apply">
          <h2>Easy Apply</h2>
          <label for="full-name">Full Name</label>
          <input id="full-name" name="fullName" type="text" required />

          <label for="email-address">Email</label>
          <input id="email-address" name="email" type="email" required />

          <label for="linkedin-profile">LinkedIn URL</label>
          <input id="linkedin-profile" name="linkedin" type="url" />

          <label for="resume-file">Resume Upload</label>
          <input id="resume-file" name="resume" type="file" />

          <label for="why-company">Why do you want to join this company?</label>
          <textarea id="why-company" name="whyCompany"></textarea>
        </form>
      </main>
    </div>
  </body>
</html>`;

function log(message, detail) {
  if (detail === undefined) {
    console.log(message);
    return;
  }
  console.log(message, detail);
}

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Retry until Chrome is ready.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url} (${response.status})`);
  }
  return response.json();
}

async function waitForTarget(predicate, timeoutMs = 15000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const target = targets.find(predicate);
    if (target) {
      return target;
    }

    await delay(250);
  }

  throw new Error('Timed out waiting for the requested target.');
}

async function injectBrowserScripts(page) {
  for (const relativePath of PAGE_SCRIPT_FILES) {
    const source = await readFile(path.resolve(relativePath), 'utf8');
    await page.send('Runtime.evaluate', {
      expression: source,
    });
  }
}

async function openTarget(url) {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(`Failed to open target: ${response.status}`);
  }
  return response.json();
}

async function connectToTarget(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) {
        reject(new Error(payload.error.message || 'CDP request failed'));
      } else {
        resolve(payload.result);
      }
    }
  });

  return {
    async send(method, params = {}) {
      id += 1;
      const requestId = id;
      const promise = new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      });
      ws.send(JSON.stringify({ id: requestId, method, params }));
      return promise;
    },
    close() {
      ws.close();
    },
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const fixtureServer = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(FIXTURE_HTML);
  });

  await new Promise((resolve, reject) => {
    fixtureServer.listen(FIXTURE_PORT, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'patronus-extension-e2e-'));
  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--host-resolver-rules=MAP www.linkedin.com 127.0.0.1,MAP linkedin.com 127.0.0.1',
    '--window-size=1440,1200',
    'about:blank',
  ];

  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', chromeArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  chrome.stdout.on('data', (chunk) => process.stdout.write(chunk));
  chrome.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const openedTarget = await openTarget(FIXTURE_URL);
    log('Opened target', openedTarget.url);

    const pageTarget = await waitForTarget((target) => target.type === 'page' && target.url.includes('/jobs/view/123'));
    assert(pageTarget, 'Sample job page target was not available.');

    const page = await connectToTarget(pageTarget.webSocketDebuggerUrl);
    await page.send('Runtime.enable');

    await injectBrowserScripts(page);

    const parseResult = await page.send('Runtime.evaluate', {
      expression: 'globalThis.PatronusParser.parseCurrentPage()',
      returnByValue: true,
    });

    const parsed = parseResult.result.value;
    log('Parse response', JSON.stringify(parsed, null, 2));

    assert(parsed?.classification?.platform === 'linkedin', 'Platform detection did not resolve to linkedin.');
    assert(parsed?.metadata?.roleTitle === 'Back End Developer', 'Role title was not parsed as expected.');
    assert((parsed?.stats?.visibleFieldCount ?? 0) >= 4, 'Expected visible form fields to be detected.');
    assert((parsed?.stats?.questionCount ?? 0) >= 1, 'Expected at least one question to be detected.');

    const nameField = parsed.fields.find((field) => field.key === 'full_name');
    const emailField = parsed.fields.find((field) => field.key === 'email');
    const linkedinField = parsed.fields.find((field) => field.key === 'linkedin_url');
    const questionField = parsed.questions.find((question) => question.answerMode === 'long_text');

    assert(nameField?.locator, 'Full name field locator was not recovered.');
    assert(emailField?.locator, 'Email field locator was not recovered.');
    assert(linkedinField?.locator, 'LinkedIn field locator was not recovered.');
    assert(questionField?.locator, 'Question locator was not recovered.');

    const fillResult = await page.send('Runtime.evaluate', {
      expression: `
        (async () => {
          return await globalThis.PatronusFill.applyFillPlan([
            {
              id: 'name-fill',
              action: 'auto_fill',
              fieldLabel: 'Full Name',
              locator: ${JSON.stringify(nameField.locator)},
              value: 'Ada Lovelace',
              inputType: 'text',
              canApply: true,
            },
            {
              id: 'email-fill',
              action: 'auto_fill',
              fieldLabel: 'Email',
              locator: ${JSON.stringify(emailField.locator)},
              value: 'ada@example.com',
              inputType: 'email',
              canApply: true,
            },
            {
              id: 'linkedin-fill',
              action: 'auto_fill',
              fieldLabel: 'LinkedIn URL',
              locator: ${JSON.stringify(linkedinField.locator)},
              value: 'https://www.linkedin.com/in/ada-lovelace',
              inputType: 'url',
              canApply: true,
            },
            {
              id: 'question-fill',
              action: 'review_required',
              fieldLabel: 'Why do you want to join this company?',
              locator: ${JSON.stringify(questionField.locator)},
              value: 'I want to join because the role fits my backend systems experience and interest in scalable infrastructure.',
              inputType: 'textarea',
              canApply: true,
            }
          ]);
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    });

    const fillPayload = fillResult.result.value;
    log('Fill response', JSON.stringify(fillPayload, null, 2));
    assert((fillPayload?.appliedCount ?? 0) >= 4, 'Fill request did not apply the expected actions.');

    const pageStateResult = await page.send('Runtime.evaluate', {
      expression: `(() => ({
        fullName: document.querySelector('#full-name')?.value || '',
        email: document.querySelector('#email-address')?.value || '',
        linkedin: document.querySelector('#linkedin-profile')?.value || '',
        whyCompany: document.querySelector('#why-company')?.value || ''
      }))()`,
      returnByValue: true,
    });

    const pageState = pageStateResult.result.value;
    log('Page values after fill', JSON.stringify(pageState, null, 2));

    assert(pageState.fullName === 'Ada Lovelace', 'Full name was not filled.');
    assert(pageState.email === 'ada@example.com', 'Email was not filled.');
    assert(pageState.linkedin === 'https://www.linkedin.com/in/ada-lovelace', 'LinkedIn URL was not filled.');
    assert(pageState.whyCompany.includes('backend systems experience'), 'Question answer was not inserted.');

    page.close();
    log('Browser parse/fill fixture test passed.');
  } finally {
    chrome.kill('SIGKILL');
    fixtureServer.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
