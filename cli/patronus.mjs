#!/usr/bin/env node
/**
 * patronus: talk to Patronus from your terminal.
 *
 *   patronus login <key> [--url https://www.patronus.cv]
 *   patronus "shipped the retry queue today, p99 down to 300ms"
 *   patronus chat                 interactive
 *   patronus log "<what you did>"
 *   patronus jobs                 your pipeline
 *   patronus confirm <winId>      add a drafted win to your record
 *   patronus whoami | logout
 *
 * The key comes from `patronus login` (stored in ~/.config/patronus, mode 600)
 * or the PATRONUS_API_KEY environment variable. Create one in
 * Settings → Channels. No dependencies; Node 18+.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'patronus');
const CONFIG = join(CONFIG_DIR, 'config.json');
const DEFAULT_URL = 'https://www.patronus.cv';

function readConfig() {
    try { return JSON.parse(readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

function settings() {
    const file = readConfig();
    return {
        key: process.env.PATRONUS_API_KEY || file.key,
        url: (process.env.PATRONUS_URL || file.url || DEFAULT_URL).replace(/\/$/, ''),
    };
}

function fail(message) {
    console.error(`patronus: ${message}`);
    process.exit(1);
}

async function call(path, init = {}) {
    const { key, url } = settings();
    if (!key) fail('not logged in. Run: patronus login <key>   (create a key in Settings → Channels)');
    let res;
    try {
        res = await fetch(`${url}${path}`, {
            ...init,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(init.headers || {}) },
            signal: AbortSignal.timeout(150_000),
        });
    } catch (error) {
        fail(`could not reach ${url} (${error.message})`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) fail(body.error || `request failed (${res.status})`);
    return body;
}

function ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); }));
}

async function say(text, { interactive = process.stdin.isTTY } = {}) {
    const reply = await call('/api/cli/v1/chat', { method: 'POST', body: JSON.stringify({ text, clientId: randomUUID() }) });
    console.log(reply.text);
    // A drafted Win goes into the record only when you confirm it.
    for (const card of reply.cards || []) {
        if (card.type !== 'win_draft' || card.status !== 'draft') continue;
        if (!interactive) {
            console.log(`(Draft ${card.winId}: confirm in the app, or run: patronus confirm ${card.winId})`);
            continue;
        }
        const answer = await ask('Confirm and add it to your record? [Y/n] ');
        const op = answer === 'n' || answer === 'no' ? 'dismiss' : 'confirm';
        await call('/api/cli/v1/confirm', { method: 'POST', body: JSON.stringify({ winId: card.winId, op }) });
        console.log(op === 'confirm' ? 'In your record.' : 'Dismissed.');
    }
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);

    if (!command || command === 'help' || command === '--help' || command === '-h') {
        console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 17).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
        return;
    }

    if (command === 'login') {
        const key = rest.find((arg) => arg.startsWith('pat_'));
        const urlIndex = rest.indexOf('--url');
        const url = urlIndex >= 0 ? rest[urlIndex + 1] : DEFAULT_URL;
        if (!key) fail('usage: patronus login <pat_…> [--url https://www.patronus.cv]');
        process.env.PATRONUS_API_KEY = key;
        process.env.PATRONUS_URL = url;
        const me = await call('/api/cli/v1/me');
        mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
        writeFileSync(CONFIG, JSON.stringify({ key, url }, null, 2), { mode: 0o600 });
        console.log(`Logged in as ${me.name || me.email || me.userId}.`);
        return;
    }

    if (command === 'logout') {
        if (existsSync(CONFIG)) rmSync(CONFIG);
        console.log('Logged out. (The key still works until you revoke it in Settings → Channels.)');
        return;
    }

    if (command === 'whoami') {
        const me = await call('/api/cli/v1/me');
        console.log(`${me.name || '(no name)'} <${me.email || 'no email'}> · ${me.userId} · ${settings().url}`);
        return;
    }

    if (command === 'log') {
        if (rest.length === 0) fail('usage: patronus log "what you did"');
        await say(`Log this as a win: ${rest.join(' ')}`);
        return;
    }

    if (command === 'confirm') {
        if (!rest[0]) fail('usage: patronus confirm <winId>');
        await call('/api/cli/v1/confirm', { method: 'POST', body: JSON.stringify({ winId: rest[0], op: 'confirm' }) });
        console.log('In your record.');
        return;
    }

    if (command === 'jobs') {
        await say('Show my job pipeline');
        return;
    }

    if (command === 'chat') {
        const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'you › ' });
        console.log('Talking to Patronus. Ctrl+D to leave.');
        rl.prompt();
        for await (const line of rl) {
            const text = line.trim();
            // The prompt's readline owns stdin; confirm in the app or with `patronus confirm`.
            if (text) await say(text, { interactive: false });
            rl.prompt();
        }
        return;
    }

    await say([command, ...rest].join(' '));
}

main().catch((error) => fail(error.message));
