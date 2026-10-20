/* ===========================================================================
   now.js  (classic script)
   The /now page: what's being built, read and learned at the moment.

   Content lives at the edge (GET /api/now, written from the admin panel on
   the index), so it can change without a deploy. Text is plain: blank lines
   make paragraphs, single newlines are kept, and bare URLs become links —
   always escaped first, so nothing in the record can inject markup.
   =========================================================================== */

(() => {
    const root = document.getElementById('nowRoot');
    const updated = document.getElementById('nowUpdated');
    if (!root) return;

    const esc = (v) => window.esc(v);

    const SECTIONS = [
        ['building', 'Building', 'rocket'],
        ['reading', 'Reading', 'book'],
        ['learning', 'Learning', 'cap']
    ];

    /* Escape, then link URLs. The URL pattern runs over escaped text, so an
       "&amp;" inside a link is still a valid attribute value. */
    function linkify(escaped) {
        return escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (raw) => {
            const trail = raw.match(/[.,;:!?)\]]+$/);
            const url = trail ? raw.slice(0, -trail[0].length) : raw;
            const shown = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${shown}</a>${trail ? trail[0] : ''}`;
        });
    }

    function prose(text) {
        return String(text || '').trim().split(/\n\s*\n/)
            .filter((p) => p.trim())
            .map((p) => `<p>${linkify(esc(p.trim())).replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    function empty(title, message) {
        root.className = 'now-grid now-grid--empty';
        root.innerHTML = `
            <div class="empty">
                ${window.icon('clock', { raw: true, size: 30 })}
                <h3>${esc(title)}</h3>
                <p>${esc(message)}</p>
                <a class="btn btn--ghost" href="./#work" style="margin-top:22px">
                    ${window.icon('arrow-left', { raw: true, size: 16 })} See the work instead
                </a>
            </div>`;
    }

    function render(data) {
        const filled = SECTIONS.filter(([key]) => String(data[key] || '').trim());
        const note = String(data.note || '').trim();

        if (updated) {
            updated.textContent = data.updatedAt
                ? `Updated ${window.relativeTime(new Date(data.updatedAt).toISOString())} · ${new Date(data.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                : 'Not dated';
        }

        if (!filled.length && !note) {
            empty('Nothing posted yet', 'There is no update here at the moment — check back soon.');
            return;
        }

        root.className = 'now-grid';
        root.innerHTML = `
            ${filled.map(([key, label, icon], i) => `
                <section class="now-card" data-reveal="up" style="--delay:${i * 90}ms">
                    <header>
                        <span class="now-ic">${window.icon(icon, { raw: true, size: 18 })}</span>
                        <h2>${label}</h2>
                    </header>
                    <div class="now-prose">${prose(data[key])}</div>
                </section>`).join('')}
            ${note ? `
                <section class="now-note" data-reveal="up" style="--delay:${filled.length * 90}ms">
                    <h2>A note</h2>
                    <div class="now-prose">${prose(note)}</div>
                </section>` : ''}`;

        if (window.Motion) window.Motion.reveal(root);
    }

    if (window.standaloneChrome) window.standaloneChrome();

    if (!window.EDGE) {
        if (updated) updated.textContent = 'Live updates unavailable here';
        empty('Not available on this mirror',
            'The Now page is served from the main site. Open www.arnavdugad.in/now to read it.');
        return;
    }

    window.edgeFetch('/api/now')
        .then((data) => render(data || {}))
        .catch((e) => {
            console.error('Now page load failed:', e);
            if (updated) updated.textContent = 'Could not load';
            empty('Could not load the update', 'Something went wrong reaching the server. Try again in a moment.');
        });
})();
