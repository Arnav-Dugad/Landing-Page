/* ===========================================================================
   worker/ingest.js  —  POST /api/ingest   (admin only)

   Paste a link, get a finished project. From one to five URLs — a GitHub
   repo, a live site, a store listing — this reads every free public source
   it can find and assembles a complete draft:

     detect → github → releases → readme → website → lighthouse → store
            → screenshots → ai → done

   Progress streams back as NDJSON, one line per stage, so the importer can
   show each step land. Nothing is written to the database here — the admin
   reviews the draft and saves it.
   =========================================================================== */

import { requireAdmin } from './auth.js';
import { readJson, HttpError } from './http.js';
import { gh, GitHubLimit, repoSlugFrom, summariseReleases, commitWeeks, languagePercents } from './github.js';
import { inspectSite, pageSpeed, cleanSiteTitle } from './web.js';
import { storeOf, findStoreLinks, readStore, storeMeta, STORE_LABELS } from './stores.js';
import { structured, SITE_VOICE_RULES, clip, str, strList } from './ai.js';

/* Mirrors CATEGORY_GROUPS in js/core.js and PICKER_ICONS in js/icons.js —
   the model must pick from exactly these. */
const CATEGORIES = ['web', 'app', 'mobile', 'dashboard', 'landing', 'portfolio', 'game', 'threed', 'creative', 'generative', 'simulation', 'puzzle', 'ai', 'ml', 'nlp', 'vision', 'bot', 'dataviz', 'tool', 'productivity', 'cli', 'extension', 'automation', 'converter', 'generator', 'api', 'backend', 'data', 'devtool', 'library', 'infra', 'security', 'education', 'finance', 'ecommerce', 'social', 'health', 'music', 'media', 'maps', 'sports', 'news', 'food', 'weather', 'design', 'web3', 'iot', 'hardware', 'experiment', 'other'];
const ICONS = ['rocket', 'gamepad', 'dice', 'puzzle', 'ball', 'target', 'mobile', 'desktop', 'robot', 'brain', 'chip', 'atom', 'code', 'terminal', 'flow', 'network', 'server', 'database', 'globe', 'cloud', 'bolt', 'flame', 'chart-line', 'chart-pie', 'chart-bar', 'table', 'checklist', 'calendar', 'clock', 'wallet', 'cart', 'map', 'plane', 'car', 'camera', 'image', 'video', 'film', 'music', 'chat', 'mail', 'book', 'cap', 'shield', 'lock', 'key', 'sparkles', 'palette', 'ruler', 'compass', 'heart', 'dumbbell', 'utensils', 'flask', 'layers', 'cubes', 'gear', 'link', 'keyboard', 'cube', 'leaf', 'anchor', 'bookmark', 'wave', 'chess', 'cards', 'trophy', 'joystick', 'wand', 'shapes', 'pen', 'crop', 'contrast', 'type', 'speaker', 'mic', 'headset', 'pulse', 'stethos', 'pill', 'seed', 'sun2', 'rain', 'snow', 'pin', 'train', 'rocket2', 'infinity', 'scale', 'badge', 'blocks', 'wifi', 'battery', 'cpu2', 'cart2', 'tag', 'gift', 'coin', 'news', 'quote', 'scan', 'filter2', 'shuffle', 'repeat', 'history', 'moon2', 'target2', 'bolt2', 'stack', 'wallet2', 'sun', 'moon', 'monitor', 'doc'];
const PLATFORMS = ['web', 'windows', 'android', 'ios', 'macos', 'linux', 'extension', 'cli'];

/* Light-theme tone-a values from css/tokens.css. */
const TONE_HEX = {
    indigo: '#4338CA', blue: '#1560C4', sky: '#067594', teal: '#0B7C72', emerald: '#0C6742',
    yellow: '#A8720B', orange: '#C8560A', red: '#B93A22', pink: '#BC1F66', purple: '#6A2CD4', slate: '#3B4756'
};
const CATEGORY_TONE = {
    game: 'red', ai: 'purple', ml: 'purple', threed: 'sky', creative: 'pink', dashboard: 'blue', dataviz: 'blue',
    data: 'blue', api: 'slate', cli: 'slate', ecommerce: 'orange', finance: 'emerald', productivity: 'teal',
    education: 'yellow', social: 'pink', tool: 'teal', web: 'indigo', app: 'indigo', mobile: 'indigo',
    extension: 'orange', bot: 'purple', design: 'pink', library: 'slate', media: 'red', music: 'pink',
    maps: 'sky', sports: 'emerald', health: 'emerald', weather: 'sky', simulation: 'sky', other: 'slate'
};

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const ago = (ms) => {
    if (!ms) return '';
    const d = Math.max(1, Math.round((Date.now() - ms) / 86_400_000));
    if (d < 2) return 'today';
    if (d < 60) return `${d}d ago`;
    if (d < 730) return `${Math.round(d / 30)}mo ago`;
    return `${Math.round(d / 365)}y ago`;
};
const humanBytes = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);
const PLATFORM_NAME = { web: 'Web', windows: 'Windows', android: 'Android', ios: 'iOS', macos: 'macOS', linux: 'Linux', extension: 'Extension', cli: 'CLI' };

/* ---------------------------------------------------------------------------
   Colour: a hex colour → the nearest site tone, by hue first. Greys and
   near-black/near-white say nothing about the project, so they return null.
   --------------------------------------------------------------------------- */

function hsl(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let hue = 0;
    if (d) {
        if (max === r) hue = ((g - b) / d) % 6;
        else if (max === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
        hue *= 60;
        if (hue < 0) hue += 360;
    }
    return { h: hue, s, l };
}

export function nearestTone(hex) {
    const c = hsl(hex);
    if (!c || c.s < 0.18 || c.l < 0.08 || c.l > 0.94) return null;
    let best = null, bestD = Infinity;
    for (const [key, val] of Object.entries(TONE_HEX)) {
        if (key === 'slate') continue;
        const t = hsl(val);
        const dh = Math.min(Math.abs(c.h - t.h), 360 - Math.abs(c.h - t.h)) / 180;
        const d = dh * 3 + Math.abs(c.s - t.s) * 0.6 + Math.abs(c.l - t.l) * 0.6;
        if (d < bestD) { bestD = d; best = key; }
    }
    return best;
}

/* ---------------------------------------------------------------------------
   README parsing
   --------------------------------------------------------------------------- */

const BADGE = /shields\.io|badgen\.net|badge\.fury|\/badge(s)?[/.]|actions\/workflows|codecov\.io|travis-ci|circleci|github\.com\/[^/]+\/[^/]+\/workflows|img\.buymeacoffee|ko-fi\.com\/img|forthebadge|visitor-badge|komarev\.com|hits\.seeyoufarm|skillicons\.dev|simpleicons|readme-typing-svg|github-readme-stats|vercel\.com\/button|deploy-button/i;

function parseReadme(md, slug, branch) {
    const text = String(md || '');
    const rawBase = `https://raw.githubusercontent.com/${slug}/${branch}/`;
    const absolute = (src) => {
        const s = String(src || '').trim().replace(/^<|>$/g, '');
        if (!s || s.startsWith('data:')) return '';
        try {
            if (/^https?:\/\//i.test(s)) {
                const u = new URL(s);
                // github.com/<o>/<r>/blob/<b>/path → raw
                const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
                if (u.hostname === 'github.com' && m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
                return u.href;
            }
            return new URL(s.replace(/^\.?\//, ''), rawBase).href;
        } catch { return ''; }
    };

    const images = [];
    const imgRe = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)|<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRe.exec(text))) {
        const tag = m[0];
        const src = absolute(m[1] || m[2]);
        if (!src || BADGE.test(src) || /\.svg(\?|$)/i.test(src)) continue;
        const w = Number((tag.match(/width=["']?(\d+)/i) || [])[1] || 0);
        const hgt = Number((tag.match(/height=["']?(\d+)/i) || [])[1] || 0);
        if ((w && w < 120) || (hgt && hgt < 120)) continue;          // icons and logos
        if (/logo|icon|avatar|favicon/i.test(src.split('/').pop()) && !/screen|shot|preview|demo/i.test(src)) continue;
        if (!images.includes(src)) images.push(src);
    }

    const h1 = (text.match(/^#\s+(.+)$/m) || [])[1] || (text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
    const title = h1.replace(/<[^>]+>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[*_`]/g, '').trim();

    const video = (text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]{6,}|youtu\.be\/[\w-]{6,}|vimeo\.com\/\d+)/i) || [])[0] || '';
    const words = text.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

    return { images: images.slice(0, 12), title: title.slice(0, 120), video, words, stores: findStoreLinks(text) };
}

/* ---------------------------------------------------------------------------
   Platforms, category and icon — deterministic, used to steer the model and
   as the fallback when no AI key is configured.
   --------------------------------------------------------------------------- */

function inferPlatforms({ repo, languages, releases, stores, site, manifestIsExtension }) {
    const set = new Set(releases ? releases.platforms : []);
    for (const s of stores) {
        if (s.platform && PLATFORMS.includes(s.platform)) set.add(s.platform);
        if (s.kind === 'npm' || s.kind === 'pypi') set.add('cli');
    }
    const langs = Object.keys(languages || {}).map((l) => l.toLowerCase());
    const topics = (repo && repo.topics || []).map((t) => t.toLowerCase());
    const name = String(repo && repo.name || '').toLowerCase();
    const has = (...xs) => xs.some((x) => topics.includes(x) || name.includes(x));

    if ((langs.includes('kotlin') || langs.includes('java')) && (has('android', 'jetpack-compose', 'compose') || /android/.test(name))) set.add('android');
    if (langs.includes('kotlin') && !set.size && !site) set.add('android');
    if (langs.includes('c#') && (has('wpf', 'winui', 'winforms', 'windows', 'maui', 'uwp') || /windows|win/.test(name))) set.add('windows');
    if (langs.includes('swift')) { set.add(has('macos', 'mac') ? 'macos' : 'ios'); if (has('ios', 'iphone')) set.add('ios'); }
    if (has('tauri', 'electron')) { set.add('windows'); set.add('macos'); set.add('linux'); }
    if (manifestIsExtension || has('chrome-extension', 'browser-extension', 'extension', 'firefox-addon')) set.add('extension');
    if (has('cli', 'command-line', 'terminal-app')) set.add('cli');
    if (/-android$/.test(name)) set.add('android');
    if (/-(windows|win)$/.test(name)) set.add('windows');
    if (/-ios$/.test(name)) set.add('ios');

    const native = [...set].filter((p) => p !== 'web');
    // A site is the product only when there's nothing native — otherwise the
    // site is the landing/download page for the app.
    if (site && site.ok && !native.length) set.add('web');

    const order = ['windows', 'android', 'ios', 'macos', 'linux', 'extension', 'cli', 'web'];
    // Whatever has the most downloads leads.
    const dl = {};
    for (const d of (releases && releases.downloads) || []) dl[d.platform] = (dl[d.platform] || 0) + d.count;
    return [...set].sort((a, b) => (dl[b] || 0) - (dl[a] || 0) || order.indexOf(a) - order.indexOf(b));
}

const KEYWORD_CATEGORY = [
    [/\b(game|arcade|puzzle|monopoly|fps|shooter|racing|rpg|platformer|tycoon)\b/, 'game'],
    [/\b(ai|gpt|llm|chatbot|claude|gemini|neural|machine learning)\b/, 'ai'],
    [/\b(dashboard|analytic|insight|metric|monitor)\b/, 'dashboard'],
    [/\b(budget|expense|finance|bank|invest|split|money|stock|equity|market)\b/, 'finance'],
    [/\b(task|todo|planner|notes?|productivity|attendance|timetable|calendar)\b/, 'productivity'],
    [/\b(school|college|student|course|learn|quiz|education|study)\b/, 'education'],
    [/\b(chat|social|forum|community|voice|messag)\b/, 'social'],
    [/\b(movie|film|video|stream|tv)\b/, 'media'], [/\b(music|audio|sound|song)\b/, 'music'],
    [/\b(map|globe|geo|flight|airport|travel|earth|gis)\b/, 'maps'],
    [/\b(weather|forecast|climate)\b/, 'weather'], [/\b(football|cricket|f1|formula|sports?|fifa)\b/, 'sports'],
    [/\b(3d|three\.js|webgl|shader|world)\b/, 'threed'], [/\b(simulat)/, 'simulation'],
    [/\b(tool|utility|converter|generator|calculator|tracker|manager|password|qr)\b/, 'tool']
];
const KEYWORD_ICON = [
    [/\b(shoot|fps|crosshair)\b/, 'target'], [/\b(game|arcade|play)\b/, 'gamepad'], [/\b(movie|film|cinema)\b/, 'film'],
    [/\b(music|song|audio|sound)\b/, 'music'], [/\b(weather|forecast)\b/, 'cloud'], [/\b(map|globe|geo|earth)\b/, 'globe'],
    [/\b(car|drive|race|f1|formula)\b/, 'car'], [/\b(flight|plane|airline|airport|atc)\b/, 'plane'],
    [/\b(attend|calendar|schedule|timetable)\b/, 'calendar'], [/\b(clock|timer|usage|limit)\b/, 'clock'],
    [/\b(chat|message|voice)\b/, 'chat'], [/\b(password|vault|encrypt|lock)\b/, 'lock'],
    [/\b(money|finance|wallet|split|budget)\b/, 'wallet'], [/\b(chart|analytic|dashboard|stock)\b/, 'chart-line'],
    [/\b(ai|llm|gpt|claude|neural)\b/, 'brain'], [/\b(3d|three|world)\b/, 'cubes'], [/\b(image|photo|picture)\b/, 'image'],
    [/\b(video|stream)\b/, 'video'], [/\b(book|read|note|doc)\b/, 'book'], [/\b(school|college|student|learn)\b/, 'cap'],
    [/\b(file|share|transfer)\b/, 'link'], [/\b(qr|scan)\b/, 'scan'], [/\b(disaster|earthquake|alert)\b/, 'pulse']
];
const CATEGORY_ICON = {
    game: 'gamepad', ai: 'brain', ml: 'brain', media: 'film', music: 'music', productivity: 'checklist',
    finance: 'wallet', education: 'cap', maps: 'globe', sports: 'ball', weather: 'cloud', social: 'chat',
    tool: 'gear', dashboard: 'chart-line', dataviz: 'chart-bar', threed: 'cubes', simulation: 'atom',
    security: 'shield', health: 'heart', news: 'news', food: 'utensils', extension: 'puzzle', cli: 'terminal'
};
const PLATFORM_ICON = { android: 'mobile', ios: 'mobile', windows: 'desktop', macos: 'monitor', linux: 'terminal', extension: 'puzzle', cli: 'terminal', web: 'globe' };

function guessCategory(hay, platforms) {
    for (const [re, k] of KEYWORD_CATEGORY) if (re.test(hay)) return k;
    if (platforms.includes('extension')) return 'extension';
    if (platforms.includes('cli')) return 'cli';
    if (platforms.some((p) => p === 'android' || p === 'ios')) return 'mobile';
    if (platforms.some((p) => p === 'windows' || p === 'macos' || p === 'linux')) return 'app';
    return 'web';
}
/* The title and description say what a thing IS; the README also says
   what it mentions. So: keywords in title/desc, then the category, then
   keywords anywhere, then the platform. */
function guessIcon(hay, platforms, category, head) {
    for (const [re, k] of KEYWORD_ICON) if (re.test(head)) return k;
    if (CATEGORY_ICON[category]) return CATEGORY_ICON[category];
    for (const [re, k] of KEYWORD_ICON) if (re.test(hay)) return k;
    return PLATFORM_ICON[platforms[0]] || 'rocket';
}

/* "UsageNotch-Windows" → "UsageNotch"; "gaming-history-site" → "Gaming History";
   "FIFA-WC-2026" stays readable. */
export function prettyName(name) {
    let n = String(name || '').replace(/\.github\.io$/i, '')
        .replace(/[-_ ](android|windows|win|ios|web|app|site|website|desktop|mobile)$/i, '')
        .replace(/[-_]+/g, ' ').trim();
    // Split camelCase only where it's clearly two words ("imagevaultAi" no; "flightLog" yes).
    if (!/\s/.test(n) && /[a-z][A-Z][a-z]/.test(n) && !/^[A-Z][a-z]+[A-Z]/.test(n)) n = n.replace(/([a-z])([A-Z])/g, '$1 $2');
    return n.split(' ').map((w) => (w === w.toLowerCase() && w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

const TOPIC_TECH = {
    javascript: 'JavaScript', typescript: 'TypeScript', react: 'React', reactjs: 'React', nextjs: 'Next.js', vue: 'Vue',
    svelte: 'Svelte', threejs: 'Three.js', webgl: 'WebGL', firebase: 'Firebase', supabase: 'Supabase', tailwindcss: 'Tailwind',
    nodejs: 'Node.js', python: 'Python', wpf: 'WPF', winui: 'WinUI', 'jetpack-compose': 'Jetpack Compose', kotlin: 'Kotlin',
    swiftui: 'SwiftUI', swift: 'Swift', csharp: 'C#', dotnet: '.NET', rust: 'Rust', tauri: 'Tauri', electron: 'Electron',
    cesium: 'Cesium', duckdb: 'DuckDB', pwa: 'PWA', webrtc: 'WebRTC', vite: 'Vite'
};

/* ---------------------------------------------------------------------------
   Gallery: verify candidates are real images (HEAD, falling back to GET).
   Store CDNs are trusted and skipped.
   --------------------------------------------------------------------------- */

const TRUSTED_IMG = /^(https:\/\/(play-lh\.googleusercontent\.com|is\d-ssl\.mzstatic\.com|store-images\.s-microsoft\.com|img\.itch\.zone|addons\.mozilla\.org|user-images\.githubusercontent\.com))/;

async function isImage(url) {
    if (TRUSTED_IMG.test(url)) return true;
    try {
        let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
        if (res.status === 405 || res.status === 403) {
            res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(5000) });
            try { await res.body?.cancel(); } catch { /* closed */ }
        }
        const type = (res.headers.get('content-type') || '').toLowerCase();
        const len = Number(res.headers.get('content-length') || 0);
        return res.ok && type.startsWith('image/') && !type.includes('svg') && (!len || len > 6000);
    } catch { return false; }
}

/* ---------------------------------------------------------------------------
   The AI step
   --------------------------------------------------------------------------- */

const DRAFT_SCHEMA = {
    type: 'object',
    properties: {
        title: { type: 'string', description: 'Clean human product name. Drop platform suffixes like "-Windows" unless the platform is the point. Never invent a name.' },
        tagline: { type: 'string', description: 'One punchy line, at most 90 characters.' },
        desc: { type: 'string', description: 'Card description: one or two sentences, at most 160 characters.' },
        longDesc: { type: 'string', description: 'Two to four short paragraphs separated by blank lines.' },
        highlights: { type: 'array', items: { type: 'string' }, description: 'Three to six concrete highlights.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Up to twelve real technologies named in the material.' },
        category: { type: 'string', enum: CATEGORIES },
        icon: { type: 'string', enum: ICONS },
        searchTerms: { type: 'array', items: { type: 'string' }, description: '12–25 lowercase terms a visitor might search for that are not already in the title/desc/tags.' },
        galleryAlt: { type: 'array', items: { type: 'string' }, description: 'One alt text per gallery image, in the same order. Base it only on the file name and context; keep it generic if unsure. Max 140 characters each.' },
        problem: { type: 'string' },
        approach: { type: 'string' },
        challenges: { type: 'array', items: { type: 'string' } },
        outcome: { type: 'string' },
        caseStudy: { type: 'boolean', description: 'True only if the README has enough real substance (motivation, design decisions, difficulties) for an honest case study.' }
    },
    required: ['title', 'tagline', 'desc', 'longDesc', 'highlights', 'tags', 'category', 'icon', 'searchTerms', 'galleryAlt', 'problem', 'approach', 'challenges', 'outcome', 'caseStudy'],
    additionalProperties: false
};

async function writeWithAi(env, body, facts, gallery) {
    const system = `You turn raw facts about one of Arnav Dugad's projects into a complete, polished portfolio entry for www.arnavdugad.in. He builds websites, Windows apps, Android apps, iOS apps and browser extensions.

${SITE_VOICE_RULES}

Hard rules:
- Use ONLY facts present in the material below (repo metadata, README, release notes, website metadata, store listings). If a field isn't supported by the material, return an empty string or an empty list.
- No invented numbers, users, ratings, partners or features. Download counts and ratings are shown elsewhere — don't restate them.
- The platforms listed in "platforms" were detected from real release files and code; describe the project accordingly (e.g. "a native Windows app" when it is one).
- category must be one of the allowed keys; icon must be one of the allowed keys and should depict what the product does.
- galleryAlt must have exactly ${gallery.length} entries, matching the gallery order.
- Return only the JSON object.`;

    const user = `Material (JSON):\n${JSON.stringify(facts)}`;
    return structured(env, { prefer: body.provider, model: body.model, system, user, schema: DRAFT_SCHEMA, maxTokens: 16000 });
}

/* ---------------------------------------------------------------------------
   The pipeline
   --------------------------------------------------------------------------- */

const isHttps = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };

async function run(env, body, send) {
    const urls = body.urls.map((u) => String(u).trim());
    const stage = (name, status, label, detail) => send({ stage: name, status, label, ...(detail ? { detail } : {}) });

    /* -- detect ------------------------------------------------------------ */
    stage('detect', 'run', 'Reading the links');
    let slug = null;
    let siteUrl = null;
    const stores = [];
    const kinds = [];
    for (const u of urls) {
        const s = storeOf(u);
        if (s) { if (!stores.find((x) => x.kind === s.kind)) stores.push(s); kinds.push(STORE_LABELS[s.kind]); continue; }
        const rs = repoSlugFrom(u);
        const host = (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } })();
        if (rs && !slug) { slug = rs; kinds.push('GitHub repo'); }
        if (!host.endsWith('github.com') && isHttps(u) && !siteUrl) { siteUrl = u; kinds.push(host.endsWith('github.io') ? 'GitHub Pages site' : 'website'); }
    }
    stage('detect', 'ok', kinds.length ? `Found ${[...new Set(kinds)].join(' · ')}` : 'Nothing recognisable — trying as a website');
    if (!kinds.length && urls[0]) siteUrl = urls[0];

    // Start the website early: a repo-less import may find its repo there.
    let sitePromise = siteUrl ? inspectSite(siteUrl).catch((e) => ({ error: e })) : null;
    const storePromises = new Map(stores.map((s) => [s.kind, readStore(s).catch((e) => ({ error: e }))]));

    /* -- github ------------------------------------------------------------ */
    let repo = null, languages = {}, weeksPromise = Promise.resolve([]);
    let ghLimited = false;
    stage('github', 'run', 'Reading the GitHub repo');
    try {
        if (!slug && sitePromise) {
            // Look for a GitHub link on the site itself.
            const site = await sitePromise;
            if (site && !site.error && site.finalUrl) slug = repoSlugFrom(site.finalUrl);
        }
        if (!slug) {
            stage('github', 'skip', 'No GitHub repo linked');
        } else {
            const [r, l] = await Promise.all([gh(env, `/repos/${slug}`), gh(env, `/repos/${slug}/languages`)]);
            if (!r.data) {
                stage('github', 'error', `GitHub has no public repo ${slug}`);
                slug = null;
            } else {
                repo = r.data;
                slug = repo.full_name;
                languages = l.data || {};
                weeksPromise = commitWeeks(env, slug).catch(() => []);
                if (!siteUrl && repo.homepage && isHttps(repo.homepage)) {
                    siteUrl = repo.homepage;
                    sitePromise = inspectSite(siteUrl).catch((e) => ({ error: e }));
                }
                const langs = languagePercents(languages).slice(0, 3).map((x) => x.name).join(', ');
                stage('github', 'ok', [slug, langs, `★ ${fmt(repo.stargazers_count)}`, `pushed ${ago(Date.parse(repo.pushed_at))}`, repo.archived ? 'archived' : ''].filter(Boolean).join(' · '));
            }
        }
    } catch (e) {
        if (e instanceof GitHubLimit) { ghLimited = true; stage('github', 'error', e.message); slug = null; }
        else stage('github', 'error', `GitHub: ${(e && e.message) || 'failed'}`.slice(0, 140));
    }

    /* -- releases ---------------------------------------------------------- */
    let releases = null;
    stage('releases', 'run', 'Looking for releases and downloads');
    if (!repo) {
        stage('releases', 'skip', ghLimited ? 'Skipped — GitHub rate limit' : 'No repo to read releases from');
    } else {
        try {
            const r = await gh(env, `/repos/${slug}/releases?per_page=30`);
            releases = summariseReleases(r.data || []);
            const count = (r.data || []).filter((x) => !x.draft).length;
            if (!count) stage('releases', 'skip', 'No releases published');
            else {
                const plats = releases.platforms.map((p) => PLATFORM_NAME[p]).join(' + ');
                stage('releases', 'ok', [`${count} release${count === 1 ? '' : 's'}`, releases.latest && releases.latest.tag ? `latest ${releases.latest.tag}` : '', plats || 'no app binaries', releases.total ? `${fmt(releases.total)} downloads` : ''].filter(Boolean).join(' · '));
            }
        } catch (e) {
            stage('releases', 'error', e instanceof GitHubLimit ? e.message : 'Could not read releases');
        }
    }

    /* -- readme ------------------------------------------------------------ */
    let readme = '', readmeInfo = { images: [], title: '', video: '', words: 0, stores: [] };
    let manifestIsExtension = false;
    stage('readme', 'run', 'Reading the README');
    if (!repo) {
        stage('readme', 'skip', 'No repo README');
    } else {
        try {
            const [r, man] = await Promise.all([
                gh(env, `/repos/${slug}/readme`, { accept: 'application/vnd.github.raw', raw: true }),
                // One cheap probe: is this a browser extension?
                gh(env, `/repos/${slug}/contents/manifest.json`, { accept: 'application/vnd.github.raw', raw: true }).catch(() => ({ data: null }))
            ]);
            manifestIsExtension = !!(man.data && /"manifest_version"\s*:\s*[23]/.test(man.data));
            readme = String(r.data || '');
            readmeInfo = parseReadme(readme, slug, repo.default_branch || 'main');
            for (const s of readmeInfo.stores) {
                if (!stores.find((x) => x.kind === s.kind)) {
                    stores.push(s);
                    storePromises.set(s.kind, readStore(s).catch((e) => ({ error: e })));
                }
            }
            if (!readme) stage('readme', 'skip', 'No README');
            else {
                stage('readme', 'ok', [`${fmt(readmeInfo.words)} words`, readmeInfo.images.length ? `${readmeInfo.images.length} image${readmeInfo.images.length === 1 ? '' : 's'}` : '',
                    readmeInfo.video ? 'demo video' : '', readmeInfo.stores.length ? readmeInfo.stores.map((s) => STORE_LABELS[s.kind]).join(', ') + ' link' : '',
                    manifestIsExtension ? 'extension manifest' : ''].filter(Boolean).join(' · '));
            }
        } catch (e) {
            stage('readme', 'error', e instanceof GitHubLimit ? e.message : 'Could not read the README');
        }
    }

    /* -- website ----------------------------------------------------------- */
    let site = null;
    stage('website', 'run', siteUrl ? `Opening ${siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : 'Looking for a live site');
    if (!sitePromise) {
        stage('website', 'skip', 'No live website');
    } else {
        const s = await sitePromise;
        if (s && s.error) {
            stage('website', 'error', `Site unreachable — ${String(s.error.name === 'TimeoutError' ? 'timed out' : s.error.message || 'failed').slice(0, 80)}`);
        } else {
            site = s;
            stage('website', s.ok ? 'ok' : 'error',
                [s.ok ? `Live · ${s.ms} ms` : `Answered ${s.code}`, s.tech.slice(0, 4).join(', '), s.hosting, s.manifest ? 'PWA manifest' : ''].filter(Boolean).join(' · '));
        }
    }

    /* Everything the model gets, gathered before it's asked — so AI and
       Lighthouse (the two slow steps) can run side by side. */
    const storeListings = {};
    for (const [kind, p] of storePromises) {
        const v = await p;
        if (v && !v.error) storeListings[kind] = v;
    }

    const weeks = await weeksPromise;
    const platforms = inferPlatforms({ repo, languages, releases, stores: Object.values(storeListings), site, manifestIsExtension });

    // Gallery candidates: store screenshots, README images, the site's OG image.
    const candidates = [];
    for (const l of Object.values(storeListings)) for (const s of l.screenshots || []) candidates.push(s);
    for (const s of readmeInfo.images) candidates.push(s);
    if (site && site.image) candidates.push(site.image);
    const seen = new Set();
    const unique = candidates.filter((u) => u && !seen.has(u.split('?')[0]) && seen.add(u.split('?')[0]));

    const psiPromise = site && site.ok ? pageSpeed(env, site.finalUrl).catch((e) => ({ error: e })) : null;

    /* -- lighthouse -------------------------------------------------------- */
    // Screenshot verification runs while Lighthouse does.
    const galleryPromise = Promise.all(unique.slice(0, 12).map(async (u) => ((await isImage(u)) ? u : null)));

    stage('lighthouse', 'run', site && site.ok ? 'Running Lighthouse (PageSpeed Insights) — 10–40 s' : 'Lighthouse');
    let psi = null;
    if (!psiPromise) stage('lighthouse', 'skip', 'No live site to score');
    else {
        const r = await psiPromise;
        if (r && r.error) stage('lighthouse', 'error', String(r.error.name === 'TimeoutError' ? 'PageSpeed timed out' : r.error.message).slice(0, 120));
        else {
            psi = r;
            stage('lighthouse', 'ok', `Performance ${psi.performance ?? '–'} · Accessibility ${psi.accessibility ?? '–'} · Best practices ${psi.bestPractices ?? '–'} · SEO ${psi.seo ?? '–'}`);
        }
    }

    /* -- store ------------------------------------------------------------- */
    stage('store', 'run', 'Reading store listings');
    const listingList = Object.values(storeListings);
    if (!stores.length) stage('store', 'skip', 'No store listings');
    else if (!listingList.length) stage('store', 'error', `Could not read ${stores.map((s) => STORE_LABELS[s.kind]).join(', ')}`);
    else {
        stage('store', 'ok', listingList.map((l) => [STORE_LABELS[l.kind], l.rating ? `★ ${l.rating}${l.ratings ? ` (${fmt(l.ratings)})` : ''}` : '', l.installs].filter(Boolean).join(' ')).join(' · '));
    }

    /* -- screenshots ------------------------------------------------------- */
    stage('screenshots', 'run', 'Checking screenshots');
    const gallery = (await galleryPromise).filter(Boolean).slice(0, 8);
    const appIcon = (listingList.find((l) => l.icon) || {}).icon || (site && site.icon) || '';
    const cover = (listingList.find((l) => l.cover) || {}).cover || (site && site.image) || gallery[0] || '';
    stage('screenshots', gallery.length || appIcon ? 'ok' : 'skip',
        [gallery.length ? `${gallery.length} screenshot${gallery.length === 1 ? '' : 's'}` : 'No screenshots found',
            appIcon ? 'app icon' : '', cover ? 'cover image' : '', platforms.includes('web') ? 'live captures added on the site' : ''].filter(Boolean).join(' · '));

    /* -- assemble the deterministic draft ------------------------------------ */
    const primaryStore = listingList[0] || null;
    const siteTitle = site ? cleanSiteTitle(site.title || site.rawTitle, site.siteName) : '';
    const baseTitle = (primaryStore && primaryStore.name) || readmeInfo.title || (repo && prettyName(repo.name)) || siteTitle || 'Untitled project';
    const baseDesc = clip((repo && repo.description) || (site && site.description) || (primaryStore && primaryStore.description) || '', 160);

    const techSet = new Map();
    const addTech = (t) => { const k = String(t || '').trim(); if (k && !techSet.has(k.toLowerCase())) techSet.set(k.toLowerCase(), k); };
    languagePercents(languages).filter((l) => l.pct >= 3).forEach((l) => addTech(l.name));
    (repo && repo.topics || []).forEach((t) => TOPIC_TECH[t] && addTech(TOPIC_TECH[t]));
    (site && site.tech || []).forEach(addTech);
    const baseTags = [...techSet.values()].slice(0, 12);

    const hay = `${baseTitle} ${baseDesc} ${(repo && repo.topics || []).join(' ')} ${readme.slice(0, 1500)}`.toLowerCase();
    const head = `${baseTitle} ${baseDesc} ${(repo && repo.topics || []).join(' ')}`.toLowerCase();
    const baseCategory = KEYWORD_CATEGORY.some(([re]) => re.test(head)) ? guessCategory(head, platforms) : guessCategory(hay, platforms);
    const created = repo ? Date.parse(repo.created_at) : null;
    const lastRel = releases && releases.latest && releases.latest.date;
    const y1 = created ? new Date(created).getUTCFullYear() : (lastRel ? new Date(lastRel).getUTCFullYear() : new Date().getUTCFullYear());
    const y2 = lastRel ? new Date(lastRel).getUTCFullYear() : y1;

    const storesMap = {};
    for (const s of stores) if (['play', 'microsoft', 'appstore', 'chrome', 'itch', 'firefox'].includes(s.kind)) storesMap[s.kind] = s.url;

    const link = (site && site.ok && site.finalUrl) || (siteUrl || '') || (primaryStore && primaryStore.url) || (releases && releases.latest && releases.latest.url) || '';

    const draft = {
        title: baseTitle,
        tagline: '',
        desc: baseDesc,
        longDesc: '',
        highlights: [],
        tags: baseTags,
        category: baseCategory,
        color: nearestTone(site && site.themeColor) || CATEGORY_TONE[baseCategory] || 'indigo',
        icon: guessIcon(hay, platforms, baseCategory, `${baseTitle} ${baseDesc}`.toLowerCase()),
        platforms,
        link,
        repo: repo ? repo.html_url : '',
        appIcon,
        cover,
        gallery,
        galleryAlt: gallery.map(() => ''),
        downloads: releases ? releases.downloads : [],
        stores: storesMap,
        version: releases && releases.latest ? String(releases.latest.tag || '').replace(/^v(?=\d)/i, '') : (primaryStore && primaryStore.version) || '',
        releasedAt: (releases && releases.latest && releases.latest.date) || null,
        year: y2 !== y1 ? `${y1}–${String(y2).slice(2)}` : String(y1),
        status: repo && repo.archived ? 'archived'
            : ((site && site.ok) || (releases && releases.downloads.length) || listingList.length ? 'live' : 'wip'),
        searchTerms: (repo && repo.topics || []).map((t) => t.replace(/-/g, ' ')).slice(0, 25),
        demoVideo: readmeInfo.video || '',
        problem: '', approach: '', challenges: [], outcome: '',
        caseStudy: false,
        sources: [...new Set([...urls, repo && repo.html_url, siteUrl, ...stores.map((s) => s.url)].filter(Boolean))].slice(0, 10),
        auto: true
    };

    /* -- ai ---------------------------------------------------------------- */
    stage('ai', 'run', 'Writing the copy');
    if (body.ai === false) {
        stage('ai', 'skip', 'AI writing turned off — using the facts as written');
    } else {
        const facts = {
            inputs: urls,
            platforms,
            repo: repo ? {
                name: repo.name, fullName: repo.full_name, description: repo.description, topics: repo.topics,
                languages: languagePercents(languages), homepage: repo.homepage, createdAt: repo.created_at,
                pushedAt: repo.pushed_at, archived: repo.archived, license: repo.license && repo.license.spdx_id
            } : null,
            readme: readme ? readme.slice(0, 14_000) : '',
            releases: releases ? {
                latest: releases.latest, platforms: releases.platforms,
                files: releases.downloads.map((d) => ({ platform: d.platform, label: d.label, size: humanBytes(d.size), arch: d.arch }))
            } : null,
            website: site ? { url: site.finalUrl, title: site.title, description: site.description, tech: site.tech, hosting: site.hosting, pwa: !!site.manifest } : null,
            stores: listingList.map((l) => ({ store: STORE_LABELS[l.kind], name: l.name, description: String(l.description || '').slice(0, 2500), genres: l.genres || [] })),
            gallery: gallery.map((u) => decodeURIComponent(u.split('/').pop().split('?')[0]).slice(0, 80)),
            existing: body.existing && typeof body.existing === 'object' ? {
                title: body.existing.title, desc: body.existing.desc, longDesc: String(body.existing.longDesc || '').slice(0, 3000)
            } : null
        };
        try {
            const started = Date.now();
            const { label, model, data } = await writeWithAi(env, body, facts, gallery);
            const tags = strList(data.tags, 30, 40);
            const seenTag = new Set();
            const ai = {
                title: str(data.title, 120),
                tagline: clip(str(data.tagline, 200), 120),
                desc: clip(str(data.desc, 600), 160),
                longDesc: str(data.longDesc, 5000),
                highlights: strList(data.highlights, 6),
                tags: tags.filter((t) => (seenTag.has(t.toLowerCase()) ? false : (seenTag.add(t.toLowerCase()), true))).slice(0, 12),
                category: CATEGORIES.includes(data.category) ? data.category : '',
                icon: ICONS.includes(data.icon) ? data.icon : '',
                searchTerms: strList(data.searchTerms, 40, 40).map((t) => t.toLowerCase()).slice(0, 25),
                galleryAlt: strList(data.galleryAlt, gallery.length, 200).map((a) => clip(a, 140)),
                problem: str(data.problem, 5000),
                approach: str(data.approach, 5000),
                challenges: strList(data.challenges, 5),
                outcome: str(data.outcome, 5000),
                caseStudy: data.caseStudy === true && readmeInfo.words > 250
            };
            // Only take what the model actually filled in.
            for (const [k, v] of Object.entries(ai)) {
                if (Array.isArray(v) ? v.length : (typeof v === 'boolean' || v)) draft[k] = v;
            }
            if (ai.galleryAlt.length < gallery.length) draft.galleryAlt = gallery.map((_, i) => ai.galleryAlt[i] || '');
            if (ai.category && !nearestTone(site && site.themeColor)) draft.color = CATEGORY_TONE[ai.category] || draft.color;
            stage('ai', 'ok', `${label} (${model}) wrote the copy in ${Math.round((Date.now() - started) / 1000)} s`);
        } catch (e) {
            stage('ai', 'error', `${String((e && e.message) || 'AI failed').slice(0, 120)} — kept the facts-only draft`);
        }
    }

    /* -- merge with an existing record -------------------------------------- */
    const existing = body.existing && typeof body.existing === 'object' ? body.existing : null;
    if (existing) {
        const locked = new Set(Array.isArray(existing.locked) ? existing.locked : []);
        for (const [k, v] of Object.entries(existing)) {
            if (k === 'locked' || k === 'id') continue;
            const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
            const draftEmpty = draft[k] === undefined || draft[k] === null || draft[k] === '' || (Array.isArray(draft[k]) && !draft[k].length);
            if (locked.has(k) && !empty) draft[k] = v;
            else if (draftEmpty && !empty) draft[k] = v;
        }
        draft.locked = [...locked];
    }

    /* -- done -------------------------------------------------------------- */
    const storeMetaOut = {};
    for (const l of listingList) {
        const m = storeMeta(l);
        if (m) storeMetaOut[l.kind] = m;
    }
    const meta = {
        updatedAt: Date.now(),
        github: repo ? {
            repo: repo.full_name, stars: repo.stargazers_count || 0, forks: repo.forks_count || 0,
            watchers: repo.subscribers_count ?? repo.watchers_count ?? 0, openIssues: repo.open_issues_count || 0,
            pushedAt: Date.parse(repo.pushed_at) || null, createdAt: Date.parse(repo.created_at) || null,
            license: (repo.license && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null) || null,
            languages: languagePercents(languages), commitWeeks: weeks,
            release: releases ? releases.latest : null, downloads: releases ? releases.total : 0
        } : null,
        web: site ? { up: !!site.ok, code: site.code, ms: site.ms, checkedAt: Date.now(), psi } : null,
        store: Object.keys(storeMetaOut).length ? storeMetaOut : null
    };

    send({ stage: 'done', status: 'ok', label: `${draft.title} is ready to review`, project: draft, meta });
}

export async function handleIngest(req, env, ctx) {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
    await requireAdmin(req, env);
    const body = await readJson(req, 256 * 1024);

    if (!Array.isArray(body.urls) || !body.urls.length || body.urls.length > 5) throw new HttpError(400, 'Send 1–5 links as "urls"');
    for (const u of body.urls) if (typeof u !== 'string' || !isHttps(u.trim())) throw new HttpError(400, `Not a web link: ${String(u).slice(0, 80)}`);
    if (body.provider !== undefined && !['claude', 'gemini', 'openai'].includes(body.provider)) throw new HttpError(400, 'provider must be claude, gemini or openai');

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    let closed = false;
    const send = (obj) => (closed ? Promise.resolve() : writer.write(enc.encode(`${JSON.stringify(obj)}\n`)).catch(() => { closed = true; }));

    const job = run(env, body, send)
        .catch((e) => {
            console.error('ingest', e && (e.stack || e.message));
            return send({ stage: 'done', status: 'error', label: `Import failed: ${String((e && e.message) || e).slice(0, 160)}` });
        })
        .finally(() => { closed = true; return writer.close().catch(() => {}); });
    ctx.waitUntil(job);

    return new Response(readable, {
        headers: {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff'
        }
    });
}

