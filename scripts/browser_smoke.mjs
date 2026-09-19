// End-to-end browser smoke for Local.Qkview.
//
// Uploads an archive through the real file input, waits for the pipeline,
// checks for an expected section, then exercises the per-row delete in
// "Recent Analyses" (RT#36) — a click, the two-step confirm, and the row
// actually going away.
//
// Drives Chrome over the DevTools Protocol using node 22's built-in WebSocket:
// no playwright, no puppeteer, nothing added to package.json. It needs only a
// Chrome/Chromium binary, and `--chrome <path>` points at one.
//
// Usage (from a host with node >= 20.9 — NOT blackbriar, see RT#336):
//   node scripts/browser_smoke.mjs --app http://127.0.0.1:3001 \
//        --upload /path/to/archive.tar --expect "Chassis Partitions" \
//        --chrome /usr/bin/chromium --shot /tmp/shot.png
//
// Exits non-zero on the first failed assertion and prints every step it took.
//
// A NOTE THAT COST AN HOUR: assertions use `textContent`, never `innerText`.
// `innerText` is the RENDERED text, so any label carrying Tailwind's
// `uppercase` class fails a case-sensitive match against its own source
// string — the table is on the page and the test says it is not.
//
// NEVER point --upload at a customer archive on a shared or remote host: the
// analysis, its log index and any screenshot all carry that archive's data.
// See qkview/README.md for which local archives are customer material (RT#338).

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : d;
};
const APP = arg('--app', 'http://127.0.0.1:3011');
const UPLOAD = arg('--upload');
const EXPECT = arg('--expect');
const SHOT = arg('--shot');
const CHROME = arg('--chrome', process.env.CHROME_PATH || '/usr/bin/chromium');
const ANALYZE_TIMEOUT_MS = Number(arg('--analyze-timeout', '600000'));

const steps = [];
function step(msg) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
    steps.push(line);
    console.log(line);
}
function fail(msg) {
    console.error(`\nFAILED: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
}

const userDataDir = mkdtempSync(join(tmpdir(), 'cdp-smoke-'));
const chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--window-size=1400,2400',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => { });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browserWsUrl() {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch('http://127.0.0.1:9222/json/version');
            if (r.ok) return (await r.json()).webSocketDebuggerUrl;
        } catch { /* not up yet */ }
        await sleep(250);
    }
    fail('chrome did not expose its debugging port');
}

async function connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = () => rej(new Error('ws connect failed'));
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
        }
    };
    const send = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
            const mid = ++id;
            pending.set(mid, { resolve, reject });
            ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
        });
    return { ws, send };
}

let session;
let send;

async function evaluate(expression) {
    const r = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
    }, session);
    if (r.exceptionDetails) {
        fail(`page threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result.value;
}

// `innerText` returns text AFTER CSS text-transform, so a label styled with
// Tailwind's `uppercase` will not match its source casing. `textContent` is the
// untransformed text — use it, and compare case-insensitively anyway.
const hasText = (s) =>
    `document.body.textContent.toLowerCase().includes(${JSON.stringify(String(s).toLowerCase())})`;

async function waitFor(label, expression, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        last = await evaluate(expression);
        if (last) return last;
        await sleep(500);
    }
    fail(`timed out waiting for ${label} (last value: ${JSON.stringify(last)})`);
}

try {
    const wsUrl = await browserWsUrl();
    ({ send } = await connect(wsUrl));
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Page.enable', {}, session);
    await send('Runtime.enable', {}, session);
    await send('DOM.enable', {}, session);
    step(`chrome up, attached to a page target`);

    await send('Page.navigate', { url: `${APP}/qkview` }, session);
    await waitFor('document ready', `document.readyState === 'complete'`);
    await waitFor('the analyzer heading', hasText('QKView Analyzer'));
    step(`loaded ${APP}/qkview`);

    if (UPLOAD) {
        // Set the hidden file input through CDP — this fires a real change
        // event, so the React handler runs exactly as it does for a user.
        const doc = await send('DOM.getDocument', {}, session);
        const { nodeId } = await send('DOM.querySelector', {
            nodeId: doc.root.nodeId, selector: 'input[type=file]',
        }, session);
        if (!nodeId) fail('no file input on the page');
        await send('DOM.setFileInputFiles', { files: [UPLOAD], nodeId }, session);
        step(`selected ${UPLOAD} in the file input`);

        await waitFor('the Begin Analysis button',
            `!!Array.from(document.querySelectorAll('button')).find(b => /Begin Analysis/.test(b.textContent))`);
        await evaluate(
            `Array.from(document.querySelectorAll('button')).find(b => /Begin Analysis/.test(b.textContent)).click(), true`);
        step('clicked Begin Analysis — waiting for the pipeline');

        await waitFor('Analysis Complete', hasText('Analysis Complete'), ANALYZE_TIMEOUT_MS);
        const host = await evaluate(
            `(document.body.innerText.match(/Hostname: ([^\\n|]+)/) || [])[1] || ''`);
        step(`analysis finished (hostname shown: ${String(host).trim() || 'n/a'})`);
    }

    if (EXPECT) {
        await waitFor(`the text ${JSON.stringify(EXPECT)}`, hasText(EXPECT));
        step(`found ${JSON.stringify(EXPECT)} on the page`);
        const table = await evaluate(`(() => {
            const h = Array.from(document.querySelectorAll('p')).find(p => p.textContent.toLowerCase().includes(${JSON.stringify(EXPECT.toLowerCase())}));
            const t = h && h.parentElement && h.parentElement.querySelector('table');
            if (!t) return null;
            return Array.from(t.querySelectorAll('tr')).map(r =>
                Array.from(r.querySelectorAll('th,td')).map(c => c.textContent.trim()).join(' | ')
            );
        })()`);
        if (table) {
            step(`table under ${JSON.stringify(EXPECT)}:`);
            for (const row of table) console.log(`        ${row}`);
        }
    }

    // ---- RT#36: the per-row delete ---------------------------------------
    await waitFor('the Recent Analyses panel', hasText('Recent Analyses'));
    const before = await evaluate(
        `document.querySelectorAll('button[title^="Delete analysis"]').length`);
    step(`Recent Analyses shows ${before} deletable row(s)`);
    if (before < 1) fail('no deletable row to exercise');

    const targetTitle = await evaluate(
        `document.querySelector('button[title^="Delete analysis"]').title`);
    step(`clicking: ${targetTitle}`);
    await evaluate(`document.querySelector('button[title^="Delete analysis"]').click(), true`);

    await waitFor('the confirm button',
        `!!Array.from(document.querySelectorAll('button')).find(b => /Confirm delete/.test(b.textContent))`);
    step('two-step confirm appeared');
    await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => /Confirm delete/.test(b.textContent)).click(), true`);
    step('clicked Confirm delete');

    await waitFor('the row to disappear',
        `document.querySelectorAll('button[title^="Delete analysis"]').length < ${before}`, 60000);
    const after = await evaluate(
        `document.querySelectorAll('button[title^="Delete analysis"]').length`);
    step(`rows went ${before} -> ${after}`);

    if (SHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, session);
        writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
        step(`screenshot written to ${SHOT}`);
    }

    console.log('\nSMOKE PASSED');
} catch (e) {
    console.error(`\nSMOKE FAILED: ${e.message}`);
    process.exitCode = 1;
} finally {
    try { chrome.kill('SIGKILL'); } catch { }
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { }
}
