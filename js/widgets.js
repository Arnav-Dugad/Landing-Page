/* ===========================================================================
   widgets.js  (classic script — index and case-study pages)
   Small, self-contained pieces of UI that more than one page renders:

     · techMark()        monochrome monogram marks for technologies
     · loadStatus()      live up/down checks from the worker (/api/status)
     · relatedProjects() "you might also like", scored from real overlap
     · mountChangelog()  recent releases or commits from GitHub
     · mountReactions()  emoji reactions, stored at the edge (/api/reactions)

   Everything that talks to the worker checks window.EDGE first and simply
   disappears on a static host, so a GitHub Pages mirror never shows a broken
   control. Requires core.js (esc, toneVars, edgeFetch) and github.js.
   =========================================================================== */

(() => {
    const esc = (v) => window.esc(v);
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* =====================================================================
       Tech marks — one shape, one weight, one colour. Brand logos in brand
       colours fight each other and the paper; a monogram in a hairline
       square reads as a system, and takes the accent when it's pointed at.
       ===================================================================== */

    const MARKS = {
        javascript: 'JS', typescript: 'TS', html: '<>', css: 'CSS', scss: 'SC', sass: 'SC',
        python: 'Py', 'c++': 'C++', c: 'C', 'c#': 'C#', java: 'Jv', go: 'Go', rust: 'Rs',
        swift: 'Sw', kotlin: 'Kt', php: 'PHP', sql: 'SQL', dart: 'Dt', ruby: 'Rb', lua: 'Lua',
        shell: 'Sh', glsl: 'GL', 'jupyter notebook': 'Nb',
        react: 'Re', 'react three fiber': 'R3F', preact: 'Pr', 'next.js': 'Nx', nuxt: 'Nu',
        vue: 'Vu', svelte: 'Sv', sveltekit: 'SK', angular: 'Ng', astro: 'As', remix: 'Rx',
        solidjs: 'So', gatsby: 'Gb', 'node.js': 'Nd', express: 'Ex', fastify: 'Fy', koa: 'Ko',
        flask: 'Fl', django: 'Dj', fastapi: 'FA', electron: 'El',
        'three.js': '3D', webgl: 'Gl', 'babylon.js': 'Bb', phaser: 'Ph', pixijs: 'Px',
        'p5.js': 'p5', 'matter.js': 'Mt', canvas: 'Cv', d3: 'D3', 'chart.js': 'Ch', recharts: 'Rc',
        gsap: 'Gs', 'framer motion': 'FM', lenis: 'Ln',
        tailwind: 'Tw', bootstrap: 'Bs', 'styled-components': 'SC',
        firebase: 'Fb', supabase: 'Sb', mongodb: 'Mg', postgresql: 'Pg', prisma: 'Pm',
        drizzle: 'Dz', redux: 'Rd', zustand: 'Zs', zod: 'Zd',
        vite: 'Vi', webpack: 'Wp', parcel: 'Pc', esbuild: 'Eb', rollup: 'Ru',
        vercel: 'Vc', netlify: 'Nf', 'github pages': 'GH', 'cloudflare pages': 'CF', cloudflare: 'CF',
        docker: 'Dk', 'github actions': 'GA', pwa: 'PWA', websockets: 'WS', api: 'API',
        openai: 'AI', 'claude api': 'Cl', 'gemini api': 'Gm', langchain: 'LC', ai: 'AI',
        'machine learning': 'ML', jest: 'Je', vitest: 'Vt', playwright: 'Pw', cypress: 'Cy',
        stripe: 'St', leaflet: 'Lf', mapbox: 'Mb', 'howler.js': 'Hw', 'tone.js': 'To', game: 'Gm'
    };

    function monogram(name) {
        const key = String(name || '').trim().toLowerCase();
        if (MARKS[key]) return MARKS[key];
        // Generic fallback: initials of a multi-word name, else the first two letters.
        const words = key.replace(/[^a-z0-9+#. ]/g, ' ').split(/\s+/).filter(Boolean);
        if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
        const w = words[0] || '?';
        return w.charAt(0).toUpperCase() + w.slice(1, 2);
    }

    function techMark(name, { size = 28 } = {}) {
        const label = String(name || '').trim();
        const text = monogram(label);
        // Long monograms shrink so every mark keeps the same footprint.
        const fs = text.length >= 3 ? 0.3 : 0.38;
        return `<span class="tmark" data-tech="${esc(label.toLowerCase())}" title="${esc(label)}"
                      style="--tm:${Number(size) || 28}px;--tm-fs:${fs}" aria-hidden="true">${esc(text)}</span>`;
    }

    /* =====================================================================
       Live status — one request per page load, shared by every caller.
       ===================================================================== */

    let statusPromise = null;

    function loadStatus() {
        if (statusPromise) return statusPromise;
        statusPromise = !window.EDGE
            ? Promise.resolve({})
            : window.edgeFetch('/api/status')
                .then((data) => (data && data.results) || {})
                .catch(() => ({}));
        return statusPromise;
    }

    async function statusFor(projectId) {
        const map = await loadStatus();
        return map[String(projectId)] || null;
    }

    function statusChip(s) {
        if (!s) return '';
        if (s.up) {
            const ms = Number.isFinite(s.ms) ? ` · ${Math.round(s.ms)} ms` : '';
            return `<span class="schip schip--up" title="Responded with HTTP ${esc(s.code ?? '')} on the last check">`
                 + `<i></i>Up${ms}</span>`;
        }
        const why = s.error || (s.code ? `HTTP ${s.code}` : 'No response');
        return `<span class="schip schip--down" title="Last check failed: ${esc(why)}"><i></i>Down</span>`;
    }

    /* =====================================================================
       Related projects — overlap you can explain: shared tech counts most,
       then same category, then being built around the same time.
       ===================================================================== */

    const yearOf = (p) => {
        const m = String((p && p.year) || '').match(/\d{4}/);
        return m ? Number(m[0]) : null;
    };

    function relatedProjects(project, all, n = 3) {
        if (!project || !Array.isArray(all)) return [];
        const mine = new Set((project.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean));
        const y = yearOf(project);

        const scored = all
            .filter((p) => p && String(p.id) !== String(project.id))
            .map((p) => {
                const shared = (p.tags || []).filter((t) => mine.has(String(t).trim().toLowerCase())).length;
                const py = yearOf(p);
                const score = 3 * shared
                    + ((p.category || 'other') === (project.category || 'other') ? 2 : 0)
                    + (y !== null && py !== null && Math.abs(py - y) <= 1 ? 1 : 0)
                    + (p.featured ? 0.5 : 0);
                return { p, score };
            })
            .sort((a, b) => b.score - a.score || (b.p.createdAt || 0) - (a.p.createdAt || 0));

        const picked = scored.filter((s) => s.score > 0).slice(0, n).map((s) => s.p);
        if (picked.length < n) {
            const newest = scored.map((s) => s.p)
                .filter((p) => !picked.includes(p))
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            picked.push(...newest.slice(0, n - picked.length));
        }
        return picked;
    }

    function relatedHtml(list, { link } = {}) {
        if (!list || !list.length) return '';
        return `<div class="related">${list.map((p) => {
            const href = link ? link(p) : null;
            const inner = `
                <span class="rel-plaque" style="${window.toneVars(p.color)}">${window.icon(p.icon, { size: 18 })}</span>
                <span class="rel-text">
                    <b>${esc(p.title)}</b>
                    <small>${esc(window.categoryLabel(p.category))}${p.year ? ` · ${esc(p.year)}` : ''}</small>
                    <em>${esc(p.desc)}</em>
                </span>
                <span class="rel-go">${window.icon('arrow-right', { raw: true, size: 15 })}</span>`;
            return href
                ? `<a class="rel-card" href="${esc(href)}" data-cursor="Open">${inner}</a>`
                : `<button type="button" class="rel-card" data-open="${esc(p.id)}" data-cursor="Open">${inner}</button>`;
        }).join('')}</div>`;
    }

    /* =====================================================================
       Changelog — releases are the author's own story of what shipped, so
       they win; a repo that never tags gets its latest commit subjects.
       ===================================================================== */

    async function mountChangelog(el, repoUrl) {
        if (!el) return;
        if (!repoUrl || !window.fetchGitHubReleases) { el.classList.add('u-hidden'); return; }

        el.classList.remove('u-hidden');
        el.innerHTML = `<div class="detail-sub">Recent changes</div>
            <div class="clog-loading"><span></span><span></span><span></span></div>`;

        let entries = [];
        let kind = 'release';
        try {
            const releases = await window.fetchGitHubReleases(repoUrl, 5);
            if (releases.length) {
                entries = releases.map((r) => ({
                    title: r.name, ref: r.tag, url: r.url, date: r.date
                }));
            } else {
                kind = 'commit';
                const commits = await window.fetchGitHubCommits(repoUrl, 6);
                entries = commits.map((c) => ({
                    title: c.message, ref: c.sha, url: c.url, date: c.date
                }));
            }
        } catch { entries = []; }

        if (!el.isConnected) return;
        if (!entries.length) { el.classList.add('u-hidden'); el.innerHTML = ''; return; }

        const safeHref = (u) => window.safeUrl(u);
        el.innerHTML = `
            <div class="detail-sub">Recent changes <span class="clog-kind">${kind === 'release' ? 'Releases' : 'Commits'}</span></div>
            <ol class="clog">
                ${entries.map((e, i) => `
                    <li class="clog-item" style="--i:${i}">
                        <i class="clog-dot" aria-hidden="true"></i>
                        <div class="clog-body">
                            ${safeHref(e.url)
                                ? `<a href="${esc(safeHref(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.title || 'Untitled')}</a>`
                                : `<span>${esc(e.title || 'Untitled')}</span>`}
                            <small>
                                ${e.ref ? `<code>${esc(e.ref)}</code>` : ''}
                                ${e.date ? `<span>${esc(window.relativeTime(e.date))}</span>` : ''}
                            </small>
                        </div>
                    </li>`).join('')}
            </ol>`;
    }

    /* =====================================================================
       Reactions — five emoji, one vote each per visitor, counted at the edge.
       ===================================================================== */

    const EMOJI = [
        ['fire', '🔥', 'Fire'], ['clap', '👏', 'Applause'], ['mind', '🤯', 'Mind blown'],
        ['heart', '❤️', 'Love it'], ['idea', '💡', 'Clever']
    ];

    function reactionsHtml(slug) {
        return `<div class="reacts" data-reacts="${esc(slug)}">
            <div class="detail-sub">Reactions</div>
            <div class="reacts-row is-loading">
                ${EMOJI.map(() => '<span class="react react--ghost"></span>').join('')}
            </div>
        </div>`;
    }

    function paintReacts(box, slug, state) {
        const row = box.querySelector('.reacts-row') || box;
        row.classList.remove('is-loading');
        row.innerHTML = EMOJI.map(([key, glyph, label]) => {
            const n = Number(state.counts[key] || 0);
            const on = state.mine.has(key);
            return `<button type="button" class="react${on ? ' is-on' : ''}" data-react="${key}"
                        aria-pressed="${on}" aria-label="${label}: ${n}" title="${label}">
                        <span class="react-glyph">${glyph}</span>
                        <b>${n ? n.toLocaleString() : ''}</b>
                    </button>`;
        }).join('');
        row.dataset.slug = slug;
    }

    function burst(btn, glyph) {
        if (reduced()) return;
        const r = btn.getBoundingClientRect();
        for (let i = 0; i < 6; i++) {
            const bit = document.createElement('span');
            bit.className = 'react-bit';
            bit.textContent = glyph;
            const angle = (-90 + (i - 2.5) * 26) * (Math.PI / 180);
            const dist = 34 + Math.random() * 26;
            bit.style.left = `${r.left + r.width / 2}px`;
            bit.style.top = `${r.top + r.height / 2}px`;
            bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
            bit.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
            bit.style.setProperty('--rot', `${(Math.random() - 0.5) * 60}deg`);
            document.body.appendChild(bit);
            setTimeout(() => bit.remove(), 900);
        }
    }

    function mountReactions(root = document) {
        root.querySelectorAll('[data-reacts]').forEach((box) => {
            if (box.dataset.reactsOn === '1') return;
            if (!window.EDGE) { box.remove(); return; }
            box.dataset.reactsOn = '1';

            const slug = box.dataset.reacts;
            const state = { counts: {}, mine: new Set() };
            let busy = false;

            const absorb = (data) => {
                state.counts = (data && data.counts) || {};
                state.mine = new Set((data && data.mine) || []);
            };

            window.edgeFetch(`/api/reactions?p=${encodeURIComponent(slug)}`)
                .then((data) => { absorb(data); if (box.isConnected) paintReacts(box, slug, state); })
                .catch(() => { box.classList.add('u-hidden'); });

            box.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-react]');
                if (!btn || busy) return;
                const key = btn.dataset.react;
                const adding = !state.mine.has(key);

                // Optimistic: the count moves the instant it's pressed.
                const before = { counts: { ...state.counts }, mine: new Set(state.mine) };
                state.counts[key] = Math.max(0, Number(state.counts[key] || 0) + (adding ? 1 : -1));
                if (adding) state.mine.add(key); else state.mine.delete(key);
                paintReacts(box, slug, state);

                const fresh = box.querySelector(`[data-react="${key}"]`);
                if (fresh && adding) {
                    fresh.classList.add('is-popping');
                    burst(fresh, (EMOJI.find(([k]) => k === key) || [])[1] || '✨');
                }

                busy = true;
                try {
                    const data = await window.edgeFetch('/api/reactions', { method: 'POST', body: { p: slug, e: key } });
                    absorb(data);
                    paintReacts(box, slug, state);
                } catch (err) {
                    state.counts = before.counts;
                    state.mine = before.mine;
                    paintReacts(box, slug, state);
                    if (window.toast) {
                        window.toast(err.status === 429
                            ? 'Easy there — try again in a minute'
                            : 'Could not save that reaction', 'error');
                    }
                } finally {
                    busy = false;
                }
            });
        });
    }

    window.Widgets = {
        techMark,
        loadStatus, statusFor, statusChip,
        relatedProjects, relatedHtml,
        mountChangelog,
        reactionsHtml, mountReactions
    };
})();
