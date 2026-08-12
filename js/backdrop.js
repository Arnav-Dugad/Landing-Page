/* ===========================================================================
   backdrop.js  (classic script)
   The interactive dot matrix behind the page.

   A dot lattice reads as precision rather than decoration, which is why it
   suits paper better than the usual particle soup. Three forces act on it:

     1. a slow diagonal wave              — ambient life
     2. a pointer field                   — dots swell, ink up and lean away
     3. click ripples                     — an expanding ring of displacement

   Everything is one canvas, one rAF subscription (shared with motion.js),
   and it idles entirely when the tab is hidden or the user is off-pointer.
   =========================================================================== */

(() => {
    const canvas = document.getElementById('field');
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const SPACING = 34;          // lattice pitch in CSS px
    const RADIUS = 1.05;         // resting dot radius
    const FIELD = 180;           // pointer influence radius
    const INK = [20, 18, 16];
    const ACCENT = [209, 68, 36];

    let w = 0, h = 0, dpr = 1;
    let cols = 0, rows = 0, offsetX = 0, offsetY = 0;
    let pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, live: false };
    const ripples = [];
    let scrollShift = 0;

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        cols = Math.ceil(w / SPACING) + 2;
        rows = Math.ceil(h / SPACING) + 2;
        // Centre the lattice so it never looks cropped at one edge.
        offsetX = (w - (cols - 1) * SPACING) / 2;
        offsetY = (h - (rows - 1) * SPACING) / 2;
    }

    /* Smootherstep — gentler shoulders than a linear falloff, which is what
       stops the pointer field from looking like a hard circular mask. */
    const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    function draw(time) {
        ctx.clearRect(0, 0, w, h);

        // Pointer chases with inertia so the field lags the cursor slightly.
        pointer.x += (pointer.tx - pointer.x) * 0.14;
        pointer.y += (pointer.ty - pointer.y) * 0.14;

        const t = time * 0.0007;

        for (let i = 0; i < ripples.length; i++) {
            ripples[i].r += 9;
            ripples[i].life -= 0.016;
        }
        while (ripples.length && ripples[0].life <= 0) ripples.shift();

        for (let cy = 0; cy < rows; cy++) {
            for (let cx = 0; cx < cols; cx++) {
                const bx = offsetX + cx * SPACING;
                const by = offsetY + cy * SPACING + scrollShift;

                // 1 — ambient wave
                const wave = Math.sin(bx * 0.011 + by * 0.013 - t) * 0.5 + 0.5;

                let scale = 0.55 + wave * 0.45;
                let alpha = 0.07 + wave * 0.05;
                let dx = 0, dy = 0;
                let tint = 0;

                // 2 — pointer field
                if (pointer.live) {
                    const px = bx - pointer.x;
                    const py = by - pointer.y;
                    const dist = Math.hypot(px, py);
                    if (dist < FIELD) {
                        const f = ease(1 - dist / FIELD);
                        scale += f * 2.6;
                        alpha += f * 0.5;
                        tint = f;
                        if (dist > 0.001) {
                            // Lean away from the cursor — the lattice "breathes".
                            const push = f * 9;
                            dx = (px / dist) * push;
                            dy = (py / dist) * push;
                        }
                    }
                }

                // 3 — click ripples
                for (let i = 0; i < ripples.length; i++) {
                    const rp = ripples[i];
                    const d = Math.hypot(bx - rp.x, by - rp.y);
                    const band = Math.abs(d - rp.r);
                    if (band < 60) {
                        const f = ease(1 - band / 60) * rp.life;
                        scale += f * 2.2;
                        alpha += f * 0.4;
                        tint = Math.max(tint, f);
                    }
                }

                if (alpha <= 0.012) continue;

                const c = tint > 0.01
                    ? [
                        Math.round(INK[0] + (ACCENT[0] - INK[0]) * tint),
                        Math.round(INK[1] + (ACCENT[1] - INK[1]) * tint),
                        Math.round(INK[2] + (ACCENT[2] - INK[2]) * tint)
                    ]
                    : INK;

                ctx.beginPath();
                ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${Math.min(alpha, 0.62)})`;
                ctx.arc(bx + dx, by + dy, RADIUS * scale, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    /* ---- Wiring --------------------------------------------------------- */

    resize();
    window.addEventListener('resize', resize, { passive: true });

    // A gentle parallax: the lattice drifts a fraction of the scroll distance.
    window.addEventListener('scroll', () => {
        scrollShift = -(window.scrollY % SPACING);
    }, { passive: true });

    window.addEventListener('pointermove', (e) => {
        pointer.tx = e.clientX;
        pointer.ty = e.clientY;
        if (!pointer.live) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.live = true; }
    }, { passive: true });

    window.addEventListener('pointerleave', () => { pointer.live = false; });

    window.addEventListener('pointerdown', (e) => {
        if (reduced()) return;
        ripples.push({ x: e.clientX, y: e.clientY, r: 0, life: 1 });
        if (ripples.length > 4) ripples.shift();
    }, { passive: true });

    if (reduced()) {
        // Still render the lattice — just frozen, with no pointer response.
        draw(0);
        window.addEventListener('resize', () => draw(0), { passive: true });
        return;
    }

    let visible = !document.hidden;
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

    const start = () => {
        if (window.onFrame) window.onFrame((t) => { if (visible) draw(t); });
        else requestAnimationFrame(function loop(t) { if (visible) draw(t); requestAnimationFrame(loop); });
    };

    // motion.js defines onFrame; if load order ever changes, fall back gracefully.
    if (window.onFrame) start();
    else window.addEventListener('DOMContentLoaded', start);
})();
