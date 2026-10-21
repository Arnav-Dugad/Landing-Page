/* ===========================================================================
   meta.js  (classic script — after github.js and widgets.js)
   Live, self-updating facts about every project, kept by the Worker:
   GitHub stars and downloads, the latest release, a year of commit activity,
   Lighthouse scores, uptime and store ratings.

     Meta.load()          → Promise<{ [projectId]: Meta }>   (one request)
     Meta.get(id)         → Meta | null                      (after load)
     Meta.github(p)       → Promise<github block | null>     (meta, else GitHub)
     Meta.downloads(p)    → total downloads for a project
     Meta.stars(p)        → stars, or null when unknown
     Meta.totals()        → { stars, downloads, perf, perfCount }

   Visitors never call GitHub from their own browser when the Worker is
   there — one cached request replaces thirty, and nobody hits the 60/hour
   anonymous rate limit. Off the edge (GitHub Pages mirror), github.js is the
   fallback, exactly as before. A `metaready` event fires on window once the
   map is in, so anything painted earlier can fill itself in.
   =========================================================================== */

(() => {
    let map = {};
    let promise = null;
    let ready = false;

    function load() {
        if (promise) return promise;
        promise = (window.EDGE ? window.edgeFetch('/api/meta') : Promise.reject(new Error('off edge')))
            .then((data) => {
                map = (data && data.projects) || {};
                return map;
            })
            .catch(() => { map = {}; return map; })
            .finally(() => {
                ready = true;
                window.dispatchEvent(new CustomEvent('metaready', { detail: { count: Object.keys(map).length } }));
            });
        return promise;
    }

    const get = (id) => (id != null && map[String(id)]) || null;

    /* The GitHub block for a project — from meta when the Worker has it,
       otherwise assembled from github.js (cached 6h in localStorage). */
    async function github(p) {
        const m = get(p && p.id);
        if (m && m.github) return m.github;
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
        if (!repo || !window.fetchGitHubStats) return null;
        const [s, langs] = await Promise.all([
            window.fetchGitHubStats(repo),
            window.fetchGitHubLanguages ? window.fetchGitHubLanguages(repo) : []
        ]);
        if (!s) return null;
        return {
            repo: repo.replace('https://github.com/', ''),
            stars: s.stars, forks: s.forks, watchers: null, openIssues: null,
            pushedAt: s.updatedAt ? Date.parse(s.updatedAt) : null,
            createdAt: s.createdAt ? Date.parse(s.createdAt) : null,
            license: null,
            languages: (langs || []).slice(0, 6).map((l) => ({ name: l.name, pct: l.pct })),
            commitWeeks: [],
            release: null,
            downloads: 0
        };
    }

    const stars = (p) => {
        const m = get(p && p.id);
        return m && m.github && Number.isFinite(m.github.stars) ? m.github.stars : null;
    };

    /* Release-asset counts from meta, plus anything the record carries itself
       (the importer stores per-asset counts in `downloads`). */
    const downloads = (p) => {
        const m = get(p && p.id);
        const fromMeta = m && m.github && Number(m.github.downloads) || 0;
        const fromRecord = (Array.isArray(p && p.downloads) ? p.downloads : [])
            .reduce((n, d) => n + (Number(d && d.count) || 0), 0);
        return Math.max(fromMeta, fromRecord);
    };

    const psi = (p) => {
        const m = get(p && p.id);
        return (m && m.web && m.web.psi) || null;
    };

    const release = (p) => {
        const m = get(p && p.id);
        const r = m && m.github && m.github.release;
        if (r && r.tag) return { version: String(r.tag).replace(/^v/i, ''), date: r.date || null, url: r.url || null };
        if (p && p.version) return { version: String(p.version).replace(/^v/i, ''), date: p.releasedAt || null, url: null };
        return null;
    };

    function totals(list) {
        const all = list || (window.getProjects ? window.getProjects() : []);
        let starSum = 0, dl = 0, perf = 0, perfCount = 0, known = 0;
        all.forEach((p) => {
            const s = stars(p);
            if (s !== null) { starSum += s; known++; }
            dl += downloads(p);
            const ps = psi(p);
            if (ps && Number.isFinite(ps.performance)) { perf += ps.performance; perfCount++; }
        });
        return {
            stars: known ? starSum : null,
            downloads: dl,
            perf: perfCount ? Math.round(perf / perfCount) : null,
            perfCount
        };
    }

    window.Meta = {
        load, get, github, stars, downloads, psi, release, totals,
        isReady: () => ready
    };

    load();
})();
