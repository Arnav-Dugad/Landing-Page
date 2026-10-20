/* ===========================================================================
   worker/status.js  —  GET /api/status, plus the cron refresh

   Is each project's live link actually up? Checked from the edge every 30
   minutes by a Cron Trigger and kept in Firestore at site/status, so a
   visitor never waits on thirty outbound requests.

   Free-plan workers get 50 subrequests per invocation. Reading the stored
   status, the projects, signing in and writing back take up to five, so at
   most 43 links are checked per run.
   =========================================================================== */

import { fetchProjects } from '../api/_project.js';
import { getDoc, setDoc, edgeToken } from './firestore.js';
import { json } from './http.js';

const FRESH_MS = 15 * 60 * 1000;
const MAX_CHECKS = 43;

/* A login wall, a bot challenge or a disallowed method still proves the
   server is there — only "not found", server errors and silence count as
   down. */
const UP_CODES = new Set([401, 403, 405, 429]);

const isHttp = (link) => {
    try {
        const u = new URL(String(link || ''));
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch { return false; }
};

async function probe(link) {
    const started = Date.now();
    try {
        const res = await fetch(link, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(6000),
            headers: {
                'user-agent': 'Mozilla/5.0 (compatible; ArnavPortfolioStatus/1.0; +https://www.arnavdugad.in)',
                accept: 'text/html,*/*'
            },
            cf: { cacheTtl: 0 }
        });
        // Headers are all we need; don't download the page.
        try { await res.body?.cancel(); } catch { /* already closed */ }
        const up = (res.status >= 200 && res.status < 400) || UP_CODES.has(res.status);
        return { up, code: res.status, ms: Date.now() - started };
    } catch (e) {
        const msg = String(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : (e && e.message) || e);
        // Running out of subrequests says nothing about the site — skip it.
        if (/too many subrequests/i.test(msg)) return null;
        return { up: false, code: null, ms: null, error: msg.slice(0, 120) };
    }
}

export async function computeStatus() {
    const projects = await fetchProjects();
    const targets = projects.filter((p) => isHttp(p.link)).slice(0, MAX_CHECKS);

    const results = {};
    const outcomes = await Promise.all(targets.map((p) => probe(p.link)));
    targets.forEach((p, i) => { if (outcomes[i]) results[p.id] = outcomes[i]; });

    return { checkedAt: Date.now(), results };
}

/* Persist with the worker's own account. A failed write is logged rather
   than thrown — the freshly computed result is still worth returning. */
async function store(env, status) {
    try {
        const token = await edgeToken(env);
        await setDoc('site/status', { checkedAt: status.checkedAt, results: JSON.stringify(status.results) }, token);
        return true;
    } catch (e) {
        console.error('status: could not store', e && e.message);
        return false;
    }
}

async function load() {
    try {
        const doc = await getDoc('site/status');
        if (!doc || typeof doc.checkedAt !== 'number') return null;
        return { checkedAt: doc.checkedAt, results: JSON.parse(doc.results || '{}') };
    } catch (e) {
        console.error('status: could not read', e && e.message);
        return null;
    }
}

export async function refreshStatus(env) {
    const status = await computeStatus();
    await store(env, status);
    return status;
}

export async function handleStatus(req, env, ctx) {
    const saved = await load();

    if (saved && Date.now() - saved.checkedAt < FRESH_MS) {
        return json(saved, { cache: 'public, max-age=60' });
    }
    if (saved) {
        // Stale: answer now, refresh behind the response.
        ctx.waitUntil(refreshStatus(env).catch((e) => console.error('status refresh', e)));
        return json(saved, { cache: 'public, max-age=60' });
    }
    // Nothing stored yet (first run, or rules not published): compute inline.
    const status = await computeStatus();
    ctx.waitUntil(store(env, status));
    return json(status, { cache: 'public, max-age=60' });
}
