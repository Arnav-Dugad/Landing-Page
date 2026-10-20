/* ===========================================================================
   worker/og.js  —  GET /api/og (PNG) and GET /api/og.svg (animated SVG)

   Rendering a card costs ~200 ms of CPU, so each one is cached — keyed by
   slug, theme AND the project's updatedAt, which means an edit produces a
   new key and a fresh card immediately, while an unchanged card can live
   in cache for a day. Two layers: Cloudflare's Cache API (per data centre;
   a no-op on *.workers.dev) and a small per-isolate memory cache.
   =========================================================================== */

import { ImageResponse } from '@cf-wasm/og';
import { buildCard, themeOf } from '../api/_card.js';
import { findProject, toneOf } from '../api/_project.js';
import { toBase64 } from './http.js';

const RESPONSE_CACHE = 'public, max-age=600, stale-while-revalidate=86400';

const memory = new Map();      // key → ArrayBuffer, insertion-ordered for LRU
const MEMORY_MAX = 16;

function remember(key, buf) {
    memory.delete(key);
    memory.set(key, buf);
    while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}

async function renderPng(req, ctx) {
    const url = new URL(req.url);
    const slug = url.searchParams.get('p') || '';
    const theme = themeOf(url.searchParams.get('theme'));

    let project = null;
    try { if (slug) project = await findProject(slug); } catch { /* generic card */ }

    const version = project ? (project.updatedAt || project.createdAt || 0) : 0;
    const key = `${project ? project.slug : '_'}/${theme}/${version}`;

    if (memory.has(key)) {
        const buf = memory.get(key);
        remember(key, buf);
        return { buf, project, theme };
    }

    const cacheKey = new Request(`https://og-cache.internal/v1/${encodeURIComponent(key)}.png`);
    try {
        const hit = await caches.default.match(cacheKey);
        if (hit) {
            const buf = await hit.arrayBuffer();
            remember(key, buf);
            return { buf, project, theme };
        }
    } catch { /* cache unavailable */ }

    const [card, options] = await buildCard(req, { project, theme });
    const res = await ImageResponse.async(card, { ...options, headers: undefined });
    if (!res.ok) throw new Error(`Card render failed (${res.status})`);
    const buf = await res.arrayBuffer();

    remember(key, buf);
    ctx.waitUntil(caches.default.put(cacheKey, new Response(buf, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }
    })).catch(() => {}));

    return { buf, project, theme };
}

export async function handleOgPng(req, ctx) {
    const { buf } = await renderPng(req, ctx);
    return new Response(buf, {
        headers: { 'content-type': 'image/png', 'cache-control': RESPONSE_CACHE }
    });
}

/* The animated card: the rendered PNG as the base layer, with three
   overlays that loop — the accent bar wiping in, a soft sheen crossing the
   card, and a pulse ring on the accent dot beside the wordmark. Everything
   stops under prefers-reduced-motion. */
export async function handleOgSvg(req, ctx) {
    const { buf, project, theme } = await renderPng(req, ctx);
    const [toneA, toneB] = toneOf(project?.color, theme);
    const paper = theme === 'dark' ? '#131110' : '#F7F5F0';
    const accent = theme === 'dark' ? '#F2764E' : '#C43E1F';
    const sheenPeak = theme === 'dark' ? 0.10 : 0.55;
    const title = project?.title ? `${project.title} — Arnav Dugad` : 'Arnav Dugad';

    // Accent dot centre, measured from the 1200x630 layout in api/_card.js.
    const DOT_X = 940.5, DOT_Y = 536.5;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img">
<title>${title.replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]))}</title>
<defs>
  <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${toneA}"/><stop offset="1" stop-color="${toneB}"/>
  </linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset=".5" stop-color="#FFFFFF" stop-opacity="${sheenPeak}"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="frame"><rect width="1200" height="630"/></clipPath>
</defs>
<style>
  .bar { transform-box: view-box; transform-origin: 0 0; animation: wipe 5s cubic-bezier(.16,1,.3,1) infinite; }
  .sheen { animation: sweep 4.2s cubic-bezier(.65,0,.35,1) infinite; }
  .ring { transform-box: fill-box; transform-origin: center; animation: pulse 2.4s cubic-bezier(.22,.61,.36,1) infinite; }
  @keyframes wipe { 0% { transform: scaleX(0); } 24%, 100% { transform: scaleX(1); } }
  @keyframes sweep { 0% { transform: translateX(-520px); } 45%, 100% { transform: translateX(1720px); } }
  @keyframes pulse { 0% { transform: scale(1); opacity: .55; } 70%, 100% { transform: scale(3.2); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; transform: none; }
    .sheen, .ring { animation: none; display: none; }
  }
</style>
<image href="data:image/png;base64,${toBase64(buf)}" width="1200" height="630"/>
<rect width="1200" height="10" fill="${paper}"/>
<rect class="bar" width="1200" height="10" fill="url(#bar)"/>
<g clip-path="url(#frame)">
  <g transform="skewX(-18)">
    <rect class="sheen" x="0" y="-120" width="360" height="870" fill="url(#sheen)"/>
  </g>
</g>
<circle class="ring" cx="${DOT_X}" cy="${DOT_Y}" r="7" fill="none" stroke="${accent}" stroke-width="2"/>
</svg>`;

    return new Response(svg, {
        headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': RESPONSE_CACHE }
    });
}
