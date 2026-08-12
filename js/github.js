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

    /* Cached + deduped GET returning parsed JSON, or null on any failure. */
    function cachedJson(url) {
        const cached = readCache(url);
        if (cached !== undefined) return Promise.resolve(cached);
        if (inflight.has(url)) return inflight.get(url);
        const p = (async () => {
            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
                if (!res.ok) { writeCache(url, null); return null; }
                const data = await res.json();
                writeCache(url, data);
                return data;
            } catch {
                return null;                     // offline/CORS/limit — don't cache transient
            } finally {
                inflight.delete(url);
            }
        })();
        inflight.set(url, p);
        return p;
    }

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
            url: data.html_url || `https://github.com/${slug}`
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
