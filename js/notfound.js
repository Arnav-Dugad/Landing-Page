/* ===========================================================================
   notfound.js  (classic script)
   The 404 page: a dot lattice that tears.

   The index's backdrop leans away from the cursor; this one breaks. Each dot
   is a damped spring tied to its home on the grid. The pointer is a moving
   blast radius — dots inside it are thrown outward with real velocity, then
   the springs pull them home with a little overshoot. Move fast and the
   lattice rips open behind you; stop and it knits itself back together.

   With no pointer (touch idle, or keyboard users) a slow phantom wanders
   across the field so the page is never dead. Reduced motion: one static
   frame, no physics.
   =========================================================================== */

(() => {
    const canvas = document.getElementById('tear');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---- Page bits ------------------------------------------------------ */

    const path = document.getElementById('lostPath');
    if (path) path.textContent = decodeURIComponent(location.pathname).slice(0, 60) || '/';

    if (window.standaloneChrome) window.standaloneChrome();

    const random = document.getElementById('lostRandom');
    if (random && window.loadProjectsRest) {
        window.loadProjectsRest().then((all) => {
            const usable = all.filter((p) => p.slug);
            if (!usable.length) return;
            random.hidden = false;
            random.addEventListener('click', () => {
                const p = usable[Math.floor(Math.random() * usable.length)];
                location.href = `./#${encodeURIComponent(p.slug)}`;
            });
        }).catch(() => { /* the button simply stays hidden */ });
    }

    if (!canvas) return;

    /* ---- Lattice -------------------------------------------------------- */

    const ctx = canvas.getContext('2d', { alpha: true });
    const SPACING = 30;
    const RADIUS = 1.15;
    const BLAST = 150;            // pointer influence radius
    const K = 0.045;              // spring stiffness toward home
    const DAMP = 0.86;            // velocity kept per frame

    let INK = [16, 14, 12];
    let ACCENT = [196, 62, 31];
    let ALPHA = 1;

    function readPalette() {
        const cs = getComputedStyle(document.documentElement);
        const rgb = (name, fallback) => {
            const parts = cs.getPropertyValue(name).trim().split(',').map((n) => parseFloat(n));
            return (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) ? parts : fallback;
        };
        INK = rgb('--field-ink', INK);
        ACCENT = rgb('--field-accent', ACCENT);
        const a = parseFloat(cs.getPropertyValue('--field-alpha'));
        ALPHA = Number.isNaN(a) ? 1 : a;
    }

    let w = 0, h = 0, dpr = 1;
    let dots = [];

    function build() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const cols = Math.ceil(w / SPACING) + 1;
        const rows = Math.ceil(h / SPACING) + 1;
        const ox = (w - (cols - 1) * SPACING) / 2;
        const oy = (h - (rows - 1) * SPACING) / 2;

        dots = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const hx = ox + x * SPACING;
                const hy = oy + y * SPACING;
                dots.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0 });
            }
        }
    }

    const pointer = { x: -9999, y: -9999, px: -9999, py: -9999, live: false, lastMove: 0 };

    function draw(time) {
        ctx.clearRect(0, 0, w, h);

        // Phantom pointer: a slow Lissajous wander when nobody is driving.
        const idle = !pointer.live || time - pointer.lastMove > 2600;
        let fx = pointer.x, fy = pointer.y;
        if (idle) {
            const t = time * 0.00028;
            fx = w * (0.5 + 0.34 * Math.sin(t * 1.3));
            fy = h * (0.5 + 0.3 * Math.sin(t * 2.1 + 1));
        }

        // Faster pointer movement hits harder — that's what makes it "tear".
        const speed = idle ? 4 : Math.min(60, Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py));
        pointer.px = pointer.x; pointer.py = pointer.y;
        const force = 0.9 + speed * 0.09;

        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];

            const dx = d.x - fx;
            const dy = d.y - fy;
            const dist = Math.hypot(dx, dy);
            if (dist < BLAST && dist > 0.001) {
                const f = (1 - dist / BLAST);
                const push = f * f * force;
                d.vx += (dx / dist) * push;
                d.vy += (dy / dist) * push;
            }

            // Damped spring back home.
            d.vx = (d.vx + (d.hx - d.x) * K) * DAMP;
            d.vy = (d.vy + (d.hy - d.y) * K) * DAMP;
            d.x += d.vx;
            d.y += d.vy;

            const off = Math.hypot(d.x - d.hx, d.y - d.hy);
            const tint = Math.min(1, off / 34);
            const alpha = Math.min(0.6, 0.1 + tint * 0.5) * ALPHA;
            if (alpha <= 0.01) continue;

            const c = tint > 0.02 ? [
                Math.round(INK[0] + (ACCENT[0] - INK[0]) * tint),
                Math.round(INK[1] + (ACCENT[1] - INK[1]) * tint),
                Math.round(INK[2] + (ACCENT[2] - INK[2]) * tint)
            ] : INK;

            ctx.beginPath();
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
            ctx.arc(d.x, d.y, RADIUS * (1 + tint * 1.4), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    readPalette();
    build();
    window.addEventListener('themechange', () => { readPalette(); if (reduced) draw(0); });
    window.addEventListener('resize', () => { build(); if (reduced) draw(0); }, { passive: true });

    if (reduced) { draw(0); return; }

    window.addEventListener('pointermove', (e) => {
        if (!pointer.live) { pointer.px = e.clientX; pointer.py = e.clientY; }
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.live = true;
        pointer.lastMove = performance.now();
    }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer.live = false; });

    // A tap is a shockwave: every dot nearby gets kicked at once.
    window.addEventListener('pointerdown', (e) => {
        dots.forEach((d) => {
            const dx = d.x - e.clientX, dy = d.y - e.clientY;
            const dist = Math.hypot(dx, dy);
            if (dist > 0.001 && dist < BLAST * 1.8) {
                const kick = (1 - dist / (BLAST * 1.8)) * 14;
                d.vx += (dx / dist) * kick;
                d.vy += (dy / dist) * kick;
            }
        });
    }, { passive: true });

    let visible = !document.hidden;
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

    const loop = (t) => { if (visible) draw(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
})();
