/* ===========================================================================
   core.js  (classic script — loaded on every page, right after icons.js)
   The handful of helpers every page needs, in one place:

     · TONES / toneVars()    per-project duotones, read from tokens.css
     · esc() / safeUrl()     everything from Firestore is untrusted
     · slugify / projectSlug the URL-safe name a project is linked by
     · CATEGORY_GROUPS       the category taxonomy and its human labels
     · EDGE / edgeFetch()    the Cloudflare (or Vercel) API, when present
     · applyProjectTheme()   re-tints the whole page in one project's colour
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
        || (/^(localhost|127\.0\.0\.1)$/.test(host) && /^(8787|8788)$/.test(location.port));

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
        s.setProperty('--wash-a',
            `radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--tone-${k}-a) 26%, transparent), transparent 68%)`);

        // The lattice paints raw RGB, so the tone has to be resolved to numbers.
        const rgb = hexToRgb(getComputedStyle(root).getPropertyValue(`--tone-${k}-a`));
        if (rgb) s.setProperty('--field-accent', rgb.join(', '));
        else s.removeProperty('--field-accent');

        root.classList.add('has-project-theme');
    }

    window.applyProjectTheme = (color) => {
        activeTone = color ? toneKey(color) : null;
        paintTone();
        window.dispatchEvent(new CustomEvent('accentchange', { detail: { tone: activeTone } }));
    };

    // Dark tokens restate every tone, so the resolved RGB has to follow.
    window.addEventListener('themechange', () => {
        if (!activeTone) return;
        paintTone();
        window.dispatchEvent(new CustomEvent('accentchange', { detail: { tone: activeTone } }));
    });

    /* -------- Case-study handoff --------------------------------------------
       The index stashes the clicked project here before navigating, so the
       case-study page can render its masthead on the very first frame — which
       is what lets the cross-document view transition morph into it. */
    window.HANDOFF_KEY = (slug) => `case-handoff:${slug}`;
})();
