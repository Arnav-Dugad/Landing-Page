/* ===========================================================================
   worker/releases.js  —  GET /api/releases

   The release radar: every project's latest GitHub release from the last
   120 days, newest first, with its "What's new" bullets. Built from the
   meta snapshot (no extra Firestore reads beyond the cached listing) and
   cached per data centre for ten minutes. Any failure answers an empty,
   valid list — the strip on the page simply doesn't show.
   =========================================================================== */

import { snapshot } from './meta.js';
import { json, HttpError } from './http.js';

const WINDOW_MS = 120 * 24 * 60 * 60 * 1000;
const CACHE = 'public, max-age=600';

const isPublic = (p) => !p.hidden;

/* Shared with the feeds: newest-first release items for visible projects. */
export async function releaseItems() {
    let data;
    try { data = await snapshot(); } catch (e) {
        console.error('releases: snapshot failed', e && e.message);
        return [];
    }
    const { projects, docs } = data;
    const now = Date.now();
    const items = [];
    for (const p of projects) {
        if (!isPublic(p)) continue;
        const rel = docs[p.id] && docs[p.id].github && docs[p.id].github.release;
        if (!rel || !rel.date || now - rel.date > WINDOW_MS) continue;
        items.push({
            projectId: String(p.id),
            slug: p.slug,
            title: p.title || '',
            platforms: Array.isArray(p.platforms) ? p.platforms : [],
            tag: rel.tag || '',
            name: rel.name || rel.tag || '',
            date: rel.date,
            url: rel.url || '',
            summary: Array.isArray(rel.summary) ? rel.summary : [],
            isNew: !!(rel.date && now - rel.date < 14 * 24 * 60 * 60 * 1000)
        });
    }
    return items.sort((a, b) => b.date - a.date);
}

export async function handleReleases(req, env, ctx) {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET');

    const cacheKey = new Request('https://releases-cache.internal/v1/list');
    try {
        const hit = await caches.default.match(cacheKey);
        if (hit) return new Response(hit.body, hit);
    } catch { /* no cache */ }

    const items = await releaseItems();
    const res = json({ items }, { cache: CACHE });
    // An empty answer may just mean the database is resting — keep it briefly.
    const copy = new Response(res.clone().body, res);
    if (!items.length) copy.headers.set('cache-control', 'public, max-age=60');
    ctx.waitUntil(caches.default.put(cacheKey, copy).catch(() => {}));
    return res;
}
