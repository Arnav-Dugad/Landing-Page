/* ===========================================================================
   reorder.js  (classic script)
   Drag-to-reorder for admin mode, persisted to each project's `order` field.

   Pointer Events throughout (one code path for mouse, touch and pen). The
   dragged card follows the cursor while its siblings shuffle around it using
   FLIP — measure before the DOM moves, invert the delta, then play it out —
   so the rearrangement animates instead of snapping.

   Reordering is only offered with no filter and no search active. Writing
   1..n over a filtered subset would scramble it against the projects you
   can't see, and a reorder that silently corrupts hidden data is worse than
   no reorder at all.
   =========================================================================== */

(() => {
    const grid = document.getElementById('grid');
    if (!grid) return;

    let card = null;            // the card being dragged
    let baseRect = null;        // its untransformed rect, recached after each move
    let grab = { x: 0, y: 0 };  // pointer offset inside the card
    let handleEl = null;
    let pointerId = null;
    let moved = false;

    const cards = () => Array.from(grid.querySelectorAll('.card'));

    function canReorder() {
        if (!window.isAdmin) return false;
        const s = window.PState || {};
        return s.filter === 'all' && !String(s.search || '').trim();
    }

    /* ---- FLIP ---------------------------------------------------------- */

    function measure() {
        const map = new Map();
        cards().forEach((el) => map.set(el, el.getBoundingClientRect()));
        return map;
    }

    function play(before) {
        cards().forEach((el) => {
            if (el === card) return;
            const first = before.get(el);
            if (!first) return;
            const last = el.getBoundingClientRect();
            const dx = first.left - last.left;
            const dy = first.top - last.top;
            if (!dx && !dy) return;

            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            // Force the inverted position to commit before transitioning it away.
            void el.offsetWidth;
            el.style.transition = 'transform .34s cubic-bezier(.16,1,.3,1)';
            el.style.transform = '';
        });
    }

    function clearFlip() {
        cards().forEach((el) => {
            if (el === card) return;
            el.style.transition = '';
            el.style.transform = '';
        });
    }

    /* ---- Drag ---------------------------------------------------------- */

    function recacheBase() {
        const prev = card.style.transform;
        card.style.transform = 'none';
        baseRect = card.getBoundingClientRect();
        card.style.transform = prev;
    }

    function follow(e) {
        const x = e.clientX - grab.x - baseRect.left;
        const y = e.clientY - grab.y - baseRect.top;
        card.style.transform = `translate(${x}px, ${y}px) scale(1.03)`;
    }

    function start(el, handle, e) {
        card = el;
        handleEl = handle;
        pointerId = e.pointerId;
        moved = false;

        const rect = card.getBoundingClientRect();
        grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        baseRect = rect;

        grid.classList.add('is-reordering');
        card.classList.add('is-dragging');
        try { handle.setPointerCapture(pointerId); } catch { /* older engines */ }

        follow(e);
    }

    function move(e) {
        if (!card) return;
        moved = true;
        follow(e);

        // Which sibling is the pointer currently over?
        const over = cards().find((el) => {
            if (el === card) return false;
            const r = el.getBoundingClientRect();
            return e.clientX >= r.left && e.clientX <= r.right
                && e.clientY >= r.top && e.clientY <= r.bottom;
        });
        if (!over) return;

        const r = over.getBoundingClientRect();
        // List view stacks vertically, grid flows horizontally — pick the axis
        // that actually separates the two cards.
        const vertical = grid.classList.contains('is-list');
        const past = vertical
            ? e.clientY > r.top + r.height / 2
            : e.clientX > r.left + r.width / 2;

        const target = past ? over.nextElementSibling : over;
        if (target === card) return;

        const before = measure();
        grid.insertBefore(card, target);
        play(before);
        recacheBase();
        follow(e);
    }

    async function end() {
        if (!card) return;

        const dragged = card;
        const ids = cards().map((el) => el.dataset.id);

        dragged.style.transition = 'transform .34s cubic-bezier(.16,1,.3,1)';
        dragged.style.transform = '';
        dragged.classList.remove('is-dragging');
        grid.classList.remove('is-reordering');

        setTimeout(() => { dragged.style.transition = ''; clearFlip(); }, 360);

        try { handleEl.releasePointerCapture(pointerId); } catch { /* already gone */ }

        const didMove = moved;
        card = null; handleEl = null; pointerId = null; baseRect = null;

        if (!didMove) return;

        // Custom order is the only sort where the new positions are visible,
        // so switch to it — otherwise the drag appears to do nothing.
        if (window.PState.sort !== 'order') {
            window.PState.sort = 'order';
            const sel = document.getElementById('sortSelect');
            if (sel) sel.value = 'order';
        }
        // Optimistic: keep the dragged layout until the snapshot confirms it.
        ids.forEach((id, i) => {
            const p = (window.getProjects ? window.getProjects() : []).find((x) => String(x.id) === String(id));
            if (p) p.order = i + 1;
        });

        await window.reorderProjectsInDb(ids);
    }

    /* ---- Wiring -------------------------------------------------------- */

    grid.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('[data-drag]');
        if (!handle || e.button !== 0) return;
        const el = handle.closest('.card');
        if (!el) return;

        if (!canReorder()) {
            window.toast('Clear the search and filters first to reorder', 'info');
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        start(el, handle, e);
    });

    grid.addEventListener('pointermove', (e) => {
        if (card && e.pointerId === pointerId) { e.preventDefault(); move(e); }
    });

    grid.addEventListener('pointerup', (e) => { if (card && e.pointerId === pointerId) end(); });
    grid.addEventListener('pointercancel', (e) => { if (card && e.pointerId === pointerId) end(); });

    // A drag that ends on the handle would otherwise open the project.
    grid.addEventListener('click', (e) => {
        if (e.target.closest('[data-drag]')) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    window.canReorder = canReorder;
})();
