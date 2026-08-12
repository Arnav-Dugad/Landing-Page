/* ===========================================================================
   case.js  (classic script)
   Renders the long-form case-study page from a single project record.

   It reads Firestore over the REST API rather than pulling in the Firebase
   SDK: this page needs exactly one document, projects are world-readable, and
   skipping the SDK keeps it to one request with nothing to initialise.

   URL: case.html?p=<project-slug>
   =========================================================================== */

(() => {
    const root = document.getElementById('caseRoot');
    if (!root) return;

    const PROJECT_ID = 'landing-page-cc574';
    const API_KEY = 'AIzaSyBVg4_5WjOjlA-xfoGAhjqNk75EyMG6sS8';
    const PATH = 'artifacts/arnav-portfolio-v1/public/data/projects';
    const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${PATH}?key=${API_KEY}&pageSize=300`;

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const safeUrl = (v) => {
        const raw = String(v ?? '').trim();
        if (!raw) return '';
        try {
            const u = new URL(raw, location.href);
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
        } catch { return ''; }
    };

    const slugify = (s) => String(s || '').toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    /* ---- Firestore REST value unwrapping -------------------------------- */

    function unwrap(value) {
        if (!value || typeof value !== 'object') return null;
        if ('stringValue' in value) return value.stringValue;
        if ('booleanValue' in value) return value.booleanValue;
        if ('integerValue' in value) return Number(value.integerValue);
        if ('doubleValue' in value) return value.doubleValue;
        if ('nullValue' in value) return null;
        if ('arrayValue' in value) return (value.arrayValue.values || []).map(unwrap);
        if ('mapValue' in value) return unwrapDoc(value.mapValue.fields || {});
        return null;
    }
    function unwrapDoc(fields) {
        const out = {};
        Object.entries(fields).forEach(([k, v]) => { out[k] = unwrap(v); });
        return out;
    }

    /* ---- Render --------------------------------------------------------- */

    function missing(title, message) {
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

    function block(index, heading, text) {
        if (!String(text || '').trim()) return '';
        return `
            <section class="case-block" data-reveal="up">
                <h2><b>${index}</b> ${esc(heading)}</h2>
                <p>${esc(text)}</p>
            </section>`;
    }

    function render(project, all) {
        const link = safeUrl(project.link);
        const repo = window.resolveRepoUrl ? window.resolveRepoUrl(project) : null;
        const tone = window.toneVars ? window.toneVars(project.color) : '';
        const gallery = (project.gallery || []).map(safeUrl).filter(Boolean);
        const challenges = (project.challenges || []).filter((c) => String(c).trim());
        const metrics = (project.metrics || []).filter((m) => String(m).trim());
        const tags = (project.tags || []).filter(Boolean);

        document.title = `${project.title} — case study — Arnav Dugad`;
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.setAttribute('content', String(project.desc || '').slice(0, 180));

        // Numbered sections, skipping any the author left empty.
        let n = 0;
        const step = () => String(++n).padStart(2, '0');

        const media = gallery.length
            ? `<img src="${esc(gallery[0])}" alt="${esc(project.title)}" loading="eager">`
            : (link ? `<iframe src="${esc(link)}" title="${esc(project.title)} live preview" loading="eager"
                        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>` : '');

        // Pick a neighbouring case study to send the reader to next.
        const others = all.filter((p) => p.caseStudy && p.slug !== project.slug);
        const next = others.length ? others[Math.floor(Math.random() * others.length)] : null;

        root.innerHTML = `
        <header class="case-head u-shell" style="${tone}">
            <a class="case-back" href="./#work">${window.icon('arrow-left', { raw: true, size: 13 })} All work</a>

            <div class="case-eyebrow">
                <span>Case study</span>
                ${project.category ? `<span>·</span><span>${esc(project.category)}</span>` : ''}
                ${project.year ? `<span>·</span><span>${esc(project.year)}</span>` : ''}
                ${project.role ? `<span>·</span><span>${esc(project.role)}</span>` : ''}
            </div>

            <h1 class="case-title" data-split>${esc(project.title)}</h1>
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
                        return `<div class="case-metric"><dt>${esc(value)}</dt><dd>${esc(label || 'Result')}</dd></div>`;
                    }).join('')}
                </dl>` : ''}
        </header>

        ${media ? `<div class="u-shell"><div class="case-media" data-reveal="scale">${media}</div></div>` : ''}

        <div class="u-shell">
            <div class="case-body">
                <div class="case-prose">
                    ${block(step(), 'The problem', project.problem)}
                    ${block(step(), 'The approach', project.approach)}

                    ${challenges.length ? `
                        <section class="case-block" data-reveal="up">
                            <h2><b>${step()}</b> What broke</h2>
                            <ol class="case-breaks">
                                ${challenges.map((c) => `<li><span>${esc(c)}</span></li>`).join('')}
                            </ol>
                        </section>` : ''}

                    ${block(step(), 'The outcome', project.outcome)}
                    ${project.longDesc && !project.problem ? block(step(), 'Notes', project.longDesc) : ''}

                    ${gallery.length > 1 ? `
                        <section class="case-block" data-reveal="up">
                            <h2><b>${step()}</b> Screens</h2>
                            <div class="case-gallery">
                                ${gallery.slice(1).map((src) => `
                                    <figure class="case-shot" data-zoom="${esc(src)}">
                                        <img src="${esc(src)}" alt="${esc(project.title)} screenshot" loading="lazy">
                                    </figure>`).join('')}
                            </div>
                        </section>` : ''}
                </div>

                <aside class="case-side">
                    ${tags.length ? `
                        <section>
                            <h5>Built with</h5>
                            <div>${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
                        </section>` : ''}
                    <section>
                        <h5>At a glance</h5>
                        <dl>
                            ${project.year ? `<div><dt>Year</dt><dd>${esc(project.year)}</dd></div>` : ''}
                            ${project.role ? `<div><dt>Role</dt><dd>${esc(project.role)}</dd></div>` : ''}
                            ${project.status ? `<div><dt>Status</dt><dd>${esc(project.status === 'wip' ? 'In progress' : project.status)}</dd></div>` : ''}
                            ${project.category ? `<div><dt>Type</dt><dd>${esc(project.category)}</dd></div>` : ''}
                            <div id="ghStars" class="u-hidden"><dt>Stars</dt><dd>—</dd></div>
                        </dl>
                    </section>
                </aside>
            </div>
        </div>

        ${next ? `
            <div class="case-next">
                <div class="u-shell">
                    <a href="case.html?p=${encodeURIComponent(next.slug)}">
                        <span>Next case study</span>
                        ${esc(next.title)}
                    </a>
                </div>
            </div>` : ''}`;

        // Post-render enhancements.
        if (window.Motion) {
            document.querySelectorAll('[data-split]').forEach((el) => window.Motion.splitText(el));
            window.Motion.reveal(root);
            window.Motion.magnetic(root);
            window.Motion.scrollChrome();     // re-measure now the page has height
        }

        if (repo && window.fetchGitHubStats) {
            window.fetchGitHubStats(repo).then((s) => {
                const row = document.getElementById('ghStars');
                if (!row || !s || !s.stars) return;
                row.querySelector('dd').textContent = s.stars.toLocaleString();
                row.classList.remove('u-hidden');
            });
        }

        wireLightbox();
    }

    /* ---- Lightbox ------------------------------------------------------- */

    function wireLightbox() {
        let box = document.querySelector('.lightbox');
        if (!box) {
            box = document.createElement('div');
            box.className = 'lightbox';
            box.innerHTML = '<img alt="">';
            document.body.appendChild(box);
            box.addEventListener('click', () => close());
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        }
        const img = box.querySelector('img');
        const close = () => { box.classList.remove('is-open'); document.body.style.overflow = ''; };

        root.querySelectorAll('[data-zoom]').forEach((fig) => {
            fig.addEventListener('click', () => {
                img.src = fig.dataset.zoom;
                box.classList.add('is-open');
                document.body.style.overflow = 'hidden';
            });
        });
    }

    /* ---- Page chrome that should work regardless of what loads ---------- */

    (function chrome() {
        window.hydrateIcons && window.hydrateIcons(document);
        if (window.Motion) {
            window.Motion.cursor();
            window.Motion.scrollChrome();
            window.Motion.magnetic(document);
        }
        const toTop = document.querySelector('.totop');
        if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    })();

    /* ---- Load ----------------------------------------------------------- */

    (async function load() {
        const slug = new URLSearchParams(location.search).get('p');
        if (!slug) {
            missing('No project selected', 'This page needs a project — open one from the work section.');
            return;
        }

        let docs;
        try {
            const res = await fetch(ENDPOINT);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            docs = json.documents || [];
        } catch (e) {
            console.error('Case study load failed:', e);
            missing('Could not load this project', 'Something went wrong reaching the database. Try again in a moment.');
            return;
        }

        const all = docs.map((d) => {
            const data = unwrapDoc(d.fields || {});
            return { ...data, id: d.name.split('/').pop(), slug: slugify(data.title) };
        });

        const project = all.find((p) => p.slug === slug);
        if (!project) {
            missing('Project not found', `Nothing here matches “${slug}”. It may have been renamed.`);
            return;
        }
        if (!project.caseStudy) {
            missing('No case study yet', `“${project.title}” doesn't have a written case study — but it is live on the work page.`);
            return;
        }
        render(project, all);
    })();
})();
