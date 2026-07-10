/* ===========================================================================
   github.js  (classic script)
   Premium feature: live GitHub stats (stars / forks / last-updated) for any
   project that carries a `repo` URL. Results are cached in localStorage with a
   TTL so we stay well under the 60 req/hr unauthenticated rate limit, and every
   failure path resolves to null so the caller can simply hide the stats row.
   No project data lives here.
   =========================================================================== */

(() => {
    const TTL_MS = 6 * 60 * 60 * 1000;           // 6 hours
    const CACHE_PREFIX = 'ghstats:';

    /* Pull "owner/repo" out of any GitHub URL (or an already-short "owner/repo"). */
    function parseRepo(repoUrl) {
        if (!repoUrl) return null;
        try {
            let path;
            if (/^https?:\/\//i.test(repoUrl)) {
                const u = new URL(repoUrl);
                if (!/github\.com$/i.test(u.hostname)) return null;
                path = u.pathname;
            } else {
                path = repoUrl;                   // assume "owner/repo"
            }
            const parts = path.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
            if (parts.length < 2 || !parts[0] || !parts[1]) return null;
            return `${parts[0]}/${parts[1]}`;
        } catch {
            return null;
        }
    }

    function readCache(slug) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + slug);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (Date.now() - entry.t > TTL_MS) return null;
            return entry.v;
        } catch {
            return null;
        }
    }

    function writeCache(slug, value) {
        try {
            localStorage.setItem(CACHE_PREFIX + slug, JSON.stringify({ t: Date.now(), v: value }));
        } catch {
            /* storage full / disabled — non-fatal */
        }
    }

    /* Returns { stars, forks, updatedAt, url } or null. Never throws. */
    window.fetchGitHubStats = async (repoUrl) => {
        const slug = parseRepo(repoUrl);
        if (!slug) return null;

        const cached = readCache(slug);
        if (cached) return cached;

        try {
            const res = await fetch(`https://api.github.com/repos/${slug}`, {
                headers: { 'Accept': 'application/vnd.github+json' }
            });
            if (!res.ok) return null;             // 404 / 403 rate-limit / etc.
            const data = await res.json();
            const stats = {
                stars: data.stargazers_count ?? 0,
                forks: data.forks_count ?? 0,
                updatedAt: data.pushed_at || data.updated_at || null,
                url: data.html_url || `https://github.com/${slug}`
            };
            writeCache(slug, stats);
            return stats;
        } catch {
            return null;                          // offline / CORS / rate-limit
        }
    };

    /* "3 days ago" style relative time for the last-push date. */
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
