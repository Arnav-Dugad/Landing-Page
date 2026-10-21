/* ===========================================================================
   worker/meta.js  —  GET /api/meta, POST /api/meta/refresh (admin)

   Living numbers for every project — stars, downloads, latest version,
   commit activity, Lighthouse, uptime, store ratings — kept in Firestore at
   meta/{projectId} so visitors never touch GitHub (and its 60/hour limit).

   Nobody has to press anything: each GET answers from Firestore and, behind
   the response, refreshes up to three entries older than 12 hours. Traffic
   is the scheduler. Lighthouse is slow, so it only runs when the admin asks
   (refresh with psi:true) or during an import.
   =========================================================================== */

import { fetchProjects } from '../api/_project.js';
import { getDoc, setDoc, listDocs, edgeToken } from './firestore.js';
import { requireAdmin } from './auth.js';
import { json, readJson, HttpError } from './http.js';
import { githubMeta, repoSlugFrom, GitHubLimit } from './github.js';
import { pageSpeed } from './web.js';
import { storeOf, readStore, storeMeta } from './stores.js';

const STALE_MS = 12 * 60 * 60 * 1000;
const BACKGROUND_BATCH = 3;
const MEMO_MS = 5 * 60 * 1000;   // listing meta costs one read per project

let memo = { at: 0, data: null };
let refreshing = false;

const repoOf = (p) => repoSlugFrom(p.repo) || repoSlugFrom(p.link);
const hasSource = (p) => !!(repoOf(p) || p.link || (p.stores && Object.keys(p.stores).length));

async function loadStatus() {
    try {
        const doc = await getDoc('site/status');
        if (!doc || typeof doc.checkedAt !== 'number') return null;
        return { checkedAt: doc.checkedAt, results: JSON.parse(doc.results || '{}') };
    } catch { return null; }
}

/* X-Frame-Options DENY/SAMEORIGIN, or a CSP frame-ancestors list that
   doesn't include us, means the browser will refuse our iframe. null when
   the site couldn't be reached — the client then just tries. */
const OUR_HOSTS = ['arnavdugad.in', 'www.arnavdugad.in', 'arnav-portfolio.arnavrival12.workers.dev'];
async function frameable(link) {
    try {
        const res = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 (portfolio frame check)' } });
        res.body?.cancel().catch(() => {});
        const xfo = (res.headers.get('x-frame-options') || '').toLowerCase();
        if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
        const csp = (res.headers.get('content-security-policy') || '').toLowerCase();
        const m = csp.match(/frame-ancestors([^;]*)/);
        if (m) {
            const list = m[1].trim();
            if (list.includes('*') && !list.includes("'none'")) return true;
            if (list.includes("'none'") || list.includes("'self'") && !OUR_HOSTS.some((h) => list.includes(h))) return false;
            return OUR_HOSTS.some((h) => list.includes(h));
        }
        return true;
    } catch {
        return null;
    }
}

/* One project's metadata. `prev` is carried forward wherever a source
   fails, so a hiccup never wipes good numbers. */
async function buildMeta(env, project, prev, status, { psi = false } = {}) {
    const out = { updatedAt: Date.now(), github: prev?.github || null, web: prev?.web || null, store: prev?.store || null };
    let limited = false;

    const slug = repoOf(project);
    if (slug) {
        try {
            const g = await githubMeta(env, slug);
            out.github = g;                                   // null = repo gone
        } catch (e) {
            if (e instanceof GitHubLimit) limited = true;
            else console.error('meta github', slug, e && e.message);
        }
    } else out.github = null;

    if (project.link) {
        const s = status && status.results && status.results[project.id];
        const web = {
            up: s ? !!s.up : (prev?.web?.up ?? null),
            code: s ? (s.code ?? null) : (prev?.web?.code ?? null),
            ms: s ? (s.ms ?? null) : (prev?.web?.ms ?? null),
            checkedAt: s ? status.checkedAt : (prev?.web?.checkedAt ?? null),
            psi: prev?.web?.psi || null,
            frameable: prev?.web?.frameable ?? null
        };
        // Whether the live site allows being shown in our preview iframe —
        // learned once (and re-learned on every PSI refresh), so the detail
        // sheet never shows a blank frame for sites that refuse embedding.
        if (web.frameable === null || psi) web.frameable = await frameable(project.link);
        if (psi) {
            try { web.psi = await pageSpeed(env, project.link, { timeout: 40_000 }); }
            catch (e) { console.error('meta psi', project.link, e && e.message); }
        }
        out.web = web;
    } else out.web = null;

    const stores = project.stores && typeof project.stores === 'object' ? project.stores : {};
    const storeOut = {};
    for (const key of ['play', 'appstore', 'microsoft']) {
        if (!stores[key]) continue;
        const s = storeOf(stores[key]);
        if (!s) continue;
        try {
            const m = storeMeta(await readStore(s));
            if (m) storeOut[key] = m;
        } catch {
            if (prev?.store?.[key]) storeOut[key] = prev.store[key];
        }
    }
    out.store = Object.keys(storeOut).length ? storeOut : null;

    // Rate-limited: keep the old GitHub numbers and try again in an hour
    // rather than in twelve.
    if (limited) out.updatedAt = Date.now() - STALE_MS + 60 * 60 * 1000;
    return out;
}

async function refreshSome(env, projects, docs, ids, opts = {}) {
    const token = await edgeToken(env);
    const status = await loadStatus();
    const done = [];
    const byId = new Map(projects.map((p) => [String(p.id), p]));
    await Promise.all(ids.map(async (id) => {
        const p = byId.get(String(id));
        if (!p) return;
        try {
            const meta = await buildMeta(env, p, docs[id] || null, status, opts);
            await setDoc(`meta/${id}`, meta, token);
            docs[id] = meta;
            done.push(String(id));
        } catch (e) {
            console.error('meta refresh', id, e && e.message);
        }
    }));
    memo = { at: 0, data: null };
    return done;
}

const staleIds = (projects, docs, now = Date.now()) => projects
    .filter(hasSource)
    .map((p) => ({ id: String(p.id), at: (docs[p.id] && docs[p.id].updatedAt) || 0 }))
    .filter((x) => now - x.at > STALE_MS)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.id);

/* Last good meta listing in the Cache API, so a Firestore quota outage
   serves yesterday's numbers instead of an error. */
const META_LAST_GOOD = 'https://meta-cache.internal/v1/last-good';

async function snapshot() {
    if (memo.data && Date.now() - memo.at < MEMO_MS) return memo.data;
    const projects = await fetchProjects();
    let docs, degraded = false;
    try {
        docs = await listDocs('meta');
        caches.default.put(META_LAST_GOOD, new Response(JSON.stringify(docs), {
            headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=2592000' }
        })).catch(() => {});
    } catch (e) {
        console.error('meta list', e && e.message);
        degraded = true;
        try {
            const hit = await caches.default.match(META_LAST_GOOD);
            docs = hit ? await hit.json() : {};
        } catch { docs = {}; }
    }
    const ids = new Set(projects.map((p) => String(p.id)));
    const live = {};
    for (const [id, m] of Object.entries(docs)) if (ids.has(id)) live[id] = m;
    // A degraded snapshot is kept briefly, so recovery is noticed quickly.
    memo = { at: degraded ? Date.now() - MEMO_MS + 30_000 : Date.now(), data: { projects, docs: live, degraded } };
    return memo.data;
}

export async function handleMeta(req, env, ctx) {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET');
    const url = new URL(req.url);

    // One shared answer per data centre for five minutes: listing meta
    // costs a Firestore read per project, and the free tier is 50k a day.
    const cacheKey = new Request(`https://meta-cache.internal/v1/response?${url.searchParams.toString()}`);
    try {
        const hit = await caches.default.match(cacheKey);
        if (hit) return new Response(hit.body, hit);
    } catch { /* no cache */ }
    const res = await buildMetaResponse(req, env, ctx, url);
    if (res.ok) {
        const copy = new Response(res.clone().body, res);
        copy.headers.set('cache-control', 'public, max-age=300');
        ctx.waitUntil(caches.default.put(cacheKey, copy).catch(() => {}));
    }
    return res;
}

async function buildMetaResponse(req, env, ctx, url) {
    const { projects, docs, degraded } = await snapshot();

    // Behind the response: bring the stalest few up to date — but not while
    // the database is refusing us; that would only burn more quota.
    const stale = degraded ? [] : staleIds(projects, docs).slice(0, BACKGROUND_BATCH);
    if (stale.length && !refreshing) {
        refreshing = true;
        ctx.waitUntil(refreshSome(env, projects, { ...docs }, stale)
            .catch((e) => console.error('meta background', e && e.message))
            .finally(() => { refreshing = false; }));
    }

    const slug = url.searchParams.get('p');
    if (slug) {
        const p = projects.find((x) => x.slug === slug);
        if (!p) throw new HttpError(404, 'No such project');
        return json({ id: String(p.id), meta: docs[p.id] || null }, { cache: 'public, max-age=120' });
    }

    const updatedAt = Math.max(0, ...Object.values(docs).map((m) => m.updatedAt || 0)) || null;
    return json({ updatedAt, projects: docs }, { cache: 'public, max-age=120' });
}

export async function handleMetaRefresh(req, env) {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
    await requireAdmin(req, env);
    const body = await readJson(req, 16 * 1024);
    const psi = body.psi === true;
    const batch = psi ? 3 : 4;

    memo = { at: 0, data: null };
    const { projects, docs } = await snapshot();
    const known = new Set(projects.map((p) => String(p.id)));

    let pending;
    if (Array.isArray(body.ids) && body.ids.length) {
        // Explicit ids: refresh exactly these, regardless of age.
        pending = body.ids.map(String).filter((id) => known.has(id)).slice(0, 50);
        const since = Number(body.since) || Date.now() - 10 * 60 * 1000;
        pending = pending.filter((id) => !docs[id] || (docs[id].updatedAt || 0) < since);
    } else {
        // Everything not refreshed in the last ten minutes (or since `since`),
        // so a client can loop until remaining reaches 0.
        const since = Number(body.since) || Date.now() - 10 * 60 * 1000;
        pending = projects.filter(hasSource)
            .filter((p) => !docs[p.id] || (docs[p.id].updatedAt || 0) < since)
            .sort((a, b) => ((docs[a.id] && docs[a.id].updatedAt) || 0) - ((docs[b.id] && docs[b.id].updatedAt) || 0))
            .map((p) => String(p.id));
    }

    const now = pending.slice(0, batch);
    const refreshed = now.length ? await refreshSome(env, projects, { ...docs }, now, { psi }) : [];
    return json({ refreshed, remaining: Math.max(0, pending.length - refreshed.length) });
}
