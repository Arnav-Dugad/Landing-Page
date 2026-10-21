/* ===========================================================================
   worker/shot.js  —  GET /api/shot?p=<slug>&w=<320..1600>[&device=mobile][&theme=dark]

   A real screenshot of a project's live site, for cards and device frames.

   Captured with Cloudflare Browser Rendering (headless Chrome run by
   Cloudflare itself — no third-party screenshot service), then kept in
   Firestore at shots/{projectId}[__m] so each site is photographed about
   once a fortnight, not once per visitor. In front of that sit the Cache
   API and a small isolate memory cache.

   Only slugs of real projects with a live link are accepted, so this can't
   be used to screenshot arbitrary URLs.
   =========================================================================== */

import puppeteer from '@cloudflare/puppeteer';
import { fetchProjects } from '../api/_project.js';
import { getDoc, setDoc, edgeToken } from './firestore.js';
import { HttpError, toBase64 } from './http.js';

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const WIDTHS = [320, 480, 640, 800, 960, 1280, 1600];
const DEVICES = {
    desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false },
    mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
};
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

const memory = new Map();
const MEMORY_MAX = 24;
const inflight = new Map();

const remember = (key, val) => {
    memory.delete(key);
    memory.set(key, val);
    while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
};

const upMemo = new Map();          // link -> { at, up }
async function siteUp(link) {
    const hit = upMemo.get(link);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.up;
    let up = false;
    try {
        const res = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(6000) });
        res.body?.cancel().catch(() => {});
        up = (res.status >= 200 && res.status < 400) || [401, 403, 405, 429].includes(res.status);
    } catch { up = false; }
    upMemo.set(link, { at: Date.now(), up });
    return up;
}

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function imageResponse(bytes, type, extra = {}) {
    return new Response(bytes, {
        headers: {
            'content-type': type,
            'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
            ...extra
        }
    });
}

const notReady = (why) => new Response(JSON.stringify({ ok: false, error: why }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '20', 'cache-control': 'no-store' }
});

/* Headless Chrome on Cloudflare. A JPEG at quality 72 keeps a 1280x800
   capture around 80–200 KB — small enough for one Firestore document. */
async function capture(env, link, device, theme = 'light') {
    const browser = await puppeteer.launch(env.BROWSER);
    try {
        const page = await browser.newPage();
        const spec = DEVICES[device];
        await page.setViewport(spec);
        if (device === 'mobile') await page.setUserAgent(MOBILE_UA);
        // Sites that follow the OS theme render their dark palette here.
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]).catch(() => {});
        try {
            await page.goto(link, { waitUntil: 'networkidle2', timeout: 25_000 });
        } catch {
            // Sites with a stream that never idles still render; take what's there.
        }
        // Let entrance animations and webfonts settle, and dismiss the most
        // common cookie banners so they don't cover the hero.
        await new Promise((r) => setTimeout(r, 1800));
        await page.evaluate(() => {
            for (const el of document.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]')) {
                const s = getComputedStyle(el);
                if (s.position === 'fixed' || s.position === 'sticky') el.remove();
            }
        }).catch(() => {});
        const buf = await page.screenshot({ type: 'jpeg', quality: device === 'mobile' ? 70 : 72 });
        return buf;
    } finally {
        await browser.close().catch(() => {});
    }
}

export async function handleShot(req, env, ctx) {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET');
    const url = new URL(req.url);
    const slug = (url.searchParams.get('p') || '').toLowerCase();
    if (!/^[a-z0-9-]{1,120}$/.test(slug)) throw new HttpError(400, 'p must be a project slug');
    const wanted = Number(url.searchParams.get('w')) || 1280;
    const w = WIDTHS.reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a), WIDTHS[0]);
    const device = url.searchParams.get('device') === 'mobile' ? 'mobile' : 'desktop';
    const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';

    // Captures committed with the site cost nothing to serve and never touch
    // the browser allowance or Firestore. Dark asks for shots/<slug>.dark.jpg
    // first and settles for the light one — a site with no dark mode looks
    // the same either way, and a real capture beats a placeholder.
    if (device === 'desktop' && env.ASSETS) {
        const names = theme === 'dark' ? [`${slug}.dark.jpg`, `${slug}.jpg`] : [`${slug}.jpg`];
        for (const name of names) {
            try {
                const res = await env.ASSETS.fetch(new Request(new URL(`/shots/${name}`, req.url)));
                if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
                    return imageResponse(await res.arrayBuffer(), 'image/jpeg', {
                        'x-shot': 'static',
                        'x-shot-theme': name.endsWith('.dark.jpg') ? 'dark' : 'light'
                    });
                }
                res.body?.cancel().catch(() => {});
            } catch { /* try the next, then live capture */ }
        }
    }

    const memKey = `${slug}/${device}/${theme}`;
    const hot = memory.get(memKey);
    if (hot && Date.now() - hot.at < MAX_AGE_MS) return imageResponse(hot.bytes, hot.type, { 'x-shot': 'memory' });

    // Width is part of the edge cache key so a future resize step can vary
    // by it; today every width is served the same capture.
    const cacheKey = new Request(`https://shot-cache.internal/v2/${encodeURIComponent(slug)}/${device}/${theme}/${w}.jpg`);
    try {
        const hit = await caches.default.match(cacheKey);
        if (hit) return new Response(hit.body, hit);
    } catch { /* cache unavailable */ }

    const projects = await fetchProjects();
    const project = projects.find((p) => p.slug === slug);
    if (!project) throw new HttpError(404, 'No such project');
    let link = '';
    try {
        const u = new URL(String(project.link || ''));
        if (u.protocol === 'https:' || u.protocol === 'http:') link = u.href;
    } catch { /* no link */ }
    if (!link) throw new HttpError(404, 'This project has no live site to capture');

    const docId = `shots/${project.id}${device === 'mobile' ? '__m' : ''}${theme === 'dark' ? '__d' : ''}`;

    const store = (bytes, type) => {
        remember(memKey, { at: Date.now(), bytes, type });
        const res = imageResponse(bytes, type, { 'x-shot': 'fresh' });
        ctx.waitUntil(caches.default.put(cacheKey, res.clone()).catch(() => {}));
        return res;
    };

    // Firestore copy, if it's recent and for the same link.
    let saved = null;
    try { saved = await getDoc(docId); } catch { /* treat as missing */ }
    if (saved && saved.data && saved.link === link && Date.now() - (saved.takenAt || 0) < MAX_AGE_MS) {
        return store(b64ToBytes(saved.data), saved.type || 'image/jpeg');
    }

    // Don't spend browser time photographing an error page: one cheap probe
    // first, remembered for half an hour per isolate.
    if (!(await siteUp(link))) {
        if (saved && saved.data) return store(b64ToBytes(saved.data), saved.type || 'image/jpeg');
        throw new HttpError(404, 'The live site is down right now');
    }

    if (!env.BROWSER) {
        if (saved && saved.data) return store(b64ToBytes(saved.data), saved.type || 'image/jpeg');
        return notReady('Screenshots need the Browser Rendering binding');
    }

    // One capture per project at a time, however many visitors ask.
    if (!inflight.has(docId)) {
        inflight.set(docId, (async () => {
            const buf = await capture(env, link, device, theme);
            const b64 = toBase64(buf);
            if (b64.length < 900_000) {
                try {
                    const token = await edgeToken(env);
                    await setDoc(docId, { data: b64, type: 'image/jpeg', link, device, theme, takenAt: Date.now() }, token);
                } catch (e) { console.error('shot store', e && e.message); }
            }
            return buf;
        })().finally(() => inflight.delete(docId)));
    }

    // Never hold a visitor's request for longer than ~30s: a slow browser
    // launch or a site that never settles answers "not ready" instead, while
    // the capture carries on in the background and lands in Firestore for
    // the next request.
    const job = inflight.get(docId);
    ctx.waitUntil(job.catch(() => {}));
    try {
        const buf = await Promise.race([
            job,
            new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), 30_000))
        ]);
        return store(new Uint8Array(buf), 'image/jpeg');
    } catch (e) {
        console.error('shot capture', slug, e && e.message);
        // An old capture beats nothing.
        if (saved && saved.data) return store(b64ToBytes(saved.data), saved.type || 'image/jpeg');
        const msg = String((e && e.message) || '');
        if (/limit|quota|429|too many/i.test(msg)) return notReady('The daily screenshot allowance is used up — try again later');
        return notReady('Could not capture the site right now');
    }
}
