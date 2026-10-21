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
     Meta.score(p)        → 0–100 "how much is worth showing" (smart sort)
     Meta.releases()      → Promise<[{ projectId, tag, date, summary[], isNew, … }]>

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

    const NEW_MS = 14 * 864e5;

    /* The latest release, whichever source knows it. isNew = shipped in the
       last two weeks (the Worker says so; otherwise worked out from the date). */
    const release = (p) => {
        const m = get(p && p.id);
        const r = m && m.github && m.github.release;
        const mk = (version, date, url, name, summary, isNew) => ({
            version: String(version).replace(/^v/i, ''),
            date: date || null, url: url || null, name: name || '',
            summary: Array.isArray(summary) ? summary.filter(Boolean).slice(0, 5) : [],
            isNew: typeof isNew === 'boolean' ? isNew : !!(date && Date.now() - date < NEW_MS)
        });
        if (r && r.tag) return mk(r.tag, r.date, r.url, r.name, r.summary, r.isNew);
        if (p && p.version) return mk(p.version, p.releasedAt, null, '', [], undefined);
        return null;
    };

    /* Smart ordering. The Worker computes `score`; until it has, a local
       estimate from the same ingredients keeps the order sensible. */
    function score(p) {
        const m = get(p && p.id);
        if (m && Number.isFinite(m.score)) return m.score;
        const g = m && m.github;
        const now = Date.now();
        const fresh = (t) => (t ? Math.max(0, 1 - (now - t) / (365 * 864e5)) : 0);
        const rel = release(p);
        const recency = Math.max(fresh(g && g.pushedAt), fresh(rel && rel.date), fresh(p.updatedAt) * 0.6, fresh(p.createdAt) * 0.5);
        const reach = Math.min(1, Math.log10(1 + downloads(p) + ((g && g.stars) || 0) * 3) / 3);
        const up = m && m.web ? (m.web.up === false ? 0 : 1) : 0.6;
        const ps = psi(p);
        const quality = ps ? ((ps.performance || 0) + (ps.accessibility || 0)) / 200 : 0.5;
        const complete = [p.tagline || p.desc, p.longDesc, (p.gallery || []).length || p.cover, p.appIcon,
            (p.highlights || []).length, p.caseStudy].filter(Boolean).length / 6;
        let s = recency * 35 + reach * 25 + up * 15 + quality * 10 + complete * 15;
        if (p.featured) s += 8;
        return Math.round(Math.min(100, s));
    }

    /* Recent releases across every project, newest first. The Worker's list
       when it has one; otherwise assembled from meta. */
    let relPromise = null;
    function releases() {
        if (relPromise) return relPromise;
        const fromMeta = () => {
            const all = window.listProjects ? window.listProjects() : [];
            return all.map((p) => ({ p, r: release(p) }))
                .filter((x) => x.r && x.r.date && Date.now() - x.r.date < 120 * 864e5)
                .sort((a, b) => b.r.date - a.r.date)
                .map(({ p, r }) => ({
                    projectId: String(p.id), slug: window.projectSlug(p), title: p.title,
                    platforms: window.platformsOf(p), tag: r.version, name: r.name,
                    date: r.date, url: r.url, summary: r.summary, isNew: r.isNew
                }));
        };
        relPromise = (window.EDGE ? window.edgeFetch('/api/releases') : Promise.reject(new Error('off edge')))
            .then((d) => {
                const items = (d && Array.isArray(d.items)) ? d.items : [];
                return items.length ? items.map((it) => ({ ...it, tag: String(it.tag || '').replace(/^v/i, '') })) : load().then(fromMeta);
            })
            .catch(() => load().then(fromMeta));
        return relPromise;
    }

    function totals(list) {
        const all = list || (window.listProjects ? window.listProjects() : []);
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
        load, get, github, stars, downloads, psi, release, totals, score, releases,
        isReady: () => ready
    };

    load();
})();
