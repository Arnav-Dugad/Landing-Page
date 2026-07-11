/* ===========================================================================
   ui.js  (classic script)
   Chrome around the projects: toasts, theme switcher, grid/list toggle,
   category filters + search, admin login, add-project modal + live preview,
   contact modal, and keyboard shortcuts. No project data lives here.
   =========================================================================== */

/* -------- Toasts -------------------------------------------------------- */
window.showToast = (message, type = "info") => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    let bgClass = "bg-slate-800", borderClass = "border-slate-600", icon = "fa-info-circle";
    if (type === "success") { bgClass = "bg-emerald-900/90"; borderClass = "border-emerald-500/50"; icon = "fa-check-circle"; }
    else if (type === "error") { bgClass = "bg-red-900/90"; borderClass = "border-red-500/50"; icon = "fa-exclamation-circle"; }
    toast.className = `p-4 rounded-xl border ${borderClass} ${bgClass} text-white shadow-lg backdrop-blur-md flex items-center gap-3 min-w-[300px] animate-slide-in-right`;
    toast.innerHTML = `<i class="fas ${icon} text-lg"></i><span class="text-sm font-medium">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.replace('animate-slide-in-right', 'animate-slide-out-right');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

/* -------- Theme switcher ------------------------------------------------ */
const themes = ['', 'theme-midnight', 'theme-sunset', 'theme-ocean'];
let currentThemeIndex = 0;
window.toggleTheme = () => {
    const oldTheme = themes[currentThemeIndex];
    if (oldTheme) document.body.classList.remove(oldTheme);
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    const newTheme = themes[currentThemeIndex];
    if (newTheme) { document.body.classList.add(newTheme); showToast(`Theme: ${newTheme.replace('theme-', '')}`, "info"); }
    else showToast(`Theme: Default`, "info");
    playClickSound();
};

/* -------- Generic modal helpers ----------------------------------------- */
function openModal(modal, content) {
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); if (content) content.classList.remove('scale-95'); }, 10);
}
function closeModal(modal, content) {
    modal.classList.add('opacity-0');
    if (content) content.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
}
// Close when clicking the dimmed backdrop (not the panel itself).
function bindBackdropClose(modal, closeFn) {
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeFn(); });
}

/* -------- Contact modal ------------------------------------------------- */
const contactModal = document.getElementById('contactModal');
const contactContent = contactModal.querySelector('div');
window.toggleContactModal = (show) => show ? openModal(contactModal, contactContent) : closeModal(contactModal, contactContent);
bindBackdropClose(contactModal, () => toggleContactModal(false));

document.getElementById('contactForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const msgData = {
        name: document.getElementById('cName').value,
        email: document.getElementById('cEmail').value,
        message: document.getElementById('cMessage').value
    };
    if (window.saveMessageToDb) window.saveMessageToDb(msgData);
});

/* -------- Add-project modal --------------------------------------------- */
const modal = document.getElementById('addProjectModal');
const modalContent = modal.querySelector('div');
window.toggleModal = (show) => {
    if (show) {
        openModal(modal, modalContent);
        const search = document.getElementById('iconSearch');
        if (search) { search.value = ''; }
        if (window.filterIcons) window.filterIcons('');
        updatePreview();
    } else closeModal(modal, modalContent);
};
bindBackdropClose(modal, () => toggleModal(false));

const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
document.getElementById('addProjectForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const tags = val('pTags').split(',').map(t => t.trim()).filter(Boolean);
    const featuredEl = document.getElementById('pFeatured');
    const highlights = val('pHighlights').split('\n').map(s => s.trim()).filter(Boolean);
    const newProject = {
        title: val('pTitle'),
        desc: val('pDesc'),
        longDesc: val('pLongDesc'),
        link: val('pLink'),
        category: val('pCategory'),
        color: val('pColor'),
        icon: val('pIcon'),
        repo: val('pRepo'),
        status: val('pStatus') || 'live',
        featured: featuredEl ? featuredEl.checked : false,
        year: val('pYear'),
        role: val('pRole'),
        demoVideo: val('pDemoVideo'),
        highlights,
        tags
    };
    if (typeof window.saveProjectToDb === 'function') window.saveProjectToDb(newProject);
    else showToast("System not ready. Please refresh.", "error");
});

/* -------- Live preview (shares COLOR_MAP with render.js) ---------------- */
function updatePreview() {
    const title = document.getElementById('pTitle').value || "Project Title";
    const desc = document.getElementById('pDesc').value || "Project description will appear here...";
    const category = document.getElementById('pCategory').value || "Category";
    const color = document.getElementById('pColor').value || "indigo";
    const icon = document.getElementById('pIcon').value || "fa-cube";
    const tagsVal = document.getElementById('pTags').value;
    const tags = tagsVal ? tagsVal.split(',').filter(t => t.trim()) : ["Tag 1", "Tag 2"];
    const gradient = (window.COLOR_MAP && window.COLOR_MAP[color]) || "from-indigo-500 to-violet-600";
    const dot = (window.DOT_COLOR && window.DOT_COLOR[color]) || "#6366f1";
    const status = document.getElementById('pStatus') ? document.getElementById('pStatus').value : '';
    const featured = document.getElementById('pFeatured') ? document.getElementById('pFeatured').checked : false;
    const link = document.getElementById('pLink') ? document.getElementById('pLink').value : '';
    const year = document.getElementById('pYear') ? document.getElementById('pYear').value.trim() : '';
    const statusHtml = (window.statusPill && status) ? window.statusPill(status) : '';
    const deployHtml = (window.deployPill && link) ? window.deployPill(link, false) : '';
    const featHtml = featured ? `<div class="feat-badge" title="Featured"><i class="fas fa-star"></i></div>` : '';
    const tagsHtml = tags.map(t => `<span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-300 mr-1">${t}</span>`).join('');
    document.getElementById('previewCardContainer').innerHTML = `
        <div class="glass-card group rounded-2xl p-6 flex flex-col h-64 relative overflow-hidden">
            ${featHtml}
            <div class="glass-card-content h-full flex flex-col">
                <div class="mt-2 mb-auto">
                    <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-lg">
                        <i class="fas ${icon} text-xl text-white"></i>
                    </div>
                    <div class="flex items-center gap-2 mb-2">
                        <h3 class="text-xl font-bold text-white truncate">${title}</h3>
                        ${statusHtml}
                    </div>
                    <p class="text-sm text-slate-400 line-clamp-2">${desc}</p>
                </div>
                <div class="mt-4 flex flex-wrap gap-y-1">${tagsHtml}</div>
                <div class="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 font-mono">
                    <span class="flex items-center gap-2"><span class="w-2 h-2 rounded-full" style="background:${dot}"></span> ${category.toUpperCase()} ${deployHtml}</span>
                    ${year ? `<span>${year}</span>` : ''}
                </div>
            </div>
        </div>`;
}
['pTitle', 'pDesc', 'pLink', 'pCategory', 'pColor', 'pIcon', 'pTags', 'pStatus', 'pFeatured', 'pYear'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', updatePreview);
    el.addEventListener('change', updatePreview);
});

/* -------- Searchable icon picker ---------------------------------------- */
window.filterIcons = (q) => {
    const grid = document.getElementById('iconGrid');
    if (!grid) return;
    const query = (q || '').toLowerCase().trim();
    let visible = 0;
    grid.querySelectorAll('.icon-option').forEach((el) => {
        const hay = `${el.getAttribute('title') || ''} ${el.className || ''}`.toLowerCase();
        const show = !query || hay.includes(query);
        el.style.display = show ? '' : 'none';
        if (show) visible++;
    });
    const none = document.getElementById('iconNoResult');
    if (none) none.classList.toggle('hidden', visible > 0);
};
window.updatePreview = updatePreview;

window.setIcon = (iconClass) => { document.getElementById('pIcon').value = iconClass; updatePreview(); };
window.addTag = (tag) => {
    const input = document.getElementById('pTags');
    input.value = input.value ? `${input.value}, ${tag}` : tag;
    updatePreview();
};
window.formatLink = (input) => { if (input.value && !input.value.startsWith('http')) input.value = 'https://' + input.value; };
window.testLink = () => {
    const link = document.getElementById('pLink').value;
    if (link) window.open(link, '_blank');
    else showToast("Please enter a link first.", "error");
};

/* -------- Grid / list view toggle --------------------------------------- */
window.currentView = 'grid';
window.setView = (view) => {
    window.currentView = view;
    const grid = document.getElementById('projectsGrid');
    const btnGrid = document.getElementById('btn-grid');
    const btnList = document.getElementById('btn-list');
    if (view === 'list') {
        grid.classList.remove('md:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4');
        grid.classList.add('list-view');
        btnList.classList.add('bg-white/10', 'text-white'); btnList.classList.remove('text-slate-400');
        btnGrid.classList.remove('bg-white/10', 'text-white'); btnGrid.classList.add('text-slate-400');
    } else {
        grid.classList.add('md:grid-cols-2', 'lg:grid-cols-3', 'xl:grid-cols-4');
        grid.classList.remove('list-view');
        btnGrid.classList.add('bg-white/10', 'text-white'); btnGrid.classList.remove('text-slate-400');
        btnList.classList.remove('bg-white/10', 'text-white'); btnList.classList.add('text-slate-400');
    }
    renderAllProjects();
};

/* -------- Filters + search (title + desc + tags via data-search) -------- */
window.filterProjects = (category, searchText = '') => {
    const needle = searchText.toLowerCase().trim();
    document.querySelectorAll('.project-card:not(.coming-soon)').forEach(card => {
        const projectCategory = card.getAttribute('data-category');
        const haystack = (card.getAttribute('data-search') || '').toLowerCase();
        const matchesCategory = category === 'all' || projectCategory === category;
        const matchesSearch = !needle || haystack.includes(needle);
        card.style.display = (matchesCategory && matchesSearch) ? 'flex' : 'none';
    });
};
// Category filter chips are generated + click-handled by render.js (delegation),
// so ui.js only owns the search box here.
const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', (e) => {
    const activeFilter = document.querySelector('.filter-btn.active')?.getAttribute('data-filter') || 'all';
    filterProjects(activeFilter, e.target.value);
});

/* -------- Admin login --------------------------------------------------- */
window.isAdmin = false;
const adminBtn = document.getElementById('adminToggleBtn');
const adminControls = document.getElementById('adminControls');
const projectsContainer = document.getElementById('projectsGrid');
adminBtn.addEventListener('click', () => {
    if (window.isAdmin) {
        window.isAdmin = false;
        adminControls.classList.add('hidden');
        projectsContainer.classList.remove('admin-mode');
        adminBtn.innerHTML = '<i class="fas fa-lock text-xs"></i>';
        renderAllProjects();
        showToast("Admin mode disabled", "info");
    } else {
        const pin = prompt("Enter Admin PIN:");
        if (pin === "8574") {
            window.isAdmin = true;
            adminControls.classList.remove('hidden');
            projectsContainer.classList.add('admin-mode');
            adminBtn.innerHTML = '<i class="fas fa-unlock text-xs text-emerald-400"></i>';
            renderAllProjects();
            showToast("Admin mode unlocked!", "success");
            updatePreview();
        } else if (pin !== null) {
            showToast("Incorrect PIN", "error");
        }
    }
});

/* -------- Keyboard shortcuts -------------------------------------------- */
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('searchInput').focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); toggleTheme(); }
    if (e.key === 'Escape') {
        toggleModal(false);
        toggleContactModal(false);
        if (window.closeDetailModal) window.closeDetailModal();
    }
});
