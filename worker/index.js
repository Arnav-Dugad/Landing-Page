/* ===========================================================================
   worker/index.js  —  the Cloudflare entry point

   Cloudflare serves every static file straight from its asset store; this
   worker only runs for the routes listed under `run_worker_first` in
   wrangler.jsonc. It is the Cloudflare twin of the Vercel functions in api/:
   share.js and sitemap.js are plain Request → Response handlers and are
   reused untouched, and the OG card shares its layout through _card.js.
   =========================================================================== */

import { ImageResponse } from '@cf-wasm/og';
import { buildCard } from '../api/_card.js';
import share from '../api/share.js';
import sitemap from '../api/sitemap.js';

/* Mirrors the `/(.*)` header block in vercel.json; static files get the same
   set from _headers. */
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()'
};

function withHeaders(res) {
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
}

/* Rendering a card costs real CPU, and unlike Vercel nothing caches a
   worker's response for it — s-maxage alone does nothing here. Keep each
   rendered PNG in this data centre's cache for the same hour. */
async function og(req, ctx) {
    const cache = caches.default;
    const key = new Request(new URL(req.url).toString(), { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return hit;

    const [card, options] = await buildCard(req);
    const res = await ImageResponse.async(card, options);
    if (res.ok) {
        const stored = new Response(res.body, res);
        stored.headers.set('cache-control', 'public, max-age=3600');
        ctx.waitUntil(cache.put(key, stored.clone()));
        stored.headers.set('cache-control', options.headers['cache-control']);
        return stored;
    }
    return res;
}

export default {
    async fetch(req, env, ctx) {
        const { pathname } = new URL(req.url);

        if (pathname === '/api/og') return withHeaders(await og(req, ctx));
        if (pathname.startsWith('/p/')) return withHeaders(await share(req));
        if (pathname === '/sitemap.xml') return withHeaders(await sitemap(req));

        // The pages load Vercel's analytics scripts, which only exist on
        // Vercel. Answer with an empty script instead of a console 404.
        if (pathname.startsWith('/_vercel/')) {
            return new Response('', {
                headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=86400' }
            });
        }

        // The source files under api/ and worker/ are excluded from the
        // asset store, so anything else falls through to it.
        return env.ASSETS.fetch(req);
    }
};
