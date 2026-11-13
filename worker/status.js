/* ===========================================================================
   worker/status.js  —  GET /api/status, plus the refresh

   Is each project's live link actually up? Checked from the edge and kept
   in Firestore at site/status, so a visitor never waits on outbound
   requests. Refreshed behind a visitor's request once it is 15 minutes old.

   Limits that shape this file:
     · A Worker keeps at most six outbound connections open; extra fetches
       queue. Firing every probe at once meant each one's timeout started
       while it was still queued, and every site came back "timeout" — down.
       Probes now run six at a time, each timed from when it really starts.
     · Free-plan workers get 50 subrequests per invocation. Reading the stored
       status, the projects, signing in and writing back take up to five, so
       at most 43 links are probed per run. With more links than that, each
       run takes the ones checked longest ago; the rest keep their last
       result, so every project is covered across runs.
     · Background work after a response gets about 30 seconds, so no new
       probe starts after DEADLINE_MS.
   HEAD is enough to learn the status and has no body to drain (an unread
   body can keep a connection busy). A timeout on a site that was up last
   time is treated as a blip, not an outage, until it happens twice running.
   =========================================================================== */

import { fetchProjects } from '../api/_project.js';
import { getDoc, setDoc, edgeToken } from './firestore.js';
import { json } from './http.js';

const FRESH_MS = 15 * 60 * 1000;
const MAX_CHECKS = 43;
const CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 7000;
const DEADLINE_MS = 20000;

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
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            headers: {
                'user-agent': 'Mozilla/5.0 (compatible; ArnavPortfolioStatus/1.1; +https://www.arnavdugad.in)',
                accept: 'text/html,*/*'
            },
            cf: { cacheTtl: 0 }
        });
        try { await res.body?.cancel(); } catch { /* HEAD has none */ }
        const up = (res.status >= 200 && res.status < 400) || UP_CODES.has(res.status);
        return { up, code: res.status, ms: Date.now() - started, at: Date.now() };
    } catch (e) {
        const msg = String(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : (e && e.message) || e);
        // Running out of subrequests says nothing about the site — skip it.
        if (/too many subrequests/i.test(msg)) return null;
        return { up: false, code: null, ms: null, error: msg.slice(0, 120), at: Date.now() };
    }
}

/* Run fn over items with at most `limit` in flight, starting nothing new
   after the deadline. Unstarted items get undefined. */
async function pool(items, limit, deadline, fn) {
    const out = new Array(items.length);
    let next = 0;
    const lane = async () => {
        while (next < items.length && Date.now() < deadline) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return out;
}

export async function computeStatus(previous = null) {
    const started = Date.now();
    const prev = (previous && previous.results) || {};
    const projects = await fetchProjects();
    const all = projects.filter((p) => isHttp(p.link));
    const ids = new Set(all.map((p) => p.id));

    // Never-checked first, then the stalest.
    const targets = [...all]
        .sort((a, b) => ((prev[a.id] && prev[a.id].at) || 0) - ((prev[b.id] && prev[b.id].at) || 0))
        .slice(0, MAX_CHECKS);

    const outcomes = await pool(targets, CONCURRENCY, started + DEADLINE_MS, (p) => probe(p.link));

    // Carry over what wasn't probed this time (for projects that still exist).
    const results = {};
    Object.entries(prev).forEach(([id, r]) => { if (ids.has(id)) results[id] = r; });
    targets.forEach((p, i) => {
        const now = outcomes[i];
        if (!now) return;
        const before = prev[p.id];
        if (now.error === 'timeout' && before && before.up && !before.blip) {
            // One slow answer after a good one: keep "up", remember the blip.
            results[p.id] = { ...before, blip: true, at: now.at };
            return;
        }
        results[p.id] = now;
    });

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

export async function refreshStatus(env, previous) {
    const status = await computeStatus(previous === undefined ? await load() : previous);
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
        ctx.waitUntil(refreshStatus(env, saved).catch((e) => console.error('status refresh', e)));
        return json(saved, { cache: 'public, max-age=60' });
    }
    // Nothing stored yet (first run, or rules not published): compute inline.
    const status = await computeStatus(null);
    ctx.waitUntil(store(env, status));
    return json(status, { cache: 'public, max-age=60' });
}
