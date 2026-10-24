/* ===========================================================================
   core.js  (classic script — loaded on every page, right after icons.js)
   The handful of helpers every page needs, in one place:

     · TONES / toneVars()    per-project duotones, read from tokens.css
     · esc() / safeUrl()     everything from Firestore is untrusted
     · slugify / projectSlug the URL-safe name a project is linked by
     · CATEGORY_GROUPS       the category taxonomy and its human labels
     · EDGE / edgeFetch()    the Cloudflare (or Vercel) API, when present
     · applyProjectTheme()   re-tints the whole page in one project's colour
     · PLATFORMS             web / windows / android / ios / … and their frames
     · platformsOf()         a project's platforms (old records: link ⇒ web)
     · visitorPlatform()     the visitor's own OS — picks the leading download
     · formatCount/Bytes()   1.2k downloads, 24 MB
     · HANDOFF_KEY()         index → case-study instant-render handoff

   No DOM work and no data loading happens here, so it is safe to run
   before anything else exists.
   =========================================================================== */

(() => {
    /* -------- Duotones ------------------------------------------------------ */
    window.TONES = {
        indigo: 'indigo', blue: 'blue', sky: 'sky', teal: 'teal',
        emerald: 'emerald', green: 'emerald', yellow: 'yellow', orange: 'orange',
        red: 'red', pink: 'pink', purple: 'purple', slate: 'slate', gray: 'slate'
    };
    window.TONE_KEYS = ['indigo', 'blue', 'sky', 'teal', 'emerald', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];

    const toneKey = (color) => window.TONES[color] || 'slate';

    /* Inline CSS custom properties for a project's colour. Reading them from the
       stylesheet keeps every colour in tokens.css rather than scattered in JS. */
    window.toneVars = (color) => {
        const key = toneKey(color);
        return `--tone-a:var(--tone-${key}-a);--tone-b:var(--tone-${key}-b);`
             + `--tone-t:var(--tone-${key}-t);--tone-i:var(--tone-${key}-i);`;
    };

    /* -------- Escaping (everything from Firestore is untrusted) ------------- */
    window.esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    /* Only http/https survive — blocks javascript: and data: URLs in href/src. */
    window.safeUrl = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        try {
            const u = new URL(raw, location.href);
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
        } catch { return ''; }
    };

    /* -------- Slugs --------------------------------------------------------- */
    window.slugify = (s) => String(s || '').toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    window.projectSlug = (p) => window.slugify(p && p.title) || String((p && p.id) || '');

    /* Right-sized images. Screenshots come straight from GitHub at full size
       (one was 476 KB for a 360px card), so they go through wsrv.nl — a free,
       open-source image CDN on Cloudflare — resized to the slot they fill and
       re-encoded as WebP. `w` is the CSS width; device pixel ratio is applied
       here. Never for SVGs (vector, tiny) or when the page isn't on a public
       host (the CDN couldn't reach localhost). If the CDN fails, the global
       error handler below swaps in the original, so nothing can break. */
    const PUBLIC_HOST = /(^|\.)arnavdugad\.in$|\.workers\.dev$|\.github\.io$/i.test(location.hostname);
    window.imgUrl = (src, w = 640) => {
        if (!src) return src;
        let u;
        try { u = new URL(src, location.href); } catch { return src; }
        // SVG is vector; GIF may be animated (the CDN would flatten it).
        if (!/^https?:$/.test(u.protocol) || /\.(svg|gif)$/i.test(u.pathname) || u.hostname === 'wsrv.nl') return src;
        if (u.origin === location.origin && !PUBLIC_HOST) return src;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.min(1600, Math.max(48, Math.round((w * dpr) / 40) * 40));
        return `https://wsrv.nl/?url=${encodeURIComponent(u.href)}&w=${width}&we&output=webp&q=80`;
    };
    // <img src="${imgUrl(x)}" data-orig="${x}">: one retry with the original.
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (!img || img.tagName !== 'IMG' || !img.dataset.orig) return;
        const orig = img.dataset.orig;
        delete img.dataset.orig;
        if (img.src !== orig) img.src = orig;
    }, true);

    /* Cleans importer-made records on read, so pages, cards, share cards and
       feeds all agree — and so the next save writes the clean values back:
         · "Name — tagline" titles (README headlines) split into title + tagline
         · version numbers dropped from titles ("Arnav Island 0.25" → "Arnav Island")
         · a GitHub repo/release page is not a live site, so it is not the link
       Hand-made projects (auto !== true) keep their titles exactly as written. */
    const PLATFORM_WORD = /^(web|android|windows|ios|iphone|mac(os)?|linux|app|desktop|mobile)$/i;
    window.normalizeProject = (raw) => {
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
    };

    /* -------- Categories ----------------------------------------------------
       Stored as slugs ("threed", "dataviz"); grouped so a list this long stays
       navigable in the editor's native select. */
    window.CATEGORY_GROUPS = [
        ['Interfaces', [
            ['web', 'Website'], ['app', 'Web app'], ['mobile', 'Mobile app'],
            ['dashboard', 'Dashboard'], ['landing', 'Landing page'], ['portfolio', 'Portfolio']
        ]],
        ['Play', [
            ['game', 'Game'], ['threed', '3D / WebGL'], ['creative', 'Creative coding'],
            ['generative', 'Generative art'], ['simulation', 'Simulation'], ['puzzle', 'Puzzle']
        ]],
        ['Intelligence', [
            ['ai', 'AI'], ['ml', 'Machine learning'], ['nlp', 'Language / NLP'],
            ['vision', 'Computer vision'], ['bot', 'Bot / agent'], ['dataviz', 'Data visualisation']
        ]],
        ['Utility', [
            ['tool', 'Tool'], ['productivity', 'Productivity'], ['cli', 'CLI'],
            ['extension', 'Browser extension'], ['automation', 'Automation'],
            ['converter', 'Converter'], ['generator', 'Generator']
        ]],
        ['Systems', [
            ['api', 'API'], ['backend', 'Backend'], ['data', 'Data / systems'],
            ['devtool', 'Developer tool'], ['library', 'Library'], ['infra', 'Infrastructure'],
            ['security', 'Security']
        ]],
        ['Domains', [
            ['education', 'Education'], ['finance', 'Finance'], ['ecommerce', 'E-commerce'],
            ['social', 'Social'], ['health', 'Health & fitness'], ['music', 'Music & audio'],
            ['media', 'Video & media'], ['maps', 'Maps & travel'], ['sports', 'Sports'],
            ['news', 'News & reading'], ['food', 'Food'], ['weather', 'Weather']
        ]],
        ['Other', [
            ['design', 'Design'], ['web3', 'Web3'], ['iot', 'IoT'],
            ['hardware', 'Hardware'], ['experiment', 'Experiment'], ['other', 'Other']
        ]]
    ];

    window.CATEGORY_LABELS = Object.fromEntries(window.CATEGORY_GROUPS.flatMap(([, items]) => items));

    const titleCase = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
    window.categoryLabel = (key) => {
        const slug = key || 'other';
        return window.CATEGORY_LABELS[slug] || titleCase(slug);
    };

    /* -------- Edge API ------------------------------------------------------
       /api/* only exists where the worker runs. Static mirrors (GitHub Pages,
       a plain file server) never call it, so nothing there waits on a 404. */
    const host = location.hostname.toLowerCase();
    window.EDGE = /(^|\.)arnavdugad\.in$/.test(host)
        || /\.(workers\.dev|vercel\.app)$/.test(host)
        || (/^(localhost|127\.0\.0\.1)$/.test(host) && /^(878[7-9])$/.test(location.port));

    window.edgeFetch = async (path, { method = 'GET', body, token } = {}) => {
        if (!window.EDGE) throw new Error('The site API is not available on this host');

        const headers = { accept: 'application/json' };
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (token) headers.authorization = `Bearer ${token}`;

        const res = await fetch(path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        let data = null;
        try { data = await res.json(); } catch { /* empty or non-JSON body */ }

        if (!res.ok) {
            const err = new Error((data && data.error) || `HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return data;
    };

    /* -------- Per-project theming -------------------------------------------
       Opening a project re-tints the page: buttons, focus rings, the cursor,
       the backdrop wash and the dot lattice all take that project's colour.
       Done with inline custom properties on <html>, so removing them restores
       the base palette exactly — nothing is computed that has to be undone. */
    const THEMED = [
        '--accent', '--accent-lift', '--accent-deep', '--accent-soft',
        '--accent-veil', '--shadow-accent', '--wash-a', '--field-accent'
    ];
    let activeTone = null;

    const hexToRgb = (hex) => {
        const h = String(hex || '').trim().replace('#', '');
        const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
        if (!/^[0-9a-f]{6}$/i.test(full)) return null;
        const n = parseInt(full, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };

    function paintTone() {
        const root = document.documentElement;
        if (!activeTone) {
            THEMED.forEach((name) => root.style.removeProperty(name));
            root.classList.remove('has-project-theme');
            return;
        }
        const k = activeTone;
        const s = root.style;
        s.setProperty('--accent', `var(--tone-${k}-i)`);
        s.setProperty('--accent-lift', `var(--tone-${k}-b)`);
        s.setProperty('--accent-deep', `var(--tone-${k}-a)`);
        s.setProperty('--accent-soft', `var(--tone-${k}-t)`);
        s.setProperty('--accent-veil', `color-mix(in srgb, var(--tone-${k}-a) 18%, transparent)`);
        s.setProperty('--shadow-accent',
            `0 10px 30px -10px color-mix(in srgb, var(--tone-${k}-a) 52%, transparent)`);
        s.setProperty('--wash-a', `color-mix(in srgb, var(--tone-${k}-a) 20%, transparent)`);

        // The lattice paints raw RGB, so the tone has to be resolved to numbers.
        const rgb = hexToRgb(getComputedStyle(root).getPropertyValue(`--tone-${k}-a`));
        if (rgb) s.setProperty('--field-accent', rgb.join(', '));
        else s.removeProperty('--field-accent');

        root.classList.add('has-project-theme');
    }

    /* -------- Accent from a real colour -------------------------------------
       An app's own icon colour beats the nearest tone. The colour is pushed
       until it clears 4.5:1 against the page in the current theme, so a pale
       icon never produces unreadable links. */
    let activeRgb = null;

    const lum = ([r, g, b]) => {
        const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

    /* Moves `rgb` toward black (light theme) or white (dark theme) until it
       reads on `ground`. Returns the adjusted colour. */
    function readable(rgb, ground, dark) {
        const target = dark ? [255, 255, 255] : [0, 0, 0];
        let out = rgb;
        for (let t = 0; t <= 1 && contrast(out, ground) < 4.5; t += 0.05) out = mix(rgb, target, t);
        return out;
    }

    function paintRgb() {
        const root = document.documentElement;
        const dark = root.dataset.theme === 'dark';
        const ground = dark ? [19, 17, 16] : [247, 245, 240];
        const base = activeRgb;
        const ink = readable(base, ground, dark);
        const deep = dark ? mix(base, [0, 0, 0], 0.35) : mix(base, [0, 0, 0], 0.25);
        const lift = mix(base, [255, 255, 255], dark ? 0.25 : 0.18);
        const css = (c) => `rgb(${c.join(' ')})`;
        const s = root.style;
        s.setProperty('--accent', css(ink));
        s.setProperty('--accent-lift', css(lift));
        s.setProperty('--accent-deep', css(deep));
        s.setProperty('--accent-soft', `rgb(${base.join(' ')} / ${dark ? 0.16 : 0.12})`);
        s.setProperty('--accent-veil', `rgb(${base.join(' ')} / .2)`);
        s.setProperty('--shadow-accent', `0 10px 30px -10px rgb(${base.join(' ')} / .5)`);
        s.setProperty('--wash-a', `rgb(${base.join(' ')} / .2)`);
        s.setProperty('--field-accent', base.join(', '));
        root.classList.add('has-project-theme');
    }

    /* color: a tone key, or null to reset. opts.rgb: [r,g,b] from the real
       icon — wins over the tone when given. */
    window.applyProjectTheme = (color, { rgb = null } = {}) => {
        activeTone = color ? toneKey(color) : null;
        activeRgb = color && Array.isArray(rgb) && rgb.length === 3 ? rgb : null;
        if (activeRgb) paintRgb(); else paintTone();
        window.dispatchEvent(new CustomEvent('accentchange', { detail: { tone: activeTone, rgb: activeRgb } }));
    };

    // Dark tokens restate every tone, so the resolved RGB has to follow.
    window.addEventListener('themechange', () => {
        if (!activeTone && !activeRgb) return;
        if (activeRgb) paintRgb(); else paintTone();
        window.dispatchEvent(new CustomEvent('accentchange', { detail: { tone: activeTone, rgb: activeRgb } }));
    });

    /* The dominant, saturated colour of an image (an app icon). Resolves to
       [r,g,b] or null — never throws: a cross-origin image without CORS
       taints the canvas, and that simply means "no colour". Cached per URL. */
    const sampled = new Map();
    window.sampleImageColor = (url) => {
        const src = window.safeUrl(url);
        if (!src) return Promise.resolve(null);
        if (sampled.has(src)) return sampled.get(src);
        const job = new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'no-referrer';
            const timer = setTimeout(() => resolve(null), 4000);
            img.onerror = () => { clearTimeout(timer); resolve(null); };
            img.onload = () => {
                clearTimeout(timer);
                try {
                    const N = 24;
                    const c = document.createElement('canvas');
                    c.width = N; c.height = N;
                    const ctx = c.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, N, N);
                    const px = ctx.getImageData(0, 0, N, N).data;
                    // Bucket by hue, weight by saturation — the logo, not the
                    // white tile it sits on.
                    const buckets = new Map();
                    for (let i = 0; i < px.length; i += 4) {
                        const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
                        if (a < 160) continue;
                        const max = Math.max(r, g, b), min = Math.min(r, g, b);
                        const sat = max ? (max - min) / max : 0;
                        if (sat < 0.25 || max < 40) continue;
                        const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
                        const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
                        const w = sat;
                        e.n += w; e.r += r * w; e.g += g * w; e.b += b * w;
                        buckets.set(key, e);
                    }
                    let best = null;
                    buckets.forEach((e) => { if (!best || e.n > best.n) best = e; });
                    resolve(best && best.n > 4 ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null);
                } catch {
                    resolve(null);                     // tainted canvas
                }
            };
            img.src = src;
        });
        sampled.set(src, job);
        return job;
    };

    /* Projects as a visitor should see them: hidden ones only for the admin. */
    window.listProjects = () => {
        const all = window.getProjects ? window.getProjects() : [];
        return window.isAdmin ? all : all.filter((p) => !p.hidden);
    };

    /* -------- Platforms -------------------------------------------------------
       What a project runs on. Ordered by how a visitor would scan them; `icon`
       is a js/icons.js key and `frame` is the device frame it is shown in. */
    window.PLATFORMS = {
        web:       { label: 'Web',               short: 'Web',       icon: 'globe',    frame: 'web',     noun: 'Websites' },
        windows:   { label: 'Windows',           short: 'Windows',   icon: 'windows',  frame: 'windows', noun: 'Windows apps' },
        android:   { label: 'Android',           short: 'Android',   icon: 'android',  frame: 'phone',   noun: 'Android apps' },
        ios:       { label: 'iOS',               short: 'iOS',       icon: 'apple',    frame: 'phone',   noun: 'iPhone apps' },
        macos:     { label: 'macOS',             short: 'Mac',       icon: 'apple',    frame: 'web',     noun: 'Mac apps' },
        linux:     { label: 'Linux',             short: 'Linux',     icon: 'linux',    frame: 'windows', noun: 'Linux apps' },
        extension: { label: 'Browser extension', short: 'Extension', icon: 'chrome',   frame: 'web',     noun: 'Extensions' },
        cli:       { label: 'Command line',      short: 'CLI',       icon: 'terminal', frame: 'windows', noun: 'CLI tools' }
    };

    /* A project's platforms, cleaned to known keys. Older records predate the
       field, so a live link alone means "web". */
    window.platformsOf = (p) => {
        if (!p) return [];
        const list = (Array.isArray(p.platforms) ? p.platforms : [])
            .map((k) => String(k || '').toLowerCase().trim())
            .filter((k, i, a) => window.PLATFORMS[k] && a.indexOf(k) === i);
        if (list.length) return list;
        return window.safeUrl(p.link) ? ['web'] : [];
    };

    /* The visitor's own OS — decides which download button leads. Client hints
       first (exact, no UA parsing), then a conservative UA sniff. */
    window.visitorPlatform = () => {
        try {
            const hint = navigator.userAgentData && navigator.userAgentData.platform;
            const ua = `${hint || ''} ${navigator.userAgent || ''}`.toLowerCase();
            if (/android/.test(ua)) return 'android';
            if (/iphone|ipad|ipod/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
            if (/windows|win32|win64/.test(ua)) return 'windows';
            if (/mac ?os|macintosh/.test(ua)) return 'macos';
            if (/linux|x11|cros/.test(ua)) return 'linux';
        } catch { /* fall through */ }
        return 'other';
    };

    /* -------- Number formatting ---------------------------------------------- */
    window.formatCount = (n) => {
        const v = Number(n) || 0;
        if (v < 1000) return String(Math.round(v));
        if (v < 1e6) return `${(v / 1e3).toFixed(v < 1e4 ? 1 : 0).replace(/\.0$/, '')}k`;
        return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    };
    window.formatBytes = (n) => {
        const v = Number(n) || 0;
        if (!v) return '';
        if (v < 1024 * 1024) return `${Math.max(1, Math.round(v / 1024))} KB`;
        if (v < 1024 ** 3) return `${(v / 1024 / 1024).toFixed(v < 10 * 1024 * 1024 ? 1 : 0)} MB`;
        return `${(v / 1024 ** 3).toFixed(1)} GB`;
    };

    /* -------- Case-study handoff --------------------------------------------
       The index stashes the clicked project here before navigating, so the
       case-study page can render its masthead on the very first frame — which
       is what lets the cross-document view transition morph into it. */
    window.HANDOFF_KEY = (slug) => `case-handoff:${slug}`;
})();
