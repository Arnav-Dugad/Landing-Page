/* ===========================================================================
   rest.js  (classic script — standalone pages only)
   Reads every project over the Firestore REST API.

   The case study, résumé and 404 pages need the project list once and never
   write, and projects are world-readable — so they skip the Firebase SDK
   entirely. One request, nothing to initialise, no auth handshake.

       window.loadProjectsRest() → Promise<Array<{...fields, id, slug}>>

   Memoised per page; throws on any network or HTTP failure so the caller can
   decide what to show instead.

   Also home to window.standaloneChrome(): the nav, cursor, scroll chrome and
   back-to-top wiring that app.js does on the index, for pages that don't
   load app.js.
   =========================================================================== */

(() => {
    const PROJECT_ID = 'landing-page-cc574';
    const API_KEY = 'AIzaSyBVg4_5WjOjlA-xfoGAhjqNk75EyMG6sS8';
    const PATH = 'artifacts/arnav-portfolio-v1/public/data/projects';
    const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${PATH}?key=${API_KEY}&pageSize=300`;

    /* ---- Firestore REST value unwrapping -------------------------------- */

    function unwrap(value) {
        if (!value || typeof value !== 'object') return null;
        if ('stringValue' in value) return value.stringValue;
        if ('booleanValue' in value) return value.booleanValue;
        if ('integerValue' in value) return Number(value.integerValue);
        if ('doubleValue' in value) return value.doubleValue;
        if ('timestampValue' in value) return Date.parse(value.timestampValue);
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

    let pending = null;

    window.loadProjectsRest = () => {
        if (pending) return pending;
        pending = (async () => {
            const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            return (json.documents || []).map((d) => {
                const data = unwrapDoc(d.fields || {});
                return { ...data, id: d.name.split('/').pop(), slug: window.slugify(data.title) };
            });
        })();
        // A failed load shouldn't poison every later caller on the page.
        pending.catch(() => { pending = null; });
        return pending;
    };

    /* ---- Page chrome ---------------------------------------------------- */

    let chromeDone = false;

    window.standaloneChrome = () => {
        if (chromeDone) return;
        chromeDone = true;

        if (window.hydrateIcons) window.hydrateIcons(document);
        if (window.Motion) {
            window.Motion.cursor();
            window.Motion.scrollChrome();
            window.Motion.magnetic(document);
            window.Motion.reveal(document);
            document.querySelectorAll('[data-split]').forEach((el) => window.Motion.splitText(el));
        }

        const year = document.getElementById('year');
        if (year) year.textContent = new Date().getFullYear();

        const toTop = document.querySelector('.totop');
        if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

        // The burger only exists below 900px, where .nav-links becomes a drop-down.
        const nav = document.querySelector('.nav');
        const burger = document.getElementById('navBurger');
        if (nav && burger) {
            burger.addEventListener('click', () => {
                const open = nav.classList.toggle('is-open');
                burger.setAttribute('aria-expanded', String(open));
            });
            nav.querySelectorAll('.nav-link').forEach((a) => a.addEventListener('click', () => {
                nav.classList.remove('is-open');
                burger.setAttribute('aria-expanded', 'false');
            }));
        }
    };
})();
