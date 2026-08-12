/* ===========================================================================
   motion.js  (classic script)
   The motion engine. Everything here is presentation-only and every piece
   no-ops under `prefers-reduced-motion`.

     · reveal()        scroll-triggered entrances (IntersectionObserver)
     · splitText()     word-level mask reveals for display type
     · magnetic()      cursor-attracted buttons
     · tilt()          pointer-tracked 3D card tilt + light sheen
     · cursor()        ink dot + lagging ring that morphs into a label
     · odometer()      rolling-digit counters
     · marquee()       seamless ticker whose speed follows scroll velocity
     · scrollChrome()  progress bar, nav condense, section rail, scroll-to-top
     · scramble()      glyph-scramble text cycler for the hero role line

   One rAF loop drives everything that animates per-frame, so the site never
   runs competing render loops.
   =========================================================================== */

(() => {
    const RM = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => RM.matches;
    window.motionReduced = reduced;

    const FINE = window.matchMedia('(hover: hover) and (pointer: fine)');
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    /* Per-frame subscribers. Anything needing rAF registers here. */
    const frameJobs = new Set();
    let frameRunning = false;
    function onFrame(fn) {
        frameJobs.add(fn);
        if (!frameRunning) {
            frameRunning = true;
            requestAnimationFrame(function loop(t) {
                frameJobs.forEach((job) => job(t));
                requestAnimationFrame(loop);
            });
        }
        return () => frameJobs.delete(fn);
    }
    window.onFrame = onFrame;

    /* =======================================================================
       Scroll reveals
       ===================================================================== */

    let revealObserver = null;

    function reveal(root = document) {
        const targets = root.querySelectorAll('[data-reveal]:not(.is-in)');
        if (reduced()) { targets.forEach((el) => el.classList.add('is-in')); return; }

        if (!revealObserver) {
            revealObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-in');
                    revealObserver.unobserve(entry.target);
                });
            }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
        }
        targets.forEach((el) => revealObserver.observe(el));
    }

    /* Stagger a group of children by index. Cheaper than authoring N delays. */
    function stagger(container, step = 60, startAt = 0) {
        if (!container) return;
        Array.from(container.children).forEach((child, i) => {
            child.style.setProperty('--delay', `${startAt + i * step}ms`);
        });
    }

    /* =======================================================================
       Split text — wraps each word so it can rise out of a mask
       ===================================================================== */

    function splitText(el) {
        if (!el || el.dataset.split === '1') return;
        el.dataset.split = '1';

        // Walk only text nodes so inline <em>/<b> markup inside survives intact.
        const walk = (node) => {
            Array.from(node.childNodes).forEach((child) => {
                if (child.nodeType === Node.TEXT_NODE) {
                    const text = child.textContent;
                    if (!text.trim()) return;
                    const frag = document.createDocumentFragment();
                    text.split(/(\s+)/).forEach((chunk) => {
                        if (!chunk.trim()) { frag.appendChild(document.createTextNode(chunk)); return; }
                        const outer = document.createElement('span');
                        outer.className = 'sp';
                        const inner = document.createElement('i');
                        inner.textContent = chunk;
                        outer.appendChild(inner);
                        frag.appendChild(outer);
                    });
                    child.replaceWith(frag);
                } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('sp')) {
                    walk(child);
                }
            });
        };
        walk(el);

        el.querySelectorAll('.sp > i').forEach((inner, i) => {
            inner.style.setProperty('--d', `${i * 52}ms`);
        });

        if (reduced()) { el.classList.add('is-split-in'); return; }

        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-split-in');
                io.unobserve(entry.target);
            });
        }, { threshold: 0.2 });
        io.observe(el);
    }

    /* =======================================================================
       Magnetic buttons — element drifts toward the cursor, springs back
       ===================================================================== */

    function magnetic(root = document) {
        if (reduced() || !FINE.matches) return;
        root.querySelectorAll('.magnetic:not([data-mag])').forEach((el) => {
            el.dataset.mag = '1';
            const strength = parseFloat(el.dataset.magStrength || '0.32');

            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                const x = e.clientX - r.left - r.width / 2;
                const y = e.clientY - r.top - r.height / 2;
                el.classList.add('is-pulled');
                el.style.transform = `translate(${x * strength}px, ${y * strength * 1.1}px)`;
            });
            el.addEventListener('pointerleave', () => {
                el.classList.remove('is-pulled');
                el.style.transform = '';
            });
        });
    }

    /* =======================================================================
       Card tilt — spring-damped so it never snaps, plus the sheen origin
       ===================================================================== */

    function tilt(root = document) {
        root.querySelectorAll('[data-tilt]:not([data-tilt-on])').forEach((el) => {
            el.dataset.tiltOn = '1';

            // Sheen position is cheap and worth having even without tilt.
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
                el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
            });

            if (reduced() || !FINE.matches) return;

            const state = { rx: 0, ry: 0, tx: 0, ty: 0, active: false };
            let stop = null;

            const run = () => {
                state.rx = lerp(state.rx, state.tx, 0.12);
                state.ry = lerp(state.ry, state.ty, 0.12);
                el.style.transform =
                    `perspective(1100px) rotateX(${state.rx.toFixed(3)}deg) rotateY(${state.ry.toFixed(3)}deg) translateZ(0)`;
                if (!state.active && Math.abs(state.rx) < 0.01 && Math.abs(state.ry) < 0.01) {
                    el.style.transform = '';
                    if (stop) { stop(); stop = null; }
                }
            };

            el.addEventListener('pointerenter', () => {
                state.active = true;
                if (!stop) stop = onFrame(run);
            });
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                const px = (e.clientX - r.left) / r.width - 0.5;
                const py = (e.clientY - r.top) / r.height - 0.5;
                state.ty = clamp(px * 11, -6.5, 6.5);
                state.tx = clamp(-py * 11, -6.5, 6.5);
            });
            el.addEventListener('pointerleave', () => {
                state.active = false;
                state.tx = 0; state.ty = 0;
            });
        });
    }

    /* =======================================================================
       Custom cursor
       ===================================================================== */

    function cursor() {
        if (reduced() || !FINE.matches) return;

        const dot = document.querySelector('.cur-dot');
        const ring = document.querySelector('.cur-ring');
        const label = ring && ring.querySelector('b');
        if (!dot || !ring) return;

        document.body.classList.add('is-cursor');

        let mx = window.innerWidth / 2, my = window.innerHeight / 2;
        let rx = mx, ry = my;

        window.addEventListener('pointermove', (e) => {
            mx = e.clientX; my = e.clientY;
            dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
        }, { passive: true });

        onFrame(() => {
            rx = lerp(rx, mx, 0.16);
            ry = lerp(ry, my, 0.16);
            ring.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0)`;
        });

        // The ring swells and shows a verb over anything meaningfully clickable.
        document.addEventListener('pointerover', (e) => {
            const target = e.target.closest('[data-cursor]');
            if (target) {
                ring.classList.add('is-hot');
                dot.classList.add('is-hidden');
                if (label) label.textContent = target.getAttribute('data-cursor') || '';
            } else {
                ring.classList.remove('is-hot');
                dot.classList.remove('is-hidden');
            }
        });

        // Hide entirely when the pointer leaves the window.
        document.addEventListener('pointerleave', () => {
            dot.style.opacity = '0'; ring.style.opacity = '0';
        });
        document.addEventListener('pointerenter', () => {
            dot.style.opacity = ''; ring.style.opacity = '';
        });
    }

    /* =======================================================================
       Odometer counters
       ===================================================================== */

    function odometer(el, value) {
        if (!el) return;
        const digits = String(Math.max(0, Math.round(value)));

        if (reduced()) { el.textContent = digits; return; }

        // Rebuild only when the digit count changes; otherwise just re-roll.
        if (el.dataset.len !== String(digits.length)) {
            el.dataset.len = String(digits.length);
            el.innerHTML = digits.split('').map(() =>
                `<span class="odo"><u>${Array.from({ length: 10 }, (_, n) => `<i>${n}</i>`).join('')}</u></span>`
            ).join('');
        }

        const cols = el.querySelectorAll('.odo > u');
        digits.split('').forEach((d, i) => {
            const col = cols[i];
            if (!col) return;
            // Small per-column delay makes the roll read as mechanical, not uniform.
            // --odo-h is the digit cell height; translating by an em guess
            // instead would drift and clip on fonts with tall ascenders.
            col.style.transitionDelay = `${i * 55}ms`;
            col.style.transform = `translateY(calc(${Number(d)} * var(--odo-h) * -1))`;
        });
    }

    /* =======================================================================
       Marquee — seamless loop, speed and direction follow the scroll
       ===================================================================== */

    function marquee(el) {
        if (!el) return;
        const track = el.querySelector('.marquee-track');
        if (!track || track.dataset.on === '1') return;
        track.dataset.on = '1';

        // Duplicate content until it comfortably overflows twice. The iteration
        // cap matters: a zero-width track (hidden tab, fonts still loading)
        // would otherwise spin forever.
        const original = track.innerHTML;
        if (!original.trim()) return;
        let copies = 0;
        while (track.scrollWidth < el.offsetWidth * 2 && copies < 12) {
            track.innerHTML += original;
            copies++;
        }
        const half = track.scrollWidth / 2;
        if (!half) return;

        if (reduced()) return;

        let offset = 0;
        let velocity = 0;
        let lastScroll = window.scrollY;
        let hovering = false;

        el.addEventListener('pointerenter', () => { hovering = true; });
        el.addEventListener('pointerleave', () => { hovering = false; });

        window.addEventListener('scroll', () => {
            const now = window.scrollY;
            velocity = clamp((now - lastScroll) * 0.35, -26, 26);
            lastScroll = now;
        }, { passive: true });

        onFrame(() => {
            velocity *= 0.92;                          // decay back to base drift
            const base = hovering ? 0.14 : 0.55;
            offset -= base + velocity * 0.5;
            if (offset <= -half) offset += half;       // wrap seamlessly
            if (offset > 0) offset -= half;
            track.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`;
        });
    }

    /* =======================================================================
       FLIP re-layout

       Filtering used to cross-fade the whole grid, which reads as "the page
       reloaded". FLIP instead measures where every card is, lets the DOM
       change, then plays each card from where it *was* to where it now is —
       so a filter looks like the cards physically rearranging.
       ===================================================================== */

    function flipGrid(container, mutate, { key = 'data-id', duration = 540 } = {}) {
        if (!container) return;
        // No Web Animations API means no FLIP — swap the DOM and move on.
        if (reduced() || typeof Element.prototype.animate !== 'function') { mutate(); return; }

        const before = new Map();
        container.querySelectorAll(`[${key}]`).forEach((el) => {
            before.set(el.getAttribute(key), el.getBoundingClientRect());
        });

        mutate();

        const easing = 'cubic-bezier(.16, 1, .3, 1)';
        let entrants = 0;

        container.querySelectorAll(`[${key}]`).forEach((el) => {
            const first = before.get(el.getAttribute(key));
            const last = el.getBoundingClientRect();
            if (!last.width) return;                    // laid out as display:none

            if (first) {
                const dx = first.left - last.left;
                const dy = first.top - last.top;
                const sx = first.width / last.width;
                const sy = first.height / last.height;

                // Nothing moved — don't burn a composite layer on it.
                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5
                    && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;

                el.animate(
                    [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
                     { transform: 'none' }],
                    { duration, easing }
                );
            } else {
                // A card that wasn't on screen a moment ago rises in, staggered.
                el.animate(
                    [{ opacity: 0, transform: 'translateY(26px) scale(.94)', filter: 'blur(6px)' },
                     { opacity: 1, transform: 'none', filter: 'none' }],
                    { duration, easing, delay: Math.min(entrants, 10) * 38, fill: 'backwards' }
                );
                entrants++;
            }
        });
    }

    /* =======================================================================
       Morphing filter indicator — one pill that travels between chips rather
       than each chip painting its own background.
       ===================================================================== */

    function filterPill(container) {
        if (!container) return;

        let pill = container.querySelector('.filters-pill');
        if (!pill) {
            pill = document.createElement('span');
            pill.className = 'filters-pill';
            pill.setAttribute('aria-hidden', 'true');
            container.prepend(pill);
        }

        const move = (animate = true) => {
            const active = container.querySelector('.chip.is-active');
            if (!active) { pill.style.opacity = '0'; return; }

            pill.style.opacity = '1';
            // offset* is relative to the scrolling container, so this stays
            // correct when the chip row is scrolled horizontally on mobile.
            const next = {
                transform: `translate(${active.offsetLeft}px, ${active.offsetTop}px)`,
                width: `${active.offsetWidth}px`,
                height: `${active.offsetHeight}px`
            };
            if (!animate || reduced()) {
                pill.style.transition = 'none';
                Object.assign(pill.style, next);
                void pill.offsetWidth;
                pill.style.transition = '';
            } else {
                Object.assign(pill.style, next);
            }
        };

        // Fonts landing late change chip widths, so re-measure once they do.
        move(false);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => move(false));
        window.addEventListener('resize', () => move(false), { passive: true });

        return move;
    }

    /* =======================================================================
       Scroll-linked text illumination

       Words brighten as the paragraph travels up the viewport, so reading
       and scrolling are the same gesture. One style write per frame drives
       the whole paragraph — each word works out its own opacity in CSS from
       the shared progress value, rather than JS touching N elements.
       ===================================================================== */

    function illuminate(el) {
        if (!el || el.dataset.lit === '1') return;
        el.dataset.lit = '1';

        // Wrap each word, preserving inline markup like <strong>.
        const wrap = (node) => {
            Array.from(node.childNodes).forEach((child) => {
                if (child.nodeType === Node.TEXT_NODE) {
                    if (!child.textContent.trim()) return;
                    const frag = document.createDocumentFragment();
                    child.textContent.split(/(\s+)/).forEach((chunk) => {
                        if (!chunk.trim()) { frag.appendChild(document.createTextNode(chunk)); return; }
                        const w = document.createElement('span');
                        w.className = 'w';
                        w.textContent = chunk;
                        frag.appendChild(w);
                    });
                    child.replaceWith(frag);
                } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('w')) {
                    wrap(child);
                }
            });
        };
        wrap(el);

        const words = el.querySelectorAll('.w');
        if (!words.length) return;
        words.forEach((w, i) => w.style.setProperty('--i', i));
        el.style.setProperty('--n', words.length);
        el.classList.add('is-lit');

        if (reduced()) { el.style.setProperty('--p', '1'); return; }

        let ticking = false;
        const update = () => {
            ticking = false;
            const rect = el.getBoundingClientRect();
            // 0 when the paragraph's top hits 85% of the viewport, 1 by 35%.
            const from = window.innerHeight * 0.85;
            const to = window.innerHeight * 0.35;
            const p = clamp((from - rect.top) / (from - to), 0, 1);
            el.style.setProperty('--p', p.toFixed(4));
        };

        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(update);
        }, { passive: true });
        window.addEventListener('resize', update, { passive: true });
        update();
    }

    /* =======================================================================
       Scroll-velocity skew — the grid leans very slightly into the direction
       of travel, then settles. Subtle enough to feel like weight, not a trick.
       ===================================================================== */

    function scrollSkew(el, { max = 1.6, strength = 0.045 } = {}) {
        if (!el || reduced() || !FINE.matches) return;

        let last = window.scrollY;
        let velocity = 0;
        let current = 0;

        window.addEventListener('scroll', () => {
            const now = window.scrollY;
            velocity = clamp((now - last) * strength, -max, max);
            last = now;
        }, { passive: true });

        onFrame(() => {
            velocity *= 0.9;
            current = lerp(current, velocity, 0.18);
            if (Math.abs(current) < 0.005) {
                if (el.style.transform) el.style.transform = '';
                return;
            }
            el.style.transform = `skewY(${current.toFixed(3)}deg)`;
        });
    }

    /* =======================================================================
       Scroll chrome: progress, nav condense, section rail, scroll-to-top
       ===================================================================== */

    function scrollChrome() {
        const bar = document.querySelector('.progress');
        const nav = document.querySelector('.nav');
        const rail = document.querySelector('.rail');
        const toTop = document.querySelector('.totop');

        const sections = Array.from(document.querySelectorAll('section[id]'));
        const railDots = rail ? Array.from(rail.querySelectorAll('.rail-dot')) : [];
        const navLinks = Array.from(document.querySelectorAll('.nav-link[href^="#"]'));

        let ticking = false;

        const update = () => {
            ticking = false;
            const y = window.scrollY;
            const max = document.documentElement.scrollHeight - window.innerHeight;

            if (bar) bar.style.width = `${max > 0 ? (y / max) * 100 : 0}%`;
            if (nav) nav.classList.toggle('is-stuck', y > 28);
            if (rail) rail.classList.toggle('is-on', y > window.innerHeight * 0.55);
            if (toTop) toTop.classList.toggle('is-on', y > window.innerHeight * 0.9);

            // Active section = the last one whose top has crossed 40% of the viewport.
            const line = y + window.innerHeight * 0.4;
            let activeId = sections.length ? sections[0].id : null;
            for (const sec of sections) {
                if (sec.offsetTop <= line) activeId = sec.id;
            }
            railDots.forEach((d) => d.classList.toggle('is-active', d.dataset.target === activeId));
            navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${activeId}`));
        };

        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(update);
        }, { passive: true });
        window.addEventListener('resize', update, { passive: true });
        update();
    }

    /* =======================================================================
       Glyph scramble — cycles the hero's role line
       ===================================================================== */

    const GLYPHS = '!<>-_\\/[]{}—=+*^?#§±$%&@';

    function scramble(el, words, hold = 2600) {
        if (!el || !words.length) return;

        if (reduced()) { el.textContent = words[0]; return; }

        let index = 0;

        const settle = (from, to) => new Promise((resolve) => {
            const length = Math.max(from.length, to.length);
            const plan = Array.from({ length }, (_, i) => {
                const start = Math.floor(Math.random() * 18);
                return { from: from[i] || '', to: to[i] || '', start, end: start + Math.floor(Math.random() * 18) + 8 };
            });

            let frame = 0;
            const step = () => {
                let out = '', done = 0;
                for (const ch of plan) {
                    if (frame >= ch.end) { out += ch.to; done++; }
                    else if (frame >= ch.start) {
                        // Re-roll the glyph occasionally so it flickers rather than crawls.
                        if (!ch.glyph || Math.random() < 0.3) ch.glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
                        out += ch.glyph;
                    } else out += ch.from;
                }
                el.textContent = out;
                if (done === plan.length) { resolve(); return; }
                frame++;
                requestAnimationFrame(step);
            };
            step();
        });

        const cycle = async () => {
            const current = el.textContent || '';
            await settle(current, words[index]);
            index = (index + 1) % words.length;
            setTimeout(cycle, hold);
        };
        setTimeout(cycle, 400);
    }

    /* =======================================================================
       Public surface
       ===================================================================== */

    window.Motion = {
        reveal, stagger, splitText, magnetic, tilt, cursor,
        odometer, marquee, scrollChrome, scramble,
        flipGrid, filterPill, scrollSkew, illuminate,
        onFrame, lerp, clamp
    };
})();
