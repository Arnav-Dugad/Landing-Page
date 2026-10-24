/* ===========================================================================
   admin.js  (classic script)
   The project editor: add, EDIT, duplicate and delete, with a live preview
   card that renders through exactly the same code path as the real grid.

   One sheet, five tabs — Basics · Media · Get it · Story · More — and only
   two buttons that matter: Save (also Ctrl/Cmd+S) and Close. Everything
   secondary lives in the ⋯ menu beside them.

   Media is drag-and-drop: screenshots dropped, pasted or picked from the
   computer are compressed in the browser and stored through
   window.uploadMedia (js/firebase.js), then arranged by dragging.

   Admin state is NOT a client flag — it is derived from the Firebase session
   (`user.isAnonymous === false`). Hiding the buttons is cosmetic; what decides
   whether a write lands is firestore.rules matching the signed-in account.
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
    const esc = (v) => window.esc(v);
    const ico = (k, size = 14) => window.icon(k, { raw: true, size });

    /* editingId === null means "creating a new project". */
    let editingId = null;
    let original = null;            // the project as it was when the editor opened
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
        'version', 'requirements', 'downloads', 'stores', 'gallery', 'galleryAlt', 'problem', 'approach',
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

    // The auth listener in firebase.js owns this — and may already have set
    // it before this script was loaded on demand (js/data.js).
    window.isAdmin = window.isAdmin === true;

    /* Categories live in js/core.js so the case-study, résumé and Now pages
       label them exactly the way the editor does. */
    const CATEGORY_GROUPS = window.CATEGORY_GROUPS || [['Other', [['other', 'Other']]]];

    const TAG_GROUPS = {
        Languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'Python', 'C++', 'C', 'C#',
                    'Java', 'Go', 'Rust', 'Swift', 'Kotlin', 'PHP', 'SQL', 'Dart'],
        Frameworks: ['React', 'Next.js', 'Vue', 'Svelte', 'Node.js', 'Express', 'Flask',
                     'Django', 'Tailwind', 'Three.js', 'FastAPI', 'Astro', 'WPF', 'Jetpack Compose', 'SwiftUI'],
        'Tools & platforms': ['Firebase', 'Vercel', 'Supabase', 'MongoDB', 'PostgreSQL', 'Vite',
                              'WebGL', 'Canvas', 'PWA', 'WebSockets', 'Docker', 'GitHub Actions']
    };

    /* =====================================================================
       Tabs
       ===================================================================== */

    const TABS = ['basics', 'media', 'getit', 'story', 'more'];
    let tab = 'basics';

    function paintTabInk() {
        const ink = sheet.querySelector('.ed-tab-ink');
        const on = sheet.querySelector(`.ed-tab[data-ed-tab="${tab}"]`);
        if (!ink || !on) return;
        ink.style.transform = `translateX(${on.offsetLeft}px)`;
        ink.style.width = `${on.offsetWidth}px`;
    }

    function setTab(name, { focus = false } = {}) {
        if (!TABS.includes(name)) return;
        tab = name;
        sheet.querySelectorAll('.ed-tab').forEach((b) => {
            const on = b.dataset.edTab === name;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        sheet.querySelectorAll('.ed-pane').forEach((p) => { p.hidden = p.dataset.edPane !== name; });
        paintTabInk();
        if (name === 'more' && editingId) renderHistory();
        if (focus) sheet.querySelector(`.ed-tab[data-ed-tab="${name}"]`)?.focus();
        const scroller = sheet.querySelector('.sheet-panel');
        const head = sheet.querySelector('.ed-head');
        if (scroller && head && scroller.scrollTop > head.offsetHeight) scroller.scrollTop = 0;
    }
    window.editorTab = setTab;

    sheet.querySelector('.ed-tabs')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ed-tab]');
        if (b) setTab(b.dataset.edTab);
    });
    sheet.querySelector('.ed-tabs')?.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const i = TABS.indexOf(tab);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1
            : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
        setTab(TABS[next], { focus: true });
    });
    window.addEventListener('resize', paintTabInk, { passive: true });

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
                 aria-label="Use the ${k} icon">${ico(k, 17)}</button>`).join('')
            : `<p style="grid-column:1/-1;font-size:var(--t-2xs);color:var(--ink-35);padding:10px">No icons match "${esc(query)}".</p>`;
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
                ${ico(m.icon)}<span>${m.label}</span>${at >= 0 ? `<b>${at + 1}</b>` : ''}</button>`;
        }).join('');
    }

    /* ---- Downloads: one compact row per release file -------------------- */
    const MB = 1024 * 1024;

    function downloadRow(d = {}) {
        const opts = PLATFORM_KEYS.map((k) =>
            `<option value="${k}" ${d.platform === k ? 'selected' : ''}>${platformMeta(k).label}</option>`).join('');
        const size = d.size ? (d.size / MB).toFixed(d.size >= 10 * MB ? 0 : 1) : '';
        return `<div class="dl-row" data-arch="${esc(d.arch || '')}">
            <div class="selectwrap"><select class="select" data-dl="platform" aria-label="Platform">${opts}</select>${ico('chev-down')}</div>
            <input class="input" data-dl="label" placeholder="Label — e.g. Windows installer" value="${esc(d.label || '')}" aria-label="Label">
            <input class="input" data-dl="url" type="url" placeholder="https://…/App-1.0.exe" value="${esc(d.url || '')}" aria-label="File URL">
            <input class="input" data-dl="size" type="number" min="0" step="0.1" placeholder="MB" value="${size}" aria-label="Size in MB">
            <input class="input" data-dl="count" type="number" min="0" placeholder="Downloads" value="${d.count ?? ''}" aria-label="Download count">
            <input class="input" data-dl="version" placeholder="1.0.0" value="${esc(d.version || '')}" aria-label="Version">
            <button type="button" class="ibtn dl-del" data-dl-del aria-label="Remove this download">${ico('x')}</button>
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
            hidden: !!(F('fHidden') && F('fHidden').checked),
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
            gallery: readyMedia().map((m) => m.url),
            galleryAlt: readyMedia().map((m) => m.alt || ''),

            /* Apps, downloads & stores */
            platforms: platformOrder.slice(),
            appIcon: val('fAppIcon'),
            cover: val('fCover'),
            coverDark: val('fCoverDark'),
            version: val('fVersion'),
            requirements: lines('fRequirements').slice(0, 6),
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
    window.normFieldValue = norm;

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

        const feat = F('fFeatured');
        if (feat) feat.checked = !!p.featured;
        const hid = F('fHidden');
        if (hid) hid.checked = !!p.hidden;
        const cs = F('fCaseStudy');
        if (cs) cs.checked = !!p.caseStudy;

        set('fTagline', p.tagline);
        set('fAppIcon', p.appIcon);
        set('fCover', p.cover);
        set('fCoverDark', p.coverDark);
        set('fVersion', p.version);
        set('fRequirements', join(p.requirements));
        set('fSources', join(p.sources));
        platformOrder = (Array.isArray(p.platforms) ? p.platforms : []).filter((k) => PLATFORM_KEYS.includes(k));
        paintPlatforms();
        paintDownloads(Array.isArray(p.downloads) ? p.downloads : []);
        document.querySelectorAll('#editorForm [data-store]').forEach((el) => {
            el.value = (p.stores && p.stores[el.dataset.store]) || '';
        });
        const auto = F('fAuto');
        if (auto) auto.checked = !!p.auto;

        // Screenshots: fresh, ready items from the stored lists.
        const alts = Array.isArray(p.galleryAlt) ? p.galleryAlt : [];
        media = (Array.isArray(p.gallery) ? p.gallery : []).filter(Boolean)
            .map((url, i) => ({ key: nextKey(), url, alt: alts[i] || '', state: 'ready' }));
        paintMedia();
        syncMediaFields({ silent: true });

        // Fields the form doesn't show, but a full-overwrite save must keep.
        carry = {};
        ['releasedAt', 'stack'].forEach((k) => { if (p[k] !== undefined) carry[k] = p[k]; });
        paintThumbs();
        paintCase();
    }

    /* js/enrich.js and js/ai.js drive the form from outside. */
    window.readEditorForm = readForm;
    window.writeEditorForm = writeForm;

    /* The case-study fields only matter once the page is switched on. */
    function paintCase() {
        const on = !!(F('fCaseStudy') && F('fCaseStudy').checked);
        const box = F('edCase');
        if (box) box.classList.toggle('is-off', !on);
    }
    F('fCaseStudy')?.addEventListener('change', paintCase);

    /* =====================================================================
       Media — drag, drop, paste or browse; compressed in the browser
       ===================================================================== */

    let media = [];                 // [{ key, url, alt, state:'ready'|'busy'|'error', note, blob }]
    let keySeq = 0;
    const nextKey = () => `m${++keySeq}`;
    const readyMedia = () => media.filter((m) => m.state === 'ready' && m.url);

    const fmtKB = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
    const absolute = (url) => { try { return new URL(url, location.origin).href; } catch { return url; } };
    const isImageFile = (f) => f && (/^image\//.test(f.type || '') || /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i.test(f.name || ''));

    function paintMedia() {
        const grid = F('mediaGrid');
        if (!grid) return;
        const cover = val('fCover');
        if (!media.length) {
            grid.innerHTML = '';
            grid.classList.add('is-empty');
        } else {
            grid.classList.remove('is-empty');
            grid.innerHTML = media.map((m, i) => {
                const src = m.state === 'ready' ? window.safeUrl(m.url) || m.url : (m.preview || '');
                const isCover = m.state === 'ready' && cover && (cover === m.url || absolute(cover) === absolute(m.url));
                return `
                <figure class="md-tile is-${m.state} ${isCover ? 'is-cover' : ''}" data-key="${m.key}" draggable="${m.state === 'ready'}" tabindex="0"
                        aria-label="Screenshot ${i + 1}${isCover ? ', cover' : ''}${m.state === 'busy' ? ', uploading' : ''}">
                    <div class="md-img">
                        ${src ? `<img src="${esc(src)}" alt="${esc(m.alt || '')}" draggable="false" loading="lazy">` : ''}
                        <span class="md-n">${i + 1}</span>
                        ${m.state === 'busy' ? `<span class="md-veil"><i class="md-ring"></i><small>${esc(m.note || 'Working…')}</small></span>` : ''}
                        ${m.state === 'error' ? `<span class="md-veil is-error">${ico('alert', 18)}<small>${esc(m.note || 'Failed')}</small></span>` : ''}
                        <div class="md-acts">
                            ${m.state === 'ready' ? `<button type="button" class="md-btn ${isCover ? 'is-on' : ''}" data-md="cover" aria-pressed="${isCover}" data-tip="${isCover ? 'This is the cover' : 'Use as cover'}" aria-label="Use as cover">${ico(isCover ? 'star-fill' : 'star', 13)}</button>` : ''}
                            ${m.state === 'error' && m.file ? `<button type="button" class="md-btn" data-md="retry" data-tip="Try again" aria-label="Try again">${ico('refresh', 13)}</button>` : ''}
                            <button type="button" class="md-btn is-danger" data-md="remove" data-tip="Remove" aria-label="Remove screenshot ${i + 1}">${ico('x', 13)}</button>
                        </div>
                        ${m.state === 'ready' ? `<span class="md-grip" aria-hidden="true">${ico('drag', 12)}</span>` : ''}
                    </div>
                    ${m.state === 'ready' ? `
                    <figcaption class="md-cap">
                        <input class="md-alt" data-md-alt value="${esc(m.alt || '')}" maxlength="160" placeholder="Describe it…" aria-label="Alt text for screenshot ${i + 1}">
                        <button type="button" class="md-ai" data-md="describe" data-tip="Describe with AI" aria-label="Describe screenshot ${i + 1} with AI">${ico('sparkles', 13)}</button>
                    </figcaption>
                    ${m.size ? `<span class="md-size">${esc(m.size)}</span>` : ''}` : ''}
                </figure>`;
            }).join('');
        }
        const n = F('edMediaCount');
        if (n) n.textContent = readyMedia().length ? String(readyMedia().length) : '';
    }

    function syncMediaFields({ silent = false } = {}) {
        const ready = readyMedia();
        const g = F('fGallery'); const a = F('fGalleryAlt');
        if (g) g.value = ready.map((m) => m.url).join('\n');
        if (a) a.value = ready.map((m) => (m.alt || '').replace(/\n/g, ' ')).join('\n');
        const n = F('edMediaCount');
        if (n) n.textContent = ready.length ? String(ready.length) : '';
        if (!silent) onEdit();
    }

    /* Two at a time: fast, but the browser stays responsive while it encodes. */
    let uploadQueue = [];
    let uploading = 0;

    function pump() {
        while (uploading < 2 && uploadQueue.length) {
            const item = uploadQueue.shift();
            uploading++;
            uploadOne(item).finally(() => { uploading--; pump(); paintSaveState(); });
        }
        paintSaveState();
    }

    async function uploadOne(item) {
        const set = (patch) => { Object.assign(item, patch); paintMedia(); };
        set({ state: 'busy', note: 'Reading…' });
        try {
            if (!window.uploadMedia) throw new Error('Uploads aren’t available yet — still connecting');
            const res = await window.uploadMedia(item.file, {
                onStage: (stage, info) => {
                    if (stage === 'encode') set({ note: 'Compressing…' });
                    if (stage === 'upload' && info) set({ note: `Uploading ${fmtKB(info.bytes)}…` });
                }
            });
            const saved = item.file.size ? Math.max(0, Math.round((1 - res.bytes / item.file.size) * 100)) : 0;
            if (item.preview) URL.revokeObjectURL(item.preview);
            set({
                state: 'ready', url: res.url, note: '', preview: '', file: null,
                size: `${fmtKB(res.bytes)} · ${res.w}×${res.h}${saved > 4 ? ` · ${saved}% smaller` : ''}`
            });
            // First screenshot with no cover yet becomes the cover.
            if (!val('fCover') && readyMedia()[0] === item) { F('fCover').value = item.url; paintThumbs(); paintMedia(); }
            syncMediaFields();
        } catch (e) {
            set({ state: 'error', note: e.message || 'Upload failed' });
            window.toast(e.message || 'Upload failed', 'error');
        }
    }

    function addFiles(fileList) {
        const files = Array.from(fileList || []);
        const images = files.filter(isImageFile);
        const skipped = files.length - images.length;
        if (skipped) window.toast(`${skipped} file${skipped === 1 ? ' isn’t an image' : 's aren’t images'} — skipped`, 'info');
        if (!images.length) return 0;
        const room = 20 - media.length;
        if (room <= 0) { window.toast('Twenty screenshots is the limit', 'info'); return 0; }
        images.slice(0, room).forEach((file) => {
            let preview = '';
            try { preview = URL.createObjectURL(file); } catch { /* no preview */ }
            const item = { key: nextKey(), state: 'busy', note: 'Waiting…', file, preview, alt: '' };
            media.push(item);
            uploadQueue.push(item);
        });
        if (images.length > room) window.toast(`Only ${room} more fit — the rest were skipped`, 'info');
        paintMedia();
        pump();
        return Math.min(images.length, room);
    }
    window.editorAddFiles = (files) => { setTab('media'); return addFiles(files); };

    /* For ai.js "Describe all": alt text per ready screenshot, in order. */
    window.editorMedia = () => readyMedia().map((m) => ({ url: m.url, absolute: absolute(m.url), alt: m.alt || '' }));
    window.editorSetAlts = (alts = []) => {
        readyMedia().forEach((m, i) => { if (alts[i]) m.alt = String(alts[i]).trim(); });
        paintMedia();
        syncMediaFields();
    };

    function addUrl(raw) {
        const url = window.safeUrl(String(raw || '').trim());
        if (!url) { window.toast('That isn’t a valid image link', 'error'); return; }
        if (media.some((m) => m.url === url)) { window.toast('That image is already here', 'info'); return; }
        media.push({ key: nextKey(), url, alt: '', state: 'ready' });
        paintMedia();
        syncMediaFields();
    }

    const tileOf = (el) => el && el.closest('.md-tile');
    const itemOf = (el) => { const t = tileOf(el); return t ? media.find((m) => m.key === t.dataset.key) : null; };

    const mediaGrid = F('mediaGrid');
    if (mediaGrid) {
        mediaGrid.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-md]');
            if (!btn) return;
            const item = itemOf(btn);
            if (!item) return;
            const act = btn.dataset.md;
            if (act === 'remove') {
                if (item.preview) URL.revokeObjectURL(item.preview);
                uploadQueue = uploadQueue.filter((q) => q !== item);
                media = media.filter((m) => m !== item);
                if (val('fCover') === item.url) { F('fCover').value = readyMedia()[0] ? readyMedia()[0].url : ''; paintThumbs(); }
                paintMedia();
                syncMediaFields();
            } else if (act === 'cover') {
                F('fCover').value = item.url;
                paintThumbs();
                paintMedia();
                syncMediaFields();
                if (window.Micro) window.Micro.burst(btn, { count: 10, spread: 40 });
            } else if (act === 'retry') {
                item.state = 'busy'; item.note = 'Waiting…';
                uploadQueue.push(item);
                paintMedia();
                pump();
            } else if (act === 'describe') {
                if (!window.Ai || !window.Ai.call) { window.toast('AI tools aren’t loaded', 'error'); return; }
                const busy = window.Micro ? window.Micro.busy(btn) : { done() {} };
                try {
                    const r = await window.Ai.call('alt-text', { imageUrl: absolute(item.url), project: { title: val('fTitle'), desc: val('fDesc') } });
                    item.alt = String((r && r.alt) || '').trim();
                    busy.done(!!item.alt);
                    paintMedia();
                    syncMediaFields();
                } catch (err) {
                    busy.done(false);
                    window.toast(err.message || 'Could not describe it', 'error');
                }
            }
        });

        mediaGrid.addEventListener('input', (e) => {
            if (!e.target.matches('[data-md-alt]')) return;
            const item = itemOf(e.target);
            if (item) { item.alt = e.target.value; syncMediaFields(); }
        });

        /* Reorder: drag a tile, or Alt+←/→ when it has focus. */
        let dragKey = null;
        mediaGrid.addEventListener('dragstart', (e) => {
            const t = tileOf(e.target);
            if (!t || t.getAttribute('draggable') !== 'true') return;
            dragKey = t.dataset.key;
            t.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-portfolio-media', dragKey);
        });
        mediaGrid.addEventListener('dragover', (e) => {
            if (!dragKey) return;
            e.preventDefault();
            e.stopPropagation();
            const over = tileOf(e.target);
            const dragged = mediaGrid.querySelector(`.md-tile[data-key="${dragKey}"]`);
            if (!over || !dragged || over === dragged) return;
            const r = over.getBoundingClientRect();
            const after = e.clientX > r.left + r.width / 2;
            const before = Array.from(mediaGrid.children).map((el) => [el, el.getBoundingClientRect()]);
            mediaGrid.insertBefore(dragged, after ? over.nextSibling : over);
            // FLIP so neighbours slide instead of jumping.
            if (!(window.motionReduced && window.motionReduced())) {
                before.forEach(([el, b]) => {
                    if (el === dragged) return;
                    const a = el.getBoundingClientRect();
                    const dx = b.left - a.left, dy = b.top - a.top;
                    if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
                });
            }
        });
        const endDrag = () => {
            if (!dragKey) return;
            const order = Array.from(mediaGrid.querySelectorAll('.md-tile')).map((el) => el.dataset.key);
            media.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
            dragKey = null;
            paintMedia();
            syncMediaFields();
        };
        mediaGrid.addEventListener('drop', (e) => { if (dragKey) { e.preventDefault(); e.stopPropagation(); endDrag(); } });
        mediaGrid.addEventListener('dragend', endDrag);

        mediaGrid.addEventListener('keydown', (e) => {
            const t = tileOf(e.target);
            if (!t || e.target !== t || !e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            const i = media.findIndex((m) => m.key === t.dataset.key);
            const j = i + (e.key === 'ArrowRight' ? 1 : -1);
            if (j < 0 || j >= media.length) return;
            [media[i], media[j]] = [media[j], media[i]];
            paintMedia();
            syncMediaFields();
            mediaGrid.querySelector(`.md-tile[data-key="${media[j].key}"]`)?.focus();
        });
    }

    /* The drop zone: click/Enter to browse, files dropped onto it. */
    const dropZone = F('mediaDrop');
    const fileInput = F('mediaFile');
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
        });
        fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
    }

    /* Files dropped anywhere on the editor land in Media. */
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    let sheetDrag = 0;
    sheet.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        sheetDrag++;
        sheet.classList.add('is-file-over');
        if (tab !== 'media') setTab('media');
    });
    sheet.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    });
    sheet.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        sheetDrag = Math.max(0, sheetDrag - 1);
        if (!sheetDrag) sheet.classList.remove('is-file-over');
    });
    sheet.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        sheetDrag = 0;
        sheet.classList.remove('is-file-over');
        const n = addFiles(e.dataTransfer.files);
        if (n && window.Micro) window.Micro.burst(F('mediaDrop'), { count: 12, spread: 60 });
    });

    /* Paste a screenshot straight from the clipboard. */
    sheet.addEventListener('paste', (e) => {
        const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(isImageFile);
        if (!files.length) return;
        e.preventDefault();
        setTab('media');
        addFiles(files);
    });

    F('mediaUrlAdd')?.addEventListener('click', () => { addUrl(val('mediaUrl')); F('mediaUrl').value = ''; });
    F('mediaUrl')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addUrl(val('mediaUrl')); F('mediaUrl').value = ''; }
    });

    /* =====================================================================
       Draft autosave — a long write-up should survive a stray Esc, a reload
       or a closed tab. Keyed per project so drafts never cross-contaminate.
       ===================================================================== */

    const draftKey = () => `draft:${editingId || 'new'}`;

    function saveDraft() {
        try {
            localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), data: readForm() }));
            paintSaveState('Draft kept on this device');
        } catch { /* storage full or disabled */ }
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

    /* The quiet line beside the footer buttons. */
    function paintSaveState(note) {
        const el = F('edStatus');
        if (!el) return;
        const pending = media.filter((m) => m.state === 'busy').length;
        const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
        if (pending) el.textContent = `Uploading ${pending} screenshot${pending === 1 ? '' : 's'}…`;
        else if (note) el.textContent = note;
        else el.textContent = dirty ? `Unsaved changes · ${mac ? '⌘' : 'Ctrl+'}S to save` : '';
        el.classList.toggle('is-busy', !!pending);
    }

    /* =====================================================================
       Live preview — the real card renderer
       ===================================================================== */

    function renderPreview() {
        if (!preview) return;
        const p = readForm();
        renderAuto();
        if (window.projectCardHtml) {
            try {
                preview.innerHTML = window.projectCardHtml({ ...p, id: 'preview' }, 0);
                preview.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
                // The preview isn't a saved project — no admin controls on it.
                preview.querySelectorAll('.card-admin, [data-card-menu], [data-drag]').forEach((el) => el.remove());
                return;
            } catch (e) { console.error('Preview fell back:', e); }
        }
        preview.innerHTML = `
        <article class="card" style="${window.toneVars(p.color)}">
            <div class="card-plaque">${window.icon(p.icon, { size: 23 })}</div>
            <div class="card-body">
                <div class="card-head"><h3 class="card-title">${esc(p.title || 'Project title')}</h3></div>
                <p class="card-desc u-clamp-2">${esc(p.desc || 'A short description of what this project does and why it exists.')}</p>
            </div>
        </article>`;
    }

    /* Auto-managed switch + the locked-field chips (More tab). */
    const FIELD_LABELS = {
        title: 'Title', tagline: 'Tagline', desc: 'Description', longDesc: 'Write-up', highlights: 'Highlights',
        tags: 'Tech', category: 'Category', color: 'Colour', icon: 'Icon', status: 'Status', year: 'Year',
        link: 'Live URL', repo: 'Repo', searchTerms: 'Search terms', platforms: 'Platforms', appIcon: 'App icon',
        cover: 'Cover', coverDark: 'Dark cover', version: 'Version', requirements: 'Requirements', downloads: 'Downloads',
        stores: 'Stores', gallery: 'Screenshots', galleryAlt: 'Alt text', problem: 'Problem', approach: 'Approach',
        challenges: 'What broke', outcome: 'Outcome', featured: 'Featured', hidden: 'Hidden', role: 'Role',
        order: 'Order', caseStudy: 'Case study', metrics: 'Numbers', demoVideo: 'Demo video', previewVideo: 'Hover preview',
        sources: 'Sources', auto: 'Auto-managed', locked: 'Locked fields'
    };
    window.FIELD_LABELS = FIELD_LABELS;

    function renderAuto() {
        const strip = F('edAuto');
        if (!strip) return;
        const auto = !!(F('fAuto') && F('fAuto').checked);
        strip.classList.toggle('is-off', !auto);
        const box = F('edLocked');
        if (!box) return;
        const keys = Array.from(computeLocked(readFields()));
        box.innerHTML = !auto
            ? '<span class="ed-locked-note">Off — nothing here is refreshed automatically.</span>'
            : keys.length
                ? `<span class="ed-locked-note">${ico('lock', 12)} Kept as you wrote them:</span>${keys.map((k) =>
                    `<button type="button" class="lock-chip" data-unlock="${k}" data-tip="Let the sources update this again">${FIELD_LABELS[k] || k}${ico('x', 11)}</button>`).join('')}`
                : '<span class="ed-locked-note">Every field follows the sources. Edit one and it locks.</span>';
    }

    window.refreshEditorPreview = () => { renderPreview(); syncTagStates(); dirty = true; paintSaveState(); };

    /* Any field edit refreshes the preview, marks the form dirty and (debounced)
       parks a draft in localStorage. */
    function onEdit() {
        dirty = JSON.stringify(readForm()) !== snapshot;
        renderPreview();
        syncTagStates();
        paintSaveState();
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => { if (dirty) saveDraft(); }, 800);
    }
    form.addEventListener('input', (e) => { if (!e.target.matches('[data-md-alt]')) onEdit(); });
    form.addEventListener('change', (e) => { if (!e.target.matches('[data-md-alt], #mediaFile')) onEdit(); });

    /* =====================================================================
       History (More tab, edit mode)
       ===================================================================== */

    async function renderHistory() {
        const box = F('edHistory');
        const list = F('edHistoryList');
        if (!box || !list || !editingId) return;
        box.hidden = false;
        if (window.AdminHistory && window.AdminHistory.renderInto) {
            window.AdminHistory.renderInto(list, { projectId: editingId, compact: true });
        } else {
            list.innerHTML = '<p class="ed-locked-note">History isn’t available.</p>';
        }
    }

    /* =====================================================================
       Open / close
       ===================================================================== */

    function open(mode, project, { offerDraft = true } = {}) {
        buildOptions();
        buildTagPicker();

        editingId = mode === 'edit' ? String(project.id) : null;
        original = mode === 'edit' ? { ...project } : null;
        locked = new Set((project && Array.isArray(project.locked)) ? project.locked : []);
        unlocked = new Set();
        baseline = (project && project.auto && mode === 'edit') ? { ...project } : null;
        if (mode === 'dupe') { baseline = null; locked = new Set(); }
        uploadQueue = [];

        if (mode === 'new') {
            writeForm({ category: 'web', color: 'indigo', icon: 'rocket', status: 'live', year: String(new Date().getFullYear()), ...(project || {}) });
            titleEl.textContent = (project && project.title) ? project.title : 'New project';
            subEl.textContent = 'It appears on the site the moment you save.';
            saveBtn.textContent = 'Add project';
        } else if (mode === 'edit') {
            writeForm(project);
            titleEl.textContent = project.title || 'Edit project';
            subEl.textContent = 'Changes go live as soon as you save.';
            saveBtn.textContent = 'Save';
        } else { // duplicate
            writeForm({ ...project, title: `${project.title} copy` });
            titleEl.textContent = 'Duplicate project';
            subEl.textContent = `Starting from “${project.title}” — saves as a new project.`;
            saveBtn.textContent = 'Create copy';
        }

        const hist = F('edHistory');
        if (hist) { hist.hidden = true; F('edHistoryList').innerHTML = ''; }

        buildIconPicker(F('iconSearch') ? F('iconSearch').value : '');
        renderPreview();
        syncTagStates();
        snapshot = JSON.stringify(readForm());
        dirty = false;
        paintSaveState();

        setTab('basics');
        window.openSheet(sheet);
        requestAnimationFrame(paintTabInk);
        setTimeout(() => { paintTabInk(); F('fTitle') && F('fTitle').focus(); }, 320);

        // Offer to restore anything left over from an interrupted session —
        // but not when the admin just started something new (an import,
        // dropped screenshots); a stale draft there only confuses.
        const draft = offerDraft ? readDraft() : null;
        if (draft && JSON.stringify(draft.data) !== snapshot) {
            const when = new Date(draft.at).toLocaleString();
            window.toastWithAction(`Unsaved draft from ${when}`, 'Restore', () => {
                writeForm(draft.data);
                renderPreview();
                syncTagStates();
                dirty = true;
                paintSaveState();
            }, 12000);
        }
    }

    async function close(force) {
        if (media.some((m) => m.state === 'busy') && !force) {
            const ok = await window.confirmAction({
                title: 'Screenshots are still uploading',
                message: 'Close anyway? Unfinished uploads will be dropped.',
                confirm: 'Close', danger: true
            });
            if (!ok) return;
        }
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
        uploadQueue = [];
        window.closeSheet(sheet);
    }

    window.closeEditor = close;

    /* =====================================================================
       Public actions
       ===================================================================== */

    const find = (id) => (window.getProjects ? window.getProjects() : []).find((p) => String(p.id) === String(id));

    window.newProject = (prefill) => {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        open('new', prefill || undefined);
    };

    /* Opens a new-project editor pre-filled with an importer draft. The
       draft becomes the baseline, so anything changed before saving is
       locked against future refreshes. */
    window.openEditorWith = (draft = {}, { tab: startTab = 'basics', files = null } = {}) => {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        const { id: _drop, ...data } = draft;
        open('new', { ...data, auto: data.auto !== false && !!(data.sources || []).length }, { offerDraft: false });
        if (data.auto !== false && (data.sources || []).length) {
            baseline = { ...data };
            subEl.textContent = 'Imported for you — check it over, then add it. Anything you change stays as you wrote it.';
        }
        dirty = true;
        renderPreview();
        paintSaveState();
        if (files && files.length) addFiles(files);
        if (startTab !== 'basics') setTab(startTab);
    };

    window.editProject = (id, { tab: startTab } = {}) => {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        const p = find(id);
        if (!p) { window.toast('That project no longer exists', 'error'); return; }
        open('edit', p);
        if (startTab) setTab(startTab);
    };

    window.duplicateProject = (id) => {
        if (!window.isAdmin) return;
        const p = find(id);
        if (!p) return;
        open('dupe', p);
    };

    window.deleteProject = async (id) => {
        if (!window.isAdmin) return false;
        const p = find(id);
        if (!p) return false;
        const ok = await window.confirmAction({
            title: 'Delete this project?',
            message: `“${p.title}” will be removed from the site. You can undo for a few seconds afterwards.`,
            confirm: 'Delete',
            danger: true
        });
        if (!ok) return false;
        return window.deleteProjectFromDb(id);
    };

    /* What changed between two versions of a project, for the history log. */
    function diffProjects(before = {}, after = {}) {
        const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
        ['id', 'createdAt', 'updatedAt', 'locked', 'slug'].forEach((k) => keys.delete(k));
        const out = [];
        keys.forEach((k) => {
            if (norm(before[k]) !== norm(after[k])) out.push({ field: k, before: before[k], after: after[k] });
        });
        return out;
    }
    window.diffProjects = diffProjects;

    const summarise = (changes) => {
        const names = changes.map((c) => FIELD_LABELS[c.field] || c.field);
        if (!names.length) return 'Saved without changes';
        return `Changed ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`;
    };

    /* =====================================================================
       Submit
       ===================================================================== */

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saveBtn.disabled) return;
        const data = readForm();

        if (!data.title) { setTab('basics'); window.toast('Give it a title', 'error'); F('fTitle').focus(); window.Micro && window.Micro.shake && window.Micro.shake(F('fTitle')); return; }
        if (!data.desc)  { setTab('basics'); window.toast('Add a short description', 'error'); F('fDesc').focus(); window.Micro && window.Micro.shake && window.Micro.shake(F('fDesc')); return; }
        if (media.some((m) => m.state === 'busy')) { setTab('media'); window.toast('Wait for the screenshots to finish uploading', 'info'); return; }

        // Normalise bare domains typed without a scheme.
        const withScheme = (v) => (v && !/^https?:\/\//i.test(v) && !v.startsWith('/') ? `https://${v}` : v);
        ['link', 'repo', 'demoVideo', 'previewVideo', 'appIcon', 'cover', 'coverDark'].forEach((k) => { data[k] = withScheme(data[k]); });
        Object.keys(data.stores || {}).forEach((k) => { data.stores[k] = withScheme(data.stores[k]); });
        (data.downloads || []).forEach((d) => { d.url = withScheme(d.url); });
        if (data.order === null || Number.isNaN(data.order)) delete data.order;

        const busy = window.Micro ? window.Micro.busy(saveBtn) : { done() {} };
        let ok;
        try {
            ok = editingId
                ? await window.updateProjectInDb(editingId, data)
                : await window.saveProjectToDb(data);
        } catch (err) {
            ok = false;
            console.error(err);
        }
        busy.done(!!ok);
        if (!ok) return;

        // History: best effort, never blocks the save.
        if (window.writeHistory) {
            if (editingId) {
                const changes = diffProjects(original || {}, data);
                if (changes.length) window.writeHistory({ projectId: editingId, kind: 'edit', summary: summarise(changes), changes });
            } else if (typeof ok === 'string') {
                window.writeHistory({
                    projectId: ok, kind: data.sources && data.sources.length ? 'import' : 'edit',
                    summary: data.sources && data.sources.length ? `Imported from ${data.sources.length} source${data.sources.length === 1 ? '' : 's'}` : 'Created',
                    changes: []
                });
            }
        }

        dropDraft();
        dirty = false;
        if (!editingId && window.celebrate) window.celebrate();
        setTimeout(() => close(true), 380);
    });

    /* Ctrl/Cmd+S saves from anywhere in the editor. */
    document.addEventListener('keydown', (e) => {
        if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
        if (!sheet.classList.contains('is-open')) return;
        e.preventDefault();
        form.requestSubmit();
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
            onEdit();
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
            onEdit();
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
            box.insertAdjacentHTML('beforeend', downloadRow({ platform: platformOrder.find((k) => k !== 'web') || 'windows' }));
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
            paintSaveState();
        });
    }

    ['fAppIcon', 'fCover'].forEach((id) => {
        if (F(id)) F(id).addEventListener('input', () => { paintThumbs(); if (id === 'fCover') paintMedia(); });
    });

    /* Re-import: read the sources again and refresh everything not locked. */
    const reimportBtn = F('edReimport');
    if (reimportBtn) {
        reimportBtn.addEventListener('click', async () => {
            if (!window.Importer || !window.Importer.ingest) { window.toast('The importer is not available here', 'error'); return; }
            const current = readForm();
            const urls = current.sources.length ? current.sources : [current.repo, current.link].filter(Boolean);
            if (!urls.length) { window.toast('Add a source link first (More → Sources)', 'error'); return; }
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
                paintSaveState();
                window.toast(changed ? `Refreshed ${changed} field${changed === 1 ? '' : 's'} — locked ones untouched. Save to keep.` : 'Already up to date', 'success');
            } catch (e) {
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

    /* ⋯ beside Save: everything secondary, in one place. */
    const moreBtn = F('edMore');
    if (moreBtn) {
        moreBtn.addEventListener('click', () => {
            if (!window.AdminMenu) return;
            const cur = readFields();
            const hasSource = cur.sources.length || cur.repo || cur.link;
            window.AdminMenu.open(moreBtn, [
                { icon: 'sparkles', label: 'Improve the copy with AI', hint: 'reads the README', run: () => F('aiImprove').click() },
                { icon: 'wand', label: 'Fill blanks from GitHub', run: () => F('autofill').click() },
                hasSource && { icon: 'refresh', label: 'Re-import from sources', hint: 'keeps your edits', run: () => F('edReimport').click() },
                editingId && '-',
                editingId && { icon: 'copy', label: 'Duplicate', run: () => { const id = editingId; close(true).then(() => window.duplicateProject(id)); } },
                editingId && { icon: 'trash', label: 'Delete project', danger: true, run: async () => { const id = editingId; if (await window.deleteProject(id)) close(true); } }
            ].filter(Boolean), { placement: 'top-start' });
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
        document.documentElement.classList.toggle('is-admin', !!window.isAdmin);
        const lock = document.getElementById('adminLock');
        if (lock) {
            lock.innerHTML = ico(window.isAdmin ? 'unlock' : 'lock', 13);
            lock.setAttribute('aria-label', window.isAdmin ? 'Sign out of admin' : 'Sign in as admin');
            lock.setAttribute('title', window.isAdmin
                ? `Signed in as ${(window.adminEmail && window.adminEmail()) || 'admin'} — click to sign out`
                : 'Admin sign in');
            lock.style.color = window.isAdmin ? 'var(--accent)' : '';
        }
        window.dispatchEvent(new CustomEvent('adminchange', { detail: { admin: !!window.isAdmin } }));
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
    // js/data.js binds the padlock up front and calls window.toggleAdmin by
    // name, so it picks this one up once loaded.
    if (lockBtn && !lockBtn.dataset.bound) lockBtn.addEventListener('click', () => window.toggleAdmin());

    document.querySelectorAll('[data-new-project]').forEach((btn) => {
        btn.addEventListener('click', () => window.newProject());
    });

    applyAdminState();
})();
