/* ===========================================================================
   github.js  (classic script)
   Live GitHub data for projects: stars/forks/last-push and per-repo language
   breakdown. A project's repo is either explicit (project.repo) or DERIVED from
   a `<user>.github.io/<name>/` live link, so projects that only have a link
   still get stats. Results are cached in localStorage (6h TTL) and deduped
   in-memory so re-renders never refetch. Every failure resolves to null so
   callers can simply hide the stats. Also exposes deploy-platform detection and
   a language color map. No project data lives here.
   =========================================================================== */

(() => {
    const TTL_MS = 6 * 60 * 60 * 1000;           // 6 hours
    const CACHE_PREFIX = 'ghcache:';
    const inflight = new Map();                  // url -> Promise (dedupe)

    /* ---- GitHub language colors (subset of github-linguist) ------------- */
    window.LANG_COLOR = {
        JavaScript: '#f1e05a', TypeScript: '#3178c6', HTML: '#e34c26', CSS: '#563d7c',
        SCSS: '#c6538c', Python: '#3572A5', 'C++': '#f34b7d', C: '#555555',
        'C#': '#178600', Java: '#b07219', Go: '#00ADD8', Rust: '#dea584',
        Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF',
        Dart: '#00B4AB', Shell: '#89e051', Vue: '#41b883', Svelte: '#ff3e00',
        Lua: '#000080', 'Jupyter Notebook': '#DA5B0B', Astro: '#ff5a03',
        GLSL: '#5686a5', Makefile: '#427819'
    };
    window.langColor = (name) => window.LANG_COLOR[name] || '#8b949e';

    /* ---- Deploy platform detection from a live URL ---------------------
       `icon` values are keys from js/icons.js; `color` is tuned for paper,
       not for a dark background. */
    window.deployInfo = (link) => {
        if (!link) return null;
        let host = '';
        try { host = new URL(link).hostname.toLowerCase(); } catch { return null; }
        if (host.endsWith('github.io')) return { name: 'GitHub Pages', icon: 'github', color: '#24292F' };
        if (host.endsWith('vercel.app')) return { name: 'Vercel', icon: 'vercel', color: '#141210' };
        if (host.endsWith('netlify.app')) return { name: 'Netlify', icon: 'bolt', color: '#00808B' };
        if (host.endsWith('web.app') || host.endsWith('firebaseapp.com')) return { name: 'Firebase', icon: 'flame', color: '#B4720A' };
        if (host.endsWith('pages.dev')) return { name: 'Cloudflare Pages', icon: 'cloud', color: '#C2610C' };
        return { name: 'Web', icon: 'globe', color: '#1D6FE0' };
    };

    /* ---- Parse "owner/repo" from a GitHub URL -------------------------- */
    function parseRepo(repoUrl) {
        if (!repoUrl) return null;
        try {
            let path;
            if (/^https?:\/\//i.test(repoUrl)) {
                const u = new URL(repoUrl);
                if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
                path = u.pathname;
            } else {
                path = repoUrl;                  // assume "owner/repo"
            }
            const parts = path.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
            if (parts.length < 2 || !parts[0] || !parts[1]) return null;
            return `${parts[0]}/${parts[1]}`;
        } catch {
            return null;
        }
    }

    /* ---- Resolve a project's repo: explicit, else derive from github.io - */
    window.resolveRepoUrl = (project) => {
        if (!project) return null;
        if (project.repo) {
            const slug = parseRepo(project.repo);
            return slug ? `https://github.com/${slug}` : null;
        }
        const link = project.link;
        if (!link) return null;
        try {
            const u = new URL(link);
            const m = u.hostname.toLowerCase().match(/^([a-z0-9-]+)\.github\.io$/);
            if (!m) return null;                 // not a github.io site
            const seg = u.pathname.replace(/^\/+/, '').split('/')[0];
            if (!seg) return null;               // user root page, no project repo
            return `https://github.com/${m[1]}/${seg}`;
        } catch {
            return null;
        }
    };

    function readCache(key) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + key);
            if (!raw) return undefined;
            const entry = JSON.parse(raw);
            if (Date.now() - entry.t > TTL_MS) return undefined;
            return entry.v;                      // may be null (cached "no data")
        } catch {
            return undefined;
        }
    }

    function writeCache(key, value) {
        try {
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
        } catch { /* storage full / disabled — non-fatal */ }
    }

    /* Cached + deduped GET returning parsed JSON, or null on any failure.

       Rate limiting gets its own short negative cache. Unauthenticated GitHub
       allows 60 requests an hour per IP; without this, a page with 30 projects
       that trips the limit would keep retrying every render and never recover. */
    let rateLimitedUntil = 0;

    function cachedJson(url) {
        const cached = readCache(url);
        if (cached !== undefined) return Promise.resolve(cached);
        if (Date.now() < rateLimitedUntil) return Promise.resolve(null);
        if (inflight.has(url)) return inflight.get(url);

        const p = (async () => {
            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
                if (res.status === 403 || res.status === 429) {
                    // Back off for everything until the window resets.
                    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
                    rateLimitedUntil = Number.isFinite(reset) && reset > Date.now()
                        ? reset : Date.now() + 10 * 60 * 1000;
                    return null;
                }
                if (res.status === 404) { writeCache(url, null); return null; }   // gone for good
                if (!res.ok) return null;                                          // transient
                const data = await res.json();
                writeCache(url, data);
                return data;
            } catch {
                return null;                     // offline/CORS — don't cache
            } finally {
                inflight.delete(url);
            }
        })();
        inflight.set(url, p);
        return p;
    }

    window.githubRateLimited = () => Date.now() < rateLimitedUntil;

    /* Returns { stars, forks, updatedAt, url } or null. Never throws.
       Accepts a repo URL/slug OR a project object (auto-resolves). */
    window.fetchGitHubStats = async (repoOrProject) => {
        const repoUrl = (repoOrProject && typeof repoOrProject === 'object')
            ? window.resolveRepoUrl(repoOrProject)
            : repoOrProject;
        const slug = parseRepo(repoUrl);
        if (!slug) return null;
        const data = await cachedJson(`https://api.github.com/repos/${slug}`);
        if (!data) return null;
        return {
            stars: data.stargazers_count ?? 0,
            forks: data.forks_count ?? 0,
            updatedAt: data.pushed_at || data.updated_at || null,
            language: data.language || null,      // primary language (no extra call)
            url: data.html_url || `https://github.com/${slug}`,
            // Everything below is used by the auto-populate pass in js/enrich.js.
            // It rides along on a request that was going to happen anyway.
            description: data.description || null,
            homepage: data.homepage || null,
            createdAt: data.created_at || null,
            archived: !!data.archived,
            topics: data.topics || []
        };
    };

    /* Returns [{ name, bytes, pct }] sorted desc, or [] on failure. */
    window.fetchGitHubLanguages = async (repoOrProject) => {
        const repoUrl = (repoOrProject && typeof repoOrProject === 'object')
            ? window.resolveRepoUrl(repoOrProject)
            : repoOrProject;
        const slug = parseRepo(repoUrl);
        if (!slug) return [];
        const data = await cachedJson(`https://api.github.com/repos/${slug}/languages`);
        if (!data || typeof data !== 'object') return [];
        const total = Object.values(data).reduce((a, b) => a + b, 0);
        if (!total) return [];
        return Object.entries(data)
            .map(([name, bytes]) => ({ name, bytes, pct: (bytes / total) * 100 }))
            .sort((a, b) => b.bytes - a.bytes);
    };

    /* ---- Automatic tech detection --------------------------------------
       Three independent signals, merged and de-duplicated:

         1. /languages    — what the code is actually written in
         2. package.json  — what it is built WITH (React, Three.js, Tailwind…),
                            which no language endpoint can tell you
         3. /topics       — whatever the author tagged the repo with

       Plus the deploy platform inferred from the live URL, so a project with
       no repo at all still gets something true said about it.
       -------------------------------------------------------------------- */

    /* Dependency name → the label a human would actually write. Ordered most
       specific first so "react-dom" doesn't win over "react-three-fiber". */
    const DEP_LABELS = [
        [/^next$/, 'Next.js'], [/^nuxt/, 'Nuxt'], [/^@remix-run/, 'Remix'],
        [/^gatsby$/, 'Gatsby'], [/^astro$/, 'Astro'],
        [/^@sveltejs\/kit$/, 'SvelteKit'], [/^svelte$/, 'Svelte'],
        [/^@angular\/core$/, 'Angular'], [/^vue$/, 'Vue'],
        [/^react-three|^@react-three/, 'React Three Fiber'],
        [/^react$/, 'React'], [/^preact$/, 'Preact'], [/^solid-js$/, 'SolidJS'],
        [/^three$/, 'Three.js'], [/^babylonjs/, 'Babylon.js'], [/^phaser$/, 'Phaser'],
        [/^pixi\.js/, 'PixiJS'], [/^matter-js$/, 'Matter.js'], [/^p5$/, 'p5.js'],
        [/^gsap$/, 'GSAP'], [/^framer-motion$/, 'Framer Motion'], [/^lenis|^@studio-freight/, 'Lenis'],
        [/^tailwindcss$/, 'Tailwind'], [/^bootstrap$/, 'Bootstrap'], [/^sass$/, 'Sass'],
        [/^styled-components$/, 'styled-components'],
        [/^firebase$/, 'Firebase'], [/^@supabase/, 'Supabase'],
        [/^mongoose$|^mongodb$/, 'MongoDB'], [/^pg$|^postgres/, 'PostgreSQL'],
        [/^prisma$|^@prisma/, 'Prisma'], [/^drizzle-orm$/, 'Drizzle'],
        [/^express$/, 'Express'], [/^fastify$/, 'Fastify'], [/^koa$/, 'Koa'],
        [/^socket\.io/, 'WebSockets'], [/^ws$/, 'WebSockets'],
        [/^vite$/, 'Vite'], [/^webpack$/, 'Webpack'], [/^parcel/, 'Parcel'],
        [/^esbuild$/, 'esbuild'], [/^rollup$/, 'Rollup'],
        [/^typescript$/, 'TypeScript'], [/^electron$/, 'Electron'],
        [/^d3$/, 'D3'], [/^chart\.js$/, 'Chart.js'], [/^recharts$/, 'Recharts'],
        [/^openai$/, 'OpenAI'], [/^@anthropic-ai/, 'Claude API'],
        [/^@google\/generative-ai|^@google\/genai/, 'Gemini API'],
        [/^langchain/, 'LangChain'], [/^zod$/, 'Zod'],
        [/^redux|^@reduxjs/, 'Redux'], [/^zustand$/, 'Zustand'],
        [/^jest$/, 'Jest'], [/^vitest$/, 'Vitest'], [/^playwright|^@playwright/, 'Playwright'],
        [/^cypress$/, 'Cypress'], [/^stripe$/, 'Stripe'],
        [/^leaflet$/, 'Leaflet'], [/^mapbox-gl$/, 'Mapbox'],
        [/^howler$/, 'Howler.js'], [/^tone$/, 'Tone.js'],
        [/^workbox/, 'PWA'], [/^next-pwa$/, 'PWA']
    ];

    /* Topics are free-form; only promote ones that name real technology. */
    const TOPIC_LABELS = {
        javascript: 'JavaScript', typescript: 'TypeScript', html: 'HTML', html5: 'HTML',
        css: 'CSS', css3: 'CSS', python: 'Python', java: 'Java', cpp: 'C++',
        react: 'React', reactjs: 'React', nextjs: 'Next.js', vue: 'Vue', vuejs: 'Vue',
        svelte: 'Svelte', angular: 'Angular', tailwind: 'Tailwind', tailwindcss: 'Tailwind',
        threejs: 'Three.js', webgl: 'WebGL', canvas: 'Canvas', firebase: 'Firebase',
        supabase: 'Supabase', mongodb: 'MongoDB', postgresql: 'PostgreSQL', sql: 'SQL',
        nodejs: 'Node.js', node: 'Node.js', express: 'Express', flask: 'Flask',
        django: 'Django', api: 'API', pwa: 'PWA', websockets: 'WebSockets',
        websocket: 'WebSockets', ai: 'AI', 'machine-learning': 'Machine learning',
        ml: 'Machine learning', game: 'Game', gamedev: 'Game', vite: 'Vite',
        vercel: 'Vercel', netlify: 'Netlify', docker: 'Docker', electron: 'Electron',
        typescript5: 'TypeScript', 'game-development': 'Game'
    };

    function labelForDep(name) {
        for (const [pattern, label] of DEP_LABELS) if (pattern.test(name)) return label;
        return null;
    }

    /* Reads package.json from the repo's default branch. Returns [] when there
       isn't one — plenty of these projects are plain HTML/CSS/JS. */
    async function techFromPackageJson(slug) {
        const meta = await cachedJson(`https://api.github.com/repos/${slug}/contents/package.json`);
        if (!meta || !meta.content) return [];
        try {
            // The contents API returns base64 with newlines in it.
            const json = JSON.parse(atob(String(meta.content).replace(/\s/g, '')));
            const deps = Object.keys({ ...(json.dependencies || {}), ...(json.devDependencies || {}) });
            return deps.map(labelForDep).filter(Boolean);
        } catch {
            return [];
        }
    }

    async function techFromTopics(slug) {
        const data = await cachedJson(`https://api.github.com/repos/${slug}/topics`);
        const topics = (data && data.names) || [];
        return topics.map((t) => TOPIC_LABELS[String(t).toLowerCase()]).filter(Boolean);
    }

    /* Anything meaningful we can say from the live URL alone. */
    function techFromLink(link) {
        const info = window.deployInfo(link);
        if (!info) return [];
        return info.name === 'Web' ? [] : [info.name === 'GitHub Pages' ? 'GitHub Pages' : info.name];
    }

    /* Returns a de-duplicated, sensibly ordered tag list for a project.
       Languages first (that's what the thing IS), then frameworks, then host. */
    window.detectTech = async (project) => {
        const repoUrl = window.resolveRepoUrl(project);
        const slug = parseRepo(repoUrl);

        let languages = [], deps = [], topics = [];
        if (slug) {
            const langData = await cachedJson(`https://api.github.com/repos/${slug}/languages`);
            languages = langData && typeof langData === 'object' ? Object.keys(langData) : [];
            [deps, topics] = await Promise.all([techFromPackageJson(slug), techFromTopics(slug)]);
        }

        const seen = new Set();
        const out = [];
        for (const tag of [...languages, ...deps, ...topics, ...techFromLink(project.link)]) {
            const key = String(tag).toLowerCase();
            if (!tag || seen.has(key)) continue;
            seen.add(key);
            out.push(tag);
        }
        return out.slice(0, 12);
    };

    /* "3 days ago" style relative time. */
    window.relativeTime = (iso) => {
        if (!iso) return '';
        const then = new Date(iso).getTime();
        if (Number.isNaN(then)) return '';
        const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
        const units = [
            ['year', 31536000], ['month', 2592000], ['week', 604800],
            ['day', 86400], ['hour', 3600], ['minute', 60]
        ];
        for (const [name, size] of units) {
            const n = Math.floor(secs / size);
            if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
        }
        return 'just now';
    };
})();
