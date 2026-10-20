/* ===========================================================================
   case.js  (classic script)
   Renders the long-form case-study page from a single project record.

   Two passes:
     1. Instant — if the index left a handoff in sessionStorage (it does when
        you click a case-study link), the masthead and body render on the
        very first frame. That is what lets the cross-document view
        transition morph the card's title and plaque into this page.
     2. Fresh — the full list is read over Firestore REST (js/rest.js). The
        page only re-renders if the record actually changed; either way it
        then fills in what needs the whole list: breadcrumbs' neighbours,
        prev/next and related projects.

   URL: case.html?p=<project-slug>
   =========================================================================== */

(() => {
    const root = document.getElementById('caseRoot');
    if (!root) return;

    const esc = (v) => window.esc(v);
    const safeUrl = (v) => window.safeUrl(v);
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const slug = new URLSearchParams(location.search).get('p') || '';

    /* ---- Helpers -------------------------------------------------------- */

    /* Key order differs between the SDK snapshot (handoff) and REST, so a
       naive JSON.stringify would call identical records "changed". */
    const signature = (p) => JSON.stringify(Object.keys(p || {}).sort()
        .filter((k) => k !== 'slug')
        .map((k) => [k, p[k]]));

    const caseHref = (p) => `case.html?p=${encodeURIComponent(p.slug || window.projectSlug(p))}`;

    function stashHandoff(p) {
        try { sessionStorage.setItem(window.HANDOFF_KEY(p.slug || window.projectSlug(p)), JSON.stringify(p)); }
        catch { /* storage disabled */ }
    }

    function readHandoff() {
        try {
            const raw = sessionStorage.getItem(window.HANDOFF_KEY(slug));
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    const caseOrder = (a, b) => ((a.order ?? 9999) - (b.order ?? 9999))
        || ((b.createdAt || 0) - (a.createdAt || 0));

    /* ---- Rich text: paragraphs + "> " pull quotes ----------------------- */

    const QUOTE_LINE = /^\s*>\s?(.*)$/;

    function pullquote(text, auto = false) {
        return `<blockquote class="pullquote${auto ? ' pullquote--auto' : ''}" data-reveal="up">
                    <p>${esc(text)}</p>
                </blockquote>`;
    }

    function richText(text) {
        const out = [];
        let para = [];
        let quote = [];
        const flushPara = () => {
            para.join('\n').split(/\n\s*\n/).forEach((chunk) => {
                if (chunk.trim()) out.push(`<p>${esc(chunk.trim())}</p>`);
            });
            para = [];
        };
        const flushQuote = () => {
            const t = quote.join(' ').trim();
            if (t) out.push(pullquote(t));
            quote = [];
        };
        String(text || '').split('\n').forEach((line) => {
            const m = line.match(QUOTE_LINE);
            if (m) { flushPara(); quote.push(m[1]); }
            else { flushQuote(); para.push(line); }
        });
        flushPara();
        flushQuote();
        return out.join('');
    }

    const hasAuthoredQuote = (p) => ['problem', 'approach', 'outcome', 'longDesc']
        .some((k) => String(p[k] || '').split('\n').some((l) => QUOTE_LINE.test(l)));

    /* The first sentence of the outcome, if it's short enough to stand alone. */
    function autoQuote(p) {
        const text = String(p.outcome || '').split('\n').filter((l) => !QUOTE_LINE.test(l)).join(' ').trim();
        const m = text.match(/^(.+?[.!?])(\s|$)/);
        const s = (m ? m[1] : text).trim();
        return s && s.length <= 160 && s.length >= 24 ? s : '';
    }

    function readingMinutes(p) {
        const words = [p.desc, p.problem, p.approach, p.outcome, p.longDesc, ...(p.challenges || [])]
            .filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length;
        return Math.max(1, Math.round(words / 220));
    }

    /* ---- Metrics: "40+" counts up from 0 to 40, suffix kept ------------- */

    function metricValue(value) {
        const m = String(value).match(/^(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/);
        if (!m || reduced()) return esc(value);
        const num = m[1];
        const to = parseFloat(num.replace(/,/g, ''));
        const dec = (num.split('.')[1] || '').length;
        return `<span class="case-num" data-to="${to}" data-dec="${dec}" data-group="${num.includes(',') ? 1 : 0}">0</span>${esc(m[2])}`;
    }

    function runTickers(scope) {
        const nums = scope.querySelectorAll('.case-num:not([data-ran])');
        if (!nums.length) return;
        const fmt = (el, v) => {
            const dec = Number(el.dataset.dec);
            el.textContent = v.toLocaleString('en-US', {
                minimumFractionDigits: dec, maximumFractionDigits: dec,
                useGrouping: el.dataset.group === '1'
            });
        };
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                io.unobserve(el);
                el.dataset.ran = '1';
                const to = Number(el.dataset.to);
                const start = performance.now();
                const dur = 1400;
                const tick = (now) => {
                    const t = Math.min(1, (now - start) / dur);
                    const eased = 1 - Math.pow(2, -10 * t);       // expo out
                    fmt(el, t >= 1 ? to : to * eased);
                    if (t < 1) requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            });
        }, { threshold: 0.4 });
        nums.forEach((el) => io.observe(el));
    }

    /* ---- Missing / error ------------------------------------------------ */

    function missing(title, message) {
        window.applyProjectTheme(null);
        root.innerHTML = `
            <div class="case-missing u-shell">
                ${window.icon('doc', { raw: true, size: 34 })}
                <h1>${esc(title)}</h1>
                <p>${esc(message)}</p>
                <a href="./#work" class="btn btn--primary" style="margin-top:10px">
                    ${window.icon('arrow-left', { raw: true, size: 17 })} Back to all work
                </a>
            </div>`;
    }

    /* ---- Render --------------------------------------------------------- */

    let shots = [];          // [{ src, alt }] for the lightbox

    function render(project, { instant = false } = {}) {
        const link = safeUrl(project.link);
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(project) : null;
        const tone = window.toneVars(project.color);
        const alts = Array.isArray(project.galleryAlt) ? project.galleryAlt : [];

        // Keep each screenshot paired with its alt text through the filtering.
        shots = (project.gallery || [])
            .map((src, i) => ({ src: safeUrl(src), alt: String(alts[i] || '').trim() }))
            .filter((s) => s.src)
            .map((s, i) => ({ ...s, alt: s.alt || `${project.title} — screenshot ${i + 1}` }));

        const challenges = (project.challenges || []).filter((c) => String(c).trim());
        const metrics = (project.metrics || []).filter((m) => String(m).trim());
        const tags = (project.tags || []).filter(Boolean);
        const category = window.categoryLabel(project.category);
        const mins = readingMinutes(project);

        window.applyProjectTheme(project.color);
        document.title = `${project.title} — case study — Arnav Dugad`;
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute('content', String(project.desc || '').slice(0, 180));

        // Numbered sections, skipping any the author left empty.
        let n = 0;
        const toc = [];
        const block = (heading, inner) => {
            if (!inner) return '';
            const num = String(++n).padStart(2, '0');
            const id = `s-${num}`;
            toc.push({ id, num, heading });
            return `
                <section class="case-block" id="${id}" data-reveal="up">
                    <h2><b>${num}</b> ${esc(heading)}</h2>
                    ${inner}
                </section>`;
        };
        const prose = (text) => (String(text || '').trim() ? richText(text) : '');

        const quote = hasAuthoredQuote(project) ? '' : autoQuote(project);

        const media = shots.length
            ? `<button type="button" class="case-zoom" data-zoom="0" aria-label="Enlarge: ${esc(shots[0].alt)}">
                   <img src="${esc(shots[0].src)}" alt="${esc(shots[0].alt)}" loading="eager">
               </button>`
            : (link ? `<iframe src="${esc(link)}" title="${esc(project.title)} live preview" loading="eager"
                        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>` : '');

        const sections = [
            block('The problem', prose(project.problem)),
            block('The approach', prose(project.approach)),
            quote ? pullquote(quote, true) : '',
            block('What broke', challenges.length ? `
                <ol class="case-breaks">
                    ${challenges.map((c) => `<li><span>${esc(c)}</span></li>`).join('')}
                </ol>` : ''),
            block('The outcome', prose(project.outcome)),
            project.longDesc && !project.problem ? block('Notes', prose(project.longDesc)) : '',
            block('Screens', shots.length > 1 ? `
                <div class="case-gallery">
                    ${shots.slice(1).map((s, i) => `
                        <figure class="case-shot">
                            <button type="button" class="case-zoom" data-zoom="${i + 1}" aria-label="Enlarge: ${esc(s.alt)}">
                                <img src="${esc(s.src)}" alt="${esc(s.alt)}" loading="lazy">
                            </button>
                        </figure>`).join('')}
                </div>` : '')
        ].join('');

        root.innerHTML = `
        <header class="case-head u-shell" style="${tone}">
            <nav class="crumbs" aria-label="Breadcrumb">
                <a href="./#work">Work</a>
                ${window.icon('chev-right', { raw: true, size: 12 })}
                <a href="./?cat=${encodeURIComponent(project.category || 'other')}#work">${esc(category)}</a>
                ${window.icon('chev-right', { raw: true, size: 12 })}
                <span aria-current="page">${esc(project.title)}</span>
            </nav>

            <div class="case-mast">
                <div class="card-plaque case-plaque">${window.icon(project.icon, { size: 24 })}</div>
                <div class="case-eyebrow">
                    <span>Case study</span>
                    <span>·</span><span>${esc(category)}</span>
                    ${project.year ? `<span>·</span><span>${esc(project.year)}</span>` : ''}
                    ${project.role ? `<span>·</span><span>${esc(project.role)}</span>` : ''}
                    <span>·</span><span>${mins} min read</span>
                </div>
            </div>

            <h1 class="case-title" ${instant ? '' : 'data-split'}>${esc(project.title)}</h1>
            <p class="case-lead">${esc(project.desc)}</p>

            <div class="case-actions">
                ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="btn btn--primary magnetic" data-cursor="Visit">
                    ${window.icon('external', { raw: true, size: 17 })} Visit live</a>` : ''}
                ${repo ? `<a href="${esc(repo)}" target="_blank" rel="noopener noreferrer" class="btn btn--ghost magnetic" data-cursor="Code">
                    ${window.icon('github', { raw: true, size: 17 })} View code</a>` : ''}
            </div>

            ${metrics.length ? `
                <dl class="case-metrics" data-reveal="up">
                    ${metrics.map((m) => {
                        const at = String(m).indexOf(':');
                        const label = at > -1 ? m.slice(0, at).trim() : '';
                        const value = at > -1 ? m.slice(at + 1).trim() : m;
                        return `<div class="case-metric"><dt>${metricValue(value)}</dt><dd>${esc(label || 'Result')}</dd></div>`;
                    }).join('')}
                </dl>` : ''}
        </header>

        ${media ? `<div class="u-shell"><div class="case-media" data-reveal="scale">${media}</div></div>` : ''}

        <div class="u-shell">
            <div class="case-body">
                <article class="case-prose" id="caseArticle">
                    ${sections}
                    <div class="case-extra" id="caseChangelog"></div>
                    ${window.Widgets ? window.Widgets.reactionsHtml(project.slug || slug) : ''}
                </article>

                <aside class="case-side">
                    ${toc.length > 1 ? `
                        <section class="case-toc">
                            <h5>
                                <span>Contents</span>
                                <span class="case-ring" aria-hidden="true">
                                    <svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="8"/><circle class="case-ring-bar" cx="10" cy="10" r="8" pathLength="100"/></svg>
                                    <b id="caseProgressPct">0%</b>
                                </span>
                            </h5>
                            <ol>
                                ${toc.map((t) => `<li><a href="#${t.id}" data-toc="${t.id}"><b>${t.num}</b>${esc(t.heading)}</a></li>`).join('')}
                            </ol>
                        </section>` : ''}

                    ${tags.length ? `
                        <section>
                            <h5>Built with</h5>
                            <ul class="case-tech">
                                ${tags.map((t) => `<li class="tmark-host">${window.Widgets ? window.Widgets.techMark(t, { size: 26 }) : ''}<span>${esc(t)}</span></li>`).join('')}
                            </ul>
                        </section>` : ''}

                    <section>
                        <h5>At a glance</h5>
                        <dl>
                            ${project.year ? `<div><dt>Year</dt><dd>${esc(project.year)}</dd></div>` : ''}
                            ${project.role ? `<div><dt>Role</dt><dd>${esc(project.role)}</dd></div>` : ''}
                            ${project.status ? `<div><dt>Status</dt><dd>${esc(project.status === 'wip' ? 'In progress' : project.status.charAt(0).toUpperCase() + project.status.slice(1))}</dd></div>` : ''}
                            <div><dt>Type</dt><dd>${esc(category)}</dd></div>
                            <div id="caseStatus" class="u-hidden"><dt>Live check</dt><dd></dd></div>
                            <div id="ghStars" class="u-hidden"><dt>Stars</dt><dd>—</dd></div>
                        </dl>
                    </section>
                </aside>
            </div>
        </div>

        <section class="case-related u-hidden" id="caseRelated" aria-label="Related projects"></section>
        <div id="casePager"></div>`;

        // Post-render enhancements.
        if (window.Motion) {
            root.querySelectorAll('[data-split]').forEach((el) => window.Motion.splitText(el));
            window.Motion.reveal(root);
            window.Motion.magnetic(root);
        }
        runTickers(root);

        if (repo && window.fetchGitHubStats) {
            window.fetchGitHubStats(repo).then((s) => {
                const row = document.getElementById('ghStars');
                if (!row || !s || !s.stars) return;
                row.querySelector('dd').textContent = s.stars.toLocaleString();
                row.classList.remove('u-hidden');
            });
        }

        if (window.Widgets) {
            window.Widgets.mountChangelog(document.getElementById('caseChangelog'), repo);
            window.Widgets.mountReactions(root);
            window.Widgets.statusFor(project.id).then((s) => {
                const row = document.getElementById('caseStatus');
                if (!row || !s) return;
                row.querySelector('dd').innerHTML = window.Widgets.statusChip(s);
                row.classList.remove('u-hidden');
            });
        }

        wireToc();
    }

    /* ---- Everything that needs the whole list --------------------------- */

    function renderNav(project, all) {
        const cases = all.filter((p) => p.caseStudy).sort(caseOrder);
        const at = cases.findIndex((p) => String(p.id) === String(project.id));
        const prev = at > 0 ? cases[at - 1] : null;
        const next = at > -1 && at < cases.length - 1 ? cases[at + 1] : null;

        const pager = document.getElementById('casePager');
        if (pager && (prev || next)) {
            const item = (p, dir) => `
                <a class="case-pager-link case-pager-link--${dir}" href="${esc(caseHref(p))}" data-handoff="${esc(p.id)}">
                    <span>${dir === 'prev' ? '← Previous case study' : 'Next case study →'}</span>
                    <b>${esc(p.title)}</b>
                </a>`;
            pager.innerHTML = `
                <nav class="case-next" aria-label="More case studies">
                    <div class="u-shell case-pager">
                        ${prev ? item(prev, 'prev') : '<span></span>'}
                        ${next ? item(next, 'next') : ''}
                    </div>
                </nav>`;
        }

        const box = document.getElementById('caseRelated');
        if (box && window.Widgets) {
            const list = window.Widgets.relatedProjects(project, all, 3);
            if (list.length) {
                box.innerHTML = `
                    <div class="u-shell">
                        <div class="sec-index"><b>→</b><i></i><span>Related projects</span></div>
                        ${window.Widgets.relatedHtml(list, {
                            link: (p) => (p.caseStudy ? caseHref(p) : `./#${encodeURIComponent(p.slug || window.projectSlug(p))}`)
                        })}
                    </div>`;
                box.querySelectorAll('a.rel-card').forEach((a) => {
                    const p = list.find((x) => x.caseStudy && caseHref(x) === a.getAttribute('href'));
                    if (p) a.dataset.handoff = p.id;
                });
                box.classList.remove('u-hidden');
            }
        }

        // Clicking through to another case study gets the same instant render.
        root.querySelectorAll('[data-handoff]').forEach((a) => {
            a.addEventListener('click', () => {
                const p = all.find((x) => String(x.id) === a.dataset.handoff);
                if (p) stashHandoff(p);
            });
        });
    }

    /* ---- Table of contents + article progress ---------------------------- */

    let tocObserver = null;
    let progressWired = false;

    function wireToc() {
        const links = Array.from(root.querySelectorAll('[data-toc]'));
        if (tocObserver) tocObserver.disconnect();

        if (links.length) {
            const setActive = (id) => links.forEach((a) => a.classList.toggle('is-active', a.dataset.toc === id));
            tocObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => { if (entry.isIntersecting) setActive(entry.target.id); });
            }, { rootMargin: '-30% 0px -60% 0px' });
            links.forEach((a) => {
                const target = document.getElementById(a.dataset.toc);
                if (target) tocObserver.observe(target);
            });
            setActive(links[0].dataset.toc);
        }

        if (progressWired) { updateProgress(); return; }
        progressWired = true;
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => { ticking = false; updateProgress(); });
        }, { passive: true });
        window.addEventListener('resize', updateProgress, { passive: true });
        updateProgress();
    }

    /* Progress through the article itself — the masthead, related projects
       and footer don't count as reading. */
    function updateProgress() {
        const article = document.getElementById('caseArticle');
        if (!article) return;
        const rect = article.getBoundingClientRect();
        const travel = rect.height - window.innerHeight * 0.5;
        const p = Math.min(1, Math.max(0, (window.innerHeight * 0.5 - rect.top) / Math.max(1, travel)));

        const bar = document.querySelector('.case-progress i');
        if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
        const ring = root.querySelector('.case-ring-bar');
        if (ring) ring.style.strokeDashoffset = String(100 - p * 100);
        const pct = document.getElementById('caseProgressPct');
        if (pct) pct.textContent = `${Math.round(p * 100)}%`;
    }

    /* ---- Lightbox, with arrow-key paging -------------------------------- */

    (function wireLightbox() {
        const box = document.createElement('div');
        box.className = 'lightbox';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'Screenshot');
        box.innerHTML = `
            <button type="button" class="lb-btn lb-close" aria-label="Close">${window.icon('x', { raw: true, size: 18 })}</button>
            <button type="button" class="lb-btn lb-prev" aria-label="Previous screenshot">${window.icon('chev-left', { raw: true, size: 20 })}</button>
            <figure class="lb-figure">
                <img alt="">
                <figcaption><span class="lb-cap"></span><span class="lb-count"></span></figcaption>
            </figure>
            <button type="button" class="lb-btn lb-next" aria-label="Next screenshot">${window.icon('chev-right', { raw: true, size: 20 })}</button>`;
        document.body.appendChild(box);

        const img = box.querySelector('img');
        const cap = box.querySelector('.lb-cap');
        const count = box.querySelector('.lb-count');
        let index = 0;
        let returnTo = null;

        const show = (i) => {
            if (!shots.length) return;
            index = (i + shots.length) % shots.length;
            img.src = shots[index].src;
            img.alt = shots[index].alt;
            cap.textContent = shots[index].alt;
            count.textContent = shots.length > 1 ? `${index + 1} / ${shots.length}` : '';
            box.classList.toggle('is-single', shots.length < 2);
        };
        const open = (i) => {
            returnTo = document.activeElement;
            show(i);
            box.classList.add('is-open');
            document.body.style.overflow = 'hidden';
            box.querySelector('.lb-close').focus({ preventScroll: true });
        };
        const close = () => {
            if (!box.classList.contains('is-open')) return;
            box.classList.remove('is-open');
            document.body.style.overflow = '';
            if (returnTo && returnTo.focus) returnTo.focus({ preventScroll: true });
        };

        box.addEventListener('click', (e) => {
            if (e.target.closest('.lb-prev')) { show(index - 1); return; }
            if (e.target.closest('.lb-next')) { show(index + 1); return; }
            if (e.target.closest('.lb-close') || !e.target.closest('.lb-figure img')) close();
        });
        document.addEventListener('keydown', (e) => {
            if (!box.classList.contains('is-open')) return;
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
        });
        root.addEventListener('click', (e) => {
            const z = e.target.closest('[data-zoom]');
            if (z) open(Number(z.dataset.zoom) || 0);
        });
    })();

    /* ---- Load ----------------------------------------------------------- */

    if (window.standaloneChrome) window.standaloneChrome();

    if (!slug) {
        missing('No project selected', 'This page needs a project — open one from the work section.');
        return;
    }

    // Pass 1: synchronous, from the index's handoff.
    const handoff = readHandoff();
    let shown = null;
    if (handoff && handoff.caseStudy) {
        handoff.slug = handoff.slug || slug;
        render(handoff, { instant: true });
        shown = signature(handoff);
    }

    // Pass 2: the real record, plus everything that needs the full list.
    window.loadProjectsRest().then((all) => {
        const project = all.find((p) => p.slug === slug);
        if (!project) {
            missing('Project not found', `Nothing here matches “${slug}”. It may have been renamed.`);
            return;
        }
        if (!project.caseStudy) {
            missing('No case study yet', `“${project.title}” doesn't have a written case study — but it is live on the work page.`);
            return;
        }
        if (signature(project) !== shown) render(project, { instant: shown !== null });
        renderNav(project, all);
        stashHandoff(project);
    }).catch((e) => {
        console.error('Case study load failed:', e);
        if (shown === null) {
            missing('Could not load this project', 'Something went wrong reaching the database. Try again in a moment.');
        }
    });
})();
