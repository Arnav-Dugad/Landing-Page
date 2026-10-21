/* ===========================================================================
   palette.js  (classic script)
   ⌘K command palette — every action on the site reachable from the keyboard.

   The command list is rebuilt on each open so it always reflects live state:
   real projects from Firestore, the categories currently in use, and whether
   admin mode is unlocked.
   =========================================================================== */

(() => {
    const root = document.getElementById('palette');
    const input = document.getElementById('paletteInput');
    const list = document.getElementById('paletteList');
    if (!root || !input || !list) return;

    let commands = [];
    let matches = [];
    let cursor = 0;

    const go = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    /* -------- Command sources ------------------------------------------- */

    function build() {
        const projects = window.listProjects ? window.listProjects() : [];
        const cmds = [];

        projects.forEach((p) => cmds.push({
            group: 'Projects',
            icon: window.normaliseIcon(p.icon),
            label: p.title,
            sub: p.desc,
            keywords: [p.category, ...(p.tags || [])].filter(Boolean).join(' '),
            hint: 'Open',
            run: () => window.openProject(p.id)
        }));

        cmds.push(
            { group: 'Navigate', icon: 'arrow-up',  label: 'Go to top',     keywords: 'home hero start', run: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
            { group: 'Navigate', icon: 'grid',      label: 'Go to work',    keywords: 'projects portfolio grid', run: go('work') },
            ...(document.getElementById('releases') && !document.getElementById('releases').hidden
                ? [{ group: 'Navigate', icon: 'rocket', label: 'Latest releases', keywords: 'new version update changelog shipped', run: go('releases') }]
                : []),
            { group: 'Navigate', icon: 'info',      label: 'Go to about',   keywords: 'bio story who', run: go('about') },
            { group: 'Navigate', icon: 'layers',    label: 'Go to stack',   keywords: 'tech tools skills', run: go('stack') },
            { group: 'Navigate', icon: 'send',      label: 'Go to contact', keywords: 'email reach hire', run: go('contact') },
            { group: 'Navigate', icon: 'pulse',     label: 'What I’m doing now', keywords: 'now current reading learning building', run: () => { location.href = 'now.html'; } },
            { group: 'Navigate', icon: 'doc',       label: 'Résumé', sub: 'Printable, generated from the projects', keywords: 'cv resume pdf hire print', run: () => { location.href = 'resume.html'; } },
            { group: 'Navigate', icon: 'news',      label: 'RSS feed', keywords: 'rss atom subscribe feed json', run: () => { location.href = '/feed.xml'; } }
        );

        // Platforms: one command per platform that actually has work on it.
        const platCounts = {};
        projects.forEach((p) => window.platformsOf(p).forEach((k) => { platCounts[k] = (platCounts[k] || 0) + 1; }));
        if (Object.keys(platCounts).length > 1) {
            cmds.push({
                group: 'Platforms', icon: 'blocks', label: 'Show everything',
                keywords: 'all platforms reset', run: () => { window.setPlatform('all'); go('work')(); }
            });
            Object.keys(window.PLATFORMS).filter((k) => platCounts[k]).forEach((k) => {
                const def = window.PLATFORMS[k];
                cmds.push({
                    group: 'Platforms', icon: def.icon, label: `Show ${def.noun.toLowerCase()}`,
                    sub: `${platCounts[k]} project${platCounts[k] === 1 ? '' : 's'}`,
                    keywords: `platform ${k} ${def.label} ${def.noun} apps`,
                    run: () => { window.setPlatform(k); go('work')(); }
                });
            });
        }

        // Direct downloads — "Download UsageNotch for Windows".
        projects.forEach((p) => (Array.isArray(p.downloads) ? p.downloads : []).forEach((d) => {
            const url = window.safeUrl(d && d.url);
            if (!url) return;
            const def = window.PLATFORMS[d.platform] || { label: d.label || 'your device', icon: 'download' };
            cmds.push({
                group: 'Downloads', icon: def.icon,
                label: `Download ${p.title} for ${def.label}`,
                sub: [d.version && `v${String(d.version).replace(/^v/i, '')}`, window.formatBytes(d.size)].filter(Boolean).join(' · '),
                keywords: `download install get ${d.platform} ${p.title} apk exe`,
                hint: 'Get',
                run: () => { const a = document.createElement('a'); a.href = url; a.download = ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
            });
        }));

        const cats = [...new Set(projects.map((p) => p.category || 'other'))].sort();
        cmds.push({
            group: 'Filter', icon: 'filter', label: 'Show all projects',
            keywords: 'clear reset filter', run: () => { window.setFilter('all'); go('work')(); }
        });
        cats.forEach((c) => cmds.push({
            group: 'Filter', icon: 'filter',
            label: `Filter: ${c.charAt(0).toUpperCase() + c.slice(1)}`,
            keywords: `category ${c}`,
            run: () => { window.setFilter(c); go('work')(); }
        }));

        [['smart', 'Recommended'], ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['stars', 'Most starred'],
         ['az', 'A–Z'], ['featured', 'Featured first']].forEach(([key, label]) => {
            cmds.push({
                group: 'Sort', icon: 'sort', label: `Sort: ${label}`,
                keywords: `order arrange ${key}`,
                run: () => { window.setSort(key); go('work')(); }
            });
        });

        cmds.push(
            { group: 'View', icon: 'grid',    label: 'Grid view',     keywords: 'cards tiles layout', run: () => { window.setView('grid'); go('work')(); } },
            { group: 'View', icon: 'list',    label: 'List view',     keywords: 'rows compact layout', run: () => { window.setView('list'); go('work')(); } },
            { group: 'View', icon: 'type',    label: 'Index view',    keywords: 'typographic titles magazine list', run: () => { window.setView('index'); go('work')(); } },
            { group: 'View', icon: 'history', label: 'Timeline view', keywords: 'years chronology history when', run: () => { window.setView('timeline'); go('work')(); } },
            { group: 'View', icon: 'link',    label: 'Copy link to this view', keywords: 'share url filter saved', run: () => document.getElementById('copyView')?.click() }
        );
        if ((window.PState.compare || []).length >= 2) {
            cmds.push({ group: 'View', icon: 'scale', label: 'Compare picked projects', keywords: 'side by side diff', run: () => window.openCompare() });
        }

        cmds.push(
            { group: 'Actions', icon: 'dice',    label: 'Surprise me',        sub: 'Open a random project', keywords: 'random lucky shuffle', run: () => window.randomProject() },
            { group: 'Actions', icon: 'mail',    label: 'Copy email address', keywords: 'contact clipboard', run: () => {
                navigator.clipboard?.writeText('arnavdugad@gmail.com')
                    .then(() => window.toast('Email copied to clipboard', 'success'))
                    .catch(() => window.toast('Could not copy', 'error'));
            } },
            { group: 'Actions', icon: 'send',    label: 'Send me a message',  keywords: 'contact form hire email', run: () => window.openContact() },
            { group: 'Actions', icon: 'wave',    label: 'Toggle sound',       keywords: 'audio mute volume', run: () => window.toggleSound() },
            { group: 'Actions', icon: 'github',  label: 'Open GitHub profile', keywords: 'code repos source', run: () => window.open('https://github.com/Arnav-Dugad', '_blank', 'noopener') },
            { group: 'Actions', icon: 'linkedin', label: 'Open LinkedIn',      keywords: 'social profile work', run: () => window.open('https://www.linkedin.com/in/arnav-dugad/', '_blank', 'noopener') },
            { group: 'Actions', icon: 'share',   label: 'Copy link to this page', keywords: 'url share clipboard', run: () => {
                navigator.clipboard?.writeText(location.origin + location.pathname)
                    .then(() => window.toast('Link copied', 'success'))
                    .catch(() => {});
            } }
        );

        cmds.push({
            group: 'Admin',
            icon: window.isAdmin ? 'unlock' : 'lock',
            label: window.isAdmin ? 'Lock admin mode' : 'Unlock admin mode',
            keywords: 'pin login edit manage',
            run: () => window.toggleAdmin()
        });
        if (window.isAdmin) {
            cmds.push({ group: 'Admin', icon: 'plus', label: 'Add a new project', keywords: 'create new add', run: () => window.newProject() });
            cmds.push({ group: 'Admin', icon: 'sparkles', label: 'AI studio', sub: 'Claude · Gemini · ChatGPT', keywords: 'ai chat ask claude gemini chatgpt openai improve', run: () => window.openAiStudio() });
            cmds.push({ group: 'Admin', icon: 'pulse', label: 'Health check', sub: 'Dead repos and links that are down', keywords: 'broken dead links status repo', run: () => window.openHealth() });
            cmds.push({ group: 'Admin', icon: 'pen', label: 'Edit the Now page', keywords: 'now update status', run: () => window.openNowEditor() });
            (window.getProjects ? window.getProjects() : []).forEach((p) => cmds.push({
                group: 'Admin', icon: 'pencil', label: `Edit: ${p.title}`,
                keywords: 'change update modify', hint: 'Edit',
                run: () => window.editProject(p.id)
            }));
        }

        commands = cmds;
    }

    /* -------- Scoring: subsequence match, weighted toward prefixes ------- */

    function score(query, cmd) {
        if (!query) return 1;
        const hay = `${cmd.label} ${cmd.sub || ''} ${cmd.keywords || ''} ${cmd.group}`.toLowerCase();
        const label = cmd.label.toLowerCase();

        if (label.startsWith(query)) return 1000 - label.length;
        if (label.includes(query)) return 700 - label.indexOf(query);
        if (hay.includes(query)) return 400;

        // Fuzzy: every character of the query, in order, somewhere in the label.
        let i = 0, gaps = 0;
        for (const ch of label) {
            if (ch === query[i]) { i++; if (i === query.length) break; }
            else gaps++;
        }
        return i === query.length ? Math.max(1, 200 - gaps) : 0;
    }

    function paint() {
        const query = input.value.toLowerCase().trim();

        matches = commands
            .map((cmd) => ({ cmd, s: score(query, cmd) }))
            .filter((m) => m.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 40)
            .map((m) => m.cmd);

        if (!matches.length) {
            list.innerHTML = `<div class="palette-empty">Nothing matches “${window.esc(input.value)}”.</div>`;
            return;
        }

        cursor = Math.min(cursor, matches.length - 1);

        let html = '';
        let group = null;
        matches.forEach((cmd, i) => {
            if (cmd.group !== group) {
                group = cmd.group;
                html += `<div class="palette-group">${window.esc(group)}</div>`;
            }
            html += `
                <button class="palette-item ${i === cursor ? 'is-cursor' : ''}" data-index="${i}" type="button">
                    <span class="ic">${window.icon(cmd.icon, { raw: true, size: 15 })}</span>
                    <span class="tx">
                        <b>${window.esc(cmd.label)}</b>
                        ${cmd.sub ? `<small>${window.esc(String(cmd.sub).slice(0, 64))}</small>` : ''}
                    </span>
                    ${cmd.hint ? `<span class="hint">${window.esc(cmd.hint)}</span>` : ''}
                </button>`;
        });
        list.innerHTML = html;
    }

    function moveCursor(delta) {
        if (!matches.length) return;
        cursor = (cursor + delta + matches.length) % matches.length;
        list.querySelectorAll('.palette-item').forEach((el, i) => {
            el.classList.toggle('is-cursor', i === cursor);
            if (i === cursor) el.scrollIntoView({ block: 'nearest' });
        });
    }

    function run(index) {
        const cmd = matches[index];
        if (!cmd) return;
        close();
        // Let the palette finish closing before the command moves the page.
        setTimeout(() => cmd.run(), 90);
    }

    /* -------- Open / close ---------------------------------------------- */

    function open() {
        build();
        input.value = '';
        cursor = 0;
        paint();
        root.classList.add('is-open');
        root.removeAttribute('aria-hidden');
        document.body.style.overflow = 'hidden';
        setTimeout(() => input.focus(), 60);
    }

    function close() {
        root.classList.remove('is-open');
        root.setAttribute('aria-hidden', 'true');
        if (!document.querySelector('.sheet.is-open')) document.body.style.overflow = '';
    }

    window.openPalette = open;
    window.closePalette = close;
    window.paletteOpen = () => root.classList.contains('is-open');

    /* -------- Wiring ----------------------------------------------------- */

    input.addEventListener('input', () => { cursor = 0; paint(); });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); run(cursor); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    list.addEventListener('click', (e) => {
        const item = e.target.closest('.palette-item');
        if (item) run(Number(item.dataset.index));
    });
    list.addEventListener('pointermove', (e) => {
        const item = e.target.closest('.palette-item');
        if (!item) return;
        const i = Number(item.dataset.index);
        if (i === cursor) return;
        cursor = i;
        list.querySelectorAll('.palette-item').forEach((el, n) => el.classList.toggle('is-cursor', n === i));
    });

    root.addEventListener('click', (e) => { if (e.target === root) close(); });

    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            window.paletteOpen() ? close() : open();
        }
    });

    document.querySelectorAll('[data-palette]').forEach((btn) => {
        btn.addEventListener('click', open);
    });
})();
