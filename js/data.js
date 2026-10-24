/* ===========================================================================
   data.js  (classic script — before render.js)
   The project list, and lazy loading for everything visitors don't need yet.

   · Projects come from the Worker (/api/projects — edge-cached, survives a
     Firestore quota outage), then the snapshot shipped with the site. Only
     hosts without the Worker need Firebase to show the work.
   · Firebase (≈190 KB of SDK + 160 KB of analytics) loads when the page is
     idle, or the moment something needs it: signing in, sending a message.
   · The admin tools (editor, importer, dock, AI…) load only for the admin.

   Functions other scripts may call before their module has loaded get a
   stand-in that loads the module first and then calls the real thing — so
   behaviour is identical, just without the up-front cost.
   =========================================================================== */

(() => {
    /* -------- Project store --------------------------------------------- */

    let projects = [];
    let loaded = false;
    const rerender = () => { if (window.renderProjects) window.renderProjects(); };

    window.getProjects = () => projects;
    window.projectsLoaded = () => loaded;
    // firebase.js (the admin's live listener, or a host without the Worker)
    // hands its snapshots here.
    window.setProjects = (list) => { projects = list; loaded = true; rerender(); };
    window.markProjectsLoaded = () => { if (!loaded) { loaded = true; rerender(); } };
    window.edgeProjectsFailed = false;

    const ADMIN_FLAG = 'adm';
    const wasAdmin = () => { try { return localStorage.getItem(ADMIN_FLAG) === '1'; } catch { return false; } };
    window.rememberAdmin = (on) => {
        try { if (on) localStorage.setItem(ADMIN_FLAG, '1'); else localStorage.removeItem(ADMIN_FLAG); } catch { /* private mode */ }
    };

    /* -------- Firebase, on demand ---------------------------------------- */

    let fbPromise = null;
    window.ensureFirebase = () => {
        if (!fbPromise) fbPromise = import('./firebase.js').catch((e) => { fbPromise = null; throw e; });
        return fbPromise;
    };

    const FIREBASE_API = ['adminSignIn', 'adminSignOut', 'adminIdToken', 'saveMessageToDb', 'loadNowFromDb',
        'saveNowToDb', 'saveProjectToDb', 'updateProjectInDb', 'deleteProjectFromDb', 'reorderProjectsInDb',
        'uploadMedia', 'compressImage', 'writeHistory', 'loadHistory'];
    FIREBASE_API.forEach((name) => {
        const stub = async (...args) => {
            await window.ensureFirebase();
            if (window[name] === stub) throw new Error('Still connecting — try again in a second');
            return window[name](...args);
        };
        window[name] = stub;
    });

    /* -------- Admin tools, on demand -------------------------------------- */

    const ADMIN_SCRIPTS = ['js/enrich.js', 'js/admin.js', 'js/ai.js', 'js/importer.js', 'js/admin-dock.js', 'js/reorder.js'];
    let adminPromise = null;
    const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;                      // keep execution order
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Could not load ${src}`));
        document.body.appendChild(s);
    });
    window.loadAdmin = () => {
        if (!adminPromise) {
            adminPromise = Promise.all(ADMIN_SCRIPTS.map(loadScript))
                .then(() => { if (window.hydrateIcons) window.hydrateIcons(document); })
                .catch((e) => { adminPromise = null; throw e; });
        }
        return adminPromise;
    };

    window.isAdmin = false;
    const adminStub = (name) => {
        const stub = async (...args) => {
            await window.loadAdmin();
            if (window[name] === stub) return undefined;
            return window[name](...args);
        };
        return stub;
    };
    // Called by firebase.js whenever the session changes. Only the admin
    // needs the tools; a visitor's call is a no-op.
    window.applyAdminState = async (...args) => {
        if (!window.isAdmin) return;
        await window.loadAdmin();
        if (window.applyAdminState.isStub !== true) window.applyAdminState(...args);
    };
    window.applyAdminState.isStub = true;
    ['toggleAdmin', 'newProject', 'editProject', 'openAiStudio'].forEach((n) => { window[n] = adminStub(n); });

    // The footer padlock: admin.js binds it once loaded; until then sign-in
    // needs both Firebase and the admin tools.
    const lock = document.getElementById('adminLock');
    if (lock) {
        lock.dataset.bound = '1';
        lock.addEventListener('click', () => { window.ensureFirebase(); window.toggleAdmin(); });
    }

    /* -------- Boot -------------------------------------------------------- */

    (async function loadForVisitors() {
        if (window.EDGE) {
            for (const url of ['/api/projects', '/data/projects-snapshot.json']) {
                try {
                    const res = await fetch(url, { headers: { accept: 'application/json' } });
                    if (!res.ok) continue;
                    const json = await res.json();
                    if (!Array.isArray(json.projects)) continue;
                    if (loaded && projects.length) return;      // the admin's live listener won
                    projects = json.projects
                        .map(({ slug, ...p }) => (window.normalizeProject ? window.normalizeProject(p) : p))
                        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                    loaded = true;
                    rerender();
                    return;
                } catch { /* try the next source */ }
            }
        }
        // No Worker (GitHub Pages, localhost) or both sources failed: Firebase
        // has to provide the list, so load it now rather than at idle.
        window.edgeProjectsFailed = true;
        window.ensureFirebase();
    })();

    // A returning admin gets everything straight away.
    if (wasAdmin()) { window.ensureFirebase(); window.loadAdmin(); }

    // Everyone else: Firebase once the page has settled (anonymous session,
    // visit counter, analytics) — never competing with first paint.
    const idle = (fn) => ('requestIdleCallback' in window
        ? requestIdleCallback(fn, { timeout: 5000 })
        : setTimeout(fn, 2500));
    // A few seconds after load, then at idle: the screenshots get the
    // bandwidth first, which matters most on a phone connection.
    const whenSettled = () => setTimeout(() => idle(() => window.ensureFirebase()), 3500);
    if (document.readyState === 'complete') whenSettled();
    else window.addEventListener('load', whenSettled, { once: true });

    // Opening the contact form is a strong hint a message is coming.
    document.addEventListener('pointerdown', (e) => {
        if (e.target.closest && e.target.closest('[data-contact], #adminLock')) window.ensureFirebase();
    }, { passive: true, capture: true });
})();
