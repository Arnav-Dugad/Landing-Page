// Cloudflare Worker entry for Urbana: the two former Vercel functions,
// everything else from the built assets.
import { searchPlaces, reversePlace } from './api/_geocode-core.js';
import { queryOverpassMirrors } from './api/_overpass-mirrors.js';

const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache }
});

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        try {
            if (url.pathname === '/api/geocode') {
                const q = url.searchParams.get('q');
                const lat = url.searchParams.get('lat');
                const lon = url.searchParams.get('lon');
                const cache = 'public, s-maxage=86400, stale-while-revalidate=604800';
                if (lat != null && lon != null) return json({ name: await reversePlace(lat, lon) }, 200, cache);
                if (q != null) return json({ results: await searchPlaces(q) }, 200, cache);
                return json({ error: 'Provide ?q= or ?lat=&lon=' }, 400);
            }
            if (url.pathname === '/api/overpass') {
                if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { allow: 'POST', 'content-type': 'application/json' } });
                const text = await req.text();
                let query;
                try { query = JSON.parse(text).query; } catch { query = text; }
                if (!query || typeof query !== 'string') return json({ error: 'Missing "query" in request body.' }, 400);
                const result = await queryOverpassMirrors(query, { perMirrorMs: 14000, overallMs: 24000 });
                if (!result.ok) return json({ error: result.message }, result.status);
                return json(result.json, 200, 'public, s-maxage=600, stale-while-revalidate=1800');
            }
        } catch (err) {
            return json({ error: String((err && err.message) || err) }, 500);
        }
        return env.ASSETS.fetch(req);
    }
};
