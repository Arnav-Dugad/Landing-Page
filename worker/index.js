/* ===========================================================================
   worker/index.js  —  the Cloudflare entry point

   Cloudflare serves every static file straight from its asset store; this
   worker only runs for the paths listed under `run_worker_first` in
   wrangler.jsonc. Routes:

     /p/<slug>          per-project share page (api/share.js, shared with Vercel)
     /sitemap.xml       generated sitemap      (api/sitemap.js, shared with Vercel)
     /feed.xml          RSS 2.0
     /feed.json         JSON Feed 1.1
     /api/og            1200x630 PNG card, ?theme=light|dark
     /api/og.svg        the same card, animated
     /api/status        is each project's live link up?
     /api/reactions     emoji reactions per project
     /api/now           the Now page (PUT is admin only)
     /api/ai            writing help from Claude / Gemini / ChatGPT (admin only)
     /api/ai/config     which AI providers are configured (admin only)
     /api/ingest        paste links → a complete project draft (admin, NDJSON)
     /api/discover      GitHub repos not yet on the site (admin)
     /api/meta          living metrics per project; /api/meta/refresh (admin)
     /api/shot          a screenshot of a project's live site
     /api/activity      latest public GitHub activity
     /api/contributions the year's contribution calendar (needs GITHUB_TOKEN)

   All data lives in Firestore (see worker/firestore.js); the Cache API is
   used only as a cache.
   =========================================================================== */

import share from '../api/share.js';
import { fetchProjects } from '../api/_project.js';
import sitemap from '../api/sitemap.js';
import { withHeaders, fail, HttpError } from './http.js';
import { FirestoreError } from './firestore.js';
import { handleOgPng, handleOgSvg } from './og.js';
import { handleStatus, refreshStatus } from './status.js';
import { handleReactions } from './reactions.js';
import { handleNow } from './now.js';
import { handleRss, handleJsonFeed } from './feeds.js';
import { handleAi, handleAiConfig } from './ai.js';
import { handleIngest } from './ingest.js';
import { handleMeta, handleMetaRefresh } from './meta.js';
import { handleShot } from './shot.js';
import { handleDiscover } from './discover.js';
import { handleActivity, handleContributions } from './activity.js';

const CANONICAL_HOST = 'www.arnavdugad.in';

/* The whole project list for visitors. Served from the Worker so a page view
   costs Firestore nothing: fetchProjects() keeps a minute of isolate memory
   plus a last-good copy that survives quota outages. Admins still get a
   realtime Firestore subscription in the browser. */
async function handleProjects(req, env) {
    let projects;
    try {
        projects = await fetchProjects();
    } catch (e) {
        // No live data and no cached copy in this data centre: fall back to
        // the snapshot committed with the site.
        const snap = await env.ASSETS.fetch(new Request(new URL('/data/projects-snapshot.json', req.url)));
        if (!snap.ok) throw e;
        projects = (await snap.json()).projects || [];
    }
    return new Response(JSON.stringify({ projects }), {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'public, max-age=30, stale-while-revalidate=300'
        }
    });
}

async function route(req, env, ctx) {
    const url = new URL(req.url);
    const { pathname } = url;

    // The bare domain always moves to www, so links and the canonical tags
    // agree. Paths served purely as static files are covered by a Cloudflare
    // Redirect Rule instead (see README), since they never reach the worker.
    if (url.hostname === 'arnavdugad.in') {
        return Response.redirect(`https://${CANONICAL_HOST}${pathname}${url.search}`, 301);
    }

    if (pathname === '/api/og') return handleOgPng(req, ctx);
    if (pathname === '/api/og.svg') return handleOgSvg(req, ctx);
    if (pathname === '/api/status') return handleStatus(req, env, ctx);
    if (pathname === '/api/reactions') return handleReactions(req, env);
    if (pathname === '/api/now') return handleNow(req, env);
    if (pathname === '/api/ai') return handleAi(req, env);
    if (pathname === '/api/ai/config') return handleAiConfig(req, env);
    if (pathname === '/api/ingest') return handleIngest(req, env, ctx);
    if (pathname === '/api/discover') return handleDiscover(req, env);
    if (pathname === '/api/projects') return handleProjects(req, env);
    if (pathname === '/api/meta') return handleMeta(req, env, ctx);
    if (pathname === '/api/meta/refresh') return handleMetaRefresh(req, env);
    if (pathname === '/api/shot') return handleShot(req, env, ctx);
    if (pathname === '/api/activity') return handleActivity(req, env, ctx);
    if (pathname === '/api/contributions') return handleContributions(req, env, ctx);

    if (pathname.startsWith('/p/')) return share(req);
    if (pathname === '/sitemap.xml') return sitemap(req);
    if (pathname === '/feed.xml') return handleRss();
    if (pathname === '/feed.json') return handleJsonFeed();

    // The pages load Vercel's analytics scripts, which only exist on
    // Vercel. Answer with an empty script instead of a console 404.
    if (pathname.startsWith('/_vercel/')) {
        return new Response('', {
            headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=86400' }
        });
    }

    if (pathname.startsWith('/api/')) throw new HttpError(404, 'No such endpoint');

    // Anything else falls through to the static asset store.
    return env.ASSETS.fetch(req);
}

export default {
    async fetch(req, env, ctx) {
        try {
            return withHeaders(await route(req, env, ctx));
        } catch (e) {
            if (e instanceof HttpError) return withHeaders(fail(e.status, e.message));
            if (e instanceof FirestoreError) {
                console.error('Firestore', e.code, e.message);
                return withHeaders(fail(e.code === 'PERMISSION_DENIED' ? 503 : 502,
                    e.code === 'PERMISSION_DENIED'
                        ? 'The database refused this request — are the latest firestore.rules published?'
                        : 'The database could not be reached'));
            }
            console.error('Unhandled', e && (e.stack || e.message || e));
            return withHeaders(fail(500, 'Something went wrong on the server'));
        }
    },

    /* Cron Trigger: re-check every live link and store the result, so
       /api/status is answered from Firestore rather than thirty fetches. */
    async scheduled(event, env, ctx) {
        ctx.waitUntil(refreshStatus(env).catch((e) => console.error('cron status', e && e.message)));
    }
};
