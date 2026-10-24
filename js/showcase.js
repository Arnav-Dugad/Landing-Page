/* ===========================================================================
   showcase.js  (classic script — after render.js and views.js)
   The parts of the page that present the body of work as a whole:

     · living wall      the hero's tilted plane of real projects, each in
                        the device it runs on, drifting in counter-scrolling
                        columns with cursor parallax
     · shipping now     the latest public GitHub activity, rotating
     · platform bar     All / Web / Windows / Android / … with a morphing
                        indicator; filters the whole work area
     · spotlight        the featured bento — a cycling lead tile, the latest
                        release, the platform mix and live uptime

   Everything is derived from the same project list the grid uses, plus
   window.Meta and the Worker's /api/activity. Nothing here is hardcoded.
   Showcase.sync() is called by render.js whenever the data changes.
   =========================================================================== */

(() => {
    const esc = window.esc;
    const W = () => window.Widgets;
    const M = () => window.Meta;
    const projects = () => (window.listProjects ? window.listProjects() : []);
    const reduced = () => !!(window.motionReduced && window.motionReduced());
    const FINE = window.matchMedia('(hover: hover) and (pointer: fine)');
    const PL = () => window.PLATFORMS;

    /* A rough "how much is there to show" score — used to choose what goes
       on the wall and in the spotlight when nothing is marked featured. */
    function showScore(p) {
        const m = M() && M().get(p.id);
        const stars = (m && m.github && m.github.stars) || 0;
        const dl = M() ? M().downloads(p) : 0;
        const media = (p.cover || (p.gallery || []).length) ? 3 : (window.safeUrl(p.link) ? 1 : 0);
        const fresh = p.createdAt ? Math.max(0, 2 - (Date.now() - p.createdAt) / (180 * 864e5)) : 0;
        return stars * 1.5 + Math.log10(1 + dl) * 4 + media + fresh + (p.featured ? 6 : 0)
            + (window.platformsOf(p).some((k) => k !== 'web') ? 2 : 0);
    }

    /* A site the uptime check says is down shouldn't lead the page (its
       "Open it" button would go nowhere) — it drops out of the spotlight and
       to the back of the wall until it's back. */
    const isDown = (p) => {
        const s = (window.projectStatus && window.projectStatus(p.id)) || (M() && M().get(p.id) && M().get(p.id).web);
        return !!s && s.up === false && !window.platformsOf(p).some((k) => k !== 'web');
    };

    let lastKey = '';

    function sync({ force = false } = {}) {
        const list = projects();
        if (!list.length) return;
        // Rebuild only when the set of projects (or their media) changed —
        // re-rendering the wall on every filter click would restart it.
        const key = list.map((p) => `${p.id}:${p.updatedAt || ''}:${p.featured ? 1 : 0}:${isDown(p) ? 'd' : ''}`).join('|') + (M() && M().isReady() ? ':m' : '');
        paintPlatbar();
        if (key === lastKey && !force) return;
        lastKey = key;
        paintWall(list);
        paintSpotlight(list);
        paintReleases();
    }

    /* =====================================================================
       Living wall
       ===================================================================== */

    const wall = document.getElementById('heroWall');
    let wallBuilt = false;

    function wallItems(list) {
        const ranked = list.slice().sort((a, b) => (isDown(a) ? 1 : 0) - (isDown(b) ? 1 : 0) || showScore(b) - showScore(a));
        // Interleave platforms so a column never reads as one kind of thing.
        const byKind = {};
        ranked.forEach((p) => {
            const k = W().mediaFor(p).kind;
            (byKind[k] = byKind[k] || []).push(p);
        });
        const out = [];
        const kinds = Object.keys(byKind);
        while (out.length < 15 && kinds.some((k) => byKind[k].length)) {
            kinds.forEach((k) => { if (byKind[k].length && out.length < 15) out.push(byKind[k].shift()); });
        }
        return out;
    }

    function tileHtml(p, i) {
        return `<button type="button" class="wall-tile" data-open="${esc(p.id)}" data-platforms="${esc(window.platformsOf(p).join(' '))}" tabindex="-1" style="--i:${i}" title="${esc(p.title)}">
            ${W().frameHtml(p, { w: 640 })}
            <span class="wall-cap">${esc(p.title)}</span>
        </button>`;
    }

    function paintWall(list) {
        if (!wall || !W()) return;
        const items = wallItems(list);
        if (items.length < 3) { wall.innerHTML = ''; return; }

        const cols = [[], [], []];
        items.forEach((p, i) => cols[i % 3].push(p));
        // Each column holds its tiles twice, so translating by -50% loops seamlessly.
        wall.innerHTML = `
            <div class="wall-plane">
                ${cols.map((c, ci) => `
                    <div class="wall-col" style="--dur:${58 + ci * 11}s" data-dir="${ci % 2 ? 'down' : 'up'}">
                        <div class="wall-track">
                            ${c.map(tileHtml).join('')}
                            ${c.map(tileHtml).join('')}
                        </div>
                    </div>`).join('')}
            </div>
            <div class="wall-row" aria-hidden="true">
                <div class="wall-track">
                    ${items.slice(0, 8).map(tileHtml).join('')}
                    ${items.slice(0, 8).map(tileHtml).join('')}
                </div>
            </div>`;
        wall.classList.add('is-ready');
        reactWall(window.PState ? window.PState.platform : 'all', { instant: true });

        if (!wallBuilt) {
            wallBuilt = true;
            wireWall();
        }
    }

    /* The wall answers the platform switcher: matching devices step forward,
       the rest sink back, and the columns give a little shuffle as if the
       deck were being re-sorted. */
    function reactWall(platform, { instant = false } = {}) {
        if (!wall) return;
        const all = platform === 'all';
        wall.classList.toggle('is-filtered', !all);
        wall.querySelectorAll('.wall-tile').forEach((t) => {
            const match = all || String(t.dataset.platforms || '').split(' ').includes(platform);
            t.classList.toggle('is-match', !all && match);
            t.classList.toggle('is-dim', !all && !match);
        });
        if (instant || reduced()) return;
        wall.querySelectorAll('.wall-col, .wall-row').forEach((col, i) => {
            if (!col.animate) return;
            col.animate([
                { transform: 'translateY(0)' },
                { transform: `translateY(${i % 2 ? 18 : -18}px)` },
                { transform: 'translateY(0)' }
            ], { duration: 720, easing: 'cubic-bezier(.34,1.42,.64,1)', delay: i * 60 });
        });
    }
    window.addEventListener('platformchange', (e) => reactWall((e.detail && e.detail.platform) || 'all'));

    function wireWall() {
        wall.addEventListener('click', (e) => {
            const tile = e.target.closest('[data-open]');
            // The tile's device flies into the detail sheet (render.js).
            if (tile) window.openProject(tile.dataset.open, { from: tile });
        });

        if (reduced() || !FINE.matches) return;
        // Cursor parallax on the whole plane — springy, never snapping.
        // The transform is written straight onto the plane: custom properties
        // on the wall would be inherited by all ~46 tiles and restyle every
        // one of them each frame (that made the cursor itself stutter).
        let tx = 0, ty = 0, x = 0, y = 0, stop = null;
        const run = () => {
            x += (tx - x) * 0.06;
            y += (ty - y) * 0.06;
            const plane = wall.querySelector('.wall-plane');
            if (plane) {
                plane.style.transform = `rotateX(${(22 - y * 3).toFixed(2)}deg) rotateY(${(-24 + x * 4).toFixed(2)}deg) rotateZ(9deg)`;
            }
            if (Math.abs(tx - x) < 0.001 && Math.abs(ty - y) < 0.001 && stop) { stop(); stop = null; }
        };
        window.addEventListener('pointermove', (e) => {
            if (window.scrollY > window.innerHeight) return;
            tx = (e.clientX / window.innerWidth - 0.5) * 2;
            ty = (e.clientY / window.innerHeight - 0.5) * 2;
            if (!stop && window.onFrame) stop = window.onFrame(run);
        }, { passive: true });
    }

    /* =====================================================================
       Shipping now — the latest public activity, one line at a time
       ===================================================================== */

    const ship = document.getElementById('heroShip');
    const shipRoll = document.getElementById('heroShipRoll');

    async function loadActivity() {
        if (!ship || !window.EDGE) return;
        let items = [];
        try {
            const data = await window.edgeFetch('/api/activity');
            items = (data && data.items) || [];
        } catch { items = []; }

        const byRepo = (repo) => {
            const name = String(repo || '').split('/').pop().toLowerCase();
            return projects().find((p) => {
                const r = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
                return r && r.toLowerCase().endsWith(`/${name}`);
            }) || null;
        };

        // Releases lead: a shipped version says more than a push. Fresh
        // releases from meta join in even if the event feed has rolled past.
        let fresh = [];
        try {
            fresh = ((await (M() ? M().releases() : Promise.resolve([]))) || [])
                .filter((r) => r.isNew)
                .map((r) => ({ type: 'release', repo: '', title: `v${r.tag}`, url: r.url, at: r.date, projectId: r.projectId }));
        } catch { fresh = []; }
        const merged = [...fresh, ...items.filter((it) => it && it.type === 'release'), ...items.filter((it) => it && it.type !== 'release')];

        const lines = merged
            .filter((it) => it && it.type !== 'star' && it.at)
            .map((it) => {
                const p = it.projectId ? projects().find((x) => String(x.id) === String(it.projectId)) : byRepo(it.repo);
                const name = p ? p.title : String(it.repo || '').split('/').pop();
                const verb = { release: 'Released', push: 'Pushed to', create: 'Started' }[it.type] || 'Updated';
                const title = String(it.title || '');
                const tail = title.toLowerCase().startsWith(name.toLowerCase()) ? title.slice(name.length).trim() : title;
                const what = it.type === 'release' && title ? `${name} ${tail}` : name;
                return { text: `${verb} ${what}`, when: W().shortAgo(it.at), id: p ? p.id : null, url: window.safeUrl(it.url) };
            })
            .filter((l, n, a) => a.findIndex((x) => x.text === l.text) === n)
            .slice(0, 6);
        if (!lines.length) return;

        let i = 0;
        const show = () => {
            const l = lines[i % lines.length];
            const el = document.createElement('span');
            el.className = 'ship-line';
            el.innerHTML = l.id
                ? `<button type="button" data-open="${esc(l.id)}">${esc(l.text)}</button><time>${esc(l.when)}</time>`
                : `<a href="${esc(l.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(l.text)}</a><time>${esc(l.when)}</time>`;
            const old = shipRoll.querySelector('.ship-line:not(.is-out)');
            if (old) {
                old.classList.add('is-out');
                setTimeout(() => old.remove(), 600);
            }
            shipRoll.appendChild(el);
            i++;
        };
        show();
        ship.hidden = false;
        if (window.Motion) window.Motion.reveal(ship.parentElement);
        if (lines.length > 1 && !reduced()) setInterval(() => { if (!document.hidden) show(); }, 4600);

        shipRoll.addEventListener('click', (e) => {
            const b = e.target.closest('[data-open]');
            if (b) window.openProject(b.dataset.open);
        });
    }

    /* =====================================================================
       Platform bar
       ===================================================================== */

    const bar = document.getElementById('platbar');
    let barKey = '';

    function paintPlatbar() {
        if (!bar) return;
        const counts = {};
        projects().forEach((p) => window.platformsOf(p).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
        const keys = Object.keys(PL()).filter((k) => counts[k]);
        const state = window.PState;

        // One platform is not a choice — don't show a switch with one position.
        if (keys.length < 2) {
            bar.innerHTML = '';
            bar.classList.add('u-hidden');
            if (state.platform !== 'all') { state.platform = 'all'; }
            return;
        }
        bar.classList.remove('u-hidden');

        const key = keys.map((k) => `${k}${counts[k]}`).join();
        if (key !== barKey) {
            barKey = key;
            bar.innerHTML = `
                <span class="platbar-blob" aria-hidden="true"></span>
                <button type="button" class="plat" data-platform="all" aria-pressed="false">
                    ${window.icon('blocks', { raw: true, size: 17 })}<span>Everything</span><b>${projects().length}</b>
                </button>
                ${keys.map((k) => `
                    <button type="button" class="plat" data-platform="${k}" aria-pressed="false">
                        ${window.icon(PL()[k].icon, { raw: true, size: 17 })}<span>${esc(PL()[k].noun)}</span><b>${counts[k]}</b>
                    </button>`).join('')}`;
        }

        bar.querySelectorAll('.plat').forEach((b) => {
            const on = b.dataset.platform === state.platform;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        moveBlob(false);
    }

    /* The indicator travels like a drop of ink: it stretches toward the
       target, then settles into it. */
    let blobFrom = null;
    function moveBlob(animate = true) {
        const blob = bar && bar.querySelector('.platbar-blob');
        const active = bar && bar.querySelector('.plat.is-active');
        if (!blob || !active) return;
        const to = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
        const place = (r) => `translate(${r.x}px, ${r.y}px)`;

        if (animate && blobFrom && !reduced() && blob.animate) {
            const left = Math.min(blobFrom.x, to.x);
            const right = Math.max(blobFrom.x + blobFrom.w, to.x + to.w);
            const mid = { x: left, y: to.y, w: right - left, h: to.h * 0.86 };
            blob.animate([
                { transform: place(blobFrom), width: `${blobFrom.w}px`, height: `${blobFrom.h}px` },
                { transform: `${place(mid)} translateY(${to.h * 0.07}px)`, width: `${mid.w}px`, height: `${mid.h}px`, offset: 0.45 },
                { transform: place(to), width: `${to.w}px`, height: `${to.h}px` }
            ], { duration: 560, easing: 'cubic-bezier(.3,1.25,.4,1)' });
        }
        blob.style.transform = place(to);
        blob.style.width = `${to.w}px`;
        blob.style.height = `${to.h}px`;
        blob.style.opacity = '1';
        blobFrom = to;
    }

    if (bar) {
        bar.addEventListener('click', (e) => {
            const b = e.target.closest('.plat');
            if (!b) return;
            const key = b.dataset.platform;
            if (key === window.PState.platform) return;
            window.setPlatform(key);
            requestAnimationFrame(() => moveBlob(true));
        });
        window.addEventListener('resize', () => moveBlob(false), { passive: true });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveBlob(false));
    }

    /* =====================================================================
       Spotlight bento
       ===================================================================== */

    const spot = document.getElementById('spotlight');
    let cycleTimer = null;

    function featuredSet(list) {
        const live = list.filter((p) => !isDown(p));
        const usable = live.length >= 2 ? live : list;
        const marked = usable.filter((p) => p.featured);
        const pool = (marked.length >= 2 ? marked : usable).slice()
            .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || showScore(b) - showScore(a));
        return pool.slice(0, 5);
    }

    /* The single most useful action for a project, for this visitor. */
    function ctaFor(p) {
        const best = W().primaryOption(p);
        if (!best) return '';
        const isDl = best.type === 'download';
        const label = best.type === 'web' ? 'Open it'
            : best.type === 'store' ? best.label
            : `Download for ${(PL()[best.platform] || {}).short || 'your device'}`;
        return `<a class="btn btn--primary magnetic" href="${esc(best.url)}" ${isDl ? 'download' : 'target="_blank" rel="noopener noreferrer"'} data-cursor="${isDl ? 'Get' : 'Open'}">
            ${window.icon(isDl ? 'download' : (best.type === 'store' ? best.icon : 'external'), { raw: true, size: 16 })} ${esc(label)}${isDl && best.size ? ` <small>${esc(window.formatBytes(best.size))}</small>` : ''}</a>`;
    }

    function leadSlide(p, i) {
        const kind = W().mediaFor(p).kind;
        return `
            <div class="spot-slide ${i === 0 ? 'is-current' : ''} spot-slide--${kind}" data-id="${esc(p.id)}" data-slide="${i}" style="${window.toneVars(p.color)}" ${i ? 'aria-hidden="true"' : ''}>
                <div class="spot-media">${W().frameHtml(p, { w: 1200, eager: i === 0 })}</div>
                <div class="spot-text">
                    <div class="spot-kicker">
                        <span>${p.featured ? 'Featured' : 'Spotlight'}</span>
                        ${W().platformGlyphs(p, { labels: true, size: 12 })}
                    </div>
                    <div class="spot-name">
                        <span class="spot-icon">${W().appIconHtml(p, { size: 44 })}</span>
                        <h3 class="spot-title"><button type="button" data-open="${esc(p.id)}" data-cursor="Open">${esc(p.title)}</button></h3>
                    </div>
                    <p class="spot-line">${esc(p.tagline || p.desc)}</p>
                    ${W().metricsHtml(p)}
                    <div class="spot-cta">
                        ${ctaFor(p)}
                        <button type="button" class="btn btn--ghost" data-open="${esc(p.id)}">${window.icon('arrow-right', { raw: true, size: 16 })} Details</button>
                    </div>
                </div>
            </div>`;
    }

    function latestTile(list) {
        // Prefer a real release; otherwise the newest project.
        const withRel = list.map((p) => ({ p, r: M() && M().release(p) }))
            .filter((x) => x.r && x.r.date)
            .sort((a, b) => b.r.date - a.r.date)[0];
        const p = withRel ? withRel.p : list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        if (!p) return '';
        const kicker = withRel ? `Latest release · v${esc(withRel.r.version)}` : 'Newest';
        const when = withRel ? W().shortAgo(withRel.r.date) : (p.createdAt ? W().shortAgo(p.createdAt) : '');
        return `
            <article class="spot-tile spot-latest" data-id="${esc(p.id)}" style="${window.toneVars(p.color)}">
                <div class="spot-latest-media">${W().frameHtml(p, { w: 640 })}</div>
                <div class="spot-latest-text">
                    <span class="spot-kicker"><span>${kicker}</span>${when ? `<time>${esc(when)}</time>` : ''}</span>
                    <h3 class="spot-title"><button type="button" data-open="${esc(p.id)}" data-cursor="Open">${esc(p.title)}</button></h3>
                    <p>${esc(p.tagline || p.desc)}</p>
                </div>
            </article>`;
    }

    function platformsTile(list) {
        const counts = {};
        list.forEach((p) => window.platformsOf(p).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
        const keys = Object.keys(PL()).filter((k) => counts[k]);
        const max = Math.max(1, ...keys.map((k) => counts[k]));
        return `
            <article class="spot-tile spot-plats">
                <span class="spot-kicker"><span>Runs on</span></span>
                <ul>${keys.map((k, i) => `
                    <li style="--w:${(counts[k] / max * 100).toFixed(1)}%;--i:${i}">
                        <button type="button" data-spot-platform="${k}" ${keys.length < 2 ? 'disabled' : ''}>
                            ${window.icon(PL()[k].icon, { raw: true, size: 16 })}
                            <span>${esc(PL()[k].noun)}</span><b>${counts[k]}</b><i aria-hidden="true"></i>
                        </button>
                    </li>`).join('')}</ul>
            </article>`;
    }

    function uptimeTile(list) {
        return `
            <article class="spot-tile spot-up" data-spot-up>
                <span class="spot-kicker"><span>Live right now</span></span>
                <p class="spot-up-n"><b data-spot-up-n>—</b><span>of ${list.filter((p) => window.safeUrl(p.link)).length} links answering</span></p>
                <div class="spot-up-dots" data-spot-up-dots>${list.filter((p) => window.safeUrl(p.link)).map((p) =>
                    `<i data-dot="${esc(p.id)}" title="${esc(p.title)}"></i>`).join('')}</div>
            </article>`;
    }

    function paintSpotlight(list) {
        if (!spot || !W()) return;
        const feat = featuredSet(list);
        if (!feat.length) { spot.innerHTML = ''; return; }

        spot.innerHTML = `
            <article class="spot-tile spot-lead" data-spot-lead tabindex="-1">
                <div class="spot-slides">${feat.map(leadSlide).join('')}</div>
                ${feat.length > 1 ? `<div class="spot-dots" role="tablist" aria-label="Featured projects">${feat.map((p, i) => `
                    <button type="button" role="tab" data-spot-to="${i}" aria-selected="${i === 0}" aria-label="${esc(p.title)}" style="${window.toneVars(p.color)}">
                        <span class="spot-dot-icon">${window.icon(p.icon, { size: 13 })}</span><i></i>
                    </button>`).join('')}</div>` : ''}
            </article>
            ${latestTile(list)}
            ${platformsTile(list)}
            ${uptimeTile(list)}`;

        if (window.hydrateIcons) window.hydrateIcons(spot);
        if (window.Motion) { window.Motion.magnetic(spot); window.Motion.tilt(spot); }
        startCycle(feat.length);
        paintUptime();
    }

    async function paintUptime() {
        const tile = spot && spot.querySelector('[data-spot-up]');
        if (!tile || !W().loadStatus) return;
        const st = await W().loadStatus();
        const ids = Object.keys(st || {});
        if (!ids.length) { tile.classList.add('is-empty'); return; }
        let up = 0;
        tile.querySelectorAll('[data-dot]').forEach((d, i) => {
            const s = st[d.dataset.dot];
            if (!s) return;
            if (s.up) up++;
            d.className = s.up ? 'is-up' : 'is-down';
            d.style.setProperty('--i', i);
        });
        const n = tile.querySelector('[data-spot-up-n]');
        if (n) {
            if (window.Motion && window.Motion.tickerInView) window.Motion.tickerInView(n, up);
            else n.textContent = up;
        }
        tile.classList.add('is-in');
    }

    function startCycle(count) {
        clearTimeout(cycleTimer);
        const lead = spot.querySelector('[data-spot-lead]');
        if (!lead || count < 2) return;
        let at = 0;
        const DUR = 6500;

        const go = (i) => {
            at = (i + count) % count;
            lead.querySelectorAll('.spot-slide').forEach((s, n) => {
                s.classList.toggle('is-current', n === at);
                if (n === at) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
            });
            lead.querySelectorAll('[data-spot-to]').forEach((d, n) => {
                d.setAttribute('aria-selected', String(n === at));
                d.classList.remove('is-running');
                if (n === at) { void d.offsetWidth; d.classList.add('is-running'); }
            });
            schedule();
        };

        let paused = false;
        const schedule = () => {
            clearTimeout(cycleTimer);
            if (reduced() || paused) return;
            cycleTimer = setTimeout(() => go(at + 1), DUR);
        };

        lead.style.setProperty('--spot-dur', `${DUR}ms`);
        const pause = (on) => {
            paused = on;
            lead.classList.toggle('is-paused', on);
            if (on) clearTimeout(cycleTimer); else schedule();
        };
        lead.addEventListener('pointerenter', () => pause(true));
        lead.addEventListener('pointerleave', () => pause(false));
        lead.addEventListener('focusin', () => pause(true));
        lead.addEventListener('focusout', (e) => { if (!lead.contains(e.relatedTarget)) pause(false); });
        lead.addEventListener('click', (e) => {
            const d = e.target.closest('[data-spot-to]');
            if (d) go(Number(d.dataset.spotTo));
        });
        go(0);
    }

    if (spot) {
        spot.addEventListener('click', (e) => {
            const open = e.target.closest('[data-open]');
            if (open) { window.openProject(open.dataset.open, { from: open.closest('.spot-slide, .spot-tile') }); return; }
            const pl = e.target.closest('[data-spot-platform]');
            if (pl) {
                window.setPlatform(pl.dataset.spotPlatform);
                document.getElementById('platbar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                requestAnimationFrame(() => moveBlob(true));
            }
        });
    }

    /* =====================================================================
       Latest releases — editorial cards, newest first. Collapses entirely
       when nothing has shipped in the last four months.
       ===================================================================== */

    const relBox = document.getElementById('releases');
    const relList = document.getElementById('releasesList');
    let relKey = '';

    async function paintReleases() {
        if (!relBox || !relList || !W() || !M()) return;
        let items = [];
        try { items = await M().releases(); } catch { items = []; }
        const list = projects();
        const rows = items
            .map((it) => ({ it, p: list.find((x) => String(x.id) === String(it.projectId)) }))
            .filter((x) => x.p)
            .slice(0, 6);
        const key = rows.map((x) => `${x.it.projectId}:${x.it.tag}`).join('|');
        if (key === relKey) return;
        relKey = key;
        if (!rows.length) { relBox.hidden = true; return; }
        relBox.hidden = false;
        relList.innerHTML = rows.map(({ it, p }, i) => W().releaseCardHtml(it, p, i)).join('');
        if (window.hydrateIcons) window.hydrateIcons(relList);
        if (window.Motion) { window.Motion.reveal(relBox); window.Motion.magnetic(relList); }
        if (W().mountFlaps) W().mountFlaps(relList);
    }

    if (relList) {
        relList.addEventListener('click', (e) => {
            const open = e.target.closest('[data-open]');
            if (open) window.openProject(open.dataset.open, { from: open.closest('.relcard') });
        });
    }

    window.Showcase = { sync, moveBlob };

    // The ticker needs the project list (names, ids) and meta (fresh
    // releases), so it starts with the first data, not at parse time.
    let activityStarted = false;
    const startActivity = () => {
        if (activityStarted || !projects().length) return;
        activityStarted = true;
        loadActivity();
    };
    const syncOrig = sync;
    window.Showcase.sync = (opts) => { syncOrig(opts); startActivity(); };
    window.addEventListener('metaready', () => { startActivity(); paintReleases(); });
})();
