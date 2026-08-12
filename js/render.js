/* ===========================================================================
   render.js  (classic script)
   The presentation layer for project data. Owns:

     · TONES            per-project duotone palettes, restated for paper
     · renderProjects() the grid — skeleton → empty → cards
     · filters/sort     derived from the data, never hardcoded
     · stats + stack    both computed from the real projects
     · detail sheet     live preview, GitHub stats, language bar, prev/next
     · deep links       #project-slug opens the matching project

   No Firestore access happens here; it reads whatever window.getProjects()
   hands over. That separation is what lets the whole UI be swapped without
   touching the data layer.
   =========================================================================== */

/* -------- Duotones ------------------------------------------------------ */
window.TONES = {
    indigo: 'indigo', blue: 'blue', sky: 'sky', teal: 'teal',
    emerald: 'emerald', green: 'emerald', yellow: 'yellow', orange: 'orange',
    red: 'red', pink: 'pink', purple: 'purple', slate: 'slate', gray: 'slate'
};
window.TONE_KEYS = ['indigo', 'blue', 'sky', 'teal', 'emerald', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];

/* Inline CSS custom properties for a project's colour. Reading them from the
   stylesheet keeps every colour in tokens.css rather than scattered in JS. */
window.toneVars = (color) => {
    const key = window.TONES[color] || 'slate';
    return `--tone-a:var(--tone-${key}-a);--tone-b:var(--tone-${key}-b);`
         + `--tone-t:var(--tone-${key}-t);--tone-i:var(--tone-${key}-i);`;
};

/* -------- Escaping (everything from Firestore is untrusted) ------------- */
window.esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/* Only http/https survive — blocks javascript: and data: URLs in href/src. */
window.safeUrl = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw, location.href);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch { return ''; }
};

(() => {
    const grid = document.getElementById('grid');
    const filterBox = document.getElementById('filters');
    const statsBox = document.getElementById('stats');
    const stackBox = document.getElementById('stackGrid');
    const countEl = document.getElementById('resultCount');

    const starById = {};
    const langById = {};
    let currentDetailId = null;
    let deepLinkDone = false;

    /* View + query state. The single place the grid's contents are decided.
       Seeded from the URL so a filtered view is a shareable link. */
    const params = new URLSearchParams(location.search);
    const state = window.PState = {
        filter: params.get('cat') || 'all',
        search: params.get('q') || '',
        sort: params.get('sort') || 'newest',
        view: params.get('view') || localStorage.getItem('view') || 'grid'
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
        const qs = next.toString();
        const url = location.pathname + (qs ? `?${qs}` : '') + location.hash;
        try { history.replaceState(null, '', url); } catch { /* file:// */ }
    }
    window.syncUrl = syncUrl;

    const projects = () => (window.getProjects ? window.getProjects() : []);
    const loaded = () => (window.projectsLoaded ? window.projectsLoaded() : false);

    const slugify = (s) => String(s || '').toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    window.projectSlug = (p) => slugify(p && p.title) || String((p && p.id) || '');

    const titleCase = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

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

    function visibleProjects() {
        const needle = state.search.toLowerCase().trim();

        let list = projects().filter((p) => {
            if (state.filter !== 'all' && (p.category || 'other') !== state.filter) return false;
            if (!needle) return true;
            const hay = [p.title, p.desc, p.longDesc, p.role, p.year, ...(p.tags || [])]
                .filter(Boolean).join(' ').toLowerCase();
            return hay.includes(needle);
        });

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

    /* =====================================================================
       Card
       ===================================================================== */

    function cardHtml(p, index) {
        const id = window.esc(p.id);
        const tags = (p.tags || []).filter(Boolean);
        const shown = tags.slice(0, 4);
        const overflow = tags.length - shown.length;

        const admin = window.isAdmin ? `
            <div class="card-admin">
                <button type="button" data-drag title="Drag to reorder" aria-label="Drag ${window.esc(p.title)} to reorder" class="is-handle">${window.icon('drag', { raw: true, size: 13 })}</button>
                <button type="button" data-act="edit" data-id="${id}" title="Edit project" aria-label="Edit ${window.esc(p.title)}">${window.icon('pencil', { raw: true, size: 13 })}</button>
                <button type="button" data-act="dupe" data-id="${id}" title="Duplicate project" aria-label="Duplicate ${window.esc(p.title)}">${window.icon('copy', { raw: true, size: 13 })}</button>
                <button type="button" data-act="del" data-id="${id}" class="is-danger" title="Delete project" aria-label="Delete ${window.esc(p.title)}">${window.icon('trash', { raw: true, size: 13 })}</button>
            </div>` : '';

        const marks = [
            p.featured ? `<span class="card-mark card-mark--star" title="Featured">${window.icon('star-fill', { raw: true, size: 12 })}</span>` : '',
            p.caseStudy ? `<span class="card-mark card-mark--case" title="Has a case study">${window.icon('doc', { raw: true, size: 12 })}</span>` : ''
        ].filter(Boolean).join('');
        const star = marks ? `<div class="card-star">${marks}</div>` : '';

        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;

        return `
        <article class="card" data-tilt data-cursor="Open"
                 role="button" tabindex="0"
                 data-id="${id}"
                 data-category="${window.esc(p.category || 'other')}"
                 ${repo ? `data-repo="${window.esc(repo)}"` : ''}
                 data-reveal="card" style="${window.toneVars(p.color)}--delay:${Math.min(index, 9) * 55}ms"
                 aria-label="${window.esc(p.title)} — open details">
            ${admin}${star}
            <div class="card-plaque">${window.icon(p.icon, { size: 23 })}</div>
            <div class="card-body">
                <div class="card-head">
                    <h3 class="card-title">${window.esc(p.title)}</h3>
                    ${window.statusBadge(p.status)}
                </div>
                <p class="card-desc u-clamp-2">${window.esc(p.desc)}</p>
                ${shown.length ? `<div class="card-tags">
                    ${shown.map((t) => `<span class="tag">${window.esc(t)}</span>`).join('')}
                    ${overflow > 0 ? `<span class="tag">+${overflow}</span>` : ''}
                </div>` : ''}
            </div>
            <div class="card-foot">
                <span class="card-cat"><s></s>${window.esc(titleCase(p.category || 'other'))}</span>
                <span class="card-gh">${p.year ? window.esc(p.year) : ''}</span>
            </div>
        </article>`;
    }

    /* =====================================================================
       Grid render
       ===================================================================== */

    function paint() {
        const list = visibleProjects();

        if (!list.length) {
            const hasAny = projects().length > 0;
            grid.innerHTML = `
                <div class="empty">
                    ${window.icon(hasAny ? 'search' : 'folder', { raw: true, size: 30 })}
                    <h3>${hasAny ? 'Nothing matches that' : 'No projects yet'}</h3>
                    <p>${hasAny
                        ? 'Try a different search or clear the filters.'
                        : 'New work is on the way — check back shortly.'}</p>
                </div>`;
        } else {
            grid.innerHTML = list.map(cardHtml).join('');
        }

        grid.classList.toggle('is-list', state.view === 'list');

        if (countEl) {
            const total = projects().length;
            countEl.textContent = list.length === total
                ? `${total} project${total === 1 ? '' : 's'}`
                : `${list.length} of ${total}`;
        }

        if (window.Motion) {
            window.Motion.reveal(grid);
            window.Motion.tilt(grid);
        }
        hydrateCardStats();
    }

    /* Wrap re-layouts in a View Transition where the browser supports it —
       filtering then cross-fades and slides instead of snapping. */
    function render() {
        if (!loaded()) {
            grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('');
            return;
        }
        renderFilters();
        renderStats();
        renderStack();
        syncUrl();

        if (document.startViewTransition && !window.motionReduced()) {
            document.startViewTransition(() => paint());
        } else {
            paint();
        }

        if (!deepLinkDone) {
            deepLinkDone = true;
            if (location.hash) setTimeout(openFromHash, 80);
        }
    }
    window.renderProjects = render;

    /* =====================================================================
       Filters — derived from the categories actually in use
       ===================================================================== */

    function renderFilters() {
        if (!filterBox) return;
        const counts = {};
        projects().forEach((p) => {
            const c = p.category || 'other';
            counts[c] = (counts[c] || 0) + 1;
        });
        const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));

        const chip = (key, label, count) =>
            `<button class="chip ${state.filter === key ? 'is-active' : ''}" data-filter="${window.esc(key)}">
                ${window.esc(label)}<b>${count}</b>
            </button>`;

        filterBox.innerHTML = chip('all', 'All', projects().length)
            + cats.map((c) => chip(c, titleCase(c), counts[c])).join('');
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
    window.setView = (view) => {
        state.view = view;
        localStorage.setItem('view', view);
        document.querySelectorAll('.segment button').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.view === view);
        });
        const thumb = document.querySelector('.segment .thumb');
        if (thumb) thumb.style.transform = view === 'list' ? 'translateX(36px)' : 'translateX(0)';
        render();
    };

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

        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el && window.Motion) window.Motion.odometer(el, val);
            else if (el) el.textContent = val;
        };
        set('statProjects', list.length);
        set('statStars', stars);
        set('statTech', techs.size);
        set('statCats', cats);

        set('figProjects', list.length);
        set('figTech', techs.size);
        const shipped = list.filter((p) => p.status === 'live').length;
        set('figLive', shipped);
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
        stackBox.innerHTML = ranked.map((t, i) => `
            <button class="stack-cell" data-reveal="fade" style="--pct:${Math.round((t.n / max) * 100)}%;--delay:${i * 40}ms"
                    data-tag="${window.esc(t.name)}" title="Filter projects using ${window.esc(t.name)}">
                <b>${window.esc(t.name)}</b>
                <span>${t.n} project${t.n === 1 ? '' : 's'}</span>
                <i></i>
            </button>`).join('');

        // The usage bar animates in with the cell.
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-in');
                io.unobserve(entry.target);
            });
        }, { threshold: 0.3 });
        stackBox.querySelectorAll('.stack-cell').forEach((el) => io.observe(el));

        if (window.Motion) window.Motion.reveal(stackBox);
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
                slot.innerHTML = `${year ? `${window.esc(year)} <s style="width:3px;height:3px;border-radius:50%;background:var(--ink-20);display:inline-block;vertical-align:middle"></s> ` : ''}`
                    + `${window.icon('star', { raw: true, size: 12 })} ${stats.stars}`;
                slot.style.display = 'inline-flex';
                slot.style.alignItems = 'center';
                slot.style.gap = '6px';
            } else if (stats.language) {
                slot.innerHTML = `<s style="width:7px;height:7px;border-radius:50%;display:inline-block;background:${window.langColor(stats.language)}"></s> ${window.esc(stats.language)}`;
                slot.style.display = 'inline-flex';
                slot.style.alignItems = 'center';
                slot.style.gap = '6px';
            }
        }));
        renderStats();
    }

    async function hydrateAllStats() {
        await Promise.allSettled(projects().map(async (p) => {
            const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
            if (!repo) return;
            const s = await window.fetchGitHubStats(repo);
            if (s) { starById[p.id] = s.stars; if (s.language) langById[p.id] = s.language; }
        }));
    }

    /* =====================================================================
       Detail sheet
       ===================================================================== */

    const sheet = document.getElementById('detailSheet');
    const body = document.getElementById('detailBody');

    window.openProject = (id) => {
        const p = projects().find((x) => String(x.id) === String(id));
        if (!p || !sheet || !body) return;
        currentDetailId = String(id);

        const link = window.safeUrl(p.link);
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
        const embed = p.demoVideo ? toEmbed(p.demoVideo) : '';
        const deploy = window.deployInfo ? window.deployInfo(link) : null;

        const media = embed
            ? `<iframe src="${window.esc(embed)}" loading="lazy" title="${window.esc(p.title)} demo"
                       allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                       allowfullscreen></iframe>`
            : (link
                ? `<iframe src="${window.esc(link)}" loading="lazy" title="${window.esc(p.title)} live preview"
                           sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>`
                : '');

        const highlights = Array.isArray(p.highlights) ? p.highlights.filter((h) => String(h).trim()) : [];
        const tags = (p.tags || []).filter(Boolean);

        body.innerHTML = `
            <div class="detail-media" style="${window.toneVars(p.color)}">
                <div class="fallback">
                    <div class="card-plaque">${window.icon(p.icon, { size: 23 })}</div>
                    <p>Preview can't be embedded — open the project to view it.</p>
                </div>
                ${media}
            </div>

            <div class="sheet-body">
                <h2 class="detail-title">${window.esc(p.title)}</h2>
                <div class="detail-meta">
                    ${p.category ? `<span>${window.esc(String(p.category).toUpperCase())}</span>` : ''}
                    ${window.statusBadge(p.status)}
                    ${deploy ? `<span>${window.icon(deploy.icon, { raw: true, size: 12 })} ${window.esc(deploy.name)}</span>` : ''}
                    ${p.year ? `<span>${window.icon('calendar', { raw: true, size: 12 })} ${window.esc(p.year)}</span>` : ''}
                    ${p.role ? `<span>${window.icon('sparkles', { raw: true, size: 12 })} ${window.esc(p.role)}</span>` : ''}
                </div>

                <p class="detail-lead">${window.esc(p.desc)}</p>
                ${p.longDesc ? `<div class="detail-prose">${window.esc(p.longDesc)}</div>` : ''}

                ${highlights.length ? `
                    <div class="detail-sub">Highlights</div>
                    <ul class="hilite">
                        ${highlights.map((h) => `<li>${window.icon('check', { raw: true, size: 15 })}<span>${window.esc(h)}</span></li>`).join('')}
                    </ul>` : ''}

                ${tags.length ? `
                    <div class="detail-sub">Built with</div>
                    <div class="card-tags" style="margin-top:0">
                        ${tags.map((t) => `<span class="tag">${window.esc(t)}</span>`).join('')}
                    </div>` : ''}

                <div id="ghStats" class="ghstats u-hidden" style="margin-top:24px"></div>
                <div id="ghLangs"></div>

                <div class="detail-actions">
                    ${p.caseStudy ? `<a href="case.html?p=${encodeURIComponent(window.projectSlug(p))}" class="btn btn--primary magnetic" data-cursor="Read">
                        ${window.icon('doc', { raw: true, size: 17 })} Read the case study</a>` : ''}
                    ${link ? `<a href="${window.esc(link)}" target="_blank" rel="noopener noreferrer" class="btn ${p.caseStudy ? 'btn--ghost' : 'btn--primary'} magnetic" data-cursor="Visit">
                        ${window.icon('external', { raw: true, size: 17 })} Visit live</a>` : ''}
                    ${repo ? `<a href="${window.esc(repo)}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost magnetic" data-cursor="Code">
                        ${window.icon('github', { raw: true, size: 17 })} View code</a>` : ''}
                    <button class="btn btn--quiet" data-share="${window.esc(p.id)}">
                        ${window.icon('share', { raw: true, size: 16 })} Share</button>
                    ${window.isAdmin ? `<button class="btn btn--quiet" data-act="edit" data-id="${window.esc(p.id)}">
                        ${window.icon('pencil', { raw: true, size: 16 })} Edit</button>` : ''}
                </div>
            </div>`;

        window.openSheet(sheet);
        if (window.Motion) window.Motion.magnetic(body);

        // Keep any active filter in the URL alongside the open project.
        try {
            history.replaceState(null, '', `${location.pathname}${location.search}#${window.projectSlug(p)}`);
        } catch { /* file:// */ }

        // GitHub stats + language breakdown, async and non-blocking.
        if (repo && window.fetchGitHubStats) {
            window.fetchGitHubStats(repo).then((s) => {
                if (String(currentDetailId) !== String(id) || !s) return;
                starById[id] = s.stars;
                const row = document.getElementById('ghStats');
                if (!row) return;
                row.innerHTML = `
                    <span class="ghstat">${window.icon('star', { raw: true, size: 13 })} <b>${s.stars.toLocaleString()}</b> stars</span>
                    <span class="ghstat">${window.icon('fork', { raw: true, size: 13 })} <b>${s.forks.toLocaleString()}</b> forks</span>
                    ${s.updatedAt ? `<span class="ghstat">${window.icon('clock', { raw: true, size: 13 })} updated <b>${window.relativeTime(s.updatedAt)}</b></span>` : ''}`;
                row.classList.remove('u-hidden');
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
                        `<span><s style="background:${window.langColor(l.name)}"></s>${window.esc(l.name)} ${l.pct.toFixed(1)}%</span>`).join('')}</div>`;
            });
        }
    };

    window.closeProject = () => {
        if (!sheet) return;
        window.closeSheet(sheet);
        currentDetailId = null;
        setTimeout(() => { if (body && !sheet.classList.contains('is-open')) body.innerHTML = ''; }, 380);
        try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// */ }
    };

    /* Prev/next walks the currently visible, currently sorted list. */
    window.detailNav = (dir) => {
        const ids = visibleProjects().map((p) => String(p.id));
        if (!ids.length) return;
        let i = ids.indexOf(String(currentDetailId));
        if (i === -1) i = 0;
        window.openProject(ids[(i + dir + ids.length) % ids.length]);
    };

    /* On Vercel there is a real /p/<slug> route that serves per-project OG
       tags to crawlers before bouncing a human to the site. Anywhere else
       (GitHub Pages, localhost) fall back to the hash deep link, which works
       for people but not for link previews. */
    const HAS_EDGE = /(^|\.)arnavdugad\.in$/i.test(location.hostname)
        || /\.vercel\.app$/i.test(location.hostname);

    window.projectUrl = (p) => (HAS_EDGE
        ? `${location.origin}/p/${encodeURIComponent(window.projectSlug(p))}`
        : `${location.origin}${location.pathname}#${window.projectSlug(p)}`);

    window.shareProject = (id) => {
        const p = projects().find((x) => String(x.id) === String(id));
        if (!p) return;
        const url = window.projectUrl(p);
        if (navigator.share) {
            navigator.share({ title: `${p.title} — Arnav Dugad`, text: p.desc, url }).catch(() => {});
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(url)
                .then(() => window.toast('Link copied to clipboard', 'success'))
                .catch(() => window.toast('Could not copy the link', 'error'));
        } else {
            window.toast(url, 'info');
        }
    };

    window.randomProject = () => {
        const list = visibleProjects();
        if (!list.length) { window.toast('Nothing to pick from', 'info'); return; }
        window.openProject(list[Math.floor(Math.random() * list.length)].id);
    };

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

    /* =====================================================================
       Grid interactions (delegated, so re-renders never lose handlers)
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
        const card = e.target.closest('.card');
        if (card) window.openProject(card.dataset.id);
    });

    grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.card');
        if (!card) return;
        e.preventDefault();
        window.openProject(card.dataset.id);
    });

    if (body) {
        body.addEventListener('click', (e) => {
            const share = e.target.closest('[data-share]');
            if (share) { window.shareProject(share.dataset.share); return; }
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
        document.querySelectorAll('.segment button[data-view]').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.view === state.view);
        });
        const thumb = document.querySelector('.segment .thumb');
        if (thumb) thumb.style.transform = state.view === 'list' ? 'translateX(36px)' : 'translateX(0)';
    })();

    /* First paint: skeletons until the data layer reports in. */
    render();
})();
