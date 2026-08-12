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

    window.isAdmin = false;   // the auth listener in firebase.js owns this

    const CATEGORIES = [
        ['web', 'Website'], ['app', 'App'], ['game', 'Game'], ['tool', 'Tool'],
        ['ai', 'AI'], ['ml', 'Machine learning'], ['data', 'Data / systems'],
        ['mobile', 'Mobile'], ['dashboard', 'Dashboard'], ['productivity', 'Productivity'],
        ['ecommerce', 'E-commerce'], ['social', 'Social'], ['education', 'Education'],
        ['finance', 'Finance'], ['cli', 'CLI'], ['extension', 'Extension'],
        ['bot', 'Bot'], ['api', 'API'], ['design', 'Design'], ['web3', 'Web3'],
        ['iot', 'IoT'], ['library', 'Library'], ['other', 'Other']
    ];

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
            cat.innerHTML = CATEGORIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
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

    function readForm() {
        return {
            title: val('fTitle'),
            desc: val('fDesc'),
            longDesc: val('fLongDesc'),
            link: val('fLink'),
            repo: val('fRepo'),
            demoVideo: val('fDemoVideo'),
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
            gallery: lines('fGallery')
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

        const feat = F('fFeatured');
        if (feat) feat.checked = !!p.featured;
        const cs = F('fCaseStudy');
        if (cs) cs.checked = !!p.caseStudy;
    }

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
                <span class="card-cat"><s></s>${window.esc((p.category || 'other').charAt(0).toUpperCase() + (p.category || 'other').slice(1))}</span>
                <span class="card-gh">${window.esc(p.year || '')}</span>
            </div>
        </article>`;
    }

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

        if (mode === 'new') {
            writeForm({ category: 'web', color: 'indigo', icon: 'rocket', status: 'live', year: String(new Date().getFullYear()) });
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
        ['link', 'repo', 'demoVideo'].forEach((k) => {
            if (data[k] && !/^https?:\/\//i.test(data[k])) data[k] = `https://${data[k]}`;
        });
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
