/* ===========================================================================
   theme.js  (classic script)
   Light / Dark / System theme switching.

   The *initial* theme is set by a tiny inline script in <head> so the page
   never paints the wrong colours first. This file owns everything after
   that: the toggle, persistence, following the system when the user hasn't
   chosen, and telling the canvas backdrop to re-read its palette.
   =========================================================================== */

(() => {
    const KEY = 'theme';
    const ORDER = ['system', 'light', 'dark'];
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
    const MARK = { system: 'monitor', light: 'sun', dark: 'moon' };

    const pref = () => {
        try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
    };
    const resolve = (p) => (p === 'system' ? (media.matches ? 'dark' : 'light') : p);

    function apply(p, { announce = false } = {}) {
        const active = resolve(p);
        const root = document.documentElement;

        root.dataset.theme = active;
        root.dataset.themePref = p;
        try { localStorage.setItem(KEY, p); } catch { /* private mode */ }

        // Keep the browser chrome in step with the page.
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content',
                getComputedStyle(root).getPropertyValue('--paper').trim() || (active === 'dark' ? '#131110' : '#F7F5F0'));
        }

        paintButtons(p);

        // The dot lattice paints with raw RGB, so it can't inherit tokens.
        window.dispatchEvent(new CustomEvent('themechange', { detail: { pref: p, theme: active } }));

        if (announce && window.toast) window.toast(`Theme: ${LABEL[p]}`, 'info');
    }

    function paintButtons(p) {
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            const showLabel = btn.hasAttribute('data-theme-label');
            const svg = window.icon(MARK[p], { raw: true, size: btn.dataset.size || 16 });
            btn.innerHTML = showLabel ? `${svg} ${LABEL[p]}` : svg;
            btn.setAttribute('aria-label', `Theme: ${LABEL[p]} — click to change`);
            btn.setAttribute('title', `Theme: ${LABEL[p]}`);
        });
    }

    /* Cycle System → Light → Dark → System. Three states rather than two so
       "follow my OS" stays reachable once someone has picked a side. */
    window.cycleTheme = () => {
        const next = ORDER[(ORDER.indexOf(pref()) + 1) % ORDER.length];
        apply(next, { announce: true });
    };

    window.setTheme = (p) => apply(ORDER.includes(p) ? p : 'system', { announce: true });
    window.getThemePref = pref;
    window.getTheme = () => resolve(pref());

    // Follow the OS live, but only while the user is on "system".
    const onSystemChange = () => { if (pref() === 'system') apply('system'); };
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);

    function wire() {
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            if (btn.dataset.themeWired === '1') return;
            btn.dataset.themeWired = '1';
            btn.addEventListener('click', window.cycleTheme);
        });
        apply(pref());
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
})();
