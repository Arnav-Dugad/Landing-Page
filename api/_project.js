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

/* Cleans importer-made records on read, so pages, cards, share cards and
   feeds all agree — and so the next save writes the clean values back:
     · "Name — tagline" titles (README headlines) split into title + tagline
     · version numbers dropped from titles ("Arnav Island 0.25" → "Arnav Island")
     · a GitHub repo/release page is not a live site, so it is not the link
   Hand-made projects (auto !== true) keep their titles exactly as written. */
const PLATFORM_WORD = /^(web|android|windows|ios|iphone|mac(os)?|linux|app|desktop|mobile)$/i;
export function normalizeProject(raw) {
    const p = { ...raw };
    if (/^https?:\/\/(www\.)?github\.com\//i.test(String(p.link || ''))) p.link = '';
    // GitHub's signed image links (private-user-images…?jwt=) expire within
    // minutes; the asset's permanent address is github.com/user-attachments.
    const stable = (u) => {
        const m = typeof u === 'string' && u.match(/^https:\/\/private-user-images\.githubusercontent\.com\/\d+\/\d+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.\w+/i);
        return m ? `https://github.com/user-attachments/assets/${m[1]}` : u;
    };
    ['cover', 'coverDark', 'appIcon'].forEach((k) => { if (p[k]) p[k] = stable(p[k]); });
    if (Array.isArray(p.gallery)) p.gallery = p.gallery.map(stable);
    // GitHub's own logo is not the app's icon (a github.io page's default).
    if (/^https?:\/\/([a-z0-9-]+\.)?githubassets\.com\//i.test(String(p.appIcon || ''))) delete p.appIcon;
    // github.com/<owner>/<repo>/blob/<branch>/<path> → the file itself.
    const toRaw = (u) => {
        const m = typeof u === 'string' && u.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/([^?#]+)/i);
        return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}` : u;
    };
    ['cover', 'coverDark', 'appIcon'].forEach((k) => { if (p[k]) p[k] = toRaw(p[k]); });
    if (Array.isArray(p.gallery)) p.gallery = p.gallery.map(toRaw);
    // Two builds with the same label ("Android APK" twice for Island and Island
    // Lite) are told apart by their file names.
    if (Array.isArray(p.downloads) && p.downloads.length > 1) {
        const counts = {};
        p.downloads.forEach((d) => { counts[d && d.label] = (counts[d && d.label] || 0) + 1; });
        p.downloads = p.downloads.map((d) => {
            if (!d || counts[d.label] < 2) return d;
            const file = decodeURIComponent(String(d.url || '').split('/').pop().split('?')[0]);
            const ext = (file.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
            const name = file.replace(/\.[a-z0-9]+$/i, '')
                .replace(/[-_ .]?v?\d+(\.\d+)+([-.][\w.]+)?/gi, '')
                .replace(/[-_]+/g, ' ').trim();
            return name ? { ...d, label: `${name}${ext ? ` (${ext.toUpperCase()})` : ''}` } : d;
        });
    }
    // "Island: a Dynamic Island-style overlay…" → "A Dynamic Island-style overlay…"
    if (p.auto === true && typeof p.desc === 'string' && p.title) {
        const esc = String(p.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const stripped = p.desc.replace(new RegExp(`^\\s*${esc}\\s*(?:[:\\u2014\\u2013|]|\\s-)\\s*`, 'i'), '');
        if (stripped !== p.desc && stripped.length > 20) p.desc = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
    if (p.auto === true && typeof p.title === 'string') {
        let name = p.title.replace(/\s+/g, ' ').trim();
        let tagline = '';
        const m = name.match(/^(.{2,60}?)\s+[—–|:]\s+(.{3,})$/)
            || name.match(/^(.{2,40}?):\s+(.{3,})$/)
            || name.match(/^(.{2,40}?)\s+-\s+(.{3,})$/);
        if (m) { name = m[1].trim(); tagline = m[2].trim(); }
        const before = name;
        name = name.replace(/\s+v?\d+(\.\d+)+([-.+][\w.]+)?$/i, '').trim();
        if (name && name !== p.title) {
            p.title = name;
            if (!p.tagline && tagline && name === before && !PLATFORM_WORD.test(tagline)) p.tagline = tagline.slice(0, 120);
        }
    }
    return p;
}

const toProjects = (json) => (json.documents || []).map((d) => {
    const data = normalizeProject(unwrapFields(d.fields || {}));
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
