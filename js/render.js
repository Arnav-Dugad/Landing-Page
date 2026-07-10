/* ===========================================================================
   render.js  (classic script)
   The presentation layer the modular refactor was missing. It owns:
     - COLOR_MAP (gradient classes) + DOT_COLOR (hex) — the single source of
       truth for project colors, shared with ui.js's live preview.
     - window.renderAllProjects() — builds cards purely from Firestore data
       (window.getDynamicProjects()); shows skeletons until the first snapshot
       and an empty-state when there are genuinely no projects.
     - The premium project detail modal (open/close, live preview, GitHub stats).
     - initTilt(), pickRandomProject().
   No project data and no Firestore access live here.
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
/* Inline hex for the status dot — avoids Tailwind purging a dynamic
   `bg-${color}-500` class that never appears literally in the markup. */
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

/* -------- Skeleton + empty states --------------------------------------- */
function renderSkeletons(count = 8) {
    projectsGrid.innerHTML = Array.from({ length: count })
        .map(() => `<div class="skeleton-card"></div>`).join('');
}

function renderEmptyState() {
    const adminHint = window.isAdmin
        ? `<button onclick="window.importSeedProjects && window.importSeedProjects()" class="mt-4 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">Import starter projects</button>`
        : `<p class="text-slate-600 text-sm mt-2">Check back soon — new work is on the way.</p>`;
    projectsGrid.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center text-center py-20">
            <div class="w-16 h-16 rounded-2xl bg-white/5 border border-dashed border-white/20 flex items-center justify-center mb-4">
                <i class="fas fa-folder-open text-2xl text-slate-500"></i>
            </div>
            <h3 class="text-xl font-bold text-slate-300">No projects yet</h3>
            ${adminHint}
        </div>`;
}

/* -------- The card + full render ---------------------------------------- */
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
    const tagsHtml = tags
        .map((t) => `<span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-300 mr-1">${window.escapeHtml(t)}</span>`)
        .join('');

    // data-search powers ui.js's title+desc+tags search.
    const haystack = window.escapeHtml([project.title, project.desc, ...tags].filter(Boolean).join(' '));

    const deleteBtn = (window.isAdmin && isDynamic)
        ? `<button onclick="event.stopPropagation(); window.deleteProjectFromDb('${window.escapeHtml(project.id)}')" class="delete-btn absolute top-3 left-3 w-8 h-8 rounded-full bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white flex items-center justify-center transition-all z-20" title="Delete project"><i class="fas fa-trash-alt text-xs"></i></button>`
        : '';

    const catLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : '';

    return `
    <div role="button" tabindex="0" onclick="window.openDetailModal('${window.escapeHtml(project.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.openDetailModal('${window.escapeHtml(project.id)}')}" onmouseenter="playHoverSound && playHoverSound()" data-category="${category}" data-search="${haystack}" data-id="${window.escapeHtml(project.id)}" class="project-card glass-card group rounded-2xl p-6 flex flex-col h-64 relative overflow-hidden opacity-0 animate-fade-in-up ${delayClass}">
        ${deleteBtn}
        <div class="glass-card-content h-full flex flex-col">
            <div class="mt-2 mb-auto icon-wrapper flex justify-center items-center">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <i class="fas ${icon} text-xl text-white icon-glow"></i>
                </div>
            </div>
            <div class="text-content">
                <h3 class="text-xl font-bold mb-2 group-hover:text-indigo-300 transition-colors">${title}</h3>
                <p class="text-sm text-slate-400 line-clamp-2">${desc}</p>
            </div>
            <div class="mt-4 flex flex-wrap gap-y-1 tags-container">${tagsHtml}</div>
            <div class="mt-2 flex items-center text-xs text-slate-500 font-mono">
                <span class="w-2 h-2 rounded-full mr-2 animate-pulse" style="background:${dot}"></span> ${catLabel}
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

window.renderAllProjects = () => {
    // Until firebase.js has loaded and reported its first snapshot, show
    // skeletons rather than a misleading "no projects" state.
    const loaded = window.hasLoadedProjects ? window.hasLoadedProjects() : false;
    if (!loaded) { renderSkeletons(); return; }

    const projects = window.getDynamicProjects ? window.getDynamicProjects() : [];
    if (!projects.length) { renderEmptyState(); return; }

    projectsGrid.innerHTML = projects.map((p, i) => cardHtml(p, i)).join('') + comingSoonHtml;

    // Re-apply any active filter/search after a re-render.
    const activeBtn = document.querySelector('.filter-btn.active');
    if (activeBtn && window.filterProjects) {
        const search = document.getElementById('searchInput');
        window.filterProjects(activeBtn.getAttribute('data-filter'), search ? search.value : '');
    }
    initTilt();
};

/* -------- 3D tilt on cards ---------------------------------------------- */
function initTilt() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
    pick.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pick.classList.add('ring-2', 'ring-indigo-400');
    setTimeout(() => pick.classList.remove('ring-2', 'ring-indigo-400'), 1200);
    const id = pick.getAttribute('data-id');
    if (id) setTimeout(() => window.openDetailModal(id), 400);
};

/* -------- Project detail modal ------------------------------------------ */
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
    }, 300);
};

window.openDetailModal = (id) => {
    if (!detailModal || !detailBody) return;
    const projects = window.getDynamicProjects ? window.getDynamicProjects() : [];
    const p = projects.find((x) => String(x.id) === String(id));
    if (!p) return;

    const gradient = window.COLOR_MAP[p.color] || window.COLOR_MAP.gray;
    const icon = window.escapeHtml(p.icon || 'fa-cube');
    const title = window.escapeHtml(p.title);
    const desc = window.escapeHtml(p.desc);
    const category = window.escapeHtml(p.category || '');
    const link = window.escapeHtml(p.link || '');
    const repo = window.escapeHtml(p.repo || '');
    const tags = (p.tags || []).map((t) => `<span class="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-slate-300">${window.escapeHtml(t)}</span>`).join('');

    const codeBtn = repo
        ? `<a href="${repo}" target="_blank" rel="noopener" class="btn-ghost"><i class="fab fa-github"></i> View Code</a>`
        : '';

    detailBody.innerHTML = `
        <div class="detail-frame-wrap mb-6">
            <div class="detail-frame-fallback">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg">
                    <i class="fas ${icon} text-2xl text-white"></i>
                </div>
                <p class="text-sm">Live preview unavailable — open the project to view it.</p>
            </div>
            ${link ? `<iframe src="${link}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" title="${title} live preview"></iframe>` : ''}
        </div>

        <div class="flex items-start gap-4 mb-4">
            <div class="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg">
                <i class="fas ${icon} text-xl text-white"></i>
            </div>
            <div class="min-w-0">
                <h2 class="text-2xl font-bold text-white leading-tight">${title}</h2>
                ${category ? `<span class="text-xs font-mono uppercase tracking-widest text-indigo-300">${category}</span>` : ''}
            </div>
        </div>

        <p class="text-slate-300 leading-relaxed mb-4">${desc}</p>
        ${tags ? `<div class="flex flex-wrap gap-2 mb-5">${tags}</div>` : ''}

        <div id="detailGhStats" class="hidden flex-wrap items-center gap-4 mb-6 text-sm text-slate-300"></div>

        <div class="flex flex-wrap gap-3">
            ${link ? `<a href="${link}" target="_blank" rel="noopener" class="btn-primary"><i class="fas fa-external-link-alt"></i> Visit Live</a>` : ''}
            ${codeBtn}
        </div>`;

    // Reveal
    detailModal.classList.remove('hidden');
    setTimeout(() => {
        detailModal.classList.remove('opacity-0');
        const panel = detailModal.querySelector('.detail-panel');
        if (panel) panel.classList.remove('scale-95');
    }, 10);
    window.playClickSound && playClickSound();

    // GitHub stats (async, non-blocking)
    if (p.repo && window.fetchGitHubStats) {
        window.fetchGitHubStats(p.repo).then((stats) => {
            const row = document.getElementById('detailGhStats');
            if (!row || !stats) return;
            row.innerHTML = `
                <span title="Stars"><i class="fas fa-star text-yellow-400"></i> ${stats.stars.toLocaleString()}</span>
                <span title="Forks"><i class="fas fa-code-branch text-slate-400"></i> ${stats.forks.toLocaleString()}</span>
                ${stats.updatedAt ? `<span class="text-slate-400" title="Last push"><i class="fas fa-clock"></i> ${window.relativeTime(stats.updatedAt)}</span>` : ''}`;
            row.classList.remove('hidden');
            row.classList.add('flex');
        });
    }
};

if (detailModal) {
    detailModal.addEventListener('mousedown', (e) => { if (e.target === detailModal) window.closeDetailModal(); });
}

/* First paint: show skeletons until Firestore's first snapshot arrives. */
renderAllProjects();
