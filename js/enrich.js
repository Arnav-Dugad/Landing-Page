/* ===========================================================================
   enrich.js  (classic script)
   Automatic project population.

   Everything here is DERIVED — it reads a project's GitHub repo and live URL
   and works out what the project is made of, what it does, and when it was
   built. Nothing is invented: a field is only ever suggested when there is a
   real source for it.

   Two entry points:
     · enrichProject(p)     what could be filled in, without writing anything
     · enrichAllProjects()  admin-only backfill across the whole collection

   The GitHub API allows 60 unauthenticated requests an hour per IP, and a
   full pass over thirty projects needs more than that. Rather than failing,
   the backfill runs until it hits the limit, saves what it learned, and tells
   you exactly where it stopped — responses are cached for six hours, so
   running it again later picks up where it left off.
   =========================================================================== */

(() => {
    /* Guessing a mark from what the project is called and what it does. First
       match wins, so specific patterns are listed before generic ones. */
    const ICON_HINTS = [
        [/\b(shoot|fps|crosshair|aim)\b/, 'target'],
        [/\b(game|arcade|play|puzzle|monopoly|ludo|chess)\b/, 'gamepad'],
        [/\b(dice|random|luck|roll)\b/, 'dice'],
        [/\b(movie|film|cinema|cineverse|imdb)\b/, 'film'],
        [/\b(music|song|audio|spotify|player)\b/, 'music'],
        [/\b(weather|forecast|climate|accuweather)\b/, 'cloud'],
        [/\b(map|globe|geo|country|world|atlas)\b/, 'globe'],
        [/\b(car|drive|driving|race|racing|f1|formula)\b/, 'car'],
        [/\b(flight|plane|airline|travel)\b/, 'plane'],
        [/\b(attend|calendar|schedule|timetable|date)\b/, 'calendar'],
        [/\b(clock|timer|pomodoro|countdown)\b/, 'clock'],
        [/\b(task|todo|checklist|planner|kanban)\b/, 'checklist'],
        [/\b(chat|message|social|forum|comment)\b/, 'chat'],
        [/\b(mail|email|inbox|newsletter)\b/, 'mail'],
        [/\b(password|auth|login|secure|vault|encrypt)\b/, 'lock'],
        [/\b(shield|security|privacy|firewall)\b/, 'shield'],
        [/\b(money|finance|bank|wallet|budget|expense|subscription)\b/, 'wallet'],
        [/\b(shop|store|cart|ecommerce|commerce|checkout)\b/, 'cart'],
        [/\b(chart|graph|analytic|dashboard|stat|metric|insight)\b/, 'chart-line'],
        [/\b(data|database|sql|record|storage)\b/, 'database'],
        [/\b(ai|gpt|llm|neural|intelligence)\b/, 'brain'],
        [/\b(bot|robot|automation|agent)\b/, 'robot'],
        [/\b(3d|three|render|webgl|scene|valley|world)\b/, 'cubes'],
        [/\b(photo|image|gallery|picture|camera)\b/, 'image'],
        [/\b(video|stream|youtube|clip)\b/, 'video'],
        [/\b(book|read|library|note|doc|wiki)\b/, 'book'],
        [/\b(school|college|student|course|learn|edu|quiz)\b/, 'cap'],
        [/\b(health|fitness|gym|workout|run)\b/, 'dumbbell'],
        [/\b(food|recipe|cook|restaurant|menu)\b/, 'utensils'],
        [/\b(terminal|cli|shell|command)\b/, 'terminal'],
        [/\b(api|endpoint|server|backend)\b/, 'server'],
        [/\b(design|theme|colour|color|palette|ui)\b/, 'palette'],
        [/\b(portfolio|landing|website|page|site)\b/, 'globe'],
        [/\b(search|find|explore|discover|picker)\b/, 'search'],
        [/\b(sport|football|soccer|cricket|fifa|match)\b/, 'ball'],
        [/\b(link|url|short)\b/, 'link'],
        [/\b(weather|storm|thunder)\b/, 'bolt']
    ];

    /* Category follows the same logic — a project's name and blurb usually
       say what kind of thing it is. */
    const CATEGORY_HINTS = [
        [/\b(game|arcade|puzzle|monopoly|fps|shooter|racing|rpg|platformer)\b/, 'game'],
        [/\b(ai|gpt|llm|chatbot|neural|intelligence)\b/, 'ai'],
        [/\b(machine learning|ml model|tensorflow|pytorch|classifier)\b/, 'ml'],
        [/\b(dashboard|analytic|insight|metric)\b/, 'dashboard'],
        [/\b(shop|store|cart|ecommerce|checkout)\b/, 'ecommerce'],
        [/\b(budget|expense|finance|bank|invest|subscription|money)\b/, 'finance'],
        [/\b(task|todo|planner|note|productivity|attendance|timetable)\b/, 'productivity'],
        [/\b(school|college|student|course|learn|quiz|education)\b/, 'education'],
        [/\b(chat|social|forum|community|feed)\b/, 'social'],
        [/\b(extension|chrome|firefox|addon)\b/, 'extension'],
        [/\b(cli|terminal|command line)\b/, 'cli'],
        [/\b(api|endpoint|rest|graphql)\b/, 'api'],
        [/\b(bot|automation|scraper)\b/, 'bot'],
        [/\b(3d|three\.js|webgl|render|shader)\b/, 'threed'],
        [/\b(visuali[sz]|generative|art|creative)\b/, 'creative'],
        [/\b(tool|utility|converter|generator|calculator|tracker|picker|manager)\b/, 'tool'],
        [/\b(mobile|android|ios|app)\b/, 'app']
    ];

    /* Colour follows category, so the grid reads as a system rather than
       thirty unrelated choices. */
    const CATEGORY_TONE = {
        game: 'red', ai: 'purple', ml: 'purple', threed: 'sky', creative: 'pink',
        dashboard: 'blue', data: 'blue', api: 'slate', cli: 'slate',
        ecommerce: 'orange', finance: 'emerald', productivity: 'teal',
        education: 'yellow', social: 'pink', tool: 'teal', web: 'indigo',
        app: 'indigo', mobile: 'indigo', extension: 'orange', bot: 'purple',
        design: 'pink', library: 'slate', other: 'slate'
    };

    const haystack = (p) => `${p.title || ''} ${p.desc || ''} ${p.longDesc || ''}`.toLowerCase();

    function guessIcon(p) {
        const hay = haystack(p);
        for (const [pattern, key] of ICON_HINTS) if (pattern.test(hay)) return key;
        return null;
    }

    function guessCategory(p) {
        const hay = haystack(p);
        for (const [pattern, key] of CATEGORY_HINTS) if (pattern.test(hay)) return key;
        return null;
    }

    /* Merge two tag lists case-insensitively, preserving the first spelling
       seen so a hand-written "Three.js" isn't replaced by "three.js". */
    function mergeTags(existing = [], found = []) {
        const seen = new Map();
        [...existing, ...found].forEach((t) => {
            const name = String(t || '').trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (!seen.has(key)) seen.set(key, name);
        });
        return [...seen.values()].slice(0, 14);
    }

    /* ---------------------------------------------------------------------
       What could this project have filled in?
       Returns only fields that are currently empty AND have a real source,
       so enrichment never overwrites something written by hand.
       --------------------------------------------------------------------- */
    window.enrichProject = async (project, { force = false } = {}) => {
        const patch = {};
        const repoUrl = window.resolveRepoUrl(project);

        const stats = repoUrl ? await window.fetchGitHubStats(repoUrl) : null;

        // Tech tags — the headline feature. Always recomputed, always merged.
        const tech = await window.detectTech(project);
        if (tech.length) {
            const merged = mergeTags(force ? [] : (project.tags || []), tech);
            if (merged.join('|') !== (project.tags || []).join('|')) patch.tags = merged;
        }

        if (stats) {
            // An explicit repo, once we've proved one exists.
            if (!project.repo && repoUrl) patch.repo = repoUrl;

            if ((!project.desc || force) && stats.description) patch.desc = stats.description;

            if ((!project.year || force) && stats.createdAt) {
                patch.year = String(new Date(stats.createdAt).getFullYear());
            }

            // GitHub's own archived flag beats any guess.
            if (stats.archived && project.status !== 'archived') patch.status = 'archived';

            // A repo homepage is a better live link than nothing.
            if (!project.link && stats.homepage) patch.link = stats.homepage;
        }

        // Only guess an icon/category/colour where nothing was chosen. A
        // default the editor filled in ("cube", "web") counts as unchosen.
        const iconIsDefault = !project.icon || window.normaliseIcon(project.icon) === 'cube';
        if (iconIsDefault || force) {
            const guess = guessIcon({ ...project, ...patch });
            if (guess) patch.icon = guess;
        }

        if (!project.category || project.category === 'other' || force) {
            const guess = guessCategory({ ...project, ...patch });
            if (guess) patch.category = guess;
        }

        if (!project.color || force) {
            const category = patch.category || project.category || 'other';
            patch.color = CATEGORY_TONE[category] || 'slate';
        }

        return patch;
    };

    /* ---------------------------------------------------------------------
       Backfill every project. Admin only — it writes.
       --------------------------------------------------------------------- */
    window.enrichAllProjects = async ({ force = false } = {}) => {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }

        const projects = (window.getProjects ? window.getProjects() : []).slice();
        if (!projects.length) { window.toast('No projects to enrich', 'info'); return; }

        const progress = window.progressToast(`Reading GitHub — 0 of ${projects.length}`);
        let updated = 0, skipped = 0, done = 0, stoppedAtLimit = false;

        for (const project of projects) {
            if (window.githubRateLimited()) { stoppedAtLimit = true; break; }

            try {
                const patch = await window.enrichProject(project, { force });
                if (Object.keys(patch).length) {
                    // updateProjectInDb does a full overwrite, so send the
                    // whole record with the patch applied on top.
                    const { id, ...current } = project;
                    await window.updateProjectInDb(id, { ...current, ...patch }, { quiet: true });
                    updated++;
                } else {
                    skipped++;
                }
            } catch (e) {
                console.error('Enrich failed for', project.title, e);
                skipped++;
            }

            done++;
            progress.update(`Reading GitHub — ${done} of ${projects.length}`, done / projects.length);
        }

        progress.close();

        if (stoppedAtLimit) {
            window.toast(
                `Updated ${updated} of ${projects.length}. GitHub's hourly limit was reached — run it again later to finish the rest.`,
                'info');
        } else if (updated) {
            window.toast(`Updated ${updated} project${updated === 1 ? '' : 's'}${skipped ? `, ${skipped} already complete` : ''}`, 'success');
            window.celebrate && window.celebrate();
        } else {
            window.toast('Everything was already up to date', 'info');
        }
    };

    /* Fill the OPEN editor form from GitHub, without saving. */
    window.enrichEditorForm = async () => {
        const read = window.readEditorForm;
        const write = window.writeEditorForm;
        if (!read || !write) return;

        const current = read();
        if (!current.link && !current.repo) {
            window.toast('Add a live URL or repo first', 'error');
            return;
        }

        const btn = document.getElementById('autofill');
        if (btn) { btn.disabled = true; btn.dataset.busy = '1'; }

        try {
            const patch = await window.enrichProject(current, { force: false });
            if (!Object.keys(patch).length) {
                window.toast('Nothing new found on GitHub', 'info');
                return;
            }
            write({ ...current, ...patch });
            window.refreshEditorPreview && window.refreshEditorPreview();
            window.toast(`Filled in: ${Object.keys(patch).join(', ')}`, 'success');
        } catch (e) {
            console.error(e);
            window.toast('Could not reach GitHub', 'error');
        } finally {
            if (btn) { btn.disabled = false; delete btn.dataset.busy; }
        }
    };
})();
