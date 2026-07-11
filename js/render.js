/* ===========================================================================
   render.js  (classic script)
   Presentation layer. Owns:
     - COLOR_MAP / DOT_COLOR (shared with ui.js live preview)
     - window.renderAllProjects() — cards from Firestore, with skeletons/empty
     - Card badges (status, deploy platform, featured) + async GitHub ⭐ stars
     - Portfolio stats bar, sorting + featured-first
     - Project detail modal: live preview, GitHub stats + language bar,
       prev/next navigation, share
     - initTilt(), pickRandomProject()
   No project data / Firestore access lives here.
   =========================================================================== */

/* -------- Colors (shared with ui.js live preview) ----------------------- */
window.COLOR_MAP = {
    orange:  "from-orange-500 to-red-600",
    blue:    "from-blue-500 to-cyan-500",
    emerald: "from-emerald-500 to-green-600",
    green:   "from-emerald-500 to-green-600",
    purple:  "from-purple-500 to-pink-500",
    indigo:  "from-indigo-500 to-violet-600",
    sky:     "from-sky-400 to-blue-600",
    yellow:  "from-yellow-500 to-amber-600",
    red:     "from-red-500 to-rose-700",
    pink:    "from-pink-500 to-rose-500",
    teal:    "from-teal-400 to-emerald-600",
    slate:   "from-slate-500 to-gray-700",
    gray:    "from-slate-500 to-gray-700"
};
window.DOT_COLOR = {
    orange: "#f97316", blue: "#3b82f6", emerald: "#10b981", green: "#10b981",
    purple: "#a855f7", indigo: "#6366f1", sky: "#38bdf8", yellow: "#eab308",
    red: "#ef4444", pink: "#ec4899", teal: "#14b8a6", slate: "#64748b", gray: "#64748b"
};

/* -------- HTML escaping (Firestore text is untrusted) ------------------- */
window.escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const projectsGrid = document.getElementById('projectsGrid');

/* -------- Module state -------------------------------------------------- */
const starById = {};        // projectId -> stargazers
const langById = {};        // projectId -> primary language
let currentSort = 'newest';
let currentDetailId = null;

const getProjects = () => (window.getDynamicProjects ? window.getDynamicProjects() : []);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------- Slug / deep-link helpers -------------------------------------- */
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
window.projectSlug = (p) => slugify(p && p.title) || String(p && p.id || '');

/* Normalize a YouTube/Vimeo URL to an embeddable form; other URLs pass through. */
function toEmbedUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
        if (host.endsWith('youtube.com')) {
            if (u.pathname.startsWith('/embed/')) return url;
            const v = u.searchParams.get('v');
            if (v) return `https://www.youtube.com/embed/${v}`;
        }
        if (host === 'vimeo.com') return `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean)[0]}`;
        return url;
    } catch { return null; }
}

/* -------- Status badge -------------------------------------------------- */
const STATUS = {
    live:     { label: 'Live',        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    wip:      { label: 'In Progress', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    archived: { label: 'Archived',    cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
};
function statusPill(status) {
    const s = STATUS[status];
    return s ? `<span class="px-2 py-0.5 rounded-md border text-[10px] font-medium ${s.cls}">${s.label}</span>` : '';
}
function deployPill(link, withLabel) {
    const d = window.deployInfo ? window.deployInfo(link) : null;
    if (!d) return '';
    const label = withLabel ? ` ${window.escapeHtml(d.name)}` : '';
    return `<span class="deploy-pill inline-flex items-center gap-1 text-[10px]" style="color:${d.color}" title="Deployed on ${window.escapeHtml(d.name)}"><i class="${d.icon}"></i>${label}</span>`;
}
window.statusPill = statusPill;      // reused by ui.js live preview
window.deployPill = deployPill;

/* -------- Skeleton + empty states --------------------------------------- */
function renderSkeletons(count = 8) {
    projectsGrid.innerHTML = Array.from({ length: count })
        .map(() => `<div class="skeleton-card"></div>`).join('');
}

function renderEmptyState() {
    const cta = window.isAdmin
        ? `<button onclick="toggleModal(true)" class="mt-4 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"><i class="fas fa-plus mr-1"></i> Add your first project</button>`
        : `<p class="text-slate-600 text-sm mt-2">Check back soon — new work is on the way.</p>`;
    projectsGrid.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center text-center py-20">
            <div class="w-16 h-16 rounded-2xl bg-white/5 border border-dashed border-white/20 flex items-center justify-center mb-4">
                <i class="fas fa-folder-open text-2xl text-slate-500"></i>
            </div>
            <h3 class="text-xl font-bold text-slate-300">No projects yet</h3>
            ${cta}
        </div>`;
}

/* -------- Card ---------------------------------------------------------- */
function cardHtml(project, index) {
    const delayClass = `stagger-${(index % 8) + 1}`;
    const gradient = window.COLOR_MAP[project.color] || window.COLOR_MAP.gray;
    const dot = window.DOT_COLOR[project.color] || window.DOT_COLOR.gray;
    const isDynamic = !(project.id && String(project.id).startsWith('static'));

    const title = window.escapeHtml(project.title);
    const desc = window.escapeHtml(project.desc);
    const category = window.escapeHtml(project.category || '');
    const icon = window.escapeHtml(project.icon || 'fa-cube');

    const tags = project.tags || [];
    const MAX_CARD_TAGS = 4;
    const tagPill = (t) => `<span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-300 mr-1 whitespace-nowrap">${window.escapeHtml(t)}</span>`;
    const extraTags = tags.length - MAX_CARD_TAGS;
    const tagsHtml = tags.slice(0, MAX_CARD_TAGS).map(tagPill).join('')
        + (extraTags > 0 ? `<span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-400 mr-1">+${extraTags}</span>` : '');
    const year = window.escapeHtml(project.year || '');

    const haystack = window.escapeHtml([project.title, project.desc, ...tags].filter(Boolean).join(' '));

    const deleteBtn = (window.isAdmin && isDynamic)
        ? `<button onclick="event.stopPropagation(); window.deleteProjectFromDb('${window.escapeHtml(project.id)}')" class="delete-btn absolute top-3 left-3 w-8 h-8 rounded-full bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white flex items-center justify-center transition-all z-20" title="Delete project"><i class="fas fa-trash-alt text-xs"></i></button>`
        : '';

    const featured = project.featured
        ? `<div class="feat-badge" title="Featured"><i class="fas fa-star"></i></div>` : '';

    const catLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : '';
    const repoUrl = window.resolveRepoUrl ? window.resolveRepoUrl(project) : null;
    const repoAttr = repoUrl ? ` data-repo="${window.escapeHtml(repoUrl)}"` : '';

    return `
    <div role="button" tabindex="0" onclick="window.openDetailModal('${window.escapeHtml(project.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.openDetailModal('${window.escapeHtml(project.id)}')}" onmouseenter="playHoverSound && playHoverSound()" data-category="${category}" data-search="${haystack}" data-id="${window.escapeHtml(project.id)}"${repoAttr} class="project-card glass-card group rounded-2xl p-6 flex flex-col min-h-[16rem] relative overflow-hidden opacity-0 animate-fade-in-up ${delayClass}">
        ${deleteBtn}
        ${featured}
        <div class="glass-card-content h-full flex flex-col">
            <div class="mt-2 mb-auto icon-wrapper flex justify-center items-center">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <i class="fas ${icon} text-xl text-white icon-glow"></i>
                </div>
            </div>
            <div class="text-content">
                <div class="flex items-center gap-2 mb-2">
                    <h3 class="text-xl font-bold group-hover:text-indigo-300 transition-colors truncate">${title}</h3>
                    ${statusPill(project.status)}
                </div>
                <p class="text-sm text-slate-400 line-clamp-2">${desc}</p>
            </div>
            <div class="mt-4 flex flex-wrap gap-y-1 tags-container">${tagsHtml}</div>
            <div class="mt-2 flex items-center justify-between text-xs text-slate-500 font-mono gap-2">
                <span class="flex items-center gap-2 min-w-0">
                    <span class="w-2 h-2 rounded-full animate-pulse shrink-0" style="background:${dot}"></span> <span class="truncate">${catLabel}</span>
                    ${deployPill(project.link, false)}
                </span>
                <span class="flex items-center gap-2 shrink-0">
                    ${year ? `<span class="text-slate-500">${year}</span>` : ''}
                    <span class="gh-star inline-flex items-center gap-1 text-slate-400"></span>
                </span>
            </div>
        </div>
    </div>`;
}

const comingSoonHtml = `
    <div class="project-card glass-card coming-soon group rounded-2xl p-6 flex flex-col h-64 relative overflow-hidden opacity-0 animate-fade-in-up stagger-9 cursor-not-allowed">
        <div class="glass-card-content h-full flex flex-col items-center justify-center text-center">
            <div class="w-12 h-12 rounded-xl bg-white/5 border border-dashed border-white/20 flex items-center justify-center mb-4">
                <i class="fas fa-plus text-xl text-slate-500"></i>
            </div>
            <h3 class="text-xl font-bold mb-2 text-slate-500">More Coming Soon</h3>
            <p class="text-sm text-slate-600">Working on new ideas...</p>
        </div>
    </div>`;

/* -------- Sorting ------------------------------------------------------- */
/* Featured pins to the top ONLY in 'featured' sort; every other mode sorts
   purely by its key so the reordering is actually visible. */
function sortProjects(projects) {
    const arr = [...projects];
    arr.sort((a, b) => {
        if (currentSort === 'featured') {
            const fa = a.featured ? 1 : 0, fb = b.featured ? 1 : 0;
            if (fa !== fb) return fb - fa;
            return (b.createdAt || 0) - (a.createdAt || 0);
        }
        if (currentSort === 'az') return String(a.title || '').localeCompare(String(b.title || ''));
        if (currentSort === 'stars') return (starById[b.id] ?? -1) - (starById[a.id] ?? -1);
        return (b.createdAt || 0) - (a.createdAt || 0);   // newest (default)
    });
    return arr;
}

window.setSort = async (mode) => {
    currentSort = mode;
    window.currentSort = mode;
    window.playClickSound && playClickSound();
    if (mode === 'stars') await hydrateAllStats();   // sort on real numbers
    renderAllProjects();
};

/* -------- Full render --------------------------------------------------- */
window.renderAllProjects = () => {
    const loaded = window.hasLoadedProjects ? window.hasLoadedProjects() : false;
    if (!loaded) { renderSkeletons(); return; }

    const projects = getProjects();
    if (!projects.length) { renderEmptyState(); updateStatsBar(); return; }

    renderFilters();
    const ordered = sortProjects(projects);
    projectsGrid.innerHTML = ordered.map((p, i) => cardHtml(p, i)).join('') + comingSoonHtml;

    const activeBtn = document.querySelector('.filter-btn.active');
    if (activeBtn && window.filterProjects) {
        const search = document.getElementById('searchInput');
        window.filterProjects(activeBtn.getAttribute('data-filter'), search ? search.value : '');
    }
    initTilt();
    updateStatsBar();
    hydrateCardStats();

    // Open a deep-linked project once, after the first real render.
    if (!deepLinkChecked) {
        deepLinkChecked = true;
        if (location.hash) setTimeout(openFromHash, 60);
    }
};

/* -------- Dynamic category filters -------------------------------------- */
const filterContainer = document.getElementById('filterContainer');
function renderFilters() {
    if (!filterContainer) return;
    const projects = getProjects();
    const counts = {};
    projects.forEach((p) => { const c = (p.category || 'other'); counts[c] = (counts[c] || 0) + 1; });
    const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    const active = filterContainer.querySelector('.filter-btn.active')?.getAttribute('data-filter') || 'all';
    const label = (c) => c.charAt(0).toUpperCase() + c.slice(1);
    const chip = (filter, text, count) =>
        `<button class="filter-btn ${active === filter ? 'active' : ''} px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 border border-transparent transition-all whitespace-nowrap shrink-0" onmouseenter="playHoverSound && playHoverSound()" data-filter="${filter}">${text}<span class="ml-1.5 opacity-50">${count}</span></button>`;
    filterContainer.innerHTML = chip('all', 'All', projects.length)
        + cats.map((c) => chip(c, label(window.escapeHtml(c)), counts[c])).join('');
}
// Delegated click handling so dynamically-rebuilt chips keep working.
if (filterContainer) {
    filterContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        filterContainer.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        window.playClickSound && playClickSound();
        const search = document.getElementById('searchInput');
        window.filterProjects && window.filterProjects(btn.getAttribute('data-filter'), search ? search.value : '');
    });
}

/* -------- Deep-link open by #slug --------------------------------------- */
let deepLinkChecked = false;
function openFromHash() {
    const slug = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (!slug) return;
    const p = getProjects().find((x) => window.projectSlug(x) === slug);
    if (p) window.openDetailModal(p.id);
}
window.addEventListener('hashchange', () => {
    // Only react to external hash changes (our own open/close use replaceState).
    if (detailModal && detailModal.classList.contains('hidden')) openFromHash();
});

/* -------- GitHub stats hydration ---------------------------------------- */
async function hydrateCardStats() {
    const cards = Array.from(document.querySelectorAll('#projectsGrid .project-card[data-repo]'));
    await Promise.allSettled(cards.map(async (card) => {
        const repo = card.getAttribute('data-repo');
        const id = card.getAttribute('data-id');
        const stats = await window.fetchGitHubStats(repo);
        if (!stats) return;
        starById[id] = stats.stars;
        if (stats.language) langById[id] = stats.language;
        const el = card.querySelector('.gh-star');
        if (!el) return;
        if (stats.stars > 0) {
            el.innerHTML = `<i class="fas fa-star text-yellow-400"></i> ${stats.stars}`;
        } else if (stats.language) {
            el.innerHTML = `<span class="w-2 h-2 rounded-full inline-block" style="background:${window.langColor(stats.language)}"></span> ${window.escapeHtml(stats.language)}`;
        }
    }));
    updateStatsBar();
}

async function hydrateAllStats() {
    const projects = getProjects();
    await Promise.allSettled(projects.map(async (p) => {
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
        if (!repo) return;
        const s = await window.fetchGitHubStats(repo);
        if (s) { starById[p.id] = s.stars; if (s.language) langById[p.id] = s.language; }
    }));
}

/* -------- Portfolio stats bar ------------------------------------------- */
function countUp(el, from, to) {
    if (reduceMotion() || from === to) { el.textContent = to.toLocaleString(); return; }
    const start = performance.now();
    const dur = 600;
    const step = (now) => {
        const t = Math.min(1, (now - start) / dur);
        const val = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
        el.textContent = val.toLocaleString();
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
function setStat(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = parseInt(el.dataset.val || '0', 10);
    if (cur === target) return;
    el.dataset.val = String(target);
    countUp(el, cur, target);
}
function updateStatsBar() {
    const bar = document.getElementById('statsBar');
    if (!bar) return;
    const projects = getProjects();
    if (!projects.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const totalStars = Object.values(starById).reduce((a, b) => a + b, 0);
    const techs = new Set();
    projects.forEach((p) => (p.tags || []).forEach((t) => {
        const s = String(t).trim().toLowerCase();
        if (s) techs.add(s);
    }));
    const cats = new Set(projects.map((p) => p.category).filter(Boolean)).size;
    setStat('stat-projects', projects.length);
    setStat('stat-stars', totalStars);
    setStat('stat-langs', techs.size);
    setStat('stat-cats', cats);
}

/* -------- 3D tilt ------------------------------------------------------- */
function initTilt() {
    if (reduceMotion()) return;
    document.querySelectorAll('#projectsGrid .glass-card').forEach((card) => {
        card.onmousemove = (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.transform = `perspective(1000px) rotateX(${((y - rect.height / 2) / rect.height / 2) * -10}deg) rotateY(${((x - rect.width / 2) / rect.width / 2) * 10}deg) scale3d(1.02, 1.02, 1.02)`;
        };
        card.onmouseleave = () => { card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)'; };
    });
}
window.initTilt = initTilt;

/* -------- "Feeling lucky" ----------------------------------------------- */
window.pickRandomProject = () => {
    const cards = Array.from(document.querySelectorAll('.project-card:not(.coming-soon)'))
        .filter((c) => c.style.display !== 'none');
    if (!cards.length) { window.showToast && showToast("No projects to pick from.", "info"); return; }
    const pick = cards[Math.floor(Math.random() * cards.length)];
    const id = pick.getAttribute('data-id');
    if (id) window.openDetailModal(id);
};

/* -------- Detail modal -------------------------------------------------- */
const detailModal = document.getElementById('detailModal');
const detailBody = document.getElementById('detailBody');

window.closeDetailModal = () => {
    if (!detailModal) return;
    detailModal.classList.add('opacity-0');
    const panel = detailModal.querySelector('.detail-panel');
    if (panel) panel.classList.add('scale-95');
    setTimeout(() => {
        detailModal.classList.add('hidden');
        if (detailBody) detailBody.innerHTML = '';   // stop any iframe from loading
        currentDetailId = null;
    }, 300);
    // Drop the #slug from the URL.
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
};

window.openDetailModal = (id) => {
    if (!detailModal || !detailBody) return;
    const p = getProjects().find((x) => String(x.id) === String(id));
    if (!p) return;
    currentDetailId = String(id);

    const gradient = window.COLOR_MAP[p.color] || window.COLOR_MAP.gray;
    const icon = window.escapeHtml(p.icon || 'fa-cube');
    const title = window.escapeHtml(p.title);
    const desc = window.escapeHtml(p.desc);
    const longDesc = p.longDesc ? window.escapeHtml(p.longDesc) : '';
    const category = window.escapeHtml(p.category || '');
    const link = window.escapeHtml(p.link || '');
    const repoUrl = window.resolveRepoUrl ? window.resolveRepoUrl(p) : null;
    const repoEsc = repoUrl ? window.escapeHtml(repoUrl) : '';
    const year = window.escapeHtml(p.year || '');
    const role = window.escapeHtml(p.role || '');
    const tags = (p.tags || []).map((t) => `<span class="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-slate-300">${window.escapeHtml(t)}</span>`).join('');

    const highlights = Array.isArray(p.highlights) ? p.highlights.filter((h) => String(h).trim()) : [];
    const highlightsHtml = highlights.length
        ? `<div class="mb-5">
               <h4 class="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2"><i class="fas fa-bolt text-indigo-400"></i> Highlights</h4>
               <ul class="space-y-1.5">${highlights.map((h) => `<li class="flex gap-2 text-sm text-slate-400"><i class="fas fa-check text-emerald-400 mt-1 text-xs shrink-0"></i><span>${window.escapeHtml(h)}</span></li>`).join('')}</ul>
           </div>`
        : '';

    // Demo video takes the media slot when present; otherwise the live iframe.
    const embed = p.demoVideo ? toEmbedUrl(p.demoVideo) : null;
    const mediaInner = embed
        ? `<iframe src="${window.escapeHtml(embed)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="${title} demo video"></iframe>`
        : (link ? `<iframe src="${link}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" title="${title} live preview"></iframe>` : '');

    detailBody.innerHTML = `
        <div class="detail-frame-wrap mb-6">
            <div class="detail-frame-fallback">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg">
                    <i class="fas ${icon} text-2xl text-white"></i>
                </div>
                <p class="text-sm">Preview unavailable — open the project to view it.</p>
            </div>
            ${mediaInner}
        </div>

        <div class="flex items-start gap-4 mb-3">
            <div class="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg">
                <i class="fas ${icon} text-xl text-white"></i>
            </div>
            <div class="min-w-0">
                <h2 class="text-2xl font-bold text-white leading-tight">${title}</h2>
                <div class="flex flex-wrap items-center gap-2 mt-1">
                    ${category ? `<span class="text-xs font-mono uppercase tracking-widest text-indigo-300">${category}</span>` : ''}
                    ${statusPill(p.status)}
                    ${deployPill(p.link, true)}
                    ${year ? `<span class="text-xs text-slate-400"><i class="far fa-calendar mr-1"></i>${year}</span>` : ''}
                    ${role ? `<span class="text-xs text-slate-400"><i class="fas fa-user mr-1"></i>${role}</span>` : ''}
                </div>
            </div>
        </div>

        <p class="text-slate-300 leading-relaxed mb-3">${desc}</p>
        ${longDesc ? `<p class="text-slate-400 text-sm leading-relaxed mb-4 whitespace-pre-line">${longDesc}</p>` : ''}
        ${highlightsHtml}
        ${tags ? `<div class="flex flex-wrap gap-2 mb-4">${tags}</div>` : ''}

        <div id="detailGhStats" class="hidden flex-wrap items-center gap-4 mb-3 text-sm text-slate-300"></div>
        <div id="detailLangs" class="mb-6"></div>

        <div class="flex flex-wrap gap-3">
            ${link ? `<a href="${link}" target="_blank" rel="noopener" class="btn-primary"><i class="fas fa-external-link-alt"></i> Visit Live</a>` : ''}
            ${repoUrl ? `<a href="${repoEsc}" target="_blank" rel="noopener" class="btn-ghost"><i class="fab fa-github"></i> View Code</a>` : ''}
            <button onclick="window.shareProject('${window.escapeHtml(String(id))}')" class="btn-ghost"><i class="fas fa-share-nodes"></i> Share</button>
        </div>`;

    // Deep link: reflect the open project in the URL without firing hashchange.
    try { history.replaceState(null, '', '#' + window.projectSlug(p)); } catch {}

    detailModal.classList.remove('hidden');
    setTimeout(() => {
        detailModal.classList.remove('opacity-0');
        const panel = detailModal.querySelector('.detail-panel');
        if (panel) panel.classList.remove('scale-95');
    }, 10);
    window.playClickSound && playClickSound();

    // GitHub stats + language bar (async, non-blocking).
    if (repoUrl && window.fetchGitHubStats) {
        window.fetchGitHubStats(repoUrl).then((stats) => {
            if (String(currentDetailId) !== String(id)) return;   // user moved on
            const row = document.getElementById('detailGhStats');
            if (!row || !stats) return;
            starById[id] = stats.stars;
            if (stats.language) langById[id] = stats.language;
            row.innerHTML = `
                <span title="Stars"><i class="fas fa-star text-yellow-400"></i> ${stats.stars.toLocaleString()}</span>
                <span title="Forks"><i class="fas fa-code-branch text-slate-400"></i> ${stats.forks.toLocaleString()}</span>
                ${stats.updatedAt ? `<span class="text-slate-400" title="Last push"><i class="fas fa-clock"></i> ${window.relativeTime(stats.updatedAt)}</span>` : ''}`;
            row.classList.remove('hidden');
            row.classList.add('flex');
        });
    }
    if (repoUrl && window.fetchGitHubLanguages) {
        window.fetchGitHubLanguages(repoUrl).then((langs) => {
            if (String(currentDetailId) !== String(id)) return;
            const box = document.getElementById('detailLangs');
            if (!box || !langs.length) return;
            const top = langs.slice(0, 6);
            const segs = top.map((l) => `<span style="width:${l.pct}%;background:${window.langColor(l.name)}" title="${window.escapeHtml(l.name)} ${l.pct.toFixed(1)}%"></span>`).join('');
            const legend = top.map((l) => `<span class="inline-flex items-center gap-1.5 text-xs text-slate-400"><span class="w-2.5 h-2.5 rounded-full" style="background:${window.langColor(l.name)}"></span>${window.escapeHtml(l.name)} ${l.pct.toFixed(1)}%</span>`).join('');
            box.innerHTML = `<div class="lang-bar">${segs}</div><div class="lang-legend flex flex-wrap gap-x-4 gap-y-1 mt-2">${legend}</div>`;
        });
    }
};

/* Prev/next through the currently-visible cards (respects filter + sort). */
window.detailNav = (dir) => {
    const ids = Array.from(document.querySelectorAll('#projectsGrid .project-card:not(.coming-soon)'))
        .filter((c) => c.style.display !== 'none')
        .map((c) => c.getAttribute('data-id'));
    if (!ids.length) return;
    let idx = ids.indexOf(currentDetailId);
    if (idx === -1) idx = 0;
    const ni = (idx + dir + ids.length) % ids.length;
    window.openDetailModal(ids[ni]);
};

window.shareProject = (id) => {
    const p = getProjects().find((x) => String(x.id) === String(id));
    if (!p) return;
    // Share a deep link back to this exact project on the portfolio.
    const url = location.origin + location.pathname + '#' + window.projectSlug(p);
    if (navigator.share) {
        navigator.share({ title: `${p.title} — Arnav Dugad`, text: p.desc, url }).catch(() => {});
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url)
            .then(() => window.showToast && showToast('Link copied to clipboard!', 'success'))
            .catch(() => window.showToast && showToast('Could not copy link', 'error'));
    } else {
        window.showToast && showToast(url, 'info');
    }
};

if (detailModal) {
    detailModal.addEventListener('mousedown', (e) => { if (e.target === detailModal) window.closeDetailModal(); });
}
// Arrow-key navigation while the detail modal is open.
document.addEventListener('keydown', (e) => {
    if (!detailModal || detailModal.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); window.detailNav(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); window.detailNav(1); }
});

/* First paint: skeletons until Firestore's first snapshot arrives. */
renderAllProjects();
