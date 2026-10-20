/* ===========================================================================
   render.js  (classic script)
   The presentation layer for project data. Owns:

     · renderProjects() the work area — skeleton → empty → grid / list /
                        index / timeline (the last two live in js/views.js)
     · filters/sort     derived from the data, never hardcoded
     · search           every word must match somewhere, including the
                        AI-written search terms, so "multiplayer" finds work
                        whose title never says it
     · stats + stack    both computed from the real projects
     · live status      server-checked up/down chips on every card
     · detail sheet     live preview, GitHub stats, changelog, reactions,
                        related projects, per-project theming
     · deep links       #project-slug opens the matching project

   Shared helpers (esc, safeUrl, toneVars, projectSlug, categoryLabel, EDGE)
   live in js/core.js so the standalone pages use the very same code.

   No Firestore access happens here; it reads whatever window.getProjects()
   hands over. That separation is what lets the whole UI be swapped without
   touching the data layer.
   =========================================================================== */

(() => {
    const grid = document.getElementById('grid');
    const filterBox = document.getElementById('filters');
    const statsBox = document.getElementById('stats');
    const stackBox = document.getElementById('stackGrid');
    const countEl = document.getElementById('resultCount');

    const esc = window.esc;
    const categoryLabel = window.categoryLabel;
    const W = () => window.Widgets || null;

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
        search: params.get('q') || '',
        sort: params.get('sort') || 'newest',
        view: VIEWS.includes(params.get('view')) ? params.get('view')
            : (VIEWS.includes(storedView) ? storedView : 'grid'),
        compare: (params.get('compare') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3)
    };

    /* Mirror the query back into the URL, omitting anything at its default so
       the common case stays a clean link. The hash (an open project) is left
       untouched — the two coexist as `/?cat=game#some-project`. */
    function syncUrl() {
        const next = new URLSearchParams();
        if (state.search.trim()) next.set('q', state.search.trim());
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

    /* =====================================================================
       Query pipeline: filter → search → sort
       ===================================================================== */

    /* Everything a visitor might type to find a project. searchTerms are
       written by the admin AI tools — synonyms and concepts that aren't in
       the copy itself, which is what makes search feel semantic without a
       model running on every keystroke. */
    const haystack = (p) => [
        p.title, p.desc, p.longDesc, p.role, p.year, categoryLabel(p.category),
        ...(p.tags || []), ...(p.searchTerms || []), ...(p.highlights || [])
    ].filter(Boolean).join(' ').toLowerCase();

    function matches(p, { filter = state.filter, search = state.search } = {}) {
        if (filter !== 'all' && (p.category || 'other') !== filter) return false;
        const words = String(search).toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (!words.length) return true;
        const hay = haystack(p);
        return words.every((w) => hay.includes(w));
    }

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
                case 'stars':  return (starById[b.id] ?? -1) - (starById[a.id] ?? -1);
                case 'oldest': return (a.createdAt || 0) - (b.createdAt || 0);
                case 'order':  return (a.order ?? 9999) - (b.order ?? 9999);
                default:       return (b.createdAt || 0) - (a.createdAt || 0);
            }
        });

        return list;
    }
    window.visibleProjects = visibleProjects;

    /* =====================================================================
       Card
       ===================================================================== */

    /* The card uses the "primary link" pattern: the title is the only real
       control for opening the project, and it stretches an invisible overlay
       across the whole card. Everything else (Visit, Code, admin) sits above
       that overlay. This keeps one accessible name per action and avoids
       nesting interactive elements inside a role="button" container. */
    function cardHtml(p, index) {
        const id = esc(p.id);
        const tags = (p.tags || []).filter(Boolean);
        const shown = tags.slice(0, 4);
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

        return `
        <article class="card ${picked ? 'is-picked' : ''}" data-tilt
                 data-id="${id}"
                 data-category="${esc(p.category || 'other')}"
                 ${repo ? `data-repo="${esc(repo)}"` : ''}
                 ${preview ? `data-preview="${esc(preview)}"` : ''}
                 data-reveal="card" style="${window.toneVars(p.color)}--delay:${Math.min(index, 9) * 55}ms">
            <i class="card-ink" aria-hidden="true"></i>
            ${admin}${star}

            <div class="card-plaque">${window.icon(p.icon, { size: 24 })}</div>

            <div class="card-body">
                <div class="card-head">
                    <h3 class="card-title"><button type="button" class="card-open" data-open="${id}" data-cursor="Open">${title}</button></h3>
                    ${window.statusBadge(p.status)}
                    <span class="card-live" data-status-slot></span>
                </div>
                <p class="card-desc u-clamp-2">${esc(p.desc)}</p>
                ${shown.length ? `<div class="card-tags">
                    ${shown.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
                    ${overflow > 0 ? `<span class="tag" title="${esc(tags.slice(4).join(', '))}">+${overflow}</span>` : ''}
                </div>` : ''}
            </div>

            <div class="card-foot">
                <span class="card-cat"><s></s>${esc(categoryLabel(p.category))}</span>
                <span class="card-gh">${p.year ? esc(p.year) : ''}</span>
            </div>

            <div class="card-actions">
                ${link ? `<a class="card-act card-act--go" href="${esc(link)}" target="_blank" rel="noopener noreferrer"
                    data-cursor="Visit" aria-label="Visit ${title} live">
                    ${window.icon('external', { raw: true, size: 14 })}<span>Visit</span></a>` : ''}
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
        const offers = [];

        if (hasSearch && hasFilter) {
            const n = all.filter((p) => matches(p, { filter: 'all' })).length;
            if (n) offers.push({ act: 'all-cats', label: `Search every category`, n });
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
            offers.push({ act: 'all-cats', label: 'Show every category', n: all.length });
        }

        // Popular tech as a gentle nudge.
        const tally = {};
        all.forEach((p) => (p.tags || []).forEach((t) => { tally[t] = (tally[t] || 0) + 1; }));
        const ideas = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

        return `
            <div class="empty">
                ${emptyArt()}
                <h3>Nothing matches ${hasSearch ? `“${esc(state.search.trim())}”` : 'that'}</h3>
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
        if (act === 'clear-search' || act === 'reset') { state.search = ''; if (searchEl) searchEl.value = ''; }
        if (act === 'reset') state.filter = 'all';
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
            countEl.textContent = list.length === total
                ? `${total} project${total === 1 ? '' : 's'}`
                : `${list.length} of ${total}`;
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
            grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('');
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

        if (!deepLinkDone) {
            deepLinkDone = true;
            loadStatuses();
            if (location.hash) setTimeout(openFromHash, 80);
        }
    }
    window.renderProjects = render;

    /* =====================================================================
       Filters — derived from the categories actually in use
       ===================================================================== */

    /* The travelling indicator behind the active filter chip, created lazily
       once Motion is available. */
    let movePill = null;

    function renderFilters() {
        if (!filterBox) return;
        const counts = {};
        projects().forEach((p) => {
            const c = p.category || 'other';
            counts[c] = (counts[c] || 0) + 1;
        });
        const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));

        const chip = (key, label, count) =>
            `<button class="chip ${state.filter === key ? 'is-active' : ''}" data-filter="${esc(key)}">
                ${esc(label)}<b>${count}</b>
            </button>`;

        filterBox.innerHTML = chip('all', 'All', projects().length)
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
    window.setSort = async (mode) => {
        state.sort = mode;
        const sel = document.getElementById('sortSelect');
        if (sel && sel.value !== mode) sel.value = mode;
        if (mode === 'stars') await hydrateAllStats();
        render();
    };
    window.setSearch = (text) => { state.search = text; render(); };

    function paintSegment() {
        const at = Math.max(0, VIEWS.indexOf(state.view));
        document.querySelectorAll('.segment button[data-view]').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.view === state.view);
            b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
        });
        const thumb = document.querySelector('.segment .thumb');
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
       Stats + hero figures
       ===================================================================== */

    function renderStats() {
        const list = projects();
        if (!statsBox) return;
        statsBox.classList.toggle('u-hidden', !list.length);
        if (!list.length) return;

        const stars = Object.values(starById).reduce((a, b) => a + b, 0);
        const techs = new Set();
        list.forEach((p) => (p.tags || []).forEach((t) => {
            const s = String(t).trim().toLowerCase();
            if (s) techs.add(s);
        }));
        const cats = new Set(list.map((p) => p.category || 'other')).size;

        // Numbers roll only once they are actually on screen — a counter that
        // finishes before anyone sees it might as well be static text.
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (window.Motion && window.Motion.tickerInView) window.Motion.tickerInView(el, val);
            else el.textContent = val;
        };
        set('statProjects', list.length);
        set('statStars', stars);
        set('statTech', techs.size);
        set('statCats', cats);

        set('figProjects', list.length);
        set('figTech', techs.size);
        set('figLive', liveCount(list));
    }

    /* "Live right now" means exactly that once the server has checked: links
       that answered. Until then, the projects marked live. */
    function liveCount(list) {
        const checked = list.filter((p) => statusById[p.id]);
        if (!checked.length) return list.filter((p) => p.status === 'live').length;
        return checked.filter((p) => statusById[p.id].up).length;
    }

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
       GitHub hydration
       ===================================================================== */

    async function hydrateCardStats() {
        const cards = Array.from(grid.querySelectorAll('.card[data-repo]'));
        await Promise.allSettled(cards.map(async (card) => {
            const stats = await window.fetchGitHubStats(card.dataset.repo);
            if (!stats) return;
            const id = card.dataset.id;
            starById[id] = stats.stars;
            if (stats.language) langById[id] = stats.language;

            const slot = card.querySelector('.card-gh');
            if (!slot) return;
            const year = slot.textContent.trim();
            if (stats.stars > 0) {
                slot.innerHTML = `${year ? `${esc(year)} <s class="card-gh-sep"></s> ` : ''}`
                    + `${window.icon('star', { raw: true, size: 12 })} ${stats.stars}`;
            } else if (stats.language) {
                slot.innerHTML = `<s class="card-gh-lang" style="background:${window.langColor(stats.language)}"></s> ${esc(stats.language)}`;
            }
        }));
        renderStats();
        if (window.isAdmin) flagMissingRepos();
    }

    async function hydrateAllStats() {
        await Promise.allSettled(projects().map(async (p) => {
            const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
            if (!repo) return;
            const s = await window.fetchGitHubStats(repo);
            if (s) { starById[p.id] = s.stars; if (s.language) langById[p.id] = s.language; }
        }));
    }
    window.projectStars = (id) => starById[id];

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
       Detail sheet
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

        const media = embed
            ? `<iframe src="${esc(embed)}" loading="lazy" title="${esc(p.title)} demo"
                       allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                       allowfullscreen></iframe>`
            : (link
                ? `<iframe src="${esc(link)}" loading="lazy" title="${esc(p.title)} live preview"
                           sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>`
                : '');

        const highlights = Array.isArray(p.highlights) ? p.highlights.filter((h) => String(h).trim()) : [];
        const tags = (p.tags || []).filter(Boolean);
        const status = statusById[p.id];

        const related = W() && W().relatedProjects ? W().relatedProjects(p, projects(), 3) : [];

        /* The actions live in a sticky header, not at the bottom of the sheet.
           Visiting the project is the single most likely thing anyone wants to
           do here, and it should never require scrolling past a write-up. */
        const actions = `
            <div class="detail-actions">
                ${p.caseStudy ? `<a href="case.html?p=${encodeURIComponent(slug)}" data-case="${esc(slug)}" class="btn btn--primary magnetic" data-cursor="Read">
                    ${window.icon('doc', { raw: true, size: 17 })} Case study</a>` : ''}
                ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="btn ${p.caseStudy ? 'btn--ghost' : 'btn--primary'} magnetic" data-cursor="Visit">
                    ${window.icon('external', { raw: true, size: 17 })} Visit live</a>` : ''}
                ${repo ? `<a href="${esc(repo)}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost magnetic" data-cursor="Code">
                    ${window.icon('github', { raw: true, size: 17 })} View code</a>` : ''}
                <button class="btn btn--quiet" data-share="${esc(p.id)}">
                    ${window.icon('share', { raw: true, size: 16 })} Share</button>
                <button class="btn btn--quiet" data-compare="${esc(p.id)}" aria-pressed="${picked}">
                    ${window.icon(picked ? 'check' : 'scale', { raw: true, size: 16 })} ${picked ? 'In comparison' : 'Compare'}</button>
                ${window.isAdmin ? `<button class="btn btn--quiet" data-act="edit" data-id="${esc(p.id)}">
                    ${window.icon('pencil', { raw: true, size: 16 })} Edit</button>` : ''}
            </div>`;

        return `
            <header class="detail-top" style="${window.toneVars(p.color)}">
                <div class="detail-ident">
                    <div class="card-plaque" data-vt="plaque">${window.icon(p.icon, { size: 24 })}</div>
                    <div class="detail-names">
                        <h2 class="detail-title" data-vt="title">${esc(p.title)}</h2>
                        <div class="detail-meta">
                            ${p.category ? `<span>${esc(categoryLabel(p.category))}</span>` : ''}
                            ${status && p.status === 'live' ? '' : window.statusBadge(p.status)}
                            ${status && W() ? W().statusChip(status) : ''}
                            ${deploy ? `<span>${window.icon(deploy.icon, { raw: true, size: 12 })} ${esc(deploy.name)}</span>` : ''}
                            ${p.year ? `<span>${window.icon('calendar', { raw: true, size: 12 })} ${esc(p.year)}</span>` : ''}
                            ${p.role ? `<span>${window.icon('sparkles', { raw: true, size: 12 })} ${esc(p.role)}</span>` : ''}
                        </div>
                    </div>
                </div>
                ${actions}
            </header>

            <div class="detail-media" style="${window.toneVars(p.color)}">
                <div class="fallback">
                    <div class="card-plaque">${window.icon(p.icon, { size: 24 })}</div>
                    <p>Preview can't be embedded — use <strong>Visit live</strong> above to open it.</p>
                </div>
                ${media}
            </div>

            <div class="sheet-body">
                <p class="detail-lead">${esc(p.desc)}</p>
                ${p.longDesc ? `<div class="detail-prose">${esc(p.longDesc)}</div>` : ''}

                ${highlights.length ? `
                    <div class="detail-sub">Highlights</div>
                    <ul class="hilite">
                        ${highlights.map((h) => `<li>${window.icon('check', { raw: true, size: 15 })}<span>${esc(h)}</span></li>`).join('')}
                    </ul>` : ''}

                ${tags.length ? `
                    <div class="detail-sub">Built with</div>
                    <div class="detail-tech">
                        ${tags.map((t) => `<span class="tech tmark-host">${W() && W().techMark ? W().techMark(t, { size: 22 }) : ''}<span>${esc(t)}</span></span>`).join('')}
                    </div>` : ''}

                <div id="ghStats" class="ghstats u-hidden" style="margin-top:24px"></div>
                <div id="ghLangs"></div>
                <div id="detailChangelog" class="detail-changelog"></div>

                ${W() && W().reactionsHtml ? W().reactionsHtml(slug) : ''}

                ${related.length ? `
                    <div class="detail-related">
                        <div class="detail-sub">More like this</div>
                        ${W().relatedHtml(related, { link: () => null })}
                    </div>` : ''}
            </div>`;
    }

    function fillDetailAsync(p, id) {
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;

        // GitHub stats + language breakdown, async and non-blocking.
        if (repo && window.fetchGitHubStats) {
            window.fetchGitHubStats(repo).then((s) => {
                if (String(currentDetailId) !== String(id) || !s) return;
                starById[id] = s.stars;
                const row = document.getElementById('ghStats');
                if (!row) return;
                row.innerHTML = `
                    <span class="ghstat">${window.icon('star', { raw: true, size: 13 })} <b data-tick="${s.stars}">0</b> stars</span>
                    <span class="ghstat">${window.icon('fork', { raw: true, size: 13 })} <b data-tick="${s.forks}">0</b> forks</span>
                    ${s.updatedAt ? `<span class="ghstat">${window.icon('clock', { raw: true, size: 13 })} updated <b>${window.relativeTime(s.updatedAt)}</b></span>` : ''}`;
                row.classList.remove('u-hidden');
                row.querySelectorAll('[data-tick]').forEach((el) => {
                    const n = Number(el.dataset.tick);
                    if (window.Motion && window.Motion.tickerInView) window.Motion.tickerInView(el, n, { root: sheet.querySelector('.sheet-panel') });
                    else el.textContent = n.toLocaleString();
                });
            });
        }
        if (repo && window.fetchGitHubLanguages) {
            window.fetchGitHubLanguages(repo).then((langs) => {
                if (String(currentDetailId) !== String(id) || !langs.length) return;
                const box = document.getElementById('ghLangs');
                if (!box) return;
                const top = langs.slice(0, 6);
                box.innerHTML = `
                    <div class="detail-sub">Language breakdown</div>
                    <div class="langbar">${top.map((l, i) =>
                        `<span style="width:${l.pct}%;background:${window.langColor(l.name)};animation-delay:${i * 90}ms"></span>`).join('')}</div>
                    <div class="langlegend">${top.map((l) =>
                        `<span><s style="background:${window.langColor(l.name)}"></s>${esc(l.name)} ${l.pct.toFixed(1)}%</span>`).join('')}</div>`;
            });
        }

        const log = document.getElementById('detailChangelog');
        if (log && W() && W().mountChangelog) {
            if (repo) W().mountChangelog(log, repo);
            else log.classList.add('u-hidden');
        }
        if (W() && W().mountReactions) W().mountReactions(body);
    }

    /* Opens a project. When it was opened from a visible card, the card's
       plaque and title morph into the sheet's (View Transitions); anything
       else — palette, deep link, prev/next — opens normally. */
    window.openProject = (id, { from = null } = {}) => {
        const p = projects().find((x) => String(x.id) === String(id));
        if (!p || !sheet || !body) return;
        const wasOpen = sheet.classList.contains('is-open');
        currentDetailId = String(id);

        const source = from || (!wasOpen ? grid.querySelector(`[data-id="${CSS.escape(String(id))}"]`) : null);
        const morph = source && canTransition() && source.getBoundingClientRect().bottom > 0
            && source.getBoundingClientRect().top < window.innerHeight;

        const swap = () => {
            body.innerHTML = detailHtml(p);
            window.hydrateIcons && window.hydrateIcons(body);
            if (morph) {
                body.querySelector('[data-vt="plaque"]').style.viewTransitionName = 'vt-plaque';
                body.querySelector('[data-vt="title"]').style.viewTransitionName = 'vt-title';
                source.querySelector('.card-plaque, .ix-mark, .tl-plaque')?.style.setProperty('view-transition-name', 'none');
                source.querySelector('.card-open, .ix-title, .tl-title')?.style.setProperty('view-transition-name', 'none');
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
            source.querySelector('.card-plaque, .ix-mark, .tl-plaque')?.style.setProperty('view-transition-name', 'vt-plaque');
            source.querySelector('.card-open, .ix-title, .tl-title')?.style.setProperty('view-transition-name', 'vt-title');
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
        const host = fromEl.closest('.card, .detail-top, .ix-row, .tl-item');
        if (!host) return;
        document.querySelectorAll('[style*="case-title"], [style*="case-plaque"]').forEach((el) => {
            el.style.removeProperty('view-transition-name');
        });
        host.querySelector('.card-open, .detail-title, .ix-title, .tl-title')?.style.setProperty('view-transition-name', 'case-title');
        host.querySelector('.card-plaque, .ix-mark, .tl-plaque')?.style.setProperty('view-transition-name', 'case-plaque');
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

        // Real links (Visit / Code / Case study) are left alone entirely.
        if (e.target.closest('.card-act, a[href]')) return;

        const open = e.target.closest('[data-open]');
        if (open) { window.openProject(open.dataset.open, { from: open.closest('[data-id]') }); return; }

        // Clicking anywhere else on the card counts as opening it — the title
        // button's stretched overlay handles most of this, but padding and the
        // plaque sit outside it.
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
       shared link like /?cat=game&sort=stars shows those controls already set. */
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
