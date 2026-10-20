/* ===========================================================================
   resume.js  (classic script)
   A printable CV generated from the live project data.

   Nothing here is typed twice: skills are counted from the tags on real
   projects (the same way the Stack band is), and the project list is the
   featured work first, then the newest. "Download PDF" is the browser's own
   print-to-PDF — the print stylesheet in pages.css does the typesetting.
   =========================================================================== */

(() => {
    const skillsBox = document.getElementById('cvSkills');
    const projectsBox = document.getElementById('cvProjects');
    if (!skillsBox || !projectsBox) return;

    const esc = (v) => window.esc(v);

    /* Same grouping idea as the editor's quick tags, widened to cover what
       tech detection actually finds. Anything unlisted is a platform/tool. */
    const LANGUAGES = new Set(['javascript', 'typescript', 'html', 'css', 'scss', 'python', 'c++', 'c',
        'c#', 'java', 'go', 'rust', 'swift', 'kotlin', 'php', 'sql', 'dart', 'ruby', 'lua', 'shell', 'glsl']);
    const FRAMEWORKS = new Set(['react', 'next.js', 'vue', 'svelte', 'sveltekit', 'angular', 'astro', 'nuxt',
        'node.js', 'express', 'fastify', 'flask', 'django', 'fastapi', 'tailwind', 'three.js',
        'react three fiber', 'preact', 'solidjs', 'remix', 'gatsby', 'phaser', 'pixijs', 'p5.js',
        'babylon.js', 'gsap', 'framer motion', 'd3', 'chart.js', 'recharts', 'bootstrap', 'electron',
        'redux', 'zustand', 'prisma', 'drizzle', 'matter.js', 'leaflet', 'mapbox']);

    function skills(projects) {
        const counts = new Map();
        projects.forEach((p) => (p.tags || []).forEach((t) => {
            const name = String(t || '').trim();
            if (!name) return;
            const key = name.toLowerCase();
            const hit = counts.get(key) || { name, n: 0 };
            hit.n++;
            counts.set(key, hit);
        }));

        const top = [...counts.entries()]
            .sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name))
            .slice(0, 18);

        const groups = { Languages: [], Frameworks: [], 'Platforms & tools': [] };
        top.forEach(([key, v]) => {
            const g = LANGUAGES.has(key) ? 'Languages' : FRAMEWORKS.has(key) ? 'Frameworks' : 'Platforms & tools';
            groups[g].push(v);
        });
        return Object.entries(groups).filter(([, list]) => list.length);
    }

    function hostOf(url) {
        try { return new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, ''); }
        catch { return ''; }
    }

    function render(projects) {
        const grouped = skills(projects);
        skillsBox.innerHTML = grouped.length
            ? grouped.map(([label, list]) => `
                <div class="cv-skill-row">
                    <h3>${label}</h3>
                    <ul>${list.map((s) => `<li>${esc(s.name)}<small>${s.n}</small></li>`).join('')}</ul>
                </div>`).join('')
            : '<p class="cv-muted">No tagged projects yet.</p>';

        const picked = projects.slice().sort((a, b) =>
            (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);

        projectsBox.innerHTML = picked.length ? picked.map((p) => {
            const link = window.safeUrl(p.link);
            const tags = (p.tags || []).filter(Boolean).slice(0, 6);
            return `
                <section class="cv-project">
                    <header>
                        <h3>${esc(p.title)}</h3>
                        <span>${[window.categoryLabel(p.category), p.year].filter(Boolean).map(esc).join(' · ')}</span>
                    </header>
                    <p>${esc(p.desc)}</p>
                    <footer>
                        ${tags.length ? `<span class="cv-tags">${tags.map(esc).join(' · ')}</span>` : ''}
                        ${link ? `<a href="${esc(link)}">${esc(hostOf(link))}</a>` : ''}
                    </footer>
                </section>`;
        }).join('') : '<p class="cv-muted">No projects published yet.</p>';
    }

    if (window.standaloneChrome) window.standaloneChrome();

    const date = document.getElementById('cvDate');
    if (date) date.textContent = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    const printBtn = document.getElementById('cvPrint');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    const cv = document.getElementById('cv');

    window.loadProjectsRest()
        .then(render)
        .catch((e) => {
            console.error('Résumé load failed:', e);
            const msg = '<p class="cv-muted">Could not reach the project database — try again in a moment.</p>';
            skillsBox.innerHTML = msg;
            projectsBox.innerHTML = msg;
        })
        .finally(() => { if (cv) cv.removeAttribute('aria-busy'); });

    // The "Now" line is a bonus — only where the edge API exists.
    if (window.EDGE) {
        window.edgeFetch('/api/now').then((data) => {
            const text = data && (data.building || data.learning || data.note);
            if (!text) return;
            const first = String(text).trim().split(/\n/)[0].slice(0, 220);
            document.getElementById('cvNow').textContent = first;
            document.getElementById('cvNowWrap').hidden = false;
        }).catch(() => { /* optional */ });
    }
})();
