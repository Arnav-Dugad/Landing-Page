/* ===========================================================================
   render.js  (classic script)
   The presentation layer for project data. Owns:

     · renderProjects() the work area — skeleton → empty → grid / list /
                        index / timeline (the last two live in js/views.js)
     · filters/sort     category, platform, search — all derived from data
     · search           every word must match somewhere, including the
                        AI-written search terms, so "multiplayer" finds work
                        whose title never says it
     · cards v2         media-first: each project on the device it runs on
     · hero figures     projects, platforms, downloads, stars, Lighthouse
     · stack band       the real tech list, ranked by use
     · live metrics     window.Meta (the Worker) first, github.js as fallback
     · detail sheet     device gallery, "Get it" install panel with QR,
                        Lighthouse rings, a year of commits, changelog,
                        reactions, related projects, per-project theming
     · deep links       #project-slug opens the matching project

   Shared helpers live in js/core.js and the reusable pieces (frames, rings,
   install panel) in js/widgets.js, so the case-study page uses the same code.
   No Firestore access happens here; it reads window.getProjects().
   =========================================================================== */

(() => {
    const grid = document.getElementById('grid');
    const filterBox = document.getElementById('filters');
    const stackBox = document.getElementById('stackGrid');
    const countEl = document.getElementById('resultCount');

    const esc = window.esc;
    const categoryLabel = window.categoryLabel;
    const W = () => window.Widgets || null;
    const M = () => window.Meta || null;

    const starById = {};
    const langById = {};
    const statusById = {};
    let currentDetailId = null;
    let deepLinkDone = false;

    const VIEWS = ['grid', 'list', 'index', 'timeline'];

    /* View + query state. The single place the work area's contents are
       decided. Seeded from the URL so any view is a shareable link. */
    const params = new URLSearchParams(location.search);
    const storedView = (() => { try { return localStorage.getItem('view'); } catch { return null; } })();
    const state = window.PState = {
        filter: params.get('cat') || 'all',
        platform: (window.PLATFORMS && window.PLATFORMS[params.get('on')]) ? params.get('on') : 'all',
        search: params.get('q') || '',
        sort: params.get('sort') || 'newest',
        view: VIEWS.includes(params.get('view')) ? params.get('view')
            : (VIEWS.includes(storedView) ? storedView : 'grid'),
        compare: (params.get('compare') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3)
    };

    /* Mirror the query back into the URL, omitting anything at its default so
       the common case stays a clean link. The hash (an open project) is left
       untouched — the two coexist as `/?on=android#some-project`. */
    function syncUrl() {
        const next = new URLSearchParams();
        if (state.search.trim()) next.set('q', state.search.trim());
        if (state.platform !== 'all') next.set('on', state.platform);
        if (state.filter !== 'all') next.set('cat', state.filter);
        if (state.sort !== 'newest') next.set('sort', state.sort);
        if (state.view !== 'grid') next.set('view', state.view);
        if (state.compare.length) next.set('compare', state.compare.join(','));
        const qs = next.toString();
        const url = location.pathname + (qs ? `?${qs}` : '') + location.hash;
        try { history.replaceState(null, '', url); } catch { /* file:// */ }
    }
    window.syncUrl = syncUrl;

    const projects = () => (window.getProjects ? window.getProjects() : []);
    const loaded = () => (window.projectsLoaded ? window.projectsLoaded() : false);

    /* -------- Status badges --------------------------------------------- */
    const STATUS = {
        live:     { label: 'Live',        cls: 'badge--live' },
        wip:      { label: 'In progress', cls: 'badge--wip' },
        archived: { label: 'Archived',    cls: 'badge--archived' }
    };
    window.statusBadge = (status) => {
        const s = STATUS[status];
        return s ? `<span class="badge ${s.cls}"><s></s>${s.label}</span>` : '';
    };

    /* -------- YouTube / Vimeo → embeddable ------------------------------ */
    function toEmbed(url) {
        const safe = window.safeUrl(url);
        if (!safe) return '';
        try {
            const u = new URL(safe);
            const host = u.hostname.replace(/^www\./, '');
            if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
            if (host.endsWith('youtube.com')) {
                if (u.pathname.startsWith('/embed/')) return safe;
                const v = u.searchParams.get('v');
                if (v) return `https://www.youtube.com/embed/${v}`;
            }
            if (host === 'vimeo.com') return `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean)[0]}`;
            return safe;
        } catch { return ''; }
    }

    /* Stars from the Worker's meta, else whatever github.js found. */
    const starsOf = (p) => {
        const s = M() ? M().stars(p) : null;
        return s !== null && s !== undefined ? s : (starById[p.id] ?? null);
    };

    /* =====================================================================
       Query pipeline: platform → category → search → sort
       ===================================================================== */

    /* Everything a visitor might type to find a project. searchTerms are
       written by the admin AI tools — synonyms and concepts that aren't in
       the copy itself, which is what makes search feel semantic without a
       model running on every keystroke. Platform names count too, so
       "android" or "windows" works from the search box. */
    const haystack = (p) => [
        p.title, p.tagline, p.desc, p.longDesc, p.role, p.year, categoryLabel(p.category),
        ...window.platformsOf(p).map((k) => `${window.PLATFORMS[k].label} ${window.PLATFORMS[k].noun}`),
        ...(p.tags || []), ...(p.searchTerms || []), ...(p.highlights || [])
    ].filter(Boolean).join(' ').toLowerCase();

    function matches(p, { filter = state.filter, search = state.search, platform = state.platform } = {}) {
        if (platform !== 'all' && !window.platformsOf(p).includes(platform)) return false;
        if (filter !== 'all' && (p.category || 'other') !== filter) return false;
        const words = String(search).toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (!words.length) return true;
        const hay = haystack(p);
        return words.every((w) => hay.includes(w));
    }
    window.projectMatches = matches;

    function visibleProjects() {
        const list = projects().filter((p) => matches(p));

        list.sort((a, b) => {
            switch (state.sort) {
                case 'featured': {
                    const fa = a.featured ? 1 : 0, fb = b.featured ? 1 : 0;
                    if (fa !== fb) return fb - fa;
                    return (b.createdAt || 0) - (a.createdAt || 0);
                }
                case 'az':     return String(a.title || '').localeCompare(String(b.title || ''));
                case 'stars':  return (starsOf(b) ?? -1) - (starsOf(a) ?? -1);
                case 'oldest': return (a.createdAt || 0) - (b.createdAt || 0);
                case 'order':  return (a.order ?? 9999) - (b.order ?? 9999);
                default:       return (b.createdAt || 0) - (a.createdAt || 0);
            }
        });

        return list;
    }
    window.visibleProjects = visibleProjects;

    /* =====================================================================
       Card v2 — media first: the project on the device it runs on, then
       identity, then the facts (stars, downloads, speed, version).

       The card keeps the "primary link" pattern: the title is the only real
       control for opening the project, and it stretches an invisible overlay
       across the whole card. Everything else (Visit, Code, admin) sits above
       that overlay, so there is one accessible name per action.
       ===================================================================== */

    function cardHtml(p, index) {
        const id = esc(p.id);
        const tags = (p.tags || []).filter(Boolean);
        const shown = tags.slice(0, 3);
        const overflow = tags.length - shown.length;
        const picked = state.compare.includes(String(p.id));

        const admin = window.isAdmin ? `
            <div class="card-admin">
                <button type="button" data-drag title="Drag to reorder" aria-label="Drag ${esc(p.title)} to reorder" class="is-handle">${window.icon('drag', { raw: true, size: 13 })}</button>
                <button type="button" data-act="edit" data-id="${id}" title="Edit project" aria-label="Edit ${esc(p.title)}">${window.icon('pencil', { raw: true, size: 13 })}</button>
                <button type="button" data-act="dupe" data-id="${id}" title="Duplicate project" aria-label="Duplicate ${esc(p.title)}">${window.icon('copy', { raw: true, size: 13 })}</button>
                <button type="button" data-act="del" data-id="${id}" class="is-danger" title="Delete project" aria-label="Delete ${esc(p.title)}">${window.icon('trash', { raw: true, size: 13 })}</button>
            </div>` : '';

        const marks = [
            p.featured ? `<span class="card-mark card-mark--star" title="Featured">${window.icon('star-fill', { raw: true, size: 12 })}</span>` : '',
            p.caseStudy ? `<span class="card-mark card-mark--case" title="Has a case study">${window.icon('doc', { raw: true, size: 12 })}</span>` : ''
        ].filter(Boolean).join('');
        const star = marks ? `<div class="card-star">${marks}</div>` : '';

        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
        const link = window.safeUrl(p.link);
        const title = esc(p.title);
        const preview = window.safeUrl(p.previewVideo);
        const slug = window.projectSlug(p);
        const w = W();
        const plats = window.platformsOf(p);
        const kind = w ? (window.PLATFORMS[plats[0]] || window.PLATFORMS.web).frame : 'web';
        const firstDl = (Array.isArray(p.downloads) ? p.downloads : []).find((d) => window.safeUrl(d && d.url));

        return `
        <article class="card card--v2 card--${kind}" data-tilt
                 data-id="${id}"
                 data-category="${esc(p.category || 'other')}"
                 data-platforms="${esc(plats.join(' '))}"
                 ${repo ? `data-repo="${esc(repo)}"` : ''}
                 ${preview ? `data-preview="${esc(preview)}"` : ''}
                 data-reveal="card" style="${window.toneVars(p.color)}--delay:${Math.min(index, 9) * 55}ms">
            <i class="card-ink" aria-hidden="true"></i>
            ${admin}${star}

            <div class="card-media" aria-hidden="true">
                <div class="card-stage">${w ? w.frameHtml(p, { w: 720 }) : ''}</div>
            </div>

            <div class="card-body">
                <div class="card-head">
                    ${w ? w.appIconHtml(p, { size: 36, cls: 'card-icon' }) : ''}
                    <div class="card-names">
                        <h3 class="card-title"><button type="button" class="card-open" data-open="${id}" data-cursor="Open">${title}</button></h3>
                        <div class="card-sub">
                            ${w ? w.platformGlyphs(p, { size: 13 }) : ''}
                            ${window.statusBadge(p.status)}
                            <span class="card-live" data-status-slot></span>
                        </div>
                    </div>
                </div>
                <p class="card-desc u-clamp-2">${esc(p.tagline || p.desc)}</p>
                <div class="card-metrics" data-metrics-slot>${w ? w.metricsHtml(p, { compact: true }) : ''}</div>
                ${shown.length ? `<div class="card-tags">
                    ${shown.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
                    ${overflow > 0 ? `<span class="tag" title="${esc(tags.slice(3).join(', '))}">+${overflow}</span>` : ''}
                </div>` : ''}
            </div>

            <div class="card-foot">
                <span class="card-cat"><s></s>${esc(categoryLabel(p.category))}</span>
                <span class="card-gh">${p.year ? esc(p.year) : ''}</span>
            </div>

            <div class="card-actions">
                ${firstDl ? `<a class="card-act card-act--go" href="${esc(window.safeUrl(firstDl.url))}" download
                    data-cursor="Get" aria-label="Download ${title} for ${esc((window.PLATFORMS[firstDl.platform] || {}).label || 'your device')}">
                    ${window.icon('download', { raw: true, size: 14 })}<span>Get</span></a>`
                : (link ? `<a class="card-act card-act--go" href="${esc(link)}" target="_blank" rel="noopener noreferrer"
                    data-cursor="Visit" aria-label="Visit ${title} live">
                    ${window.icon('external', { raw: true, size: 14 })}<span>Visit</span></a>` : '')}
                ${repo ? `<a class="card-act" href="${esc(repo)}" target="_blank" rel="noopener noreferrer"
                    data-cursor="Code" aria-label="View the code for ${title}">
                    ${window.icon('github', { raw: true, size: 14 })}<span>Code</span></a>` : ''}
                ${p.caseStudy ? `<a class="card-act" href="case.html?p=${encodeURIComponent(slug)}" data-case="${esc(slug)}"
                    data-cursor="Read" aria-label="Read the ${title} case study">
                    ${window.icon('doc', { raw: true, size: 14 })}<span>Case study</span></a>` : ''}
                <button type="button" class="card-act card-act--cmp" data-compare="${id}" aria-pressed="${picked}"
                    data-cursor="Compare" aria-label="${picked ? 'Remove' : 'Add'} ${title} ${picked ? 'from' : 'to'} the comparison">
                    ${window.icon(picked ? 'check' : 'scale', { raw: true, size: 14 })}<span>${picked ? 'Picked' : 'Compare'}</span></button>
            </div>
        </article>`;
    }
    window.projectCardHtml = cardHtml;

    /* =====================================================================
       Empty state — never a dead end. Suggest the smallest change that
       would bring something back, with the count it would bring back.
       ===================================================================== */

    function emptyHtml() {
        const all = projects();
        if (!all.length) {
            return `
                <div class="empty">
                    ${emptyArt()}
                    <h3>No projects yet</h3>
                    <p>New work is on the way — check back shortly.</p>
                </div>`;
        }

        const hasSearch = !!state.search.trim();
        const hasFilter = state.filter !== 'all';
        const hasPlatform = state.platform !== 'all';
        const offers = [];

        if (hasPlatform) {
            const n = all.filter((p) => matches(p, { platform: 'all' })).length;
            if (n) offers.push({ act: 'all-platforms', label: 'Every platform', n });
        }
        if (hasSearch && hasFilter) {
            const n = all.filter((p) => matches(p, { filter: 'all' })).length;
            if (n) offers.push({ act: 'all-cats', label: 'Search every category', n });
        }
        if (hasSearch) {
            const n = all.filter((p) => matches(p, { search: '' })).length;
            if (n) offers.push({ act: 'clear-search', label: hasFilter ? `Keep ${categoryLabel(state.filter)}, drop the search` : 'Clear the search', n });

            // Drop one word at a time — "react game physics" may be one word too many.
            const words = state.search.trim().split(/\s+/);
            if (words.length > 1) {
                words.forEach((w) => {
                    const rest = words.filter((x) => x !== w).join(' ');
                    const n2 = all.filter((p) => matches(p, { search: rest })).length;
                    if (n2) offers.push({ act: 'search', value: rest, label: `Search “${rest}”`, n: n2 });
                });
            }
        } else if (hasFilter) {
            offers.push({ act: 'all-cats', label: 'Show every category', n: all.filter((p) => matches(p, { filter: 'all' })).length });
        }

        // Popular tech as a gentle nudge.
        const tally = {};
        all.forEach((p) => (p.tags || []).forEach((t) => { tally[t] = (tally[t] || 0) + 1; }));
        const ideas = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
        const where = hasPlatform ? ` for ${window.PLATFORMS[state.platform].label}` : '';

        return `
            <div class="empty">
                ${emptyArt()}
                <h3>Nothing matches ${hasSearch ? `“${esc(state.search.trim())}”` : 'that'}${esc(where)}</h3>
                <p>${offers.length ? 'Closest ways back:' : 'Try a different word, or start over.'}</p>
                ${offers.length ? `<div class="empty-offers">${offers.slice(0, 4).map((o) => `
                    <button type="button" class="chip" data-empty-act="${o.act}" ${o.value ? `data-value="${esc(o.value)}"` : ''}>
                        ${esc(o.label)}<b>${o.n}</b></button>`).join('')}</div>` : ''}
                ${ideas.length ? `<div class="empty-ideas"><span>Or try</span>${ideas.map((t) =>
                    `<button type="button" class="tag" data-empty-act="search" data-value="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
                <button type="button" class="btn btn--quiet" data-empty-act="reset" style="margin-top:22px">Start over</button>
            </div>`;
    }

    /* A small drawn magnifier over a few lattice dots — the site's own motif. */
    function emptyArt() {
        const dots = [];
        for (let y = 0; y < 4; y++) for (let x = 0; x < 7; x++) {
            dots.push(`<circle cx="${10 + x * 14}" cy="${10 + y * 14}" r="1.6"/>`);
        }
        return `<svg class="empty-art" viewBox="0 0 108 66" aria-hidden="true">
            <g class="empty-dots">${dots.join('')}</g>
            <g class="empty-glass" fill="none" stroke-width="2.2" stroke-linecap="round">
                <circle cx="60" cy="30" r="15"/><path d="m71 41 11 11"/>
            </g></svg>`;
    }

    function runEmptyAct(btn) {
        const act = btn.dataset.emptyAct;
        const searchEl = document.getElementById('search');
        if (act === 'all-cats') state.filter = 'all';
        if (act === 'all-platforms') state.platform = 'all';
        if (act === 'clear-search' || act === 'reset') { state.search = ''; if (searchEl) searchEl.value = ''; }
        if (act === 'reset') { state.filter = 'all'; state.platform = 'all'; }
        if (act === 'search') { state.search = btn.dataset.value || ''; if (searchEl) searchEl.value = state.search; }
        render();
    }

    /* =====================================================================
       Work area render
       ===================================================================== */

    function paint() {
        const list = visibleProjects();
        const view = state.view;

        if (!list.length) {
            grid.innerHTML = emptyHtml();
        } else if (view === 'index' && window.Views) {
            grid.innerHTML = window.Views.indexHtml(list);
        } else if (view === 'timeline' && window.Views) {
            grid.innerHTML = window.Views.timelineHtml(list, projects());
        } else {
            grid.innerHTML = list.map(cardHtml).join('');
        }

        VIEWS.forEach((v) => grid.classList.toggle(`is-${v}`, v === view));

        if (countEl) {
            const total = projects().length;
            const where = state.platform !== 'all' ? ` · ${window.PLATFORMS[state.platform].noun.toLowerCase()}` : '';
            countEl.textContent = list.length === total
                ? `${total} project${total === 1 ? '' : 's'}`
                : `${list.length} of ${total}${where}`;
        }

        if (window.Motion) {
            if (firstPaint) {
                // Only the very first grid earns a scroll-triggered entrance.
                window.Motion.reveal(grid);
            } else {
                // Later paints are re-layouts — FLIP owns the motion, so the
                // reveal state must already be settled or cards flash.
                grid.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
            }
            window.Motion.tilt(grid);
        }
        if (window.Views) window.Views.mount(grid, view);
        firstPaint = false;
        hydrateCardStats();
        paintStatuses();
        if (window.isAdmin) flagMissingRepos();
        if (window.Views) window.Views.syncWorkbar(list.length, projects().length);
    }

    let firstPaint = true;

    /* Re-layouts run through FLIP: measure, mutate, then play every card from
       where it was to where it now is. Filtering reads as the cards physically
       rearranging rather than the grid blinking. */
    function render() {
        if (!loaded()) {
            grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton skeleton--v2"><i></i><b></b><b></b></div>').join('');
            return;
        }
        renderFilters();
        renderStats();
        renderStack();
        syncUrl();

        if (firstPaint || !window.Motion) paint();
        else window.Motion.flipGrid(grid, paint);

        if (movePill) movePill();
        if (window.Views) window.Views.syncCompare();
        if (window.Showcase) window.Showcase.sync();

        if (!deepLinkDone) {
            deepLinkDone = true;
            loadStatuses();
            if (location.hash) setTimeout(openFromHash, 80);
        }
    }
    window.renderProjects = render;

    /* =====================================================================
       Filters — derived from the categories actually in use (within the
       chosen platform, so the counts are always honest)
       ===================================================================== */

    /* The travelling indicator behind the active filter chip, created lazily
       once Motion is available. */
    let movePill = null;

    function renderFilters() {
        if (!filterBox) return;
        const counts = {};
        const pool = projects().filter((p) => matches(p, { filter: 'all', search: '' }));
        pool.forEach((p) => {
            const c = p.category || 'other';
            counts[c] = (counts[c] || 0) + 1;
        });
        // A category that vanished under the platform filter can't stay selected.
        if (state.filter !== 'all' && !counts[state.filter]) state.filter = 'all';
        const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));

        const chip = (key, label, count) =>
            `<button class="chip ${state.filter === key ? 'is-active' : ''}" data-filter="${esc(key)}">
                ${esc(label)}<b>${count}</b>
            </button>`;

        filterBox.innerHTML = chip('all', 'All', pool.length)
            + cats.map((c) => chip(c, categoryLabel(c), counts[c])).join('');

        // Re-created markup means the pill's element is gone; rebuild it.
        if (window.Motion) movePill = window.Motion.filterPill(filterBox);
    }

    if (filterBox) {
        filterBox.addEventListener('click', (e) => {
            const btn = e.target.closest('.chip');
            if (!btn) return;
            state.filter = btn.dataset.filter;
            render();
        });
    }

    window.setFilter = (cat) => { state.filter = cat; render(); };
    window.setPlatform = (key) => {
        state.platform = (key && window.PLATFORMS[key]) ? key : 'all';
        render();
    };
    window.setSort = async (mode) => {
        state.sort = mode;
        const sel = document.getElementById('sortSelect');
        if (sel && sel.value !== mode) sel.value = mode;
        if (mode === 'stars' && !(window.EDGE && M() && M().isReady())) await hydrateAllStats();
        render();
    };
    window.setSearch = (text) => { state.search = text; render(); };

    function paintSegment() {
        const at = Math.max(0, VIEWS.indexOf(state.view));
        document.querySelectorAll('.segment button[data-view]').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.view === state.view);
            b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
        });
        const thumb = document.querySelector('.toolbar .segment .thumb');
        if (thumb) thumb.style.transform = `translateX(${at * 36}px)`;
    }

    window.setView = (view) => {
        if (!VIEWS.includes(view)) return;
        state.view = view;
        try { localStorage.setItem('view', view); } catch { /* private mode */ }
        paintSegment();
        render();
    };
    window.cycleView = () => window.setView(VIEWS[(VIEWS.indexOf(state.view) + 1) % VIEWS.length]);

    /* =====================================================================
       Hero figures — each one is a real, checkable number, and a figure we
       can't vouch for is hidden rather than shown as zero.
       ===================================================================== */

    function renderStats() {
        const list = projects();
        if (!list.length) return;

        const platforms = new Set();
        const techs = new Set();
        list.forEach((p) => {
            window.platformsOf(p).forEach((k) => platforms.add(k));
            (p.tags || []).forEach((t) => { const k = String(t).trim().toLowerCase(); if (k) techs.add(k); });
        });
        const t = M() ? M().totals(list) : { stars: null, downloads: 0, perf: null };
        const stars = t.stars !== null ? t.stars : (Object.keys(starById).length ? Object.values(starById).reduce((a, b) => a + b, 0) : null);
        const checked = Object.keys(statusById).length;

        /* In priority order; a figure only earns a place when it says
           something — "1 platform" or "2 stars" is worse than no figure.
           At most five, so the strip stays one line on a laptop. */
        const figures = [
            ['projects',  'hsProjects',  list.length,              true],
            ['platforms', 'hsPlatforms', platforms.size,           platforms.size >= 2],
            ['downloads', 'hsDownloads', t.downloads,              t.downloads >= 10],
            ['stars',     'hsStars',     stars,                    stars >= 10],
            ['perf',      'hsPerf',      t.perf,                   t.perf !== null && t.perfCount >= 2],
            ['live',      'hsLive',      liveCount(list),          checked > 0],
            ['tech',      'hsTech',      techs.size,               techs.size >= 3]
        ];
        let shown = 0;
        figures.forEach(([cell, id, val, ok]) => {
            const box = document.querySelector(`[data-hstat="${cell}"]`);
            const show = ok && shown < 5;
            if (box) box.classList.toggle('u-hidden', !show);
            if (!show) return;
            shown++;
            const el = document.getElementById(id);
            if (!el) return;
            if (window.Motion && window.Motion.tickerInView) window.Motion.tickerInView(el, val);
            else el.textContent = val;
        });
    }

    /* "Live right now" counts real answers once the server has checked. */
    function liveCount(list) {
        const checked = list.filter((p) => statusById[p.id]);
        if (!checked.length) return list.filter((p) => p.status === 'live').length;
        return checked.filter((p) => statusById[p.id].up).length;
    }
    window.liveProjectCount = () => liveCount(projects());

    /* =====================================================================
       Stack band — the real tech list, ranked by how often it appears
       ===================================================================== */

    function renderStack() {
        if (!stackBox) return;
        const counts = {};
        projects().forEach((p) => (p.tags || []).forEach((t) => {
            const name = String(t).trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (!counts[key]) counts[key] = { name, n: 0 };
            counts[key].n++;
        }));

        const ranked = Object.values(counts).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 12);
        if (!ranked.length) {
            stackBox.closest('section')?.classList.add('u-hidden');
            return;
        }
        stackBox.closest('section')?.classList.remove('u-hidden');

        const max = ranked[0].n;
        const mark = (name) => (W() && W().techMark ? W().techMark(name, { size: 38 }) : '');
        stackBox.innerHTML = ranked.map((t, i) => `
            <button class="stack-cell tmark-host" style="--pct:${Math.round((t.n / max) * 100)}%;--delay:${i * 40}ms;--i:${i}"
                    data-tag="${esc(t.name)}" title="Filter projects using ${esc(t.name)}">
                <span class="stack-mark">${mark(t.name)}</span>
                <b>${esc(t.name)}</b>
                <span>${t.n} project${t.n === 1 ? '' : 's'}</span>
                <i></i>
            </button>`).join('');

        // The usage bar animates in with the cell. Browsers with scroll-driven
        // animations assemble the marks in CSS; this class is the fallback.
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            });
        }, { threshold: 0.3 });
        stackBox.querySelectorAll('.stack-cell').forEach((el) => io.observe(el));
    }

    if (stackBox) {
        stackBox.addEventListener('click', (e) => {
            const cell = e.target.closest('.stack-cell');
            if (!cell) return;
            const search = document.getElementById('search');
            if (search) search.value = cell.dataset.tag;
            state.search = cell.dataset.tag;
            state.filter = 'all';
            render();
            document.getElementById('work')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    /* =====================================================================
       Metrics — the Worker's meta when it is there (one cached request for
       everything); github.js per card only as the off-edge fallback.
       ===================================================================== */

    function paintMetrics(root = grid) {
        if (!W()) return;
        root.querySelectorAll('[data-id]').forEach((el) => {
            const p = projects().find((x) => String(x.id) === el.dataset.id);
            const slot = el.querySelector('[data-metrics-slot]');
            if (p && slot) slot.innerHTML = W().metricsHtml(p, { compact: true });
        });
    }

    async function hydrateCardStats() {
        const metaReady = M() && M().isReady();
        if (window.EDGE && metaReady && Object.keys(projects()).length && projects().some((p) => M().get(p.id))) {
            paintMetrics();
            renderStats();
            return;
        }
        if (window.EDGE && !metaReady) return;           // metaready will call back

        // Fallback: browser GitHub calls (cached 6h), as before.
        const cards = Array.from(grid.querySelectorAll('[data-repo]'));
        await Promise.allSettled(cards.map(async (card) => {
            const stats = await window.fetchGitHubStats(card.dataset.repo);
            if (!stats) return;
            const id = card.dataset.id;
            starById[id] = stats.stars;
            if (stats.language) langById[id] = stats.language;
            const slot = card.querySelector('[data-metrics-slot]');
            if (slot && stats.stars > 0 && !slot.querySelector('.mchip')) {
                slot.innerHTML = `<span class="mchips"><span class="mchip" title="GitHub stars">${window.icon('star', { raw: true, size: 12 })}${window.formatCount(stats.stars)}</span></span>`;
            }
        }));
        renderStats();
        if (window.isAdmin) flagMissingRepos();
    }

    window.addEventListener('metaready', () => {
        if (!loaded()) return;
        paintMetrics();
        renderStats();
        if (window.Showcase) window.Showcase.sync({ force: true });
        if (state.sort === 'stars') render();
    });

    async function hydrateAllStats() {
        await Promise.allSettled(projects().map(async (p) => {
            const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
            if (!repo) return;
            const s = await window.fetchGitHubStats(repo);
            if (s) { starById[p.id] = s.stars; if (s.language) langById[p.id] = s.language; }
        }));
    }
    window.projectStars = (id) => {
        const p = projects().find((x) => String(x.id) === String(id));
        return p ? starsOf(p) : starById[id];
    };

    /* Admin only: a repo GitHub positively says is gone gets a visible flag.
       Visitors never see this — it's a to-do, not a disclaimer. */
    function flagMissingRepos() {
        grid.querySelectorAll('.card[data-repo]').forEach((card) => {
            if (window.githubRepoMissing(card.dataset.repo) !== true) return;
            if (card.querySelector('.card-flag')) return;
            card.insertAdjacentHTML('beforeend',
                `<span class="card-flag" title="GitHub says this repo doesn't exist (renamed, private or deleted)">${window.icon('alert', { raw: true, size: 12 })} Repo missing</span>`);
        });
    }

    /* =====================================================================
       Live status — checked by the Worker, never by the visitor's browser
       (a browser can't read cross-origin status codes anyway).
       ===================================================================== */

    async function loadStatuses() {
        if (!W() || !W().loadStatus) return;
        const results = await W().loadStatus();
        Object.assign(statusById, results || {});
        paintStatuses();
        renderStats();
    }
    window.projectStatus = (id) => statusById[id] || null;

    function paintStatuses() {
        if (!W() || !W().statusChip) return;
        grid.querySelectorAll('[data-id]').forEach((el) => {
            const s = statusById[el.dataset.id];
            if (!s) return;
            el.classList.toggle('is-down', !s.up);
            // A real check beats the hand-set "Live" badge — never show both.
            el.querySelector('.badge--live')?.classList.add('u-hidden');
            const slot = el.querySelector('[data-status-slot]');
            if (slot && !slot.dataset.filled) {
                slot.innerHTML = W().statusChip(s);
                slot.dataset.filled = '1';
            }
        });
    }

    /* =====================================================================
       Detail sheet v2
       ===================================================================== */

    const sheet = document.getElementById('detailSheet');
    const body = document.getElementById('detailBody');

    const canTransition = () => typeof document.startViewTransition === 'function'
        && !(window.motionReduced && window.motionReduced());

    function detailHtml(p) {
        const link = window.safeUrl(p.link);
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
        const embed = p.demoVideo ? toEmbed(p.demoVideo) : '';
        const deploy = window.deployInfo ? window.deployInfo(link) : null;
        const slug = window.projectSlug(p);
        const picked = state.compare.includes(String(p.id));
        const w = W();
        const plats = window.platformsOf(p);

        // The live site runs in the first slide — but only for things that
        // are web pages. An app's landing page is not the app.
        const live = embed
            ? `<iframe src="${esc(embed)}" loading="lazy" title="${esc(p.title)} demo"
                       allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                       allowfullscreen></iframe>`
            : (link && (plats.includes('web') || !plats.length) && !(statusById[p.id] && !statusById[p.id].up)
                && !(M() && M().get(p.id) && M().get(p.id).web && M().get(p.id).web.frameable === false)
                ? `<iframe src="${esc(link)}" loading="lazy" title="${esc(p.title)} live preview"
                           sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>`
                : '');

        const highlights = Array.isArray(p.highlights) ? p.highlights.filter((h) => String(h).trim()) : [];
        const tags = (p.tags || []).filter(Boolean);
        const status = statusById[p.id];
        const meta = M() ? M().get(p.id) : null;
        const related = w && w.relatedProjects ? w.relatedProjects(p, projects(), 3) : [];
        const rel = M() ? M().release(p) : null;
        const dl = M() ? M().downloads(p) : 0;

        /* The actions live in a sticky header, not at the bottom of the sheet.
           Visiting the project is the single most likely thing anyone wants to
           do here, and it should never require scrolling past a write-up. */
        const actions = `
            <div class="detail-actions">
                ${p.caseStudy ? `<a href="case.html?p=${encodeURIComponent(slug)}" data-case="${esc(slug)}" class="btn btn--primary magnetic" data-cursor="Read">
                    ${window.icon('doc', { raw: true, size: 17 })} Case study</a>` : ''}
                ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="btn ${p.caseStudy ? 'btn--ghost' : 'btn--primary'} magnetic" data-cursor="Visit">
                    ${window.icon('external', { raw: true, size: 17 })} ${plats.includes('web') || !plats.length ? 'Visit live' : 'Website'}</a>` : ''}
                ${repo ? `<a href="${esc(repo)}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost magnetic" data-cursor="Code">
                    ${window.icon('github', { raw: true, size: 17 })} View code</a>` : ''}
                <button class="btn btn--quiet" data-share="${esc(p.id)}">
                    ${window.icon('share', { raw: true, size: 16 })} Share</button>
                <button class="btn btn--quiet" data-compare="${esc(p.id)}" aria-pressed="${picked}">
                    ${window.icon(picked ? 'check' : 'scale', { raw: true, size: 16 })} ${picked ? 'In comparison' : 'Compare'}</button>
                ${window.isAdmin ? `<button class="btn btn--quiet" data-act="edit" data-id="${esc(p.id)}">
                    ${window.icon('pencil', { raw: true, size: 16 })} Edit</button>` : ''}
            </div>`;

        // A row of quick facts — only the ones that are true for this project.
        const facts = [
            rel && rel.version ? `<div class="dfact"><b>v${esc(rel.version)}</b><span>${rel.date ? `released ${esc(window.relativeTime(new Date(rel.date).toISOString()))}` : 'latest release'}</span></div>` : '',
            dl ? `<div class="dfact"><b>${window.formatCount(dl)}</b><span>downloads</span></div>` : '',
            meta && meta.github && meta.github.stars ? `<div class="dfact"><b>${window.formatCount(meta.github.stars)}</b><span>GitHub stars</span></div>` : '',
            meta && meta.github && meta.github.pushedAt ? `<div class="dfact"><b>${esc(w.shortAgo(meta.github.pushedAt))}</b><span>last commit</span></div>` : '',
            meta && meta.store && meta.store.play && meta.store.play.rating ? `<div class="dfact"><b>★ ${Number(meta.store.play.rating).toFixed(1)}</b><span>Google Play</span></div>` : '',
            meta && meta.store && meta.store.appstore && meta.store.appstore.rating ? `<div class="dfact"><b>★ ${Number(meta.store.appstore.rating).toFixed(1)}</b><span>App Store</span></div>` : '',
            meta && meta.store && meta.store.microsoft && meta.store.microsoft.rating ? `<div class="dfact"><b>★ ${Number(meta.store.microsoft.rating).toFixed(1)}</b><span>Microsoft Store</span></div>` : '',
            meta && meta.github && meta.github.license ? `<div class="dfact"><b>${esc(meta.github.license)}</b><span>license</span></div>` : ''
        ].filter(Boolean);

        const psi = meta && meta.web && meta.web.psi;
        const weeks = meta && meta.github && meta.github.commitWeeks;

        return `
            <header class="detail-top" style="${window.toneVars(p.color)}">
                <div class="detail-ident">
                    <div class="detail-icon" data-vt="plaque">${w ? w.appIconHtml(p, { size: 50 }) : ''}</div>
                    <div class="detail-names">
                        <h2 class="detail-title" data-vt="title">${esc(p.title)}</h2>
                        <div class="detail-meta">
                            ${w ? w.platformGlyphs(p, { labels: true, size: 12 }) : ''}
                            ${p.category ? `<span>${esc(categoryLabel(p.category))}</span>` : ''}
                            ${status && p.status === 'live' ? '' : window.statusBadge(p.status)}
                            ${status && w ? w.statusChip(status) : ''}
                            ${deploy && (plats.includes('web') || !plats.length) ? `<span>${window.icon(deploy.icon, { raw: true, size: 12 })} ${esc(deploy.name)}</span>` : ''}
                            ${p.year ? `<span>${window.icon('calendar', { raw: true, size: 12 })} ${esc(p.year)}</span>` : ''}
                            ${p.role ? `<span>${window.icon('sparkles', { raw: true, size: 12 })} ${esc(p.role)}</span>` : ''}
                        </div>
                    </div>
                </div>
                ${actions}
            </header>

            <div class="detail-media detail-media--v2" style="${window.toneVars(p.color)}">
                ${w ? w.galleryHtml(p, { live }) : ''}
            </div>

            <div class="sheet-body">
                ${p.tagline ? `<p class="detail-tagline">${esc(p.tagline)}</p>` : ''}
                <p class="detail-lead">${esc(p.desc)}</p>

                ${facts.length ? `<div class="dfacts">${facts.join('')}</div>` : ''}

                ${w ? w.getItHtml(p) : ''}

                ${p.longDesc ? `<div class="detail-prose">${esc(p.longDesc)}</div>` : ''}

                ${highlights.length ? `
                    <div class="detail-sub">Highlights</div>
                    <ul class="hilite">
                        ${highlights.map((h) => `<li>${window.icon('check', { raw: true, size: 15 })}<span>${esc(h)}</span></li>`).join('')}
                    </ul>` : ''}

                ${psi || (weeks && weeks.some(Boolean)) ? `
                    <div class="dhealth">
                        ${psi ? `<div class="dhealth-col"><div class="detail-sub">Lighthouse <span class="getit-count">mobile</span></div>${w.ringsHtml(psi)}</div>` : ''}
                        ${weeks && weeks.some(Boolean) ? `<div class="dhealth-col"><div class="detail-sub">Activity</div>${w.commitStripHtml(weeks)}</div>` : ''}
                    </div>` : ''}

                ${tags.length ? `
                    <div class="detail-sub">Built with</div>
                    <div class="detail-tech">
                        ${tags.map((t) => `<span class="tech tmark-host">${w && w.techMark ? w.techMark(t, { size: 22 }) : ''}<span>${esc(t)}</span></span>`).join('')}
                    </div>` : ''}

                <div id="ghStats" class="ghstats u-hidden" style="margin-top:24px"></div>
                <div id="ghLangs"></div>
                <div id="detailChangelog" class="detail-changelog"></div>

                ${w && w.reactionsHtml ? w.reactionsHtml(slug) : ''}

                ${related.length ? `
                    <div class="detail-related">
                        <div class="detail-sub">More like this</div>
                        ${w.relatedHtml(related, { link: () => null })}
                    </div>` : ''}
            </div>`;
    }

    function fillDetailAsync(p, id) {
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
        if (W() && W().mountGallery) W().mountGallery(body);

        // Stars/forks + language breakdown: meta first, github.js fallback.
        if (repo && M()) {
            M().github(p).then((g) => {
                if (String(currentDetailId) !== String(id) || !g) return;
                starById[id] = g.stars;
                const row = document.getElementById('ghStats');
                if (row && !body.querySelector('.dfacts')) {
                    row.innerHTML = `
                        <span class="ghstat">${window.icon('star', { raw: true, size: 13 })} <b data-tick="${g.stars}">0</b> stars</span>
                        <span class="ghstat">${window.icon('fork', { raw: true, size: 13 })} <b data-tick="${g.forks}">0</b> forks</span>
                        ${g.pushedAt ? `<span class="ghstat">${window.icon('clock', { raw: true, size: 13 })} updated <b>${window.relativeTime(new Date(g.pushedAt).toISOString())}</b></span>` : ''}`;
                    row.classList.remove('u-hidden');
                    row.querySelectorAll('[data-tick]').forEach((el) => {
                        const n = Number(el.dataset.tick);
                        if (window.Motion && window.Motion.tickerInView) window.Motion.tickerInView(el, n, { root: sheet.querySelector('.sheet-panel') });
                        else el.textContent = n.toLocaleString();
                    });
                }
                const langs = (g.languages || []).slice(0, 6);
                const box = document.getElementById('ghLangs');
                if (box && langs.length) {
                    box.innerHTML = `
                        <div class="detail-sub">Language breakdown</div>
                        <div class="langbar">${langs.map((l, i) =>
                            `<span style="width:${l.pct}%;background:${window.langColor(l.name)};animation-delay:${i * 90}ms"></span>`).join('')}</div>
                        <div class="langlegend">${langs.map((l) =>
                            `<span><s style="background:${window.langColor(l.name)}"></s>${esc(l.name)} ${Number(l.pct).toFixed(1)}%</span>`).join('')}</div>`;
                }
            });
        }

        const log = document.getElementById('detailChangelog');
        if (log && W() && W().mountChangelog) {
            if (repo) W().mountChangelog(log, repo);
            else log.classList.add('u-hidden');
        }
        if (W() && W().mountReactions) W().mountReactions(body);

        // Rings and the activity strip draw in once they scroll into view.
        const panel = sheet.querySelector('.sheet-panel');
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (!e.isIntersecting) return;
                e.target.classList.add('is-in');
                io.unobserve(e.target);
            });
        }, { root: panel, threshold: 0.3 });
        body.querySelectorAll('.rings, .cstrip, .getit').forEach((el) => io.observe(el));
    }

    /* Opens a project. When it was opened from a visible card, the card's
       icon and title morph into the sheet's (View Transitions); anything
       else — palette, deep link, prev/next — opens normally. */
    window.openProject = (id, { from = null } = {}) => {
        const p = projects().find((x) => String(x.id) === String(id));
        if (!p || !sheet || !body) return;
        const wasOpen = sheet.classList.contains('is-open');
        currentDetailId = String(id);

        const source = from || (!wasOpen ? grid.querySelector(`[data-id="${CSS.escape(String(id))}"]`) : null);
        const morph = source && canTransition() && source.getBoundingClientRect().bottom > 0
            && source.getBoundingClientRect().top < window.innerHeight;
        const srcIcon = () => source.querySelector('.card-icon, .card-plaque, .ix-mark, .tl-plaque, .spot-icon');
        const srcTitle = () => source.querySelector('.card-open, .ix-title, .tl-title, .spot-title');

        const swap = () => {
            body.innerHTML = detailHtml(p);
            window.hydrateIcons && window.hydrateIcons(body);
            if (morph) {
                body.querySelector('[data-vt="plaque"]').style.viewTransitionName = 'vt-plaque';
                body.querySelector('[data-vt="title"]').style.viewTransitionName = 'vt-title';
                srcIcon()?.style.setProperty('view-transition-name', 'none');
                srcTitle()?.style.setProperty('view-transition-name', 'none');
                sheet.classList.add('vt-instant');
            }
            window.openSheet(sheet);
            body.closest('.sheet-panel').scrollTop = 0;
            // Wire the async parts only once their containers exist — with a
            // View Transition this callback runs a frame after openProject.
            if (window.Motion) window.Motion.magnetic(body);
            fillDetailAsync(p, id);
        };

        if (morph) {
            srcIcon()?.style.setProperty('view-transition-name', 'vt-plaque');
            srcTitle()?.style.setProperty('view-transition-name', 'vt-title');
            document.documentElement.classList.add('vt-sheet');
            const vt = document.startViewTransition(swap);
            vt.finished.finally(() => {
                document.documentElement.classList.remove('vt-sheet');
                sheet.classList.remove('vt-instant');
                body.querySelectorAll('[data-vt]').forEach((el) => { el.style.viewTransitionName = ''; });
                source.querySelectorAll('[style*="view-transition-name"]').forEach((el) => el.style.removeProperty('view-transition-name'));
            });
        } else {
            swap();
        }

        if (window.applyProjectTheme) window.applyProjectTheme(p.color);

        // Keep any active filter in the URL alongside the open project.
        try {
            history.replaceState(null, '', `${location.pathname}${location.search}#${window.projectSlug(p)}`);
        } catch { /* file:// */ }
    };

    window.closeProject = () => {
        if (!sheet) return;
        window.closeSheet(sheet);
        currentDetailId = null;
        if (window.applyProjectTheme) window.applyProjectTheme(null);
        // Stop any live iframe immediately rather than after the fade.
        setTimeout(() => { if (body && !sheet.classList.contains('is-open')) body.innerHTML = ''; }, 380);
        try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// */ }
    };
    window.currentProjectId = () => currentDetailId;

    /* Prev/next walks the currently visible, currently sorted list. */
    window.detailNav = (dir) => {
        const ids = visibleProjects().map((p) => String(p.id));
        if (!ids.length) return;
        let i = ids.indexOf(String(currentDetailId));
        if (i === -1) i = 0;
        const panel = sheet.querySelector('.sheet-panel');
        const next = ids[(i + dir + ids.length) % ids.length];
        if (panel && panel.animate && !(window.motionReduced && window.motionReduced())) {
            panel.animate([
                { transform: 'none', opacity: 1 },
                { transform: `translateX(${dir * -26}px)`, opacity: 0 }
            ], { duration: 140, easing: 'ease-in' }).finished.then(() => {
                window.openProject(next);
                panel.animate([
                    { transform: `translateX(${dir * 26}px)`, opacity: 0 },
                    { transform: 'none', opacity: 1 }
                ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' });
            });
        } else {
            window.openProject(next);
        }
    };

    window.randomProject = () => {
        const list = visibleProjects();
        if (!list.length) { window.toast('Nothing to pick from', 'info'); return; }
        window.openProject(list[Math.floor(Math.random() * list.length)].id);
    };

    /* On the Worker (and Vercel) there is a real /p/<slug> route that serves
       per-project OG tags to crawlers before bouncing a human to the site.
       Anywhere else (GitHub Pages, localhost) fall back to the hash deep link,
       which works for people but not for link previews. */
    window.projectUrl = (p) => (window.EDGE
        ? `${location.origin}/p/${encodeURIComponent(window.projectSlug(p))}`
        : `${location.origin}${location.pathname}#${window.projectSlug(p)}`);

    /* -------- Deep links ------------------------------------------------- */
    function openFromHash() {
        const slug = decodeURIComponent((location.hash || '').replace(/^#/, ''));
        if (!slug) return;
        // Section anchors (#work, #about…) are handled by the browser.
        if (document.getElementById(slug)) return;
        const p = projects().find((x) => window.projectSlug(x) === slug);
        if (p) window.openProject(p.id);
    }
    window.addEventListener('hashchange', () => {
        if (sheet && !sheet.classList.contains('is-open')) openFromHash();
    });

    /* Before following a case-study link, hand the record over so the case
       page can paint instantly, and name the title so it morphs across the
       navigation (cross-document View Transitions). */
    function handoff(slug, fromEl) {
        const p = projects().find((x) => window.projectSlug(x) === slug);
        if (!p) return;
        try {
            sessionStorage.setItem(window.HANDOFF_KEY ? window.HANDOFF_KEY(slug) : `case-handoff:${slug}`,
                JSON.stringify({ ...p, slug }));
        } catch { /* storage full */ }
        const host = fromEl.closest('.card, .detail-top, .ix-row, .tl-item, .spot-tile');
        if (!host) return;
        document.querySelectorAll('[style*="case-title"], [style*="case-plaque"]').forEach((el) => {
            el.style.removeProperty('view-transition-name');
        });
        host.querySelector('.card-open, .detail-title, .ix-title, .tl-title, .spot-title')?.style.setProperty('view-transition-name', 'case-title');
        host.querySelector('.card-icon, .detail-icon, .card-plaque, .ix-mark, .tl-plaque, .spot-icon')?.style.setProperty('view-transition-name', 'case-plaque');
    }
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-case]');
        if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey) handoff(a.dataset.case, a);
    }, true);

    /* =====================================================================
       Work-area interactions (delegated, so re-renders never lose handlers)
       ===================================================================== */

    grid.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-act]');
        if (actionBtn) {
            e.stopPropagation();
            const id = actionBtn.dataset.id;
            if (actionBtn.dataset.act === 'edit') window.editProject && window.editProject(id);
            if (actionBtn.dataset.act === 'dupe') window.duplicateProject && window.duplicateProject(id);
            if (actionBtn.dataset.act === 'del')  window.deleteProject && window.deleteProject(id);
            return;
        }
        const emptyBtn = e.target.closest('[data-empty-act]');
        if (emptyBtn) { runEmptyAct(emptyBtn); return; }

        const cmp = e.target.closest('[data-compare]');
        if (cmp) { e.stopPropagation(); window.toggleCompare && window.toggleCompare(cmp.dataset.compare); return; }

        // Real links (Visit / Code / Case study / Get) are left alone entirely.
        if (e.target.closest('.card-act, a[href]')) return;

        const open = e.target.closest('[data-open]');
        if (open) { window.openProject(open.dataset.open, { from: open.closest('[data-id]') }); return; }

        // Clicking anywhere else on the card counts as opening it — the title
        // button's stretched overlay handles most of this, but padding and the
        // media sit outside it.
        const card = e.target.closest('[data-id]');
        if (card) window.openProject(card.dataset.id, { from: card });
    });

    /* Arrow-key navigation across the grid. Columns are read from the computed
       layout rather than assumed, so it works in every view and breakpoint. */
    function columnsInGrid() {
        if (state.view !== 'grid') return 1;
        const template = getComputedStyle(grid).gridTemplateColumns;
        const n = template.split(' ').filter(Boolean).length;
        return Math.max(1, n);
    }

    grid.addEventListener('keydown', (e) => {
        const openers = Array.from(grid.querySelectorAll('[data-open]'));
        if (!openers.length) return;

        const current = e.target.closest('[data-open]');
        if (!current) return;

        const i = openers.indexOf(current);
        const cols = columnsInGrid();
        let next = -1;

        switch (e.key) {
            case 'ArrowRight': next = i + 1; break;
            case 'ArrowLeft':  next = i - 1; break;
            case 'ArrowDown':  next = i + cols; break;
            case 'ArrowUp':    next = i - cols; break;
            case 'Home':       next = 0; break;
            case 'End':        next = openers.length - 1; break;
            default: return;
        }

        e.preventDefault();
        // Clamp rather than wrap — wrapping across rows is disorienting.
        next = Math.min(openers.length - 1, Math.max(0, next));
        openers[next].focus();
        openers[next].closest('[data-id]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    if (body) {
        body.addEventListener('click', (e) => {
            const share = e.target.closest('[data-share]');
            if (share) { window.openShare && window.openShare(share.dataset.share); return; }
            const cmp = e.target.closest('[data-compare]');
            if (cmp) {
                window.toggleCompare && window.toggleCompare(cmp.dataset.compare);
                const on = state.compare.includes(cmp.dataset.compare);
                cmp.setAttribute('aria-pressed', String(on));
                cmp.innerHTML = `${window.icon(on ? 'check' : 'scale', { raw: true, size: 16 })} ${on ? 'In comparison' : 'Compare'}`;
                return;
            }
            const rel = e.target.closest('.rel-card[data-open]');
            if (rel) { window.openProject(rel.dataset.open); return; }
            const edit = e.target.closest('[data-act="edit"]');
            if (edit && window.editProject) { window.closeProject(); window.editProject(edit.dataset.id); }
        });
    }

    /* Reflect URL-seeded state in the controls before the first paint, so a
       shared link like /?on=android&sort=stars shows those controls already set. */
    (function syncControls() {
        const searchEl = document.getElementById('search');
        if (searchEl) searchEl.value = state.search;
        const sortEl = document.getElementById('sortSelect');
        if (sortEl) sortEl.value = state.sort;
        paintSegment();
    })();

    /* First paint: skeletons until the data layer reports in. */
    render();
})();
