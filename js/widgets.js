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

    /* =====================================================================
       Device frames — every project is shown on the thing it runs on: a
       browser for the web, a window for Windows, a phone for Android and
       iOS. Pure CSS frames (css/showcase.css); the screen holds a real
       screenshot when there is one, and a designed fallback when there
       isn't, so an empty frame never looks broken.
       ===================================================================== */

    const P = () => window.PLATFORMS || {};
    const primaryPlatform = (p) => (window.platformsOf ? window.platformsOf(p)[0] : null) || 'web';
    const frameKind = (platform) => ((P()[platform] && P()[platform].frame) || 'web');

    const hostOf = (url) => {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    };

    /* Best image for a project's primary frame. Screenshot service only for
       things that have a live page to photograph. */
    function mediaFor(p, { w = 800, platform } = {}) {
        const pl = platform || primaryPlatform(p);
        const kind = frameKind(pl);
        const gallery = (Array.isArray(p.gallery) ? p.gallery : []).map(window.safeUrl).filter(Boolean);
        const cover = window.safeUrl(p.cover);
        const link = window.safeUrl(p.link);
        let src = null, shot = false;
        if (kind === 'phone') src = gallery[0] || cover || null;
        else src = cover || gallery[0] || null;
        // A site known to be down would only be photographed showing its
        // error page — keep the designed fallback instead.
        const live = (window.projectStatus && window.projectStatus(p.id))
            || (window.Meta && window.Meta.get && window.Meta.get(p.id) && window.Meta.get(p.id).web);
        const down = !!live && live.up === false;
        if (!src && kind !== 'phone' && link && window.EDGE && !down) {
            src = `/api/shot?p=${encodeURIComponent(window.projectSlug(p))}&w=${Math.max(320, Math.min(1600, w))}`;
            shot = true;
        }
        return { platform: pl, kind, src, shot, alt: (p.galleryAlt && p.galleryAlt[0]) || '' };
    }

    function appIconHtml(p, { size = 40, cls = '' } = {}) {
        const src = window.safeUrl(p && p.appIcon);
        if (src) {
            return `<span class="appicon ${cls}" style="--ai:${size}px;${window.toneVars(p.color)}">
                <img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
                     data-appicon>${window.icon(p.icon, { size: Math.round(size * 0.48) })}</span>`;
        }
        return `<span class="appicon appicon--glyph ${cls}" style="--ai:${size}px;${window.toneVars(p.color)}">${window.icon(p.icon, { size: Math.round(size * 0.48) })}</span>`;
    }

    /* What the screen shows when there is no image (or it fails to load). */
    function screenFallback(p, kind) {
        const title = esc(p.title || '');
        const icon = appIconHtml(p, { size: kind === 'phone' ? 46 : 52, cls: 'df-fb-icon' });
        const lines = '<span class="df-sk"><i></i><i></i><i></i></span>';
        return `<div class="df-fallback">${icon}<b>${title}</b>${kind === 'phone' ? lines : ''}</div>`;
    }

    /* Screenshot-service images go through a queue (below) instead of
       loading straight away: a page full of frames would otherwise open
       dozens of slow requests at once and starve everything else on the
       origin — including the page's own scripts on HTTP/1.1. */
    function screenImg(src, { alt = '', shot = false, eager = false } = {}) {
        if (!src) return '';
        if (shot) {
            return `<img class="df-img" data-shot-src="${esc(src)}" alt="${esc(alt)}" decoding="async" data-shot referrerpolicy="no-referrer">`;
        }
        return `<img class="df-img" src="${esc(src)}" alt="${esc(alt)}" ${eager ? '' : 'loading="lazy"'} decoding="async"
                     referrerpolicy="no-referrer">`;
    }

    /* ---- Screenshot queue: near the viewport, two at a time, 25s cap ---- */
    const shotQueue = [];
    let shotActive = 0;
    const SHOT_SLOTS = 2;
    const SHOT_TIMEOUT = 25000;

    function pumpShots() {
        while (shotActive < SHOT_SLOTS && shotQueue.length) {
            const img = shotQueue.shift();
            if (!img.isConnected || !img.dataset.shotSrc) continue;
            shotActive++;
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                shotActive--;
                clearTimeout(timer);
                pumpShots();
            };
            const timer = setTimeout(() => {
                // Too slow: give the slot back and keep the designed fallback.
                img.dataset.tries = '99';
                img.removeAttribute('src');
                img.classList.add('is-failed');
                done();
            }, SHOT_TIMEOUT);
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            img.src = img.dataset.shotSrc;
            delete img.dataset.shotSrc;
        }
    }

    /* An <img> with no src can measure as zero-size, so the observer watches
       the screen it sits in — that always has a real box. */
    const shotFor = new WeakMap();
    const shotIO = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (!e.isIntersecting) return;
            shotIO.unobserve(e.target);
            const img = shotFor.get(e.target);
            if (img) shotQueue.push(img);
        });
        pumpShots();
    }, { rootMargin: '300px 0px' }) : null;

    /* Picks up queued screenshots anywhere new markup lands. */
    function watchShots(root = document) {
        root.querySelectorAll('img[data-shot-src]').forEach((img) => {
            if (img.dataset.shotWatched) return;
            img.dataset.shotWatched = '1';
            const box = img.closest('.df-screen') || img.parentElement;
            if (shotIO && box) { shotFor.set(box, img); shotIO.observe(box); }
            else { shotQueue.push(img); pumpShots(); }
        });
    }
    if ('MutationObserver' in window) {
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => { pending = false; watchShots(document); });
        }).observe(document.documentElement, { childList: true, subtree: true });
    }

    /* frameHtml(p, opts) — opts: { platform, src, alt, kind, eager, w, inner } */
    function frameHtml(p, opts = {}) {
        const media = opts.src !== undefined
            ? { platform: opts.platform || primaryPlatform(p), kind: opts.kind || frameKind(opts.platform || primaryPlatform(p)), src: opts.src, shot: !!opts.shot, alt: opts.alt || '' }
            : mediaFor(p, opts);
        const kind = opts.kind || media.kind;
        const screen = opts.inner !== undefined
            ? opts.inner
            : `${screenFallback(p, kind)}${screenImg(media.src, { alt: media.alt, shot: media.shot, eager: opts.eager })}`;
        const tone = window.toneVars(p.color);

        if (kind === 'phone') {
            const ios = media.platform === 'ios';
            return `<div class="dframe dframe--phone ${ios ? 'is-ios' : 'is-android'}" style="${tone}">
                <div class="df-screen">${screen}</div>
                <i class="df-cam" aria-hidden="true"></i>
            </div>`;
        }
        if (kind === 'windows') {
            return `<div class="dframe dframe--windows" style="${tone}">
                <div class="df-bar" aria-hidden="true">
                    <span class="df-app">${window.icon(p.icon, { size: 11 })}</span>
                    <span class="df-title">${esc(p.title || '')}</span>
                    <span class="df-caps"><i></i><i></i><i></i></span>
                </div>
                <div class="df-screen">${screen}</div>
            </div>`;
        }
        const host = hostOf(window.safeUrl(p.link)) || 'arnavdugad.in';
        return `<div class="dframe dframe--web" style="${tone}">
            <div class="df-bar" aria-hidden="true">
                <span class="df-dots"><i></i><i></i><i></i></span>
                <span class="df-url">${window.icon('lock', { raw: true, size: 9 })}${esc(host)}</span>
            </div>
            <div class="df-screen">${screen}</div>
        </div>`;
    }

    /* Images: blur-up on load; screenshot-service images retry while the
       service is still rendering, then give up gracefully to the fallback. */
    document.addEventListener('load', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (img.classList.contains('df-img')) {
            img.classList.add('is-loaded');
            const frame = img.closest('.dframe');
            if (frame) {
                frame.classList.add('has-img');
                // A tall image in a landscape frame reads better as a phone.
                if (frame.dataset.autoKind === '1' && img.naturalHeight > img.naturalWidth * 1.3) frame.classList.add('is-portrait-shot');
            }
        }
        if (img.hasAttribute('data-appicon')) img.closest('.appicon')?.classList.add('has-img');
    }, true);

    document.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (img.hasAttribute('data-appicon')) { img.remove(); return; }
        if (!img.classList.contains('df-img')) return;
        const tries = Number(img.dataset.tries || 0);
        if (img.hasAttribute('data-shot') && tries < 2) {
            img.dataset.tries = String(tries + 1);
            // The service may still be rendering: re-queue a little later.
            const u = new URL(img.src, location.href);
            u.searchParams.set('r', String(tries + 1));
            setTimeout(() => {
                if (!img.isConnected) return;
                img.dataset.shotSrc = u.pathname + u.search;
                shotQueue.push(img);
                pumpShots();
            }, 9000 * (tries + 1));
            return;
        }
        img.classList.add('is-failed');
    }, true);

    /* =====================================================================
       Platform glyphs, metric chips
       ===================================================================== */

    function platformGlyphs(p, { labels = false, size = 14 } = {}) {
        const list = window.platformsOf ? window.platformsOf(p) : [];
        if (!list.length) return '';
        return `<span class="pglyphs">${list.map((k) => {
            const def = P()[k];
            return `<span class="pglyph" title="${esc(def.label)}">${window.icon(def.icon, { raw: true, size })}${labels ? `<span>${esc(def.short)}</span>` : '<span class="u-sr">' + esc(def.label) + '</span>'}</span>`;
        }).join('')}</span>`;
    }

    const M = () => window.Meta || null;

    /* ★ stars · ⬇ downloads · ⚡ performance · version. Empty string when
       there is nothing true to say — never a row of zeroes. */
    function metricsHtml(p, { compact = false } = {}) {
        if (!M()) return '';
        const chips = [];
        const s = M().stars(p);
        if (s) chips.push(`<span class="mchip" title="GitHub stars">${window.icon('star', { raw: true, size: 12 })}${window.formatCount(s)}</span>`);
        const d = M().downloads(p);
        if (d) chips.push(`<span class="mchip" title="Downloads">${window.icon('download', { raw: true, size: 12 })}${window.formatCount(d)}</span>`);
        const ps = M().psi(p);
        if (ps && Number.isFinite(ps.performance)) {
            chips.push(`<span class="mchip mchip--perf ${scoreClass(ps.performance)}" title="Lighthouse performance (mobile)">${window.icon('bolt', { raw: true, size: 12 })}${ps.performance}</span>`);
        }
        const r = M().release(p);
        if (r && r.version && !compact) {
            chips.push(`<span class="mchip mchip--ver" title="Latest release${r.date ? ` · ${new Date(r.date).toLocaleDateString()}` : ''}">v${esc(r.version)}${r.date ? ` · ${esc(shortAgo(r.date))}` : ''}</span>`);
        }
        return chips.length ? `<span class="mchips">${chips.join('')}</span>` : '';
    }

    const scoreClass = (n) => (n >= 90 ? 'is-good' : n >= 50 ? 'is-ok' : 'is-poor');

    function shortAgo(t) {
        const s = Math.max(1, Math.floor((Date.now() - Number(t)) / 1000));
        const units = [['y', 31536000], ['mo', 2592000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]];
        for (const [u, n] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
        return 'just now';
    }

    /* =====================================================================
       Lighthouse rings + commit activity
       ===================================================================== */

    function ringsHtml(psi) {
        if (!psi) return '';
        const items = [
            ['performance', 'Performance'], ['accessibility', 'Accessibility'],
            ['bestPractices', 'Best practices'], ['seo', 'SEO']
        ].filter(([k]) => Number.isFinite(psi[k]));
        if (!items.length) return '';
        const C = 2 * Math.PI * 20;
        return `<div class="rings" role="list">${items.map(([k, label], i) => {
            const v = Math.max(0, Math.min(100, Math.round(psi[k])));
            return `<div class="ring ${scoreClass(v)}" role="listitem" style="--i:${i};--off:${(C * (1 - v / 100)).toFixed(2)};--c:${C.toFixed(2)}">
                <svg viewBox="0 0 48 48" aria-hidden="true"><circle class="ring-track" cx="24" cy="24" r="20"/><circle class="ring-fill" cx="24" cy="24" r="20"/></svg>
                <b>${v}</b><span>${label}</span>
            </div>`;
        }).join('')}</div>`;
    }

    function commitStripHtml(weeks) {
        const w = (Array.isArray(weeks) ? weeks : []).slice(-52).map((n) => Math.max(0, Number(n) || 0));
        if (!w.length || !w.some(Boolean)) return '';
        const max = Math.max(...w);
        const total = w.reduce((a, b) => a + b, 0);
        const bw = 6, gap = 2, h = 40;
        const bars = w.map((n, i) => {
            const bh = n ? Math.max(3, Math.round((n / max) * h)) : 2;
            return `<rect x="${i * (bw + gap)}" y="${h - bh}" width="${bw}" height="${bh}" rx="1.5" class="${n ? 'on' : 'off'}" style="--i:${i}"><title>${n} commit${n === 1 ? '' : 's'}</title></rect>`;
        }).join('');
        return `<div class="cstrip">
            <svg viewBox="0 0 ${w.length * (bw + gap) - gap} ${h}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>
            <p><b>${total.toLocaleString()}</b> commit${total === 1 ? '' : 's'} in the last year</p>
        </div>`;
    }

    /* =====================================================================
       "Get it" — the install panel. The leading button is whatever fits the
       visitor's own device; Android installs can be handed to a phone by QR.
       ===================================================================== */

    const STORE_DEFS = {
        play:      { label: 'Google Play',       pre: 'Get it on',         icon: 'android', platform: 'android' },
        appstore:  { label: 'App Store',         pre: 'Download on the',   icon: 'apple',   platform: 'ios' },
        microsoft: { label: 'Microsoft Store',   pre: 'Get it from',       icon: 'windows', platform: 'windows' },
        chrome:    { label: 'Chrome Web Store',  pre: 'Available in the',  icon: 'chrome',  platform: 'extension' },
        firefox:   { label: 'Firefox Add-ons',   pre: 'Get the add-on',    icon: 'globe',   platform: 'extension' },
        itch:      { label: 'itch.io',           pre: 'Available on',      icon: 'gamepad', platform: null }
    };

    function getItOptions(p) {
        const opts = [];
        (Array.isArray(p.downloads) ? p.downloads : []).forEach((d) => {
            const url = window.safeUrl(d && d.url);
            if (!url) return;
            const pl = String(d.platform || '').toLowerCase();
            opts.push({
                type: 'download', platform: pl, url,
                title: `Download for ${(P()[pl] && P()[pl].label) || d.label || 'your device'}`,
                label: d.label || (P()[pl] && P()[pl].label) || 'Download',
                size: Number(d.size) || 0, count: Number(d.count) || 0,
                version: d.version || '', arch: d.arch || '',
                file: url.split('/').pop()
            });
        });
        const stores = p.stores && typeof p.stores === 'object' ? p.stores : {};
        Object.entries(STORE_DEFS).forEach(([key, def]) => {
            const url = window.safeUrl(stores[key]);
            if (url) opts.push({ type: 'store', key, platform: def.platform, url, title: `${def.pre} ${def.label}`, label: def.label, icon: def.icon, pre: def.pre });
        });
        const link = window.safeUrl(p.link);
        if (link && (window.platformsOf(p).includes('web') || !opts.length)) {
            opts.push({ type: 'web', platform: 'web', url: link, title: 'Open in your browser', label: hostOf(link) });
        }
        return opts;
    }

    /* The visitor's own device first; failing that, the project's main
       platform (an Android app should lead with Android, even on a PC —
       the QR hands it to the phone); the website only after that. */
    function pickPrimary(opts, vp, plats = []) {
        const byPl = (pl) => opts.find((o) => o.type === 'store' && o.platform === pl)
            || opts.find((o) => o.type === 'download' && o.platform === pl);
        const main = plats.find((k) => k !== 'web');
        return byPl(vp)
            || (main ? byPl(main) : null)
            || opts.find((o) => o.type === 'web')
            || opts[0] || null;
    }

    /* The one option to lead with, for this visitor (shared by the spotlight
       CTA and the Get-it panel so they never disagree). */
    function primaryOption(p) {
        const vp = window.visitorPlatform ? window.visitorPlatform() : 'other';
        return pickPrimary(getItOptions(p), vp, window.platformsOf(p));
    }

    function getItHtml(p) {
        const opts = getItOptions(p);
        // A website alone needs no install panel — "Visit live" says it all.
        if (!opts.some((o) => o.type !== 'web')) return '';
        const vp = window.visitorPlatform ? window.visitorPlatform() : 'other';
        const primary = pickPrimary(opts, vp, window.platformsOf(p));
        const rest = opts.filter((o) => o !== primary);

        const metaLine = (o) => [o.version && `v${String(o.version).replace(/^v/i, '')}`, o.arch, window.formatBytes(o.size), o.count ? `${window.formatCount(o.count)} downloads` : '']
            .filter(Boolean).join(' · ');

        const primaryBtn = primary ? `
            <a class="getit-primary" href="${esc(primary.url)}" ${primary.type === 'download' ? 'download' : 'target="_blank" rel="noopener noreferrer"'}
               data-cursor="${primary.type === 'download' ? 'Get' : 'Open'}" data-getit="${esc(primary.type)}">
                <span class="getit-glyph">${window.icon(primary.type === 'store' ? primary.icon : ((P()[primary.platform] || {}).icon || 'download'), { raw: true, size: 22 })}</span>
                <span class="getit-text">
                    <small>${primary.type === 'store' ? esc(primary.pre) : (primary.type === 'download' ? (vp === primary.platform ? 'For this device' : 'Download') : 'No install needed')}</small>
                    <b>${esc(primary.type === 'store' ? primary.label : (primary.type === 'web' ? 'Open in your browser' : primary.title.replace(/^Download /, '')))}</b>
                    ${primary.type === 'download' && metaLine(primary) ? `<em>${esc(metaLine(primary))}</em>` : ''}
                </span>
                <span class="getit-go">${window.icon(primary.type === 'download' ? 'download' : 'external', { raw: true, size: 16 })}</span>
            </a>` : '';

        const others = rest.length ? `<ul class="getit-list">${rest.map((o) => `
            <li><a href="${esc(o.url)}" ${o.type === 'download' ? 'download' : 'target="_blank" rel="noopener noreferrer"'} class="getit-row">
                <span class="getit-row-ic">${window.icon(o.type === 'store' ? o.icon : ((P()[o.platform] || {}).icon || 'globe'), { raw: true, size: 15 })}</span>
                <span class="getit-row-tx"><b>${esc(o.type === 'store' ? `${o.pre} ${o.label}` : o.title)}</b>${o.type === 'download' && metaLine(o) ? `<small>${esc(metaLine(o))}</small>` : (o.type === 'web' ? `<small>${esc(o.label)}</small>` : '')}</span>
                ${window.icon(o.type === 'download' ? 'download' : 'external', { raw: true, size: 14 })}
            </a></li>`).join('')}</ul>` : '';

        // Hand an Android or iOS install to a phone when we're not on one.
        let qr = '';
        const phoneTarget = (vp !== 'android' && (opts.find((o) => o.type === 'store' && o.key === 'play') || opts.find((o) => o.type === 'download' && o.platform === 'android')))
            || (vp !== 'ios' && opts.find((o) => o.type === 'store' && o.key === 'appstore'));
        if (phoneTarget && window.QR) {
            const code = window.QR.svg(phoneTarget.url, { label: `QR code to install ${p.title} on a phone` });
            if (code) {
                qr = `<figure class="getit-qr">
                    <div class="getit-qr-code">${code}</div>
                    <figcaption><b>Scan to install</b><span>on your ${phoneTarget.platform === 'ios' ? 'iPhone' : 'Android phone'}</span></figcaption>
                </figure>`;
            }
        }

        const totalDl = M() ? M().downloads(p) : 0;
        return `<section class="getit ${qr ? 'has-qr' : ''}" aria-label="Get ${esc(p.title)}">
            <div class="getit-main">
                <div class="detail-sub">Get it${totalDl ? ` <span class="getit-count">${window.formatCount(totalDl)} downloads</span>` : ''}</div>
                ${primaryBtn}
                ${others}
            </div>
            ${qr}
        </section>`;
    }

    function storeBadgesHtml(p) {
        const stores = p.stores && typeof p.stores === 'object' ? p.stores : {};
        const items = Object.entries(STORE_DEFS).filter(([k]) => window.safeUrl(stores[k]));
        if (!items.length) return '';
        return `<div class="sbadges">${items.map(([k, def]) => `
            <a class="sbadge" href="${esc(window.safeUrl(stores[k]))}" target="_blank" rel="noopener noreferrer">
                ${window.icon(def.icon, { raw: true, size: 18 })}<span><small>${esc(def.pre)}</small><b>${esc(def.label)}</b></span>
            </a>`).join('')}</div>`;
    }

    /* =====================================================================
       Gallery — a device-framed slideshow: live site first (web), then every
       screenshot, each in the frame its shape asks for. Swipe, arrows, dots.
       ===================================================================== */

    function galleryHtml(p, { live = '' } = {}) {
        const pl = primaryPlatform(p);
        const kind = frameKind(pl);
        const shots = (Array.isArray(p.gallery) ? p.gallery : []).map(window.safeUrl).filter(Boolean);
        const alts = Array.isArray(p.galleryAlt) ? p.galleryAlt : [];
        const cover = window.safeUrl(p.cover);
        const slides = [];

        // A website leads with itself, running; an app leads with its own
        // screens and keeps the website as the last slide.
        const liveSlide = live ? frameHtml(p, { kind: 'web', platform: 'web', inner: live }) : '';
        if (liveSlide && pl === 'web') slides.push(liveSlide);
        if (cover && !shots.includes(cover)) slides.push(frameHtml(p, { src: cover, kind: kind === 'phone' ? 'web' : kind, eager: !slides.length }));
        if (kind === 'phone' && shots.length > 1) {
            // App-store style: phones three to a slide, gently fanned.
            for (let i = 0; i < shots.length; i += 3) {
                const group = shots.slice(i, i + 3);
                slides.push(`<div class="dgal-phones" data-count="${group.length}">${group.map((src, j) =>
                    frameHtml(p, { src, alt: alts[i + j] || `${p.title} screenshot ${i + j + 1}`, eager: !slides.length && j === 0 })).join('')}</div>`);
            }
        } else {
            shots.forEach((src, i) => slides.push(frameHtml(p, { src, alt: alts[i] || `${p.title} screenshot ${i + 1}`, eager: !slides.length && i === 0 })));
        }
        if (liveSlide && pl !== 'web') slides.push(liveSlide);
        if (!slides.length) {
            const m = mediaFor(p, { w: 1200 });
            slides.push(frameHtml(p, { ...m, eager: true }));
        }

        return `<div class="dgal ${kind === 'phone' ? 'is-phone' : ''}" data-gallery tabindex="0" aria-roledescription="carousel" aria-label="${esc(p.title)} screens">
            <div class="dgal-track">${slides.map((s, i) => `<div class="dgal-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">${s}</div>`).join('')}</div>
            ${slides.length > 1 ? `
                <button type="button" class="dgal-nav dgal-nav--prev" data-gal="-1" aria-label="Previous screen">${window.icon('chev-left', { raw: true, size: 16 })}</button>
                <button type="button" class="dgal-nav dgal-nav--next" data-gal="1" aria-label="Next screen">${window.icon('chev-right', { raw: true, size: 16 })}</button>
                <div class="dgal-dots">${slides.map((_, i) => `<button type="button" data-gal-to="${i}" aria-label="Screen ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('')}</div>` : ''}
        </div>`;
    }

    function mountGallery(root) {
        root.querySelectorAll('[data-gallery]').forEach((gal) => {
            if (gal.dataset.galOn === '1') return;
            gal.dataset.galOn = '1';
            const track = gal.querySelector('.dgal-track');
            const slides = Array.from(gal.querySelectorAll('.dgal-slide'));
            // A lone slide is always the current one — otherwise its live
            // iframe stays hidden by the "only the visible slide runs" rule.
            if (slides.length < 2) { slides.forEach((s) => s.classList.add('is-current')); return; }
            let at = 0;

            const go = (i, { instant = false } = {}) => {
                at = (i + slides.length) % slides.length;
                track.style.transition = instant || reduced() ? 'none' : '';
                track.style.transform = `translateX(${-at * 100}%)`;
                gal.querySelectorAll('[data-gal-to]').forEach((d, n) => {
                    if (n === at) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
                });
                // The live iframe only runs while it is on screen.
                slides.forEach((s, n) => s.classList.toggle('is-current', n === at));
            };
            go(0, { instant: true });

            gal.addEventListener('click', (e) => {
                const step = e.target.closest('[data-gal]');
                if (step) { e.stopPropagation(); go(at + Number(step.dataset.gal)); return; }
                const dot = e.target.closest('[data-gal-to]');
                if (dot) { e.stopPropagation(); go(Number(dot.dataset.galTo)); }
            });
            gal.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(at - 1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(at + 1); }
            });

            // Swipe with a little rubber-banding at the ends.
            let sx = null, sy = null, dx = 0, horiz = null;
            gal.addEventListener('pointerdown', (e) => {
                if (e.target.closest('button, a, iframe')) return;
                sx = e.clientX; sy = e.clientY; dx = 0; horiz = null;
            });
            gal.addEventListener('pointermove', (e) => {
                if (sx === null) return;
                dx = e.clientX - sx;
                const dy = e.clientY - sy;
                if (horiz === null && Math.hypot(dx, dy) > 8) horiz = Math.abs(dx) > Math.abs(dy);
                if (!horiz) return;
                const edge = (at === 0 && dx > 0) || (at === slides.length - 1 && dx < 0);
                track.style.transition = 'none';
                track.style.transform = `translateX(calc(${-at * 100}% + ${edge ? dx * 0.3 : dx}px))`;
            });
            const end = () => {
                if (sx === null) return;
                const moved = horiz && Math.abs(dx) > 50;
                sx = null;
                track.style.transition = '';
                go(moved ? at + (dx < 0 ? 1 : -1) : at);
            };
            gal.addEventListener('pointerup', end);
            gal.addEventListener('pointercancel', end);
            gal.addEventListener('pointerleave', end);
        });
    }

    window.Widgets = {
        techMark,
        loadStatus, statusFor, statusChip,
        relatedProjects, relatedHtml,
        mountChangelog,
        reactionsHtml, mountReactions,
        // v2 showcase
        mediaFor, frameHtml, appIconHtml, platformGlyphs, metricsHtml,
        ringsHtml, commitStripHtml, getItHtml, getItOptions, primaryOption, storeBadgesHtml,
        galleryHtml, mountGallery, shortAgo, scoreClass, primaryPlatform
    };
})();
