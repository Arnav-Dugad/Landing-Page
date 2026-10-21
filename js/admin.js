/* ===========================================================================
   admin.js  (classic script)
   The project editor: add, EDIT, duplicate and delete, with a live preview
   card that renders through exactly the same code path as the real grid.

   Admin state is NOT a client flag any more — it is derived from the Firebase
   session (`user.isAnonymous === false`). Hiding the buttons is cosmetic; what
   actually decides whether a write lands is firestore.rules matching the
   signed-in account.
   =========================================================================== */

(() => {
    const sheet = document.getElementById('editorSheet');
    const form = document.getElementById('editorForm');
    const preview = document.getElementById('editorPreview');
    const titleEl = document.getElementById('editorTitle');
    const subEl = document.getElementById('editorSub');
    const saveBtn = document.getElementById('editorSave');
    if (!sheet || !form) return;

    const F = (id) => document.getElementById(id);
    const val = (id) => { const el = F(id); return el ? String(el.value).trim() : ''; };

    /* editingId === null means "creating a new project". */
    let editingId = null;
    let dirty = false;
    let snapshot = '';
    let draftTimer = null;

    /* Automation state. `baseline` is what the importer last wrote; any field
       the admin changes away from it becomes locked, so a later re-import or
       metrics refresh never overwrites a hand edit. `carry` holds fields the
       form doesn't show but a full-overwrite save must keep. */
    let baseline = null;
    let locked = new Set();
    let unlocked = new Set();
    let carry = {};

    const TRACKED = ['title', 'tagline', 'desc', 'longDesc', 'highlights', 'tags', 'category', 'color',
        'icon', 'status', 'year', 'link', 'repo', 'searchTerms', 'platforms', 'appIcon', 'cover',
        'version', 'downloads', 'stores', 'gallery', 'galleryAlt', 'problem', 'approach',
        'challenges', 'outcome'];

    const PLATFORM_KEYS = ['web', 'windows', 'android', 'ios', 'macos', 'linux', 'extension', 'cli'];
    const PLATFORM_FALLBACK = {
        web: ['Web', 'globe'], windows: ['Windows', 'desktop'], android: ['Android', 'mobile'],
        ios: ['iOS', 'mobile'], macos: ['macOS', 'monitor'], linux: ['Linux', 'terminal'],
        extension: ['Extension', 'puzzle'], cli: ['CLI', 'terminal']
    };
    const platformMeta = (k) => {
        const P = window.PLATFORMS && window.PLATFORMS[k];
        return { label: (P && P.label) || PLATFORM_FALLBACK[k][0], icon: (P && P.icon) || PLATFORM_FALLBACK[k][1] };
    };

    window.isAdmin = false;   // the auth listener in firebase.js owns this

    /* Categories live in js/core.js so the case-study, résumé and Now pages
       label them exactly the way the editor does. */
    const CATEGORY_GROUPS = window.CATEGORY_GROUPS || [['Other', [['other', 'Other']]]];

    const TAG_GROUPS = {
        Languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'Python', 'C++', 'C', 'C#',
                    'Java', 'Go', 'Rust', 'Swift', 'Kotlin', 'PHP', 'SQL', 'Dart'],
        Frameworks: ['React', 'Next.js', 'Vue', 'Svelte', 'Node.js', 'Express', 'Flask',
                     'Django', 'Tailwind', 'Three.js', 'FastAPI', 'Astro'],
        'Tools & platforms': ['Firebase', 'Vercel', 'Supabase', 'MongoDB', 'PostgreSQL', 'Vite',
                              'WebGL', 'Canvas', 'PWA', 'WebSockets', 'Docker', 'GitHub Actions']
    };

    /* =====================================================================
       Populate the static parts of the form once
       ===================================================================== */

    function buildOptions() {
        const cat = F('fCategory');
        if (cat && !cat.options.length) {
            cat.innerHTML = CATEGORY_GROUPS.map(([group, items]) =>
                `<optgroup label="${group}">${items.map(([v, l]) =>
                    `<option value="${v}">${l}</option>`).join('')}</optgroup>`).join('');
        }
        const color = F('fColor');
        if (color && !color.options.length) {
            color.innerHTML = window.TONE_KEYS.map((k) =>
                `<option value="${k}">${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('');
        }
    }

    function buildIconPicker(query = '') {
        const box = F('iconPicker');
        if (!box) return;
        const q = query.toLowerCase().trim();
        const current = val('fIcon');
        const keys = window.PICKER_ICONS.filter((k) =>
            !q || k.includes(q) || (window.ICON_TERMS[k] || '').includes(q));

        box.innerHTML = keys.length
            ? keys.map((k) => `<button type="button" data-icon-key="${k}" title="${k}"
                 class="${window.normaliseIcon(current) === k ? 'is-active' : ''}"
                 aria-label="Use the ${k} icon">${window.icon(k, { raw: true, size: 17 })}</button>`).join('')
            : `<p style="grid-column:1/-1;font-size:var(--t-2xs);color:var(--ink-35);padding:10px">No icons match "${window.esc(query)}".</p>`;
    }

    function buildTagPicker() {
        const box = F('tagPicker');
        if (!box || box.dataset.built === '1') return;
        box.dataset.built = '1';
        box.innerHTML = Object.entries(TAG_GROUPS).map(([label, tags]) => `
            <div class="taggroup">
                <h6>${label}</h6>
                <div class="taglist">
                    ${tags.map((t) => `<button type="button" data-tag="${t}">${t}</button>`).join('')}
                </div>
            </div>`).join('');
    }

    /* Highlight the quick-tag buttons that are already in the text field. */
    function syncTagStates() {
        const chosen = new Set(val('fTags').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
        document.querySelectorAll('#tagPicker [data-tag]').forEach((btn) => {
            btn.classList.toggle('is-on', chosen.has(btn.dataset.tag.toLowerCase()));
        });
    }

    /* =====================================================================
       Read / write the form
       ===================================================================== */

    const lines = (id) => val(id).split('\n').map((s) => s.trim()).filter(Boolean);

    /* ---- Platforms: toggle chips, click order = importance ------------- */
    let platformOrder = [];

    function paintPlatforms() {
        const box = F('platformPicker');
        if (!box) return;
        box.innerHTML = PLATFORM_KEYS.map((k) => {
            const m = platformMeta(k);
            const at = platformOrder.indexOf(k);
            return `<button type="button" class="plat-chip ${at >= 0 ? 'is-on' : ''}" data-platform="${k}" aria-pressed="${at >= 0}">
                ${window.icon(m.icon, { raw: true, size: 14 })}<span>${m.label}</span>${at >= 0 ? `<b>${at + 1}</b>` : ''}</button>`;
        }).join('');
    }

    /* ---- Downloads: one compact row per release file -------------------- */
    const MB = 1024 * 1024;

    function downloadRow(d = {}) {
        const opts = PLATFORM_KEYS.map((k) =>
            `<option value="${k}" ${d.platform === k ? 'selected' : ''}>${platformMeta(k).label}</option>`).join('');
        const size = d.size ? (d.size / MB).toFixed(d.size >= 10 * MB ? 0 : 1) : '';
        return `<div class="dl-row" data-arch="${window.esc(d.arch || '')}">
            <div class="selectwrap"><select class="select" data-dl="platform" aria-label="Platform">${opts}</select>${window.icon('chev-down', { raw: true, size: 14 })}</div>
            <input class="input" data-dl="label" placeholder="Label — e.g. Windows installer" value="${window.esc(d.label || '')}" aria-label="Label">
            <input class="input" data-dl="url" type="url" placeholder="https://…/App-1.0.exe" value="${window.esc(d.url || '')}" aria-label="File URL">
            <input class="input" data-dl="size" type="number" min="0" step="0.1" placeholder="MB" value="${size}" aria-label="Size in MB">
            <input class="input" data-dl="count" type="number" min="0" placeholder="Downloads" value="${d.count ?? ''}" aria-label="Download count">
            <input class="input" data-dl="version" placeholder="1.0.0" value="${window.esc(d.version || '')}" aria-label="Version">
            <button type="button" class="ibtn dl-del" data-dl-del aria-label="Remove this download">${window.icon('x', { raw: true, size: 14 })}</button>
        </div>`;
    }

    function paintDownloads(list = []) {
        const box = F('dlRows');
        if (!box) return;
        box.innerHTML = list.length ? list.map(downloadRow).join('')
            : '<p class="dl-empty">No release files yet — the importer adds .exe, .apk, .dmg and friends from GitHub releases.</p>';
    }

    function readDownloads() {
        return Array.from(document.querySelectorAll('#dlRows .dl-row')).map((row) => {
            const g = (k) => String((row.querySelector(`[data-dl="${k}"]`) || {}).value || '').trim();
            return {
                platform: g('platform'), label: g('label'), url: g('url'),
                size: Math.round((parseFloat(g('size')) || 0) * MB),
                count: parseInt(g('count'), 10) || 0,
                version: g('version'), arch: row.dataset.arch || ''
            };
        }).filter((d) => d.url).slice(0, 12);
    }

    function readStores() {
        const out = {};
        document.querySelectorAll('#editorForm [data-store]').forEach((el) => {
            const v = String(el.value || '').trim();
            if (v) out[el.dataset.store] = v;
        });
        return out;
    }

    function paintThumbs() {
        [['fAppIcon', 'fAppIconThumb'], ['fCover', 'fCoverThumb']].forEach(([input, thumb]) => {
            const el = F(thumb);
            if (!el) return;
            const url = window.safeUrl(val(input));
            el.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : '';
            el.classList.toggle('is-empty', !url);
        });
    }

    /* Every field the form shows — no automation bookkeeping. */
    function readFields() {
        return {
            title: val('fTitle'),
            tagline: val('fTagline'),
            desc: val('fDesc'),
            longDesc: val('fLongDesc'),
            link: val('fLink'),
            repo: val('fRepo'),
            demoVideo: val('fDemoVideo'),
            previewVideo: val('fPreviewVideo'),
            searchTerms: val('fSearchTerms').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
            category: val('fCategory') || 'other',
            color: val('fColor') || 'indigo',
            icon: val('fIcon') || 'cube',
            status: val('fStatus') || 'live',
            year: val('fYear'),
            role: val('fRole'),
            featured: !!(F('fFeatured') && F('fFeatured').checked),
            order: val('fOrder') ? Number(val('fOrder')) : null,
            highlights: lines('fHighlights'),
            tags: val('fTags').split(',').map((s) => s.trim()).filter(Boolean),

            /* Case study — only surfaced on the project page when caseStudy
               is on AND there is something in at least one of these. */
            caseStudy: !!(F('fCaseStudy') && F('fCaseStudy').checked),
            problem: val('fProblem'),
            approach: val('fApproach'),
            challenges: lines('fChallenges'),
            outcome: val('fOutcome'),
            metrics: lines('fMetrics'),
            gallery: lines('fGallery'),
            galleryAlt: lines('fGalleryAlt'),

            /* Apps, downloads & stores */
            platforms: platformOrder.slice(),
            appIcon: val('fAppIcon'),
            cover: val('fCover'),
            version: val('fVersion'),
            downloads: readDownloads(),
            stores: readStores(),
            sources: lines('fSources').slice(0, 10)
        };
    }

    /* Comparable form of any field value, so "unchanged" means unchanged
       regardless of whitespace, key order or number formatting. */
    function norm(v) {
        if (v === undefined || v === null) return '';
        // Empty lists and maps mean "nothing", same as a missing field.
        if (Array.isArray(v)) {
            const items = v.map((x) => (x && typeof x === 'object' ? norm(x) : String(x).trim())).filter((x) => x !== '');
            return items.length ? JSON.stringify(items) : '';
        }
        if (typeof v === 'object') {
            const obj = Object.keys(v).sort().reduce((o, k) => {
                const x = v[k];
                if (x !== '' && x !== null && x !== undefined && x !== 0) o[k] = typeof x === 'string' ? x.trim() : x;
                return o;
            }, {});
            return Object.keys(obj).length ? JSON.stringify(obj) : '';
        }
        return String(v).trim();
    }

    function computeLocked(fields) {
        const out = new Set(locked);
        if (baseline) {
            TRACKED.forEach((k) => {
                if (norm(fields[k]) !== norm(baseline[k])) out.add(k);
            });
        }
        unlocked.forEach((k) => out.delete(k));
        return out;
    }

    function readForm() {
        const fields = readFields();
        const auto = !!(F('fAuto') && F('fAuto').checked);
        return {
            ...carry,
            ...fields,
            auto,
            locked: auto ? Array.from(computeLocked(fields)) : Array.from(locked)
        };
    }

    function writeForm(p = {}) {
        const set = (id, v) => { const el = F(id); if (el) el.value = v ?? ''; };
        const join = (v) => (Array.isArray(v) ? v.join('\n') : (v || ''));

        set('fTitle', p.title);
        set('fDesc', p.desc);
        set('fLongDesc', p.longDesc);
        set('fLink', p.link);
        set('fRepo', p.repo);
        set('fDemoVideo', p.demoVideo);
        set('fPreviewVideo', p.previewVideo);
        set('fSearchTerms', Array.isArray(p.searchTerms) ? p.searchTerms.join(', ') : (p.searchTerms || ''));
        set('fCategory', p.category || 'web');
        set('fColor', p.color || 'indigo');
        set('fIcon', window.normaliseIcon(p.icon || 'rocket'));
        set('fStatus', p.status || 'live');
        set('fYear', p.year);
        set('fRole', p.role);
        set('fOrder', p.order ?? '');
        set('fHighlights', join(p.highlights));
        set('fTags', Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || ''));

        set('fProblem', p.problem);
        set('fApproach', p.approach);
        set('fChallenges', join(p.challenges));
        set('fOutcome', p.outcome);
        set('fMetrics', join(p.metrics));
        set('fGallery', join(p.gallery));
        set('fGalleryAlt', join(p.galleryAlt));

        const feat = F('fFeatured');
        if (feat) feat.checked = !!p.featured;
        const cs = F('fCaseStudy');
        if (cs) cs.checked = !!p.caseStudy;

        set('fTagline', p.tagline);
        set('fAppIcon', p.appIcon);
        set('fCover', p.cover);
        set('fVersion', p.version);
        set('fSources', join(p.sources));
        platformOrder = (Array.isArray(p.platforms) ? p.platforms : []).filter((k) => PLATFORM_KEYS.includes(k));
        paintPlatforms();
        paintDownloads(Array.isArray(p.downloads) ? p.downloads : []);
        document.querySelectorAll('#editorForm [data-store]').forEach((el) => {
            el.value = (p.stores && p.stores[el.dataset.store]) || '';
        });
        const auto = F('fAuto');
        if (auto) auto.checked = !!p.auto;
        // Fields the form doesn't show, but a full-overwrite save must keep.
        carry = {};
        if (p.releasedAt) carry.releasedAt = p.releasedAt;
        paintThumbs();
        // Anything with downloads or stores deserves its section open.
        const apps = F('appsFold');
        if (apps) apps.open = !!((p.downloads || []).length || (p.stores && Object.keys(p.stores).length) || p.appIcon);
    }

    /* js/enrich.js drives the form from outside when auto-filling from GitHub. */
    window.readEditorForm = readForm;
    window.writeEditorForm = writeForm;

    /* =====================================================================
       Draft autosave — a long write-up should survive a stray Esc, a reload
       or a closed tab. Keyed per project so drafts never cross-contaminate.
       ===================================================================== */

    const draftKey = () => `draft:${editingId || 'new'}`;

    function saveDraft() {
        try { localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), data: readForm() })); }
        catch { /* storage full or disabled */ }
    }
    function dropDraft() {
        try { localStorage.removeItem(draftKey()); } catch { /* no-op */ }
    }
    function readDraft() {
        try {
            const raw = localStorage.getItem(draftKey());
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            // A week-old draft is noise, not a rescue.
            if (Date.now() - parsed.at > 7 * 24 * 60 * 60 * 1000) { dropDraft(); return null; }
            return parsed;
        } catch { return null; }
    }

    /* =====================================================================
       Live preview — deliberately the same markup as the real card
       ===================================================================== */

    function renderPreview() {
        if (!preview) return;
        const p = readForm();
        renderAuto();
        // The real card renderer, so the preview can never drift from the grid.
        if (window.projectCardHtml) {
            try {
                preview.innerHTML = window.projectCardHtml({ ...p, id: 'preview' }, 0);
                preview.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
                return;
            } catch (e) { console.error('Preview fell back:', e); }
        }
        const tags = p.tags.length ? p.tags : ['Tag'];
        const shown = tags.slice(0, 4);
        const overflow = tags.length - shown.length;

        preview.innerHTML = `
        <article class="card" style="${window.toneVars(p.color)}">
            ${p.featured ? `<div class="card-star">${window.icon('star-fill', { raw: true, size: 13 })}</div>` : ''}
            <div class="card-plaque">${window.icon(p.icon, { size: 23 })}</div>
            <div class="card-body">
                <div class="card-head">
                    <h3 class="card-title">${window.esc(p.title || 'Project title')}</h3>
                    ${window.statusBadge(p.status)}
                </div>
                <p class="card-desc u-clamp-2">${window.esc(p.desc || 'A short description of what this project does and why it exists.')}</p>
                <div class="card-tags">
                    ${shown.map((t) => `<span class="tag">${window.esc(t)}</span>`).join('')}
                    ${overflow > 0 ? `<span class="tag">+${overflow}</span>` : ''}
                </div>
            </div>
            <div class="card-foot">
                <span class="card-cat"><s></s>${window.esc(window.categoryLabel(p.category))}</span>
                <span class="card-gh">${window.esc(p.year || '')}</span>
            </div>
        </article>`;
    }

    /* The strip above the form: auto switch + the locked-field chips. */
    const FIELD_LABELS = {
        title: 'Title', tagline: 'Tagline', desc: 'Description', longDesc: 'Write-up', highlights: 'Highlights',
        tags: 'Tech', category: 'Category', color: 'Colour', icon: 'Icon', status: 'Status', year: 'Year',
        link: 'Live URL', repo: 'Repo', searchTerms: 'Search terms', platforms: 'Platforms', appIcon: 'App icon',
        cover: 'Cover', version: 'Version', downloads: 'Downloads', stores: 'Stores', gallery: 'Screenshots',
        galleryAlt: 'Alt text', problem: 'Problem', approach: 'Approach', challenges: 'What broke', outcome: 'Outcome'
    };

    function renderAuto() {
        const strip = F('edAuto');
        if (!strip) return;
        const auto = !!(F('fAuto') && F('fAuto').checked);
        const show = auto || !!baseline || lines('fSources').length > 0;
        strip.classList.toggle('u-hidden', !show);
        strip.classList.toggle('is-off', !auto);
        const box = F('edLocked');
        if (!box) return;
        const keys = Array.from(computeLocked(readFields()));
        box.innerHTML = !auto
            ? '<span class="ed-locked-note">Off — nothing here is refreshed automatically.</span>'
            : keys.length
                ? `<span class="ed-locked-note">${window.icon('lock', { raw: true, size: 12 })} Kept as you wrote them:</span>${keys.map((k) =>
                    `<button type="button" class="lock-chip" data-unlock="${k}" data-tip="Let the sources update this again">${FIELD_LABELS[k] || k}${window.icon('x', { raw: true, size: 11 })}</button>`).join('')}`
                : '<span class="ed-locked-note">Every field follows the sources. Edit one and it locks.</span>';
    }

    window.refreshEditorPreview = () => { renderPreview(); syncTagStates(); dirty = true; };

    /* Any field edit refreshes the preview, marks the form dirty and (debounced)
       parks a draft in localStorage. */
    function onEdit() {
        dirty = JSON.stringify(readForm()) !== snapshot;
        renderPreview();
        syncTagStates();
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => { if (dirty) saveDraft(); }, 600);
    }
    form.addEventListener('input', onEdit);
    form.addEventListener('change', onEdit);

    /* =====================================================================
       Open / close
       ===================================================================== */

    function open(mode, project) {
        buildOptions();
        buildTagPicker();

        editingId = mode === 'edit' ? String(project.id) : null;
        locked = new Set((project && Array.isArray(project.locked)) ? project.locked : []);
        unlocked = new Set();
        baseline = (project && project.auto && mode === 'edit') ? { ...project } : null;
        if (mode === 'dupe') { baseline = null; locked = new Set(); }

        if (mode === 'new') {
            writeForm({ category: 'web', color: 'indigo', icon: 'rocket', status: 'live', year: String(new Date().getFullYear()), ...(project || {}) });
            titleEl.textContent = 'New project';
            subEl.textContent = 'It appears on the site the moment you save — no rebuild, no deploy.';
            saveBtn.textContent = 'Add project';
        } else if (mode === 'edit') {
            writeForm(project);
            titleEl.textContent = 'Edit project';
            subEl.textContent = `Editing “${project.title}”. Changes go live immediately.`;
            saveBtn.textContent = 'Save changes';
        } else { // duplicate
            writeForm({ ...project, title: `${project.title} copy` });
            titleEl.textContent = 'Duplicate project';
            subEl.textContent = `Starting from “${project.title}”. This saves as a new project.`;
            saveBtn.textContent = 'Create copy';
        }

        buildIconPicker(F('iconSearch') ? F('iconSearch').value : '');
        renderPreview();
        syncTagStates();
        snapshot = JSON.stringify(readForm());
        dirty = false;

        window.openSheet(sheet);
        setTimeout(() => F('fTitle') && F('fTitle').focus(), 320);

        // Offer to restore anything left over from an interrupted session.
        const draft = readDraft();
        if (draft && JSON.stringify(draft.data) !== snapshot) {
            const when = new Date(draft.at).toLocaleString();
            window.toastWithAction(`Unsaved draft from ${when}`, 'Restore', () => {
                writeForm(draft.data);
                renderPreview();
                syncTagStates();
                dirty = true;
            }, 12000);
        }
    }

    async function close(force) {
        if (dirty && !force) {
            const ok = await window.confirmAction({
                title: 'Discard changes?',
                message: 'This project has unsaved edits. They are kept as a draft you can restore next time you open it.',
                confirm: 'Close',
                danger: true
            });
            if (!ok) return;
            saveDraft();
        }
        clearTimeout(draftTimer);
        dirty = false;
        window.closeSheet(sheet);
    }

    window.closeEditor = close;

    /* =====================================================================
       Public actions
       ===================================================================== */

    const find = (id) => (window.getProjects ? window.getProjects() : []).find((p) => String(p.id) === String(id));

    window.newProject = () => {
        if (!window.isAdmin) { window.toast('Unlock admin mode first', 'error'); return; }
        open('new');
    };

    /* Opens a new-project editor pre-filled with an importer draft. The
       draft becomes the baseline, so anything changed before saving is
       locked against future refreshes. */
    window.openEditorWith = (draft = {}) => {
        if (!window.isAdmin) { window.toast('Unlock admin mode first', 'error'); return; }
        const { id: _drop, ...data } = draft;
        open('new', { ...data, auto: data.auto !== false });
        baseline = { ...data };
        subEl.textContent = 'Imported for you — check it over, change anything, then add it. Edited fields stay as you wrote them.';
        dirty = true;
        renderPreview();
    };

    window.editProject = (id) => {
        if (!window.isAdmin) { window.toast('Unlock admin mode first', 'error'); return; }
        const p = find(id);
        if (!p) { window.toast('That project no longer exists', 'error'); return; }
        open('edit', p);
    };

    window.duplicateProject = (id) => {
        if (!window.isAdmin) return;
        const p = find(id);
        if (!p) return;
        open('dupe', p);
    };

    window.deleteProject = async (id) => {
        if (!window.isAdmin) return;
        const p = find(id);
        if (!p) return;
        const ok = await window.confirmAction({
            title: 'Delete this project?',
            message: `“${p.title}” will be removed from the site permanently. This cannot be undone.`,
            confirm: 'Delete',
            danger: true
        });
        if (!ok) return;
        window.deleteProjectFromDb(id);
    };

    /* =====================================================================
       Submit
       ===================================================================== */

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = readForm();

        if (!data.title) { window.toast('A title is required', 'error'); F('fTitle').focus(); return; }
        if (!data.desc)  { window.toast('A short description is required', 'error'); F('fDesc').focus(); return; }

        // Normalise bare domains typed without a scheme.
        const withScheme = (v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);
        ['link', 'repo', 'demoVideo', 'previewVideo', 'appIcon', 'cover'].forEach((k) => { data[k] = withScheme(data[k]); });
        Object.keys(data.stores || {}).forEach((k) => { data.stores[k] = withScheme(data.stores[k]); });
        (data.downloads || []).forEach((d) => { d.url = withScheme(d.url); });
        if (data.order === null || Number.isNaN(data.order)) delete data.order;

        saveBtn.disabled = true;
        const label = saveBtn.textContent;
        saveBtn.textContent = editingId ? 'Saving…' : 'Adding…';

        try {
            const ok = editingId
                ? await window.updateProjectInDb(editingId, data)
                : await window.saveProjectToDb(data);
            if (ok) {
                dropDraft();
                dirty = false;
                close(true);
                if (!editingId && window.celebrate) window.celebrate();
            }
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = label;
        }
    });

    /* =====================================================================
       Editor chrome wiring
       ===================================================================== */

    const iconSearch = F('iconSearch');
    if (iconSearch) iconSearch.addEventListener('input', () => buildIconPicker(iconSearch.value));

    const iconPicker = F('iconPicker');
    if (iconPicker) {
        iconPicker.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-icon-key]');
            if (!btn) return;
            F('fIcon').value = btn.dataset.iconKey;
            iconPicker.querySelectorAll('button').forEach((b) => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            dirty = true;
            renderPreview();
        });
    }

    const tagPicker = F('tagPicker');
    if (tagPicker) {
        tagPicker.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-tag]');
            if (!btn) return;
            const input = F('fTags');
            const tag = btn.dataset.tag;
            const list = input.value.split(',').map((t) => t.trim()).filter(Boolean);
            const at = list.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
            if (at >= 0) list.splice(at, 1); else list.push(tag);
            input.value = list.join(', ');
            dirty = true;
            syncTagStates();
            renderPreview();
        });
    }

    const platformBox = F('platformPicker');
    if (platformBox) {
        platformBox.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-platform]');
            if (!btn) return;
            const k = btn.dataset.platform;
            const at = platformOrder.indexOf(k);
            if (at >= 0) platformOrder.splice(at, 1); else platformOrder.push(k);
            paintPlatforms();
            onEdit();
        });
    }

    const dlAdd = F('dlAdd');
    if (dlAdd) {
        dlAdd.addEventListener('click', () => {
            const box = F('dlRows');
            const rows = box.querySelectorAll('.dl-row').length;
            if (rows >= 12) { window.toast('Twelve downloads is the limit', 'info'); return; }
            if (!rows) box.innerHTML = '';
            box.insertAdjacentHTML('beforeend', downloadRow({ platform: platformOrder[0] || 'windows' }));
            box.lastElementChild.querySelector('[data-dl="url"]').focus();
            onEdit();
        });
    }
    const dlBox = F('dlRows');
    if (dlBox) {
        dlBox.addEventListener('click', (e) => {
            const del = e.target.closest('[data-dl-del]');
            if (!del) return;
            del.closest('.dl-row').remove();
            if (!dlBox.querySelector('.dl-row')) paintDownloads([]);
            onEdit();
        });
    }

    const lockedBox = F('edLocked');
    if (lockedBox) {
        lockedBox.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-unlock]');
            if (!chip) return;
            const k = chip.dataset.unlock;
            locked.delete(k);
            unlocked.add(k);
            renderAuto();
            dirty = true;
        });
    }

    ['fAppIcon', 'fCover'].forEach((id) => { if (F(id)) F(id).addEventListener('input', paintThumbs); });

    /* Re-import: read the sources again and refresh everything not locked. */
    const reimportBtn = F('edReimport');
    if (reimportBtn) {
        reimportBtn.addEventListener('click', async () => {
            if (!window.Importer || !window.Importer.ingest) { window.toast('The importer is not available here', 'error'); return; }
            const current = readForm();
            const urls = current.sources.length ? current.sources : [current.repo, current.link].filter(Boolean);
            if (!urls.length) { window.toast('Add a source link first', 'error'); return; }
            const busy = window.Micro ? window.Micro.busy(reimportBtn) : { done() {} };
            const progress = window.progressToast('Reading the sources…');
            try {
                const final = await window.Importer.ingest({ urls, existing: current }, (ev) => {
                    if (ev.label && ev.status === 'run') progress.update(ev.label);
                });
                const draft = final.project || {};
                const keep = new Set(current.locked || []);
                const merged = { ...current };
                let changed = 0;
                Object.entries(draft).forEach(([k, v]) => {
                    if (keep.has(k) || k === 'locked' || k === 'id' || k === 'auto') return;
                    if (norm(v) !== norm(current[k])) changed++;
                    merged[k] = v;
                });
                writeForm(merged);
                baseline = { ...(baseline || {}), ...draft };
                renderPreview();
                syncTagStates();
                dirty = true;
                busy.done(true);
                window.toast(changed ? `Refreshed ${changed} field${changed === 1 ? '' : 's'} — locked ones untouched` : 'Already up to date', 'success');
            } catch (e) {
                busy.done(false);
                window.toast(e.message || 'Re-import failed', 'error');
            } finally {
                progress.close();
            }
        });
    }

    const autoBox = F('fAuto');
    if (autoBox) autoBox.addEventListener('change', () => { if (autoBox.checked && !baseline) baseline = { ...readFields() }; renderAuto(); });

    const autofillBtn = F('autofill');
    if (autofillBtn) autofillBtn.addEventListener('click', () => window.enrichEditorForm && window.enrichEditorForm());

    const testBtn = F('testLink');
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            const url = window.safeUrl(val('fLink'));
            if (url) window.open(url, '_blank', 'noopener');
            else window.toast('Enter a valid link first', 'error');
        });
    }

    sheet.addEventListener('click', (e) => {
        if (e.target === sheet || e.target.closest('[data-close]')) close();
    });

    /* =====================================================================
       Admin gate
       ===================================================================== */

    function applyAdminState() {
        document.querySelectorAll('[data-admin-only]').forEach((el) => {
            el.classList.toggle('u-hidden', !window.isAdmin);
        });
        const lock = document.getElementById('adminLock');
        if (lock) {
            lock.innerHTML = window.icon(window.isAdmin ? 'unlock' : 'lock', { raw: true, size: 13 });
            lock.setAttribute('aria-label', window.isAdmin ? 'Sign out of admin' : 'Sign in as admin');
            lock.setAttribute('title', window.isAdmin
                ? `Signed in as ${(window.adminEmail && window.adminEmail()) || 'admin'} — click to sign out`
                : 'Admin sign in');
            lock.style.color = window.isAdmin ? 'var(--accent)' : '';
        }
        if (window.renderProjects) window.renderProjects();
    }
    window.applyAdminState = applyAdminState;

    /* ---- Sign in / out -------------------------------------------------- */

    const authSheet = document.getElementById('authSheet');
    const authForm = document.getElementById('authForm');

    window.toggleAdmin = async () => {
        if (window.isAdmin) {
            const ok = await window.confirmAction({
                title: 'Sign out?',
                message: 'You will go back to browsing as a visitor.',
                confirm: 'Sign out'
            });
            if (ok) await window.adminSignOut();
            return;
        }
        if (!window.adminSignIn) { window.toast('Still connecting — try again in a second', 'error'); return; }
        window.openSheet(authSheet);
    };

    if (authSheet) {
        authSheet.addEventListener('click', (e) => {
            if (e.target === authSheet || e.target.closest('[data-close]')) window.closeSheet(authSheet);
        });
    }

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('authSubmit');
            const email = F('aEmail').value.trim();
            const password = F('aPassword').value;
            if (!email || !password) return;

            btn.disabled = true;
            btn.textContent = 'Signing in…';
            const ok = await window.adminSignIn(email, password);
            btn.disabled = false;
            btn.textContent = 'Sign in';

            if (ok) {
                authForm.reset();
                window.closeSheet(authSheet);
            } else {
                F('aPassword').value = '';
                F('aPassword').focus();
            }
        });
    }

    const lockBtn = document.getElementById('adminLock');
    if (lockBtn) lockBtn.addEventListener('click', window.toggleAdmin);

    document.querySelectorAll('[data-new-project]').forEach((btn) => {
        btn.addEventListener('click', () => window.newProject());
    });

    applyAdminState();
})();
