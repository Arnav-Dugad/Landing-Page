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
import { githubMeta, repoSlugFrom, GitHubLimit, bulletsFromNotes } from './github.js';
import { pageSpeed } from './web.js';
import { storeOf, readStore, storeMeta } from './stores.js';
import { structured, availableProvider, strList, clip } from './ai.js';
import { writeHistory, change } from './history.js';

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

const NEW_RELEASE_MS = 14 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/* Release notes → up to five plain-English bullets. Only ever called for a
   recent release, and only in a foreground (admin) refresh — never for a
   visitor and never in the background, where the 30 s waitUntil budget
   could cut it off mid-call. */
const SUMMARY_SCHEMA = {
    type: 'object',
    properties: { bullets: { type: 'array', items: { type: 'string' }, description: 'Two to five short bullets, each under 110 characters.' } },
    required: ['bullets'],
    additionalProperties: false
};
async function summariseRelease(env, project, rel, notes) {
    if (!notes || notes.trim().length < 40 || !availableProvider(env)) return null;
    try {
        const { data } = await structured(env, {
            system: 'You summarise one software release for the "What\'s new" panel of a portfolio. Plain, specific, user-facing language; British spelling; no hype; no invented changes; skip contributor credits, links and checksums. Return only the JSON object.',
            user: `Project: ${project.title || ''}\nRelease: ${rel.name || rel.tag}\n\nRelease notes:\n"""\n${notes.slice(0, 6000)}\n"""`,
            schema: SUMMARY_SCHEMA,
            maxTokens: 1500
        });
        const bullets = strList(data.bullets, 5, 200).map((b) => clip(b, 110));
        return bullets.length ? bullets : null;
    } catch (e) {
        console.error('release summary', project.id, e && e.message);
        return null;
    }
}

/* 0–100, used for the default "Smart" sort. Recency 35, popularity 25,
   uptime 15, Lighthouse 10, completeness of the entry 15. */
export function computeScore(project, meta, now = Date.now()) {
    const g = meta && meta.github;
    const w = meta && meta.web;
    const last = Math.max(
        (g && g.pushedAt) || 0,
        (g && g.release && g.release.date) || 0,
        Number(project.releasedAt) || 0,
        Number(project.updatedAt) || 0,
        Number(project.createdAt) || 0
    );
    const recency = last ? 35 * Math.exp(-Math.max(0, now - last) / (120 * DAY)) : 0;

    const downloads = (g && g.downloads)
        || (Array.isArray(project.downloads) ? project.downloads.reduce((a, d) => a + (Number(d && d.count) || 0), 0) : 0);
    const stars = (g && g.stars) || 0;
    // log scale: ~10k downloads-or-equivalent saturates.
    const popularity = Math.min(25, 25 * Math.log10(1 + downloads + stars * 5) / 4);

    let uptime = 7.5;                                   // unknown
    if (w && w.up === true) uptime = 15;
    else if (w && w.up === false) uptime = 0;
    else if (!project.link && downloads > 0) uptime = 15; // an app, not a site

    const psi = w && w.psi;
    const lh = psi ? 10 * (((psi.performance || 0) + (psi.accessibility || 0) + (psi.bestPractices || 0) + (psi.seo || 0)) / 400) : 5;

    const filled = [
        !!(project.desc && String(project.desc).trim()),
        !!(project.tagline && String(project.tagline).trim()),
        !!(project.longDesc && String(project.longDesc).trim()),
        Array.isArray(project.highlights) && project.highlights.length >= 3,
        !!(project.cover || (Array.isArray(project.gallery) && project.gallery.length)),
        !!project.appIcon || !!project.caseStudy
    ].filter(Boolean).length;
    const completeness = 15 * filled / 6;

    return Math.max(0, Math.min(100, Math.round(recency + popularity + uptime + lh + completeness)));
}

/* Which committed screenshots exist (shots/<slug>.jpg, shots/<slug>.dark.jpg):
   two asset-store lookups, no Firestore. */
async function shotFlags(env, project) {
    if (!env.ASSETS || !project.slug) return null;
    const has = async (name) => {
        try {
            const res = await env.ASSETS.fetch(new Request(`https://assets.local/shots/${name}`));
            res.body?.cancel().catch(() => {});
            return res.ok && (res.headers.get('content-type') || '').startsWith('image/');
        } catch { return false; }
    };
    const [light, dark] = await Promise.all([has(`${project.slug}.jpg`), has(`${project.slug}.dark.jpg`)]);
    return { light, dark };
}

/* The changes worth a line in the history log — movement a person would
   notice, not every recomputed field. */
function meaningfulChanges(prev, next) {
    if (!prev) return [];
    const out = [];
    const pg = prev.github || {}, ng = next.github || {};
    if (prev.github && next.github) {
        if ((ng.stars || 0) !== (pg.stars || 0)) out.push(change('stars', pg.stars || 0, ng.stars || 0));
        if ((ng.downloads || 0) !== (pg.downloads || 0)) out.push(change('downloads', pg.downloads || 0, ng.downloads || 0));
        if ((ng.forks || 0) !== (pg.forks || 0)) out.push(change('forks', pg.forks || 0, ng.forks || 0));
    }
    if (prev.github && next.github === null) out.push(change('repo', pg.repo || 'repo', 'gone'));
    const pu = prev.web && prev.web.up, nu = next.web && next.web.up;
    if (typeof pu === 'boolean' && typeof nu === 'boolean' && pu !== nu) out.push(change('live', pu ? 'up' : 'down', nu ? 'up' : 'down'));
    return out;
}

async function logEvents(env, project, prev, next, events) {
    const writes = [];
    if (events.newRelease) {
        const { rel, prevTag } = events.newRelease;
        writes.push(writeHistory(env, {
            projectId: project.id,
            kind: 'release',
            summary: `${project.title || 'Project'} released ${rel.name || rel.tag}`,
            changes: [change('version', prevTag, rel.tag), ...(rel.summary || []).slice(0, 5).map((b, i) => change(`note ${i + 1}`, '', b))]
        }));
    }
    const diff = meaningfulChanges(prev, next);
    if (diff.length) {
        const bits = diff.map((d) => (d.field === 'live' ? `now ${d.after}` : `${d.field} ${d.before} → ${d.after}`));
        writes.push(writeHistory(env, {
            projectId: project.id,
            kind: 'refresh',
            summary: `${project.title || 'Project'}: ${bits.join(', ')}`.slice(0, 200),
            changes: diff
        }));
    }
    await Promise.all(writes);
}

/* One project's metadata. `prev` is carried forward wherever a source
   fails, so a hiccup never wipes good numbers. Returns the meta plus what
   happened (for the history log). `ai` allows an AI release summary. */
async function buildMeta(env, project, prev, status, { psi = false, ai = false } = {}) {
    const out = { updatedAt: Date.now(), github: prev?.github || null, web: prev?.web || null, store: prev?.store || null };
    const events = { newRelease: null };
    let limited = false;

    const slug = repoOf(project);
    if (slug) {
        try {
            const g = await githubMeta(env, slug);
            if (g && g.release) {
                const rel = g.release;
                const notes = rel.notes || '';
                delete rel.notes;                              // never stored
                const prevRel = prev?.github?.release || null;
                const sameTag = !!(prevRel && prevRel.tag === rel.tag);
                if (sameTag && Array.isArray(prevRel.summary) && prevRel.summary.length) {
                    rel.summary = prevRel.summary;
                    rel.summaryBy = prevRel.summaryBy || 'notes';
                } else {
                    rel.summary = bulletsFromNotes(notes);
                    rel.summaryBy = 'notes';
                }
                // A recent release gets an AI summary — foreground only.
                const recent = !!(rel.date && Date.now() - rel.date < 120 * DAY);
                if (ai && recent && rel.summaryBy !== 'ai') {
                    const better = await summariseRelease(env, project, rel, notes);
                    if (better) { rel.summary = better; rel.summaryBy = 'ai'; }
                }
                rel.isNew = !!(rel.date && Date.now() - rel.date < NEW_RELEASE_MS);
                // A tag we haven't seen before, on a project we already tracked.
                if (prev?.github && !sameTag && rel.tag) events.newRelease = { rel, prevTag: prevRel ? prevRel.tag : '' };
            }
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

    out.shots = (await shotFlags(env, project)) || prev?.shots || null;
    out.score = computeScore(project, out);

    // Rate-limited: keep the old GitHub numbers and try again in an hour
    // rather than in twelve.
    if (limited) out.updatedAt = Date.now() - STALE_MS + 60 * 60 * 1000;
    return { meta: out, events };
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
            const prev = docs[id] || null;
            const { meta, events } = await buildMeta(env, p, prev, status, opts);
            await setDoc(`meta/${id}`, meta, token);
            docs[id] = meta;
            done.push(String(id));
            await logEvents(env, p, prev, meta, events);
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

export async function snapshot() {
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
    const refreshed = now.length ? await refreshSome(env, projects, { ...docs }, now, { psi, ai: true }) : [];
    return json({ refreshed, remaining: Math.max(0, pending.length - refreshed.length) });
}
