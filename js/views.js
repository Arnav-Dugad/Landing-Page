/* ===========================================================================
   views.js  (classic script)
   Everything around the work area that isn't the card grid itself:

     · index view      a typographic, magazine-style list of titles; hover
                       floats a preview beside the cursor
     · timeline view   projects on a spine by year, with "firsts" marked
     · workbar         the toolbar collapses into a pill once scrolled past
     · hover preview   the floating "peek" (video loop, screenshot or plaque)
     · compare         pick 2–3 projects, see them side by side
     · share sheet     the real social card, in the visitor's theme
     · health check    admin: dead repos and live links that are down
     · now editor      admin: the /now page

   render.js decides WHAT is visible; this file decides how some of it is
   laid out and what happens around it. It reads state through window.PState.
   =========================================================================== */

(() => {
    const esc = window.esc;
    const state = () => window.PState;
    const projects = () => (window.getProjects ? window.getProjects() : []);
    const byId = (id) => projects().find((p) => String(p.id) === String(id));
    const reduced = () => !!(window.motionReduced && window.motionReduced());
    const FINE = window.matchMedia('(hover: hover) and (pointer: fine)');

    /* A year for anything — the year field is free text ("2024–25"), so take
       the first four-digit run, falling back to when it was added. */
    const yearOf = (p) => {
        const m = String(p.year || '').match(/(19|20)\d{2}/);
        if (m) return Number(m[0]);
        return p.createdAt ? new Date(p.createdAt).getFullYear() : null;
    };

    /* =====================================================================
       Index view
       ===================================================================== */

    function indexHtml(list) {
        return `<ol class="ix">${list.map((p, i) => `
            <li class="ix-row" data-id="${esc(p.id)}" style="${window.toneVars(p.color)}--delay:${Math.min(i, 12) * 35}ms" data-reveal="up">
                <span class="ix-num">${String(i + 1).padStart(2, '0')}</span>
                <span class="ix-mark card-plaque" aria-hidden="true">${window.icon(p.icon, { size: 20 })}</span>
                <h3 class="ix-head"><button type="button" class="ix-title" data-open="${esc(p.id)}" data-cursor="Open">${esc(p.title)}</button></h3>
                <span class="ix-meta">
                    <span>${esc(window.categoryLabel(p.category))}</span>
                    ${p.year ? `<span>${esc(p.year)}</span>` : ''}
                    <span class="card-live" data-status-slot></span>
                </span>
                <span class="ix-arrow" aria-hidden="true">${window.icon('arrow-right', { raw: true, size: 18 })}</span>
            </li>`).join('')}</ol>`;
    }

    /* =====================================================================
       Timeline view
       ===================================================================== */

    /* "Firsts" are worked out from ALL projects, not the filtered set — the
       first Three.js project is still the first even when you filter to games. */
    function firstsOf(all) {
        const tally = {};
        all.forEach((p) => (p.tags || []).forEach((t) => { const k = String(t).toLowerCase(); tally[k] = (tally[k] || 0) + 1; }));
        const notable = new Set(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => k));

        const chrono = all.slice().sort((a, b) => (yearOf(a) || 0) - (yearOf(b) || 0) || (a.createdAt || 0) - (b.createdAt || 0));
        const seen = new Set();
        const out = {};
        let firstCase = false;
        chrono.forEach((p) => {
            const marks = [];
            (p.tags || []).forEach((t) => {
                const k = String(t).toLowerCase();
                if (notable.has(k) && !seen.has(k)) { seen.add(k); marks.push(`First with ${t}`); }
            });
            if (p.caseStudy && !firstCase) { firstCase = true; marks.push('First case study'); }
            if (marks.length) out[p.id] = marks.slice(0, 2);
        });
        return out;
    }

    function timelineHtml(list, all) {
        const asc = state().sort === 'oldest';
        const sorted = list.slice().sort((a, b) => {
            const d = (yearOf(b) || 0) - (yearOf(a) || 0) || (b.createdAt || 0) - (a.createdAt || 0);
            return asc ? -d : d;
        });
        const firsts = firstsOf(all);

        let html = '<div class="tl"><span class="tl-spine" aria-hidden="true"></span>';
        let lastYear = undefined;
        let side = 0;
        sorted.forEach((p, i) => {
            const y = yearOf(p);
            if (y !== lastYear) {
                const n = sorted.filter((x) => yearOf(x) === y).length;
                html += `<div class="tl-year" data-reveal="fade"><span>${y || 'Undated'}</span><b>${n} project${n === 1 ? '' : 's'}</b></div>`;
                lastYear = y;
            }
            const tags = (p.tags || []).filter(Boolean).slice(0, 3);
            const marks = firsts[p.id] || [];
            html += `
                <article class="tl-item ${side++ % 2 ? 'is-right' : 'is-left'}" data-id="${esc(p.id)}"
                         style="${window.toneVars(p.color)}--delay:${Math.min(i, 8) * 40}ms" data-reveal="up">
                    <span class="tl-dot" aria-hidden="true"></span>
                    <div class="tl-card">
                        <span class="tl-plaque card-plaque" aria-hidden="true">${window.icon(p.icon, { size: 20 })}</span>
                        <div class="tl-text">
                            ${marks.length ? `<div class="tl-firsts">${marks.map((m) => `<span>${window.icon('sparkles', { raw: true, size: 11 })}${esc(m)}</span>`).join('')}</div>` : ''}
                            <h3><button type="button" class="tl-title" data-open="${esc(p.id)}" data-cursor="Open">${esc(p.title)}</button></h3>
                            <p class="u-clamp-2">${esc(p.desc)}</p>
                            <div class="tl-foot">
                                ${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
                                <span class="card-live" data-status-slot></span>
                            </div>
                        </div>
                    </div>
                </article>`;
        });
        return `${html}</div>`;
    }

    /* =====================================================================
       Hover preview ("peek") — one floating element, reused everywhere
       ===================================================================== */

    const peek = document.createElement('div');
    peek.className = 'peek';
    peek.setAttribute('aria-hidden', 'true');
    document.body.appendChild(peek);

    let peekTarget = null;
    let peekTimer = null;
    let px = 0, py = 0, tx = 0, ty = 0;
    let peekLoop = null;

    const isVideo = (url) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);

    function peekContent(p, el) {
        const preview = window.safeUrl(p.previewVideo);
        const shot = window.safeUrl((p.gallery || [])[0]);
        if (preview && isVideo(preview)) {
            return `<video src="${esc(preview)}" muted loop playsinline autoplay preload="auto"></video>`;
        }
        if (preview) return `<img src="${esc(preview)}" alt="">`;
        if (shot && el.classList.contains('ix-row')) return `<img src="${esc(shot)}" alt="">`;
        if (el.classList.contains('ix-row')) {
            return `<div class="peek-plaque" style="${window.toneVars(p.color)}">
                <span class="card-plaque">${window.icon(p.icon, { size: 34 })}</span>
                <b>${esc(p.title)}</b><small>${esc(window.categoryLabel(p.category))}</small></div>`;
        }
        return '';
    }

    function showPeek(el) {
        const p = byId(el.dataset.id);
        if (!p) return;
        const html = peekContent(p, el);
        if (!html) return;
        peek.innerHTML = html;
        peek.style.cssText = window.toneVars(p.color);
        peek.classList.add('is-on');
        if (!peekLoop && window.onFrame) {
            peekLoop = window.onFrame(() => {
                px += (tx - px) * 0.18;
                py += (ty - py) * 0.18;
                peek.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
            });
        }
    }

    function hidePeek() {
        clearTimeout(peekTimer);
        peekTarget = null;
        peek.classList.remove('is-on');
        const v = peek.querySelector('video');
        if (v) v.pause();
        setTimeout(() => {
            if (peekTarget) return;
            peek.innerHTML = '';
            if (peekLoop) { peekLoop(); peekLoop = null; }
        }, 260);
    }

    function wirePeek(root) {
        if (!FINE.matches || root.dataset.peek === '1') return;
        root.dataset.peek = '1';

        root.addEventListener('pointermove', (e) => {
            // Sit to the right of the cursor, flipping left near the edge.
            const w = 300, h = 190;
            const right = e.clientX + 28 + w < window.innerWidth;
            tx = right ? e.clientX + 28 : e.clientX - 28 - w;
            ty = Math.min(window.innerHeight - h - 12, Math.max(12, e.clientY - h / 2));
            if (!peekTarget) { px = tx; py = ty; }

            const el = e.target.closest('.card[data-preview], .ix-row');
            if (el === peekTarget) return;
            hidePeek();
            if (!el || root.classList.contains('is-reordering')) return;
            peekTarget = el;
            peekTimer = setTimeout(() => { if (peekTarget === el) showPeek(el); }, el.classList.contains('ix-row') ? 60 : 320);
        });
        root.addEventListener('pointerleave', hidePeek);
        window.addEventListener('scroll', () => { if (peekTarget) hidePeek(); }, { passive: true });
    }

    /* =====================================================================
       Mount — per-view behaviour after each paint
       ===================================================================== */

    function mount(grid) {
        wirePeek(grid);
        hidePeek();
    }

    /* =====================================================================
       Workbar — the toolbar becomes a pill once you scroll past it
       ===================================================================== */

    const sentinel = document.getElementById('workbarSentinel');
    const pill = document.getElementById('workpill');
    const work = document.getElementById('work');
    let pastBar = false, inWork = false;

    function paintPill() {
        if (!pill) return;
        pill.classList.toggle('is-on', pastBar && inWork);
    }

    if (sentinel && pill && work) {
        /* Plain geometry on a rAF-throttled scroll: two reads per frame at
           most, and no observer lifetimes to reason about. */
        let ticking = false;
        const measure = () => {
            ticking = false;
            const s = sentinel.getBoundingClientRect();
            const w = work.getBoundingClientRect();
            pastBar = s.top < 90;
            inWork = w.top < window.innerHeight * 0.6 && w.bottom > window.innerHeight * 0.8;
            paintPill();
        };
        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(measure);
        }, { passive: true });
        window.addEventListener('resize', measure, { passive: true });
        measure();

        pill.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-workpill]');
            if (!btn) return;
            const act = btn.dataset.workpill;
            const bar = document.getElementById('workbar');
            if (act === 'clear') {
                const search = document.getElementById('search');
                if (search) search.value = '';
                state().search = '';
                state().filter = 'all';
                window.renderProjects();
                return;
            }
            bar?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (act === 'search') setTimeout(() => document.getElementById('search')?.focus({ preventScroll: true }), 420);
        });
    }

    function syncWorkbar(shown, total) {
        if (!pill) return;
        const s = state();
        const parts = [];
        parts.push(s.filter === 'all' ? 'All projects' : window.categoryLabel(s.filter));
        if (s.search.trim()) parts.push(`“${s.search.trim()}”`);
        const label = document.getElementById('workpillLabel');
        const count = document.getElementById('workpillCount');
        if (label) label.textContent = parts.join(' · ');
        if (count) count.textContent = shown === total ? String(total) : `${shown}/${total}`;
        pill.querySelector('[data-workpill="clear"]')?.classList.toggle('u-hidden', s.filter === 'all' && !s.search.trim());
    }

    /* Copy a link that reproduces this exact view: filter, search, sort,
       layout and comparison all live in the query string. */
    const copyView = document.getElementById('copyView');
    if (copyView) {
        copyView.addEventListener('click', () => {
            window.syncUrl();
            const url = location.origin + location.pathname + location.search;
            navigator.clipboard?.writeText(url)
                .then(() => {
                    window.toast('Link to this view copied', 'success');
                    copyView.classList.add('is-popping');
                    setTimeout(() => copyView.classList.remove('is-popping'), 420);
                })
                .catch(() => window.toast(url, 'info'));
        });
    }

    /* =====================================================================
       Compare
       ===================================================================== */

    const tray = document.getElementById('ctray');
    const slots = document.getElementById('ctraySlots');
    const goBtn = document.getElementById('ctrayGo');
    const compareSheet = document.getElementById('compareSheet');
    const compareBody = document.getElementById('compareBody');

    window.toggleCompare = (id) => {
        const list = state().compare;
        const key = String(id);
        const at = list.indexOf(key);
        if (at >= 0) list.splice(at, 1);
        else {
            if (list.length >= 3) { window.toast('Compare up to three — remove one first', 'info'); return; }
            list.push(key);
        }
        // Update the cards in place rather than repainting the whole grid.
        document.querySelectorAll(`#grid [data-compare="${CSS.escape(key)}"]`).forEach((btn) => {
            const on = list.includes(key);
            btn.setAttribute('aria-pressed', String(on));
            btn.innerHTML = `${window.icon(on ? 'check' : 'scale', { raw: true, size: 14 })}<span>${on ? 'Picked' : 'Compare'}</span>`;
            btn.closest('.card')?.classList.toggle('is-picked', on);
        });
        window.syncUrl();
        syncCompare();
    };

    function syncCompare() {
        if (!tray) return;
        const picked = state().compare.map(byId).filter(Boolean);
        // Drop ids that no longer exist (deleted projects in an old link).
        if (picked.length !== state().compare.length && projects().length) {
            state().compare = picked.map((p) => String(p.id));
        }
        const on = picked.length > 0;
        tray.classList.toggle('is-on', on);
        tray.setAttribute('aria-hidden', String(!on));
        document.body.classList.toggle('has-ctray', on);

        slots.innerHTML = [0, 1, 2].map((i) => {
            const p = picked[i];
            if (!p) return `<span class="ctray-slot is-empty">${i < 2 ? 'Pick a project' : 'Optional third'}</span>`;
            return `<span class="ctray-slot" style="${window.toneVars(p.color)}">
                <span class="card-plaque">${window.icon(p.icon, { size: 14 })}</span>
                <b>${esc(p.title)}</b>
                <button type="button" data-uncompare="${esc(p.id)}" aria-label="Remove ${esc(p.title)}">${window.icon('x', { raw: true, size: 12 })}</button>
            </span>`;
        }).join('');
        if (goBtn) goBtn.disabled = picked.length < 2;
    }

    if (slots) {
        slots.addEventListener('click', (e) => {
            const x = e.target.closest('[data-uncompare]');
            if (x) window.toggleCompare(x.dataset.uncompare);
        });
    }
    document.getElementById('ctrayClear')?.addEventListener('click', () => {
        state().compare.slice().forEach((id) => window.toggleCompare(id));
    });
    goBtn?.addEventListener('click', () => window.openCompare());

    window.openCompare = () => {
        const picked = state().compare.map(byId).filter(Boolean);
        if (picked.length < 2) { window.toast('Pick at least two projects to compare', 'info'); return; }
        if (!compareSheet || !compareBody) return;

        // Tech shared by every picked project gets highlighted.
        const lower = picked.map((p) => new Set((p.tags || []).map((t) => String(t).toLowerCase())));
        const shared = new Set([...lower[0]].filter((t) => lower.every((s) => s.has(t))));

        const cell = (fn) => picked.map((p) => `<td>${fn(p)}</td>`).join('');
        const rows = [
            ['Category', (p) => esc(window.categoryLabel(p.category))],
            ['Year', (p) => esc(p.year || '—')],
            ['Status', (p) => {
                const checked = window.projectStatus && window.projectStatus(p.id);
                const chip = checked && window.Widgets ? window.Widgets.statusChip(checked) : '';
                // A real check replaces the hand-set "Live" badge.
                const badge = checked && p.status === 'live' ? '' : window.statusBadge(p.status);
                return `${badge}${chip}` || '—';
            }],
            ['Role', (p) => esc(p.role || '—')],
            ['Stars', (p) => `<span data-cmp="stars" data-id="${esc(p.id)}">…</span>`],
            ['Forks', (p) => `<span data-cmp="forks" data-id="${esc(p.id)}">…</span>`],
            ['Last push', (p) => `<span data-cmp="pushed" data-id="${esc(p.id)}">…</span>`],
            ['Languages', (p) => `<div data-cmp="langs" data-id="${esc(p.id)}" class="cmp-langs"></div>`],
            ['Tech', (p) => `<div class="cmp-tags">${(p.tags || []).map((t) =>
                `<span class="tag ${shared.has(String(t).toLowerCase()) ? 'is-shared' : ''}">${esc(t)}</span>`).join('') || '—'}</div>`],
            ['Highlights', (p) => (p.highlights || []).length
                ? `<ul class="cmp-hl">${p.highlights.slice(0, 4).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '—'],
            ['Links', (p) => {
                const link = window.safeUrl(p.link);
                const repo = window.resolveRepoUrl(p);
                return `<div class="cmp-links">
                    ${link ? `<a class="card-act card-act--go" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${window.icon('external', { raw: true, size: 13 })}<span>Visit</span></a>` : ''}
                    ${repo ? `<a class="card-act" href="${esc(repo)}" target="_blank" rel="noopener noreferrer">${window.icon('github', { raw: true, size: 13 })}<span>Code</span></a>` : ''}
                    ${p.caseStudy ? `<a class="card-act" href="case.html?p=${encodeURIComponent(window.projectSlug(p))}" data-case="${esc(window.projectSlug(p))}">${window.icon('doc', { raw: true, size: 13 })}<span>Case</span></a>` : ''}
                </div>`;
            }]
        ];

        compareBody.innerHTML = `
            <div class="cmp-scroll">
                <table class="cmp" style="--cols:${picked.length}">
                    <thead><tr><th scope="col"><span class="u-sr">Field</span></th>${picked.map((p) => `
                        <th scope="col" style="${window.toneVars(p.color)}">
                            <span class="card-plaque">${window.icon(p.icon, { size: 20 })}</span>
                            <button type="button" class="cmp-title" data-cmp-open="${esc(p.id)}">${esc(p.title)}</button>
                            <p>${esc(p.desc)}</p>
                        </th>`).join('')}</tr></thead>
                    <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${cell(fn)}</tr>`).join('')}</tbody>
                </table>
            </div>
            ${shared.size ? `<p class="cmp-note"><span class="tag is-shared">shared</span> ${shared.size} piece${shared.size === 1 ? '' : 's'} of tech in common.</p>` : '<p class="cmp-note">No tech in common — these were built very differently.</p>'}`;

        window.openSheet(compareSheet);

        picked.forEach(async (p) => {
            const repo = window.resolveRepoUrl(p);
            const put = (k, v) => { const el = compareBody.querySelector(`[data-cmp="${k}"][data-id="${CSS.escape(String(p.id))}"]`); if (el) el.innerHTML = v; };
            if (!repo) { put('stars', '—'); put('forks', '—'); put('pushed', '—'); return; }
            const [s, langs] = await Promise.all([window.fetchGitHubStats(repo), window.fetchGitHubLanguages(repo)]);
            put('stars', s ? `${window.icon('star', { raw: true, size: 12 })} ${s.stars.toLocaleString()}` : '—');
            put('forks', s ? s.forks.toLocaleString() : '—');
            put('pushed', s && s.updatedAt ? esc(window.relativeTime(s.updatedAt)) : '—');
            const top = (langs || []).slice(0, 5);
            put('langs', top.length ? `<div class="langbar">${top.map((l) =>
                `<span style="width:${l.pct}%;background:${window.langColor(l.name)}"></span>`).join('')}</div>
                <div class="langlegend">${top.slice(0, 3).map((l) => `<span><s style="background:${window.langColor(l.name)}"></s>${esc(l.name)}</span>`).join('')}</div>` : '—');
        });
    };

    if (compareSheet) {
        compareSheet.addEventListener('click', (e) => {
            if (e.target === compareSheet || e.target.closest('[data-close]')) { window.closeSheet(compareSheet); return; }
            const open = e.target.closest('[data-cmp-open]');
            if (open) { window.closeSheet(compareSheet); window.openProject(open.dataset.cmpOpen); }
        });
    }

    /* =====================================================================
       Share sheet — shows the actual card a link unfurls into
       ===================================================================== */

    const shareSheet = document.getElementById('shareSheet');
    const shareBody = document.getElementById('shareBody');
    let shareTheme = 'light';

    function paintShare(p) {
        const slug = window.projectSlug(p);
        const url = window.projectUrl(p);
        const q = `p=${encodeURIComponent(slug)}&theme=${shareTheme}`;
        const text = `${p.title} — ${p.desc || ''}`.slice(0, 200);

        const preview = window.EDGE
            ? `<img src="/api/og.svg?${q}" alt="Social card for ${esc(p.title)}" width="1200" height="630"
                    onerror="this.onerror=null;this.src='/api/og?${q}'">`
            : `<div class="share-fallback" style="${window.toneVars(p.color)}">
                    <span class="card-plaque">${window.icon(p.icon, { size: 28 })}</span>
                    <b>${esc(p.title)}</b><p>${esc(p.desc)}</p><small>arnavdugad.in</small></div>`;

        shareBody.innerHTML = `
            <div class="share-toggle segment" role="group" aria-label="Card theme">
                <span class="thumb" aria-hidden="true" style="transform:translateX(${shareTheme === 'dark' ? 76 : 0}px)"></span>
                <button type="button" data-share-theme="light" class="${shareTheme === 'light' ? 'is-active' : ''}">Light</button>
                <button type="button" data-share-theme="dark" class="${shareTheme === 'dark' ? 'is-active' : ''}">Dark</button>
            </div>
            <figure class="share-card">${preview}</figure>
            <div class="share-url">
                <input class="input" readonly value="${esc(url)}" aria-label="Link">
                <button type="button" class="btn btn--primary" data-share-do="copy">${window.icon('copy', { raw: true, size: 16 })} Copy</button>
            </div>
            <div class="share-acts">
                ${navigator.share ? `<button type="button" class="btn btn--ghost" data-share-do="native">${window.icon('share', { raw: true, size: 16 })} Share…</button>` : ''}
                <a class="btn btn--ghost" target="_blank" rel="noopener noreferrer"
                   href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">${window.icon('x', { raw: true, size: 15 })} Post</a>
                <a class="btn btn--ghost" target="_blank" rel="noopener noreferrer"
                   href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}">${window.icon('linkedin', { raw: true, size: 15 })} LinkedIn</a>
                <a class="btn btn--quiet" href="mailto:?subject=${encodeURIComponent(p.title)}&body=${encodeURIComponent(`${text}\n\n${url}`)}">${window.icon('mail', { raw: true, size: 15 })} Email</a>
                ${window.EDGE ? `<a class="btn btn--quiet" href="/api/og?${q}" download="${esc(slug)}-${shareTheme}.png">${window.icon('download', { raw: true, size: 15 })} Card PNG</a>` : ''}
            </div>`;
    }

    window.openShare = (id) => {
        const p = byId(id);
        if (!p || !shareSheet) return;
        shareTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        document.getElementById('shareTitle').textContent = `Share ${p.title}`;
        shareSheet.dataset.id = String(p.id);
        paintShare(p);
        window.openSheet(shareSheet);
    };
    // Kept for anything still calling the old one-shot share.
    window.shareProject = window.openShare;

    if (shareSheet) {
        shareSheet.addEventListener('click', async (e) => {
            if (e.target === shareSheet || e.target.closest('[data-close]')) { window.closeSheet(shareSheet); return; }
            const p = byId(shareSheet.dataset.id);
            if (!p) return;
            const themeBtn = e.target.closest('[data-share-theme]');
            if (themeBtn) { shareTheme = themeBtn.dataset.shareTheme; paintShare(p); return; }
            const act = e.target.closest('[data-share-do]');
            if (!act) return;
            const url = window.projectUrl(p);
            if (act.dataset.shareDo === 'copy') {
                navigator.clipboard?.writeText(url)
                    .then(() => window.toast('Link copied to clipboard', 'success'))
                    .catch(() => window.toast('Could not copy the link', 'error'));
            } else if (act.dataset.shareDo === 'native') {
                navigator.share({ title: `${p.title} — Arnav Dugad`, text: p.desc, url }).catch(() => {});
            }
        });
    }

    /* =====================================================================
       Health check (admin)
       ===================================================================== */

    const healthSheet = document.getElementById('healthSheet');
    const healthBody = document.getElementById('healthBody');

    window.openHealth = async () => {
        if (!window.isAdmin || !healthSheet) return;
        healthBody.innerHTML = '<div class="skeleton" style="min-height:220px"></div>';
        window.openSheet(healthSheet);

        const status = window.Widgets && window.Widgets.loadStatus ? await window.Widgets.loadStatus() : {};
        const list = projects();
        const rows = await Promise.all(list.map(async (p) => {
            const repo = window.resolveRepoUrl(p);
            let repoState = 'none';
            if (repo) {
                const s = await window.fetchGitHubStats(repo);
                const missing = window.githubRepoMissing(repo);
                repoState = s ? 'ok' : (missing === true ? 'missing' : 'unknown');
            }
            const live = status[p.id] || null;
            const liveState = !window.safeUrl(p.link) ? 'none' : (live ? (live.up ? 'up' : 'down') : 'unchecked');
            const score = (repoState === 'missing' ? 2 : 0) + (liveState === 'down' ? 2 : 0)
                + (repoState === 'unknown' ? 0.5 : 0) + (liveState === 'none' ? 0.3 : 0);
            return { p, repoState, liveState, live, score };
        }));
        rows.sort((a, b) => b.score - a.score || String(a.p.title).localeCompare(String(b.p.title)));

        const problems = rows.filter((r) => r.repoState === 'missing' || r.liveState === 'down').length;
        const pill = (cls, text) => `<span class="hc-pill hc-pill--${cls}">${text}</span>`;
        const repoPill = { ok: pill('ok', 'Repo OK'), missing: pill('bad', 'Repo missing'), unknown: pill('meh', 'Repo unchecked'), none: pill('meh', 'No repo') };
        const livePill = (r) => ({
            up: pill('ok', `Up${r.live && r.live.ms ? ` · ${r.live.ms} ms` : ''}`),
            down: pill('bad', `Down${r.live && r.live.code ? ` · ${r.live.code}` : (r.live && r.live.error ? ` · ${esc(r.live.error)}` : '')}`),
            unchecked: pill('meh', 'Not checked yet'),
            none: pill('meh', 'No live link')
        })[r.liveState];

        healthBody.innerHTML = `
            <p class="hc-sum">${problems
                ? `<b>${problems}</b> project${problems === 1 ? ' needs' : 's need'} attention.`
                : '<b>All clear.</b> Every repo exists and every live link answered.'}
                ${window.githubRateLimited() ? ' GitHub\'s hourly limit was hit, so some repos are unchecked — try again later.' : ''}</p>
            <ul class="hc-list">${rows.map((r) => `
                <li class="${r.score >= 2 ? 'is-bad' : ''}" style="${window.toneVars(r.p.color)}">
                    <span class="card-plaque">${window.icon(r.p.icon, { size: 15 })}</span>
                    <b>${esc(r.p.title)}</b>
                    <span class="hc-pills">${repoPill[r.repoState]}${livePill(r)}</span>
                    <button type="button" class="btn btn--quiet" data-hc-edit="${esc(r.p.id)}">${window.icon('pencil', { raw: true, size: 14 })} Fix</button>
                </li>`).join('')}</ul>`;
    };

    if (healthSheet) {
        healthSheet.addEventListener('click', (e) => {
            if (e.target === healthSheet || e.target.closest('[data-close]')) { window.closeSheet(healthSheet); return; }
            const edit = e.target.closest('[data-hc-edit]');
            if (edit) { window.closeSheet(healthSheet); window.editProject(edit.dataset.hcEdit); }
        });
    }
    document.getElementById('healthOpen')?.addEventListener('click', () => window.openHealth());

    /* =====================================================================
       Now page editor (admin) — writes straight to Firestore; the rules
       only accept it from the admin account.
       ===================================================================== */

    const nowSheet = document.getElementById('nowSheet');
    const nowForm = document.getElementById('nowForm');
    const NOW_FIELDS = { building: 'nBuilding', reading: 'nReading', learning: 'nLearning', note: 'nNote' };

    window.openNowEditor = async () => {
        if (!window.isAdmin || !nowSheet) return;
        Object.values(NOW_FIELDS).forEach((id) => { const el = document.getElementById(id); if (el) { el.value = ''; el.placeholder = 'Loading…'; } });
        window.openSheet(nowSheet);
        const data = window.loadNowFromDb ? await window.loadNowFromDb() : null;
        Object.entries(NOW_FIELDS).forEach(([k, id]) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.placeholder = '';
            el.value = (data && data[k]) || '';
        });
    };

    if (nowSheet) {
        nowSheet.addEventListener('click', (e) => {
            if (e.target === nowSheet || e.target.closest('[data-close]')) window.closeSheet(nowSheet);
        });
    }
    if (nowForm) {
        nowForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('nowSave');
            const data = {};
            Object.entries(NOW_FIELDS).forEach(([k, id]) => { data[k] = String(document.getElementById(id)?.value || '').trim(); });
            btn.disabled = true;
            const ok = window.saveNowToDb ? await window.saveNowToDb(data) : false;
            btn.disabled = false;
            if (ok) window.closeSheet(nowSheet);
        });
    }
    document.getElementById('nowOpen')?.addEventListener('click', () => window.openNowEditor());

    window.Views = { indexHtml, timelineHtml, mount, syncWorkbar, syncCompare };
})();
