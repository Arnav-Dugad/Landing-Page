/* ===========================================================================
   api/_project.js
   Shared helper for the edge functions: fetch a project from Firestore over
   the REST API and unwrap its typed values into a plain object.

   REST rather than the Firebase SDK because these run on the edge runtime,
   need exactly one collection, and projects are world-readable — the SDK
   would add weight and an auth handshake for nothing.

   Files prefixed with `_` are not routed by Vercel, so this stays private.
   =========================================================================== */

const PROJECT_ID = 'landing-page-cc574';
const API_KEY = 'AIzaSyBVg4_5WjOjlA-xfoGAhjqNk75EyMG6sS8';
const PATH = 'artifacts/arnav-portfolio-v1/public/data/projects';

export const ENDPOINT =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${PATH}?key=${API_KEY}&pageSize=300`;

export const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function unwrap(value) {
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

function unwrapFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = unwrap(v);
    return out;
}

/* Returns every project, each with an `id` and a derived `slug`. Throws on a
   network or HTTP failure so callers can decide what to serve instead. */
export async function fetchProjects() {
    const res = await fetch(ENDPOINT, {
        // Firestore data changes rarely; a short shared cache keeps crawler
        // traffic off the database without making edits feel stale.
        cf: { cacheTtl: 300 },
        headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`Firestore responded ${res.status}`);
    const json = await res.json();
    return (json.documents || []).map((d) => {
        const data = unwrapFields(d.fields || {});
        return { ...data, id: d.name.split('/').pop(), slug: slugify(data.title) };
    });
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

export const toneOf = (color) => TONES[color] || TONES.slate;
