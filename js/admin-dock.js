/* ===========================================================================
   admin-dock.js  (classic script) — admin only
   The whole admin surface, reduced to two buttons.

     · Dock        bottom-left while signed in: ＋ Add, and ⋯ for everything
                   else (Discover, Refresh metrics, Releases & history, AI
                   studio, Health check, Now page, Sign out).
     · Add sheet   one drop zone: paste links → magic import; drop screenshots
                   → a new project with them; or start blank.
     · Page drop   drag a link or image files anywhere on the page.
     · Card menu   one ⋯ per card (rendered by render.js as [data-card-menu]):
                   Edit, Screenshots, Re-import, Rehost, Hide, Duplicate, Delete.
     · History     what changed and when, with before → after diffs; plus the
                   latest releases across every project.
     · Rehost      move a project whose host died onto Cloudflare Pages.

   window.AdminMenu is the one popover menu used by all of the above and by
   the editor's ⋯ (js/admin.js).
   =========================================================================== */

(() => {
    const esc = (v) => (window.esc ? window.esc(v) : String(v ?? ''));
    const icon = (k, size = 15) => (window.icon ? window.icon(k, { raw: true, size }) : '');
    const DOTS = '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
    const PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

    const projects = () => (window.getProjects ? window.getProjects() : []);
    const find = (id) => projects().find((p) => String(p.id) === String(id)) || null;
    const typing = () => {
        const a = document.activeElement;
        return a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    };
    const anySheetOpen = () => !!document.querySelector('.sheet.is-open, .palette.is-open');
    const ago = (ms) => (window.relativeTime ? window.relativeTime(new Date(ms).toISOString()) : new Date(ms).toLocaleString());
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

    /* =====================================================================
       AdminMenu — one accessible popover menu
       ===================================================================== */

    let menuEl = null;
    let menuAnchor = null;

    function closeMenu({ focus = true } = {}) {
        if (!menuEl) return;
        const el = menuEl;
        menuEl = null;
        el.classList.remove('is-open');
        setTimeout(() => el.remove(), 180);
        if (menuAnchor) {
            menuAnchor.setAttribute('aria-expanded', 'false');
            if (focus) menuAnchor.focus({ preventScroll: true });
        }
        menuAnchor = null;
    }

    function openMenu(anchor, items, { placement = 'bottom-end', label = 'Actions' } = {}) {
        if (menuEl && menuAnchor === anchor) { closeMenu(); return; }
        closeMenu({ focus: false });
        menuAnchor = anchor;
        anchor.setAttribute('aria-expanded', 'true');

        const el = document.createElement('div');
        el.className = 'am-menu';
        el.setAttribute('role', 'menu');
        el.setAttribute('aria-label', label);
        el.innerHTML = items.map((it, i) => (it === '-'
            ? '<div class="am-sep" role="separator"></div>'
            : `<button type="button" role="menuitem" class="am-item ${it.danger ? 'is-danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
                    <span class="am-ico">${icon(it.icon || 'cube', 15)}</span>
                    <span class="am-txt"><b>${esc(it.label)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>
                    ${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}
               </button>`)).join('');
        document.body.appendChild(el);
        menuEl = el;

        // Position: fixed, beside the anchor, flipped to stay on screen.
        const r = anchor.getBoundingClientRect();
        const mw = el.offsetWidth, mh = el.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        let top = placement.startsWith('top') ? r.top - mh - 8 : r.bottom + 8;
        if (top + mh > vh - 8) top = r.top - mh - 8;
        if (top < 8) top = Math.min(vh - mh - 8, r.bottom + 8);
        let left = placement.endsWith('start') ? r.left : r.right - mw;
        left = Math.max(8, Math.min(vw - mw - 8, left));
        el.style.top = `${Math.max(8, top)}px`;
        el.style.left = `${left}px`;
        el.style.transformOrigin = `${r.left + r.width / 2 - left}px ${top < r.top ? '100%' : '0'}`;
        requestAnimationFrame(() => el.classList.add('is-open'));

        const buttons = () => Array.from(el.querySelectorAll('.am-item:not([disabled])'));
        setTimeout(() => buttons()[0] && buttons()[0].focus({ preventScroll: true }), 30);

        el.addEventListener('click', (e) => {
            const b = e.target.closest('.am-item');
            if (!b) return;
            const it = items[Number(b.dataset.i)];
            closeMenu({ focus: false });
            if (it && it.run) setTimeout(() => it.run(), 10);
        });
        el.addEventListener('keydown', (e) => {
            const list = buttons();
            const at = list.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length].focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length].focus(); }
            else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
            else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
            else if (e.key === 'Tab') closeMenu({ focus: false });
        });
    }

    document.addEventListener('pointerdown', (e) => {
        if (menuEl && !menuEl.contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu({ focus: false });
    }, true);
    window.addEventListener('resize', () => closeMenu({ focus: false }));
    window.addEventListener('scroll', () => { if (menuEl) closeMenu({ focus: false }); }, { passive: true });

    window.AdminMenu = { open: openMenu, close: closeMenu };

    /* =====================================================================
       Generic sheet scaffold (same skeleton as every other sheet)
       ===================================================================== */

    function makeSheet(id, size, label, inner) {
        let el = document.getElementById(id);
        if (el) return el;
        el = document.createElement('div');
        el.className = 'sheet adm-sheet';
        el.id = id;
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `<div class="sheet-panel sheet-panel--${size}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
            <button class="sheet-close" data-close aria-label="Close">${icon('x', 16)}</button>${inner}</div>`;
        document.body.appendChild(el);
        el.addEventListener('click', (e) => {
            if (e.target === el || e.target.closest('[data-close]')) window.closeSheet(el);
        });
        return el;
    }

    /* =====================================================================
       The dock
       ===================================================================== */

    const dock = document.createElement('div');
    dock.className = 'adock u-hidden';
    dock.setAttribute('data-admin-only', '');
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'Admin');
    dock.innerHTML = `
        <button type="button" class="adock-add" id="dockAdd" aria-keyshortcuts="A" data-tip="Add a project — or drop links and screenshots anywhere">
            ${PLUS}<span>Add</span>
        </button>
        <button type="button" class="adock-more" id="dockMore" aria-haspopup="menu" aria-expanded="false" aria-label="Admin menu" data-tip="Admin menu">
            ${DOTS}
        </button>`;
    document.body.appendChild(dock);
    if (window.isAdmin) dock.classList.remove('u-hidden');

    const call = (fn, ...args) => {
        if (typeof window[fn] === 'function') return window[fn](...args);
        window.toast('That isn’t available on this page', 'info');
        return null;
    };

    function dockMenuItems() {
        return [
            { icon: 'github', label: 'Discover repos', hint: 'your GitHub work that isn’t here yet', run: () => call('openDiscover') },
            { icon: 'refresh', label: 'Refresh metrics', hint: 'stars, downloads, versions, uptime', run: () => call('refreshAllMetrics') },
            { icon: 'history', label: 'Releases & history', hint: 'what changed, and when', run: () => openHistory() },
            '-',
            { icon: 'sparkles', label: 'AI studio', run: () => call('openAiStudio') },
            { icon: 'pulse', label: 'Health check', hint: 'dead repos, links that are down', run: () => call('openHealth') },
            { icon: 'pen', label: 'Edit the Now page', run: () => call('openNowEditor') },
            '-',
            { icon: 'unlock', label: 'Sign out', run: () => call('toggleAdmin') }
        ];
    }

    dock.querySelector('#dockAdd').addEventListener('click', () => openAdd());
    dock.querySelector('#dockMore').addEventListener('click', (e) => {
        openMenu(e.currentTarget, dockMenuItems(), { placement: 'top-start', label: 'Admin' });
    });

    /* A one-time nudge the first time admin turns on in a session. */
    window.addEventListener('adminchange', (e) => {
        if (!e.detail || !e.detail.admin) { closeMenu({ focus: false }); return; }
        try {
            if (sessionStorage.getItem('admin:hinted')) return;
            sessionStorage.setItem('admin:hinted', '1');
        } catch { /* private */ }
        setTimeout(() => window.toast('Admin is on — press ＋ (or A) to add, or drop links and screenshots anywhere', 'info'), 600);
    });

    /* =====================================================================
       Add sheet — links, screenshots, or blank
       ===================================================================== */

    let addSheet = null;
    let addFiles = [];              // [{ key, file, preview, state, url, note, bytes }]
    let addSeq = 0;

    const parseLinks = (text) => String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
        .filter((s) => (window.Importer && window.Importer.sourceOf ? window.Importer.sourceOf(s) : /\./.test(s)));
    const isImage = (f) => f && (/^image\//.test(f.type || '') || /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i.test(f.name || ''));
    const fmtKB = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

    function buildAdd() {
        addSheet = makeSheet('addSheet', 'md', 'Add a project', `
            <div class="sheet-head">
                <h2>Add a project</h2>
                <p>Paste a link and everything is filled in for you. Screenshots are welcome too.</p>
            </div>
            <div class="sheet-body add-body">
                <div class="add-drop" id="addDrop">
                    <textarea id="addLinks" rows="3" spellcheck="false" autocomplete="off" aria-label="Links"
                        placeholder="Paste a link — GitHub repo, website, Play Store, Microsoft Store, App Store, itch.io…"></textarea>
                    <div class="add-drop-hint" aria-hidden="true">
                        <span class="add-drop-art"><i></i><i></i><i></i></span>
                        <span>Drop links or screenshots here · <button type="button" class="add-browse" id="addBrowse">choose screenshots</button></span>
                    </div>
                    <input type="file" id="addFile" accept="image/*" multiple hidden>
                </div>
                <div class="imp-detect" id="addDetect" aria-live="polite"></div>
                <div class="add-shots" id="addShots" aria-live="polite"></div>
                <p class="add-or">
                    <button type="button" class="add-link" data-add="blank">${icon('plus', 13)} Start from a blank project</button>
                    <span aria-hidden="true">·</span>
                    <button type="button" class="add-link" data-add="discover">${icon('github', 13)} Pick from my GitHub repos</button>
                </p>
            </div>
            <div class="sheet-foot">
                <span class="ed-status" id="addStatus" aria-live="polite"></span>
                <span class="imp-foot-gap"></span>
                <button class="btn btn--quiet" type="button" data-close>Cancel</button>
                <button class="btn btn--primary" type="button" id="addGo" disabled>${icon('wand', 16)} Import</button>
            </div>`);

        const links = addSheet.querySelector('#addLinks');
        links.addEventListener('input', paintAdd);
        links.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); goAdd(); }
        });
        addSheet.querySelector('#addBrowse').addEventListener('click', () => addSheet.querySelector('#addFile').click());
        addSheet.querySelector('#addFile').addEventListener('change', (e) => { takeFiles(e.target.files); e.target.value = ''; });
        addSheet.querySelector('#addGo').addEventListener('click', goAdd);
        addSheet.addEventListener('click', (e) => {
            const a = e.target.closest('[data-add]');
            if (a) {
                const what = a.dataset.add;
                closeAdd(true);
                setTimeout(() => (what === 'blank' ? window.newProject() : call('openDiscover')), 220);
                return;
            }
            const rm = e.target.closest('[data-add-rm]');
            if (rm) {
                addFiles = addFiles.filter((f) => f.key !== rm.dataset.addRm);
                paintAdd();
            }
        });

        // The sheet is its own drop target (stops the page overlay).
        const zone = addSheet.querySelector('.sheet-panel');
        let depth = 0;
        zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; addSheet.querySelector('#addDrop').classList.add('is-over'); });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
        zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) addSheet.querySelector('#addDrop').classList.remove('is-over'); });
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            depth = 0;
            addSheet.querySelector('#addDrop').classList.remove('is-over');
            takeDrop(e.dataTransfer);
        });
        addSheet.addEventListener('paste', (e) => {
            const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(isImage);
            if (!files.length) return;
            e.preventDefault();
            takeFiles(files);
        });
    }

    function takeDrop(dt) {
        if (!dt) return;
        const files = Array.from(dt.files || []);
        if (files.length) takeFiles(files);
        const text = dt.getData('text/uri-list') || (files.length ? '' : dt.getData('text/plain')) || '';
        const urls = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
        if (urls.length) {
            const box = addSheet.querySelector('#addLinks');
            box.value = [box.value.trim(), ...urls].filter(Boolean).join('\n');
            paintAdd();
        }
    }

    function takeFiles(list) {
        const all = Array.from(list || []);
        const imgs = all.filter(isImage);
        if (all.length - imgs.length) window.toast(`${all.length - imgs.length} file${all.length - imgs.length === 1 ? ' isn’t an image' : 's aren’t images'} — skipped`, 'info');
        imgs.slice(0, 20 - addFiles.length).forEach((file) => {
            let preview = '';
            try { preview = URL.createObjectURL(file); } catch { /* none */ }
            addFiles.push({ key: `a${++addSeq}`, file, preview, state: 'idle', note: fmtKB(file.size || 0) });
        });
        paintAdd();
        if (imgs.length && window.Micro) window.Micro.burst(addSheet.querySelector('#addDrop'), { count: 10, spread: 50 });
    }

    function paintAdd() {
        if (!addSheet) return;
        const links = parseLinks(addSheet.querySelector('#addLinks').value);
        const detect = addSheet.querySelector('#addDetect');
        detect.innerHTML = links.slice(0, 5).map((raw) => {
            const s = window.Importer && window.Importer.sourceOf ? window.Importer.sourceOf(raw) : { kind: 'Link', icon: 'link', url: raw };
            return s ? `<span class="imp-src">${icon(s.icon, 13)}<b>${esc(s.kind)}</b><em>${esc(String(s.url).replace(/^https?:\/\//, '').slice(0, 42))}</em></span>` : '';
        }).join('');

        const shots = addSheet.querySelector('#addShots');
        shots.innerHTML = addFiles.map((f) => `
            <figure class="add-shot is-${f.state}">
                ${f.preview ? `<img src="${esc(f.preview)}" alt="">` : ''}
                ${f.state === 'busy' ? '<span class="md-veil"><i class="md-ring"></i></span>' : ''}
                ${f.state === 'error' ? `<span class="md-veil is-error">${icon('alert', 15)}</span>` : ''}
                ${f.state === 'done' ? `<span class="add-shot-ok">${icon('check', 12)}</span>` : ''}
                <figcaption>${esc(f.note || '')}</figcaption>
                ${f.state !== 'busy' ? `<button type="button" class="md-btn is-danger" data-add-rm="${f.key}" aria-label="Remove">${icon('x', 12)}</button>` : ''}
            </figure>`).join('');

        const go = addSheet.querySelector('#addGo');
        const n = addFiles.length;
        go.disabled = !links.length && !n;
        go.innerHTML = links.length && n ? `${icon('wand', 16)} Import with ${n} screenshot${n === 1 ? '' : 's'}`
            : links.length ? `${icon('wand', 16)} Import`
                : n ? `${icon('arrow-right', 16)} Continue with ${n} screenshot${n === 1 ? '' : 's'}`
                    : `${icon('wand', 16)} Import`;
        const status = addSheet.querySelector('#addStatus');
        status.textContent = links.length ? 'Everything else is filled in for you' : n ? 'You’ll add the title next' : '';
    }

    async function goAdd() {
        const links = parseLinks(addSheet.querySelector('#addLinks').value).slice(0, 5);
        const files = addFiles.slice();
        if (!links.length && !files.length) return;

        // Screenshots only: straight to the editor, which uploads them with
        // per-file progress in the Media tab.
        if (!links.length) {
            closeAdd(true);
            setTimeout(() => window.openEditorWith({}, { files: files.map((f) => f.file), tab: 'media' }), 220);
            return;
        }

        // Links only: magic import.
        if (!files.length) {
            closeAdd(true);
            setTimeout(() => call('openImporter', links), 220);
            return;
        }

        // Both: upload the screenshots here first, then import with them.
        const go = addSheet.querySelector('#addGo');
        const busy = window.Micro ? window.Micro.busy(go) : { done() {} };
        const gallery = [];
        let failed = 0;
        for (const f of files) {
            if (f.state === 'done' && f.url) { gallery.push({ url: f.url, alt: '' }); continue; }
            f.state = 'busy'; f.note = 'Compressing…'; paintAdd();
            try {
                const r = await window.uploadMedia(f.file, {
                    onStage: (st, info) => { if (st === 'upload' && info) { f.note = `Uploading ${fmtKB(info.bytes)}…`; paintAdd(); } }
                });
                f.state = 'done'; f.url = r.url; f.note = `${fmtKB(r.bytes)} · ${r.w}×${r.h}`;
                gallery.push({ url: r.url, alt: '' });
            } catch (e) {
                f.state = 'error'; f.note = e.message || 'Failed';
                failed++;
            }
            paintAdd();
        }
        busy.done(!failed);
        if (failed && !gallery.length) { window.toast('The screenshots couldn’t be uploaded — try again, or import without them', 'error'); return; }
        if (failed) window.toast(`${failed} screenshot${failed === 1 ? '' : 's'} failed — importing with the rest`, 'info');
        closeAdd(true);
        setTimeout(() => call('openImporter', links, { gallery }), 220);
    }

    function openAdd(prefill = {}) {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        if (!addSheet) buildAdd();
        addFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
        addFiles = [];
        const box = addSheet.querySelector('#addLinks');
        box.value = (prefill.links || []).join('\n');
        if (prefill.files) takeFiles(prefill.files);
        paintAdd();
        window.openSheet(addSheet);
        setTimeout(() => box.focus(), 140);
    }

    function closeAdd(force) {
        if (!addSheet) return;
        if (!force && addFiles.some((f) => f.state === 'busy')) { window.toast('Still uploading — one moment', 'info'); return; }
        window.closeSheet(addSheet);
    }

    window.openAdd = openAdd;

    /* =====================================================================
       Page-wide drop: links → import, images → new project
       ===================================================================== */

    const overlay = document.createElement('div');
    overlay.className = 'adm-drop';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `<div class="adm-drop-card">
        <span class="adm-drop-art"><i></i><i></i><i></i></span>
        <b>Drop to add</b>
        <span><em>Links</em> are imported · <em>screenshots</em> start a new project</span></div>`;
    document.body.appendChild(overlay);
    let pageDepth = 0;

    const droppable = (e) => {
        if (!window.isAdmin || !e.dataTransfer) return false;
        if (document.querySelector('.sheet.is-open')) return false;   // sheets handle their own drops
        const t = Array.from(e.dataTransfer.types || []);
        if (t.includes('application/x-portfolio-media')) return false;
        return t.includes('Files') || t.includes('text/uri-list') || t.includes('text/plain');
    };

    document.addEventListener('dragenter', (e) => {
        if (!droppable(e)) return;
        pageDepth++;
        overlay.classList.add('is-on');
    });
    document.addEventListener('dragover', (e) => {
        if (!overlay.classList.contains('is-on')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('dragleave', () => {
        if (!overlay.classList.contains('is-on')) return;
        pageDepth = Math.max(0, pageDepth - 1);
        if (!pageDepth) overlay.classList.remove('is-on');
    });
    document.addEventListener('drop', (e) => {
        if (!overlay.classList.contains('is-on')) return;
        e.preventDefault();
        pageDepth = 0;
        overlay.classList.remove('is-on');
        const files = Array.from(e.dataTransfer.files || []).filter(isImage);
        const text = files.length ? (e.dataTransfer.getData('text/uri-list') || '') : (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '');
        const links = parseLinks(text.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).join('\n'));
        if (files.length && links.length) { openAdd({ links, files }); return; }
        if (files.length) { window.openEditorWith({}, { files, tab: 'media' }); return; }
        if (links.length) { call('openImporter', links.slice(0, 5)); return; }
        window.toast('Drop a link or some screenshots', 'info');
    });
    // Leaving the window mid-drag must not strand the overlay.
    window.addEventListener('blur', () => { pageDepth = 0; overlay.classList.remove('is-on'); });

    /* =====================================================================
       Keyboard: A opens Add
       ===================================================================== */

    document.addEventListener('keydown', (e) => {
        if (!window.isAdmin || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.key.toLowerCase() !== 'a' || typing() || anySheetOpen()) return;
        e.preventDefault();
        openAdd();
    });

    /* =====================================================================
       Per-card ⋯ menu (render.js draws [data-card-menu="<id>"])
       ===================================================================== */

    const statusOf = (id) => {
        const s = window.projectStatus && window.projectStatus(id);
        if (s) return s;
        const m = window.Meta && window.Meta.get && window.Meta.get(id);
        return (m && m.web) || null;
    };
    const isDown = (id) => { const s = statusOf(id); return !!s && s.up === false; };

    function cardMenuItems(p) {
        const repo = p.repo || (window.resolveRepoUrl && window.resolveRepoUrl(p));
        const sources = (p.sources || []).length || repo || p.link;
        return [
            { icon: 'pencil', label: 'Edit', run: () => window.editProject(p.id) },
            { icon: 'image', label: 'Screenshots', hint: 'drop or paste images', run: () => window.editProject(p.id, { tab: 'media' }) },
            sources && { icon: 'refresh', label: 'Re-import', hint: 'refresh from its sources, keep your edits', run: () => reimport(p.id) },
            isDown(p.id) && repo && { icon: 'cloud', label: 'Rehost on Cloudflare', hint: 'its live site is down', run: () => startRehost(p.id) },
            { icon: p.hidden ? 'eye' : 'eye', label: p.hidden ? 'Show to visitors' : 'Hide from visitors', run: () => toggleHidden(p.id) },
            { icon: 'copy', label: 'Duplicate', run: () => window.duplicateProject(p.id) },
            { icon: 'history', label: 'History', run: () => openHistory({ projectId: String(p.id) }) },
            '-',
            { icon: 'trash', label: 'Delete', danger: true, run: () => window.deleteProject(p.id) }
        ].filter(Boolean);
    }

    // Capture phase, so the card's own "open on click" never fires.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-card-menu]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (!window.isAdmin) return;
        const p = find(btn.dataset.cardMenu);
        if (!p) { window.toast('That project isn’t loaded', 'error'); return; }
        btn.setAttribute('aria-haspopup', 'menu');
        openMenu(btn, cardMenuItems(p), { placement: 'bottom-start', label: `${p.title} actions` });
    }, true);
    window.openCardMenu = (id, anchor) => {
        const p = find(id);
        if (p && anchor) openMenu(anchor, cardMenuItems(p), { placement: 'bottom-start', label: `${p.title} actions` });
    };

    const withoutId = (p) => { const { id, slug, ...rest } = p; return rest; };

    async function toggleHidden(id) {
        const p = find(id);
        if (!p) return;
        const next = !p.hidden;
        const ok = await window.updateProjectInDb(p.id, { ...withoutId(p), hidden: next }, { quiet: true });
        if (!ok) return;
        if (window.writeHistory) window.writeHistory({ projectId: p.id, kind: 'edit', summary: next ? 'Hidden from visitors' : 'Shown to visitors', changes: [{ field: 'hidden', before: !next, after: next }] });
        window.toastWithAction(next ? `“${p.title}” is hidden from visitors` : `“${p.title}” is visible again`, 'Undo', async () => {
            const cur = find(id) || p;
            await window.updateProjectInDb(cur.id, { ...withoutId(cur), hidden: !next }, { quiet: true });
        });
    }

    async function reimport(id) {
        const p = find(id);
        if (!p || !window.Importer || !window.Importer.ingest) { window.toast('The importer isn’t available here', 'error'); return; }
        const repo = p.repo || (window.resolveRepoUrl && window.resolveRepoUrl(p));
        const urls = (p.sources || []).length ? p.sources : [repo, p.link].filter(Boolean);
        if (!urls.length) { window.toast('This project has no source links yet — add them in Edit → More', 'info'); return; }
        const progress = window.progressToast(`Re-reading ${p.title}…`);
        try {
            const provider = window.Ai && window.Ai.getProvider ? window.Ai.getProvider() : 'claude';
            const final = await window.Importer.ingest({ urls, provider, existing: withoutId(p) }, (ev) => {
                if (ev.status === 'run' && ev.label) progress.update(ev.label);
            });
            const draft = final.project || {};
            const keep = new Set(p.locked || []);
            const merged = { ...withoutId(p) };
            Object.entries(draft).forEach(([k, v]) => {
                if (keep.has(k) || ['id', 'locked', 'featured', 'order', 'hidden'].includes(k)) return;
                merged[k] = v;
            });
            merged.auto = true;
            const changes = window.diffProjects ? window.diffProjects(withoutId(p), merged) : [];
            if (!changes.length) { window.toast(`${p.title} is already up to date`, 'success'); return; }
            const ok = await window.updateProjectInDb(p.id, merged, { quiet: true });
            if (!ok) return;
            if (window.writeHistory) window.writeHistory({ projectId: p.id, kind: 'import', summary: `Re-imported — ${changes.length} field${changes.length === 1 ? '' : 's'} updated`, changes });
            window.toastWithAction(`Updated ${changes.length} field${changes.length === 1 ? '' : 's'} on ${p.title}`, 'See changes', () => openHistory({ projectId: String(p.id) }));
        } catch (e) {
            window.toast(e.message || 'Re-import failed', 'error');
        } finally {
            progress.close();
        }
    }
    window.reimportProject = reimport;

    /* =====================================================================
       Releases & history
       ===================================================================== */

    const KINDS = [
        ['all', 'Everything'], ['import', 'Imports'], ['edit', 'Edits'],
        ['refresh', 'Refreshes'], ['release', 'Releases'], ['rehost', 'Rehosts']
    ];
    const KIND_ICON = { import: 'wand', edit: 'pencil', refresh: 'refresh', release: 'rocket', rehost: 'cloud' };

    let histCache = null;           // { at, items }
    async function getHistory(force = false) {
        if (!force && histCache && Date.now() - histCache.at < 60_000) return histCache.items;
        if (!window.loadHistory) throw new Error('History isn’t available yet — still connecting');
        const items = await window.loadHistory({ max: 150 });
        histCache = { at: Date.now(), items };
        return items;
    }
    window.addEventListener('adminchange', () => { histCache = null; });

    const label = (f) => (window.FIELD_LABELS && window.FIELD_LABELS[f]) || f;

    function pretty(v) {
        const s = String(v ?? '');
        if (!s || s === '""' || s === '[]' || s === '{}' || s === 'null' || s === 'undefined') return '';
        try {
            const j = JSON.parse(s);
            if (Array.isArray(j)) return j.map((x) => (x && typeof x === 'object' ? (x.label || x.url || JSON.stringify(x)) : String(x))).join(' · ');
            if (j && typeof j === 'object') return Object.entries(j).map(([k, x]) => `${k}: ${x}`).join(' · ');
        } catch { /* plain string */ }
        return s;
    }

    function diffHtml(changes = []) {
        if (!changes.length) return '<p class="hist-nochg">No field-level changes recorded.</p>';
        return `<dl class="hist-diff">${changes.map((c) => {
            const before = pretty(c.before), after = pretty(c.after);
            return `<div class="hist-chg">
                <dt>${esc(label(c.field))}</dt>
                <dd>${before ? `<del>${esc(before)}</del>` : '<span class="hist-empty">empty</span>'}
                    <span class="hist-arrow" aria-label="became">${icon('arrow-right', 12)}</span>
                    ${after ? `<ins>${esc(after)}</ins>` : '<span class="hist-empty">removed</span>'}</dd>
            </div>`;
        }).join('')}</dl>`;
    }

    function dayLabel(ms) {
        const d = new Date(ms);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const that = new Date(d); that.setHours(0, 0, 0, 0);
        const diff = Math.round((today - that) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: today.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
    }

    function entriesHtml(items, { compact = false } = {}) {
        if (!items.length) {
            return `<div class="hist-empty-state">${icon('history', 22)}<p>${compact ? 'Nothing recorded for this project yet.' : 'Nothing matches — imports, edits, refreshes and releases appear here as they happen.'}</p></div>`;
        }
        let html = '';
        let day = '';
        items.forEach((h) => {
            const d = dayLabel(h.at || 0);
            if (!compact && d !== day) { day = d; html += `<h6 class="hist-day">${esc(d)}</h6>`; }
            const p = find(h.projectId);
            const n = (h.changes || []).length;
            html += `<details class="hist-row" data-kind="${esc(h.kind)}">
                <summary>
                    <span class="hist-kind" data-kind="${esc(h.kind)}">${icon(KIND_ICON[h.kind] || 'history', 13)}</span>
                    <span class="hist-main">
                        ${compact ? '' : `<b>${esc(p ? p.title : 'Removed project')}</b>`}
                        <span>${esc(h.summary || h.kind)}</span>
                    </span>
                    <span class="hist-meta">${h.by === 'worker' ? `<span class="hist-by" data-tip="Done automatically">${icon('bolt', 11)}</span>` : ''}
                        <time datetime="${new Date(h.at || 0).toISOString()}">${esc(ago(h.at || 0))}</time>
                        ${n ? `<span class="hist-n">${n}</span>` : ''}</span>
                </summary>
                <div class="hist-body">
                    ${diffHtml(h.changes || [])}
                    ${p && !compact ? `<button type="button" class="btn btn--quiet hist-open" data-hist-edit="${esc(p.id)}">${icon('pencil', 13)} Open ${esc(p.title)}</button>` : ''}
                </div>
            </details>`;
        });
        return html;
    }

    function errorHtml(e) {
        const quota = /quota|resource-exhausted|exhausted/i.test(`${e.code || ''} ${e.message || ''}`);
        return `<div class="hist-empty-state is-error">${icon('alert', 20)}<p>${esc(quota
            ? 'Firestore’s free daily quota is used up — history loads again after it resets.'
            : (e.message || 'Couldn’t load the history'))}</p></div>`;
    }

    window.AdminHistory = {
        async renderInto(el, { projectId = null, compact = false } = {}) {
            el.innerHTML = '<div class="hist-skel"><span></span><span></span><span></span></div>';
            try {
                const items = (await getHistory()).filter((h) => !projectId || String(h.projectId) === String(projectId));
                el.innerHTML = entriesHtml(compact ? items.slice(0, 12) : items, { compact });
            } catch (e) {
                el.innerHTML = errorHtml(e);
            }
        }
    };

    let histSheet = null;
    const histState = { pane: 'history', kind: 'all', projectId: '' };

    function buildHistory() {
        histSheet = makeSheet('historySheet', 'lg', 'Releases and history', `
            <div class="sheet-head">
                <h2>Releases &amp; history</h2>
                <p>Every import, edit, metrics refresh, release and rehost — with what changed.</p>
            </div>
            <div class="sheet-body hist-sheet-body">
                <div class="ed-tabs hist-tabs" role="tablist" aria-label="View">
                    <button type="button" role="tab" class="ed-tab is-active" data-hist-pane="history" aria-selected="true">History</button>
                    <button type="button" role="tab" class="ed-tab" data-hist-pane="releases" aria-selected="false">Releases</button>
                </div>
                <div data-hist-view="history">
                    <div class="hist-filters">
                        <div class="selectwrap">
                            <select class="select" id="histProject" aria-label="Project"></select>
                            ${icon('chev-down', 14)}
                        </div>
                        <div class="hist-kinds" role="group" aria-label="Kind">
                            ${KINDS.map(([k, l]) => `<button type="button" class="chip ${k === 'all' ? 'is-active' : ''}" data-hist-kind="${k}">${esc(l)}</button>`).join('')}
                        </div>
                        <button type="button" class="ibtn" id="histReload" aria-label="Reload" data-tip="Reload">${icon('refresh', 15)}</button>
                    </div>
                    <div class="hist-list" id="histList" aria-live="polite"></div>
                </div>
                <div data-hist-view="releases" hidden>
                    <div class="rel-list" id="relList" aria-live="polite"></div>
                </div>
            </div>`);

        histSheet.addEventListener('click', (e) => {
            const pane = e.target.closest('[data-hist-pane]');
            if (pane) { histState.pane = pane.dataset.histPane; paintHistory(); return; }
            const kind = e.target.closest('[data-hist-kind]');
            if (kind) { histState.kind = kind.dataset.histKind; paintHistory(); return; }
            const edit = e.target.closest('[data-hist-edit]');
            if (edit) { window.closeSheet(histSheet); setTimeout(() => window.editProject(edit.dataset.histEdit), 220); return; }
            if (e.target.closest('#histReload')) { histCache = null; paintHistory(); }
        });
        histSheet.querySelector('#histProject').addEventListener('change', (e) => { histState.projectId = e.target.value; paintHistory(); });
    }

    async function paintHistory() {
        histSheet.querySelectorAll('[data-hist-pane]').forEach((b) => {
            const on = b.dataset.histPane === histState.pane;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', String(on));
        });
        histSheet.querySelectorAll('[data-hist-view]').forEach((v) => { v.hidden = v.dataset.histView !== histState.pane; });

        if (histState.pane === 'releases') { paintReleases(); return; }

        const sel = histSheet.querySelector('#histProject');
        const list = projects().slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
        sel.innerHTML = `<option value="">All projects</option>${list.map((p) =>
            `<option value="${esc(p.id)}" ${String(p.id) === histState.projectId ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}`;
        histSheet.querySelectorAll('[data-hist-kind]').forEach((b) => b.classList.toggle('is-active', b.dataset.histKind === histState.kind));

        const box = histSheet.querySelector('#histList');
        box.innerHTML = '<div class="hist-skel"><span></span><span></span><span></span><span></span></div>';
        try {
            const items = (await getHistory()).filter((h) => (!histState.projectId || String(h.projectId) === histState.projectId)
                && (histState.kind === 'all' || h.kind === histState.kind));
            box.innerHTML = entriesHtml(items);
        } catch (e) {
            box.innerHTML = errorHtml(e);
        }
    }

    async function paintReleases() {
        const box = histSheet.querySelector('#relList');
        box.innerHTML = '<div class="hist-skel"><span></span><span></span><span></span></div>';
        try {
            if (!window.edgeFetch) throw new Error('Releases come from the live site');
            const data = await window.edgeFetch('/api/releases');
            const items = (data && data.items) || [];
            if (!items.length) {
                box.innerHTML = `<div class="hist-empty-state">${icon('rocket', 22)}<p>No releases in the last four months. When a repo publishes one, it appears here — and on the site — automatically.</p></div>`;
                return;
            }
            box.innerHTML = items.map((r) => `
                <article class="rel-row">
                    <div class="rel-top">
                        <b>${esc(r.title)}</b>
                        <span class="rel-tag">${esc(r.tag || r.name || '')}</span>
                        ${r.isNew ? '<span class="rel-new">New</span>' : ''}
                        <time>${esc(r.date ? ago(r.date) : '')}</time>
                    </div>
                    ${(r.summary || []).length ? `<ul>${r.summary.slice(0, 5).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
                    <div class="rel-acts">
                        ${r.url ? `<a class="btn btn--quiet" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${icon('external', 13)} On GitHub</a>` : ''}
                        ${r.projectId ? `<button type="button" class="btn btn--quiet" data-hist-edit="${esc(r.projectId)}">${icon('pencil', 13)} Edit project</button>` : ''}
                    </div>
                </article>`).join('');
        } catch (e) {
            box.innerHTML = `<div class="hist-empty-state is-error">${icon('alert', 20)}<p>${esc(e.status === 404 ? 'The releases feed isn’t deployed on this server yet.' : (e.message || 'Couldn’t load releases'))}</p></div>`;
        }
    }

    function openHistory({ projectId = '', pane = 'history' } = {}) {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        if (!histSheet) buildHistory();
        histState.projectId = projectId ? String(projectId) : '';
        histState.pane = pane;
        histState.kind = 'all';
        window.openSheet(histSheet);
        paintHistory();
    }
    window.openHistory = openHistory;

    /* =====================================================================
       Rehost — move a project whose host died onto Cloudflare Pages
       ===================================================================== */

    let rhSheet = null;
    let rhPoll = null;

    function buildRehost() {
        rhSheet = makeSheet('rehostSheet', 'sm', 'Rehost on Cloudflare', `
            <div class="sheet-head">
                <h2 id="rhTitle">Rehost</h2>
                <p id="rhSub">Builds the repo on Cloudflare Pages — free, and your current link stays until you switch.</p>
            </div>
            <div class="sheet-body">
                <ol class="imp-stages rh-steps" id="rhSteps">
                    <li class="imp-stage" data-rh="create" data-state="idle"><span class="imp-ico" aria-hidden="true"></span><span class="imp-txt"><b>Create the Pages project</b><small></small></span></li>
                    <li class="imp-stage" data-rh="build" data-state="idle"><span class="imp-ico" aria-hidden="true"></span><span class="imp-txt"><b>Build and deploy</b><small></small></span></li>
                    <li class="imp-stage" data-rh="live" data-state="idle"><span class="imp-ico" aria-hidden="true"></span><span class="imp-txt"><b>Live</b><small></small></span></li>
                </ol>
                <div class="rh-detail" id="rhDetail" hidden></div>
            </div>
            <div class="sheet-foot" id="rhFoot">
                <button class="btn btn--quiet" type="button" data-close>Close</button>
            </div>`);
        rhSheet.addEventListener('click', (e) => {
            if (e.target === rhSheet || e.target.closest('[data-close]')) { clearInterval(rhPoll); rhPoll = null; }
        });
    }

    function rhStep(key, state, note) {
        const li = rhSheet.querySelector(`[data-rh="${key}"]`);
        if (!li) return;
        li.dataset.state = state;
        li.querySelector('small').textContent = note || '';
    }

    function rhDetail(html) {
        const box = rhSheet.querySelector('#rhDetail');
        box.hidden = !html;
        box.innerHTML = html || '';
    }

    function rhFoot(html) {
        rhSheet.querySelector('#rhFoot').innerHTML = `<button class="btn btn--quiet" type="button" data-close>Close</button>${html || ''}`;
    }

    function needsSetup(detail) {
        rhStep('create', 'error', 'Cloudflare needs a one-time setup');
        rhDetail(`<p class="rh-need">${esc(detail || 'Rehosting needs a Cloudflare API token and access to the repo.')}</p>
            <a class="btn btn--ghost" href="https://dash.cloudflare.com/?to=/:account/pages" target="_blank" rel="noopener noreferrer">${icon('external', 14)} Open Cloudflare</a>`);
    }

    async function startRehost(id) {
        const p = find(id);
        if (!p) return;
        const repo = p.repo || (window.resolveRepoUrl && window.resolveRepoUrl(p));
        if (!repo) { window.toast('Rehosting needs a GitHub repo', 'info'); return; }
        const ok = await window.confirmAction({
            title: `Rehost ${p.title}?`,
            message: `Builds ${repo.replace('https://github.com/', '')} on Cloudflare Pages (free). Your current link stays until you choose to switch. Apps that need secret keys will need those added in Cloudflare.`,
            confirm: 'Rehost'
        });
        if (!ok) return;
        if (!rhSheet) buildRehost();
        rhSheet.querySelector('#rhTitle').textContent = `Rehost ${p.title}`;
        ['create', 'build', 'live'].forEach((k) => rhStep(k, 'idle', ''));
        rhDetail('');
        rhFoot('');
        window.openSheet(rhSheet);
        rhStep('create', 'run', 'Talking to Cloudflare…');

        let token;
        try { token = await window.adminIdToken(); } catch (e) { rhStep('create', 'error', e.message); return; }
        let res;
        try {
            res = await window.edgeFetch('/api/rehost', { method: 'POST', body: { projectId: String(p.id) }, token });
        } catch (e) {
            rhStep('create', 'error', e.status === 404 ? 'Rehosting isn’t deployed on this server yet' : (e.message || 'Cloudflare refused'));
            return;
        }
        handleRehostState(p, res, token);
    }

    function handleRehostState(p, res, token) {
        const state = res && res.state;
        if (state === 'needs-setup') { needsSetup(res.detail); return; }
        if (state === 'error' || state === 'failure') {
            const step = rhSheet.querySelector('[data-rh="build"]').dataset.state === 'run' ? 'build' : 'create';
            rhStep(step, 'error', 'It didn’t work');
            rhDetail(`<p class="rh-need">${esc(res.detail || 'The build failed — open Cloudflare for the build log.')}</p>`);
            rhFoot(`<button class="btn btn--primary" type="button" id="rhRetry">${icon('refresh', 14)} Try again</button>`);
            rhSheet.querySelector('#rhRetry').addEventListener('click', () => startRehost(p.id));
            return;
        }
        rhStep('create', 'ok', res.pagesProject ? `Project “${res.pagesProject}”` : 'Ready');
        if (state === 'success') { rehostLive(p, res); return; }

        // building → poll
        rhStep('build', 'run', 'Building — this usually takes a minute or two');
        const started = Date.now();
        clearInterval(rhPoll);
        rhPoll = setInterval(async () => {
            if (!rhSheet.classList.contains('is-open')) { clearInterval(rhPoll); rhPoll = null; return; }
            const secs = Math.round((Date.now() - started) / 1000);
            rhStep('build', 'run', `Building — ${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}`);
            if (secs > 900) { clearInterval(rhPoll); rhStep('build', 'error', 'Still building after 15 minutes — check Cloudflare'); return; }
            if (secs % 6) return;
            try {
                const r = await window.edgeFetch(`/api/rehost?projectId=${encodeURIComponent(p.id)}`, { token });
                if (r.state === 'building') return;
                clearInterval(rhPoll);
                rhPoll = null;
                if (r.state === 'success') { rhStep('build', 'ok', 'Built'); rehostLive(p, r); }
                else handleRehostState(p, r, token);
            } catch { /* keep polling */ }
        }, 1000);
    }

    function rehostLive(p, res) {
        rhStep('build', 'ok', 'Built');
        rhStep('live', 'ok', res.url ? hostOf(res.url) : 'Deployed');
        if (window.Micro) window.Micro.burst(rhSheet.querySelector('[data-rh="live"]'), { count: 18, spread: 80 });
        rhDetail(res.url ? `<p class="rh-url">${icon('globe', 14)} <a href="${esc(res.url)}" target="_blank" rel="noopener noreferrer">${esc(res.url)}</a></p>` : '');
        if (!res.url) return;
        rhFoot(`<a class="btn btn--ghost" href="${esc(res.url)}" target="_blank" rel="noopener noreferrer">${icon('external', 14)} Open it</a>
            <button class="btn btn--primary" type="button" id="rhUse">${icon('check', 15)} Use this URL</button>`);
        rhSheet.querySelector('#rhUse').addEventListener('click', async (e) => {
            const cur = find(p.id) || p;
            const busy = window.Micro ? window.Micro.busy(e.currentTarget) : { done() {} };
            const next = { ...withoutId(cur), link: res.url, status: 'live' };
            const ok = await window.updateProjectInDb(cur.id, next, { quiet: true });
            busy.done(!!ok);
            if (!ok) return;
            if (window.writeHistory) window.writeHistory({ projectId: cur.id, kind: 'rehost', summary: `Moved to ${hostOf(res.url)}`, changes: [{ field: 'link', before: cur.link, after: res.url }] });
            window.toast(`${cur.title} now points at ${hostOf(res.url)}`, 'success');
            setTimeout(() => window.closeSheet(rhSheet), 700);
        });
    }
    window.startRehost = startRehost;
})();
