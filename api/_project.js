/* ===========================================================================
   api/_project.js
   Shared helper for the edge functions: fetch a project from Firestore over
   the REST API and unwrap its typed values into a plain object.

   REST rather than the Firebase SDK because these run on the edge runtime,
   need exactly one collection, and projects are world-readable — the SDK
   would add weight and an auth handshake for nothing.

   Files prefixed with `_` are not routed by Vercel, so this stays private.
   =========================================================================== */

export const PROJECT_ID = 'landing-page-cc574';
export const API_KEY = 'AIzaSyBVg4_5WjOjlA-xfoGAhjqNk75EyMG6sS8';
export const DATA_PATH = 'artifacts/arnav-portfolio-v1/public/data';
const PATH = `${DATA_PATH}/projects`;

export const ENDPOINT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${PATH}?key=${API_KEY}&pageSize=300`;

export const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export function unwrap(value) {
    if (!value || typeof value !== 'object') return null;
    if ('stringValue' in value) return value.stringValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('nullValue' in value) return null;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(unwrap);
    if ('mapValue' in value) return unwrapFields(value.mapValue.fields || {});
    return null;
}

export function unwrapFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = unwrap(v);
    return out;
}

/* "Last known good" copy of the raw project list. Firestore's free tier has
   a daily read quota; when it runs out (or the network blips) every page
   built from projects keeps working from this copy instead of failing.
   Isolate memory first, then the Cache API (Cloudflare only — Vercel's edge
   has no caches.default, so there it is memory-only). */
const LAST_GOOD_KEY = 'https://projects-cache.internal/v1/last-good';
let memoryCopy = null;          // { at, json }
const FRESH_MS = 60 * 1000;

const hasCache = () => typeof caches !== 'undefined' && caches.default;

async function readLastGood() {
    if (memoryCopy) return memoryCopy.json;
    if (!hasCache()) return null;
    try {
        const hit = await caches.default.match(LAST_GOOD_KEY);
        if (hit) { const json = await hit.json(); memoryCopy = { at: 0, json }; return json; }
    } catch { /* no copy */ }
    return null;
}

async function writeLastGood(json) {
    memoryCopy = { at: Date.now(), json };
    if (!hasCache()) return;
    try {
        await caches.default.put(LAST_GOOD_KEY, new Response(JSON.stringify(json), {
            headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=2592000' }
        }));
    } catch { /* best effort */ }
}

const toProjects = (json) => (json.documents || []).map((d) => {
    const data = unwrapFields(d.fields || {});
    return { ...data, id: d.name.split('/').pop(), slug: slugify(data.title) };
});

/* Returns every project, each with an `id` and a derived `slug`. Serves the
   last good copy when Firestore can't answer; throws only if there has never
   been one. */
export async function fetchProjects() {
    // A minute of isolate memory absorbs bursts without touching Firestore.
    if (memoryCopy && Date.now() - memoryCopy.at < FRESH_MS) return toProjects(memoryCopy.json);
    try {
        const res = await fetch(ENDPOINT, {
            // Firestore data changes rarely; a short shared cache keeps crawler
            // traffic off the database without making edits feel stale.
            cf: { cacheTtl: 300 },
            headers: { accept: 'application/json' }
        });
        if (!res.ok) throw new Error(`Firestore responded ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.documents)) throw new Error('Firestore returned no documents');
        await writeLastGood(json);
        return toProjects(json);
    } catch (e) {
        const json = await readLastGood();
        if (json) return toProjects(json);
        throw e;
    }
}

export async function findProject(slug) {
    const all = await fetchProjects();
    return all.find((p) => p.slug === slug) || null;
}

/* Duotones mirrored from css/tokens.css so a generated card matches the site. */
export const TONES = {
    indigo:  ['#4338CA', '#7C74F0'],
    blue:    ['#1560C4', '#4A97E8'],
    sky:     ['#067594', '#2BAEE0'],
    teal:    ['#0B7C72', '#3FD0BB'],
    emerald: ['#0C6742', '#35C46B'],
    green:   ['#0C6742', '#35C46B'],
    yellow:  ['#A8720B', '#EFBE3A'],
    orange:  ['#C8560A', '#F59A3D'],
    red:     ['#B93A22', '#EF5F5F'],
    pink:    ['#BC1F66', '#F189BE'],
    purple:  ['#6A2CD4', '#AE9BF7'],
    slate:   ['#3B4756', '#7C8BA0'],
    gray:    ['#3B4756', '#7C8BA0']
};

/* The dark theme's duotones lift toward the light end, as in tokens.css. */
export const TONES_DARK = {
    indigo:  ['#6366F1', '#A5A0FF'],
    blue:    ['#3B8FEA', '#79BDFF'],
    sky:     ['#22A8CC', '#63D6F5'],
    teal:    ['#17B3A2', '#6EEAD6'],
    emerald: ['#1DA35F', '#63E08D'],
    green:   ['#1DA35F', '#63E08D'],
    yellow:  ['#D9A21C', '#F7D96B'],
    orange:  ['#EF7C22', '#FFB067'],
    red:     ['#E4553A', '#FF8A80'],
    pink:    ['#E64C90', '#FBA3CD'],
    purple:  ['#9366F0', '#C7B6FB'],
    slate:   ['#67748A', '#A4B0C2'],
    gray:    ['#67748A', '#A4B0C2']
};

export const toneOf = (color, theme = 'light') => {
    const set = theme === 'dark' ? TONES_DARK : TONES;
    return set[color] || set.slate;
};
