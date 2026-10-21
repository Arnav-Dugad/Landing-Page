/* ===========================================================================
   micro.js  (classic script — loads after app.js)
   The micro-interaction layer. Everything here is additive: it decorates
   what the other modules render, through delegated listeners, and never
   owns layout or data.

     · press      ink ripple from the exact press point + a sprung squeeze
     · focus      one ring that glides between keyboard-focused targets
     · tips       hover-intent tooltips for icon-only controls and [data-tip]
     · copy       copy actions morph into a drawn check + "Copied"
     · toasts     a stacked deck: hover to fan out and pause, swipe to dismiss
     · nav        hides while reading down, returns the moment you scroll up
     · links      underlines draw in from the side the pointer entered
     · inputs     search clear, result-count bump, near-limit counters,
                  invalid-submit shake, busy → check / cross buttons
     · haptics    tiny vibrations on touch devices
     · keycaps    on-screen <kbd> keys depress when you press them
     · images     lazy images blur up; broken ones step aside
     · long-press touch-and-hold a card to open it
     · delight    particle bursts, and one hidden word

   Opt out anywhere with data-micro-off (everything) or
   data-micro-off="press tips" (named features). Under reduced motion only
   the non-motion parts (tooltips, counters, haptic-free feedback) remain.

   Public: window.Micro = { busy, tip, haptic, burst, copied }
   =========================================================================== */

(() => {
    const RM = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => RM.matches;
    const FINE = window.matchMedia('(hover: hover) and (pointer: fine)');
    const COARSE = window.matchMedia('(pointer: coarse)');
    const root = document.documentElement;

    root.classList.add('mi');

    /* data-micro-off="" disables everything inside; a list disables named
       features only. */
    function off(el, feature) {
        const host = el && el.closest && el.closest('[data-micro-off]');
        if (!host) return false;
        const list = host.getAttribute('data-micro-off').trim();
        return !list || list.split(/\s+/).includes(feature);
    }

    const typingIn = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

    /* =====================================================================
       Haptics
       ===================================================================== */

    const PATTERNS = { tap: 8, success: [10, 40, 16], error: [24, 40, 24] };

    function haptic(kind = 'tap') {
        if (!COARSE.matches || reduced() || typeof navigator.vibrate !== 'function') return;
        try { navigator.vibrate(PATTERNS[kind] || PATTERNS.tap); } catch { /* not allowed */ }
    }

    /* =====================================================================
       1. Press physics — ink from the press point, sprung squeeze
       ===================================================================== */

    const PRESS = '.btn, .chip, .ibtn, .card-act, .segment button, .palette-item, .workpill-go, '
        + '.ai-prov, .mailchip, .nav-cmd, .sheet-close, .toast-action, .plat-chip, .lock-chip, [data-press]';

    function inkHost(el) {
        let ink = el.querySelector(':scope > .mi-ink');
        if (!ink) {
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
            ink = document.createElement('span');
            ink.className = 'mi-ink';
            ink.setAttribute('aria-hidden', 'true');
            el.appendChild(ink);
        }
        return ink;
    }

    function ripple(el, x, y) {
        if (reduced() || !el.animate) return;
        const r = el.getBoundingClientRect();
        const px = x === undefined ? r.width / 2 : x - r.left;
        const py = y === undefined ? r.height / 2 : y - r.top;
        const size = Math.hypot(Math.max(px, r.width - px), Math.max(py, r.height - py)) * 2;
        const dot = document.createElement('i');
        dot.style.cssText = `left:${px - size / 2}px;top:${py - size / 2}px;width:${size}px;height:${size}px`;
        inkHost(el).appendChild(dot);
        dot.animate(
            [{ transform: 'scale(0)', opacity: 0.26 }, { transform: 'scale(1)', opacity: 0 }],
            { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
        ).finished.then(() => dot.remove(), () => dot.remove());
    }

    /* The squeeze animates the independent `scale` property through the Web
       Animations API, so it composes with magnetic pull, card tilt and every
       existing transform/transition instead of fighting them. */
    const SPRING = CSS.supports('transition-timing-function', 'linear(0, 1)')
        ? 'linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 19.4%, 1.067, 1.096 24%, 1.106 25.5%, 1.099 27.3%, 1.055 32.5%, 1.004 38.3%, .988 41.8%, .983 45.3%, .993 53.7%, 1.001 61.7%, 1)'
        : 'cubic-bezier(.34, 1.56, .64, 1)';

    let pressed = null;
    const release = () => {
        if (!pressed) return;
        const el = pressed;
        pressed = null;
        if (el._miSqueeze) { el._miSqueeze.cancel(); el._miSqueeze = null; }
        el.animate([{ scale: '.955' }, { scale: '1' }], { duration: 560, easing: SPRING });
    };

    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const el = e.target.closest && e.target.closest(PRESS);
        if (!el || el.disabled || off(el, 'press')) return;
        ripple(el, e.clientX, e.clientY);
        if (!reduced() && el.animate) {
            pressed = el;
            el._miSqueeze = el.animate([{ scale: '1' }, { scale: '.955' }], { duration: 110, easing: 'ease-out', fill: 'forwards' });
        }
        if (e.pointerType === 'touch') haptic('tap');
    }, { passive: true });
    document.addEventListener('pointerup', release, { passive: true });
    document.addEventListener('pointercancel', release, { passive: true });
    window.addEventListener('blur', release);

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = document.activeElement;
        if (!el || !el.matches || !el.matches(PRESS) || off(el, 'press')) return;
        ripple(el);
    });

    /* =====================================================================
       2. Gliding focus ring — keyboard users only
       ===================================================================== */

    const ring = document.createElement('div');
    ring.className = 'mi-focus';
    ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring);

    let ringTarget = null;
    let ringShown = false;

    /* A stretched card opener should ring the whole card, not its title; a
       visually-hidden checkbox or switch rings the box you actually see. */
    const ringHostOf = (el) => {
        if (el.matches('.card-open, .ix-title, .tl-title')) return el.closest('.card, .ix-row, .tl-item') || el;
        if (el.matches('input[type="checkbox"], input[type="radio"]')) {
            const label = el.closest('.check, .switch');
            const seen = label && label.querySelector('.box, .switch-track');
            if (seen) return seen;
        }
        return el;
    };

    function placeRing() {
        if (!ringTarget || !ringTarget.isConnected) { hideRing(); return; }
        const host = ringHostOf(ringTarget);
        const r = host.getBoundingClientRect();
        if (!r.width && !r.height) { hideRing(); return; }
        const cs = getComputedStyle(host);
        ring.style.transform = `translate3d(${r.left - 4}px, ${r.top - 4}px, 0)`;
        ring.style.width = `${r.width + 8}px`;
        ring.style.height = `${r.height + 8}px`;
        const rad = parseFloat(cs.borderTopLeftRadius) || 6;
        ring.style.borderRadius = `${Math.min(rad + 4, (Math.min(r.width, r.height) + 8) / 2)}px`;
    }

    /* Text fields draw their own focus state (border + veil); a ring on top
       would double it. Checkboxes, radios and range sliders still get one. */
    const OWN_FOCUS = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select, [contenteditable="true"]';

    function showRing(el) {
        if (off(el, 'focus') || el.matches(OWN_FOCUS)) { hideRing(); return; }
        const first = !ringShown;
        ringTarget = el;
        if (first) ring.classList.add('is-jump');      // appear in place, don't fly in
        placeRing();
        ring.classList.add('is-on');
        root.classList.add('mi-ring');
        ringShown = true;
        if (first) requestAnimationFrame(() => ring.classList.remove('is-jump'));
    }

    function hideRing() {
        ringTarget = null;
        ringShown = false;
        ring.classList.remove('is-on');
        root.classList.remove('mi-ring');
    }

    document.addEventListener('focusin', (e) => {
        const el = e.target;
        let visible = false;
        try { visible = el.matches(':focus-visible'); } catch { visible = false; }
        if (visible) showRing(el); else hideRing();
    });
    document.addEventListener('focusout', () => {
        // Focus moving to another element fires focusin right after.
        requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) hideRing(); });
    });
    document.addEventListener('pointerdown', hideRing, { passive: true });

    let ringTick = false;
    const reRing = () => {
        if (!ringShown || ringTick) return;
        ringTick = true;
        requestAnimationFrame(() => { ringTick = false; placeRing(); });
    };
    document.addEventListener('scroll', reRing, { passive: true, capture: true });
    window.addEventListener('resize', reRing, { passive: true });

    /* =====================================================================
       3. Tooltips — hover intent, keyboard, edge-aware, one at a time
       ===================================================================== */

    const tipEl = document.createElement('div');
    tipEl.className = 'mi-tip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.id = 'mi-tip';
    tipEl.innerHTML = '<span></span><i></i>';
    document.body.appendChild(tipEl);
    const tipText = tipEl.firstElementChild;
    const tipArrow = tipEl.lastElementChild;

    let tipFor = null;
    let tipTimer = null;
    let tipHideTimer = null;
    let warmUntil = 0;

    /* Icon-only controls get a tooltip from their accessible name; anything
       can opt in with data-tip. Visible text means no tooltip is needed. */
    function tipTextOf(el) {
        if (!el || off(el, 'tips')) return '';
        if (el.hasAttribute('data-tip')) return el.getAttribute('data-tip');
        if (!el.matches('button, a, [role="button"]')) return '';
        const visible = (el.textContent || '').replace(/\s+/g, '').length > 0;
        if (visible) return '';
        return el.dataset.miTitle || el.getAttribute('title') || el.getAttribute('aria-label') || '';
    }

    const tipTarget = (node) => {
        let el = node && node.closest ? node.closest('[data-tip], button, a, [role="button"]') : null;
        while (el) {
            if (tipTextOf(el)) return el;
            el = el.parentElement && el.parentElement.closest('[data-tip], button, a, [role="button"]');
        }
        return null;
    };

    function placeTip(el) {
        const r = el.getBoundingClientRect();
        const t = tipEl.getBoundingClientRect();
        const gap = 10;
        let top = r.top - t.height - gap;
        let below = false;
        if (top < 8) { top = r.bottom + gap; below = true; }
        const cx = r.left + r.width / 2;
        const left = Math.min(window.innerWidth - t.width - 8, Math.max(8, cx - t.width / 2));
        tipEl.classList.toggle('is-below', below);
        tipEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
        tipArrow.style.left = `${Math.max(10, Math.min(t.width - 10, cx - left))}px`;
    }

    function showTip(el, text) {
        clearTimeout(tipHideTimer);
        if (tipFor && tipFor !== el) restoreTitle(tipFor);
        tipFor = el;
        // The native title would double up with ours; park it while shown.
        if (el.hasAttribute('title')) {
            el.dataset.miTitle = el.getAttribute('title');
            el.removeAttribute('title');
        }
        tipText.textContent = text;
        tipEl.classList.remove('is-on');
        tipEl.style.transform = 'translate3d(-9999px, 0, 0)';
        el.setAttribute('aria-describedby', 'mi-tip');
        requestAnimationFrame(() => {
            if (tipFor !== el) return;
            placeTip(el);
            tipEl.classList.add('is-on');
        });
    }

    function restoreTitle(el) {
        if (el && el.dataset.miTitle) {
            el.setAttribute('title', el.dataset.miTitle);
            delete el.dataset.miTitle;
        }
        if (el && el.getAttribute('aria-describedby') === 'mi-tip') el.removeAttribute('aria-describedby');
    }

    function hideTip() {
        clearTimeout(tipTimer);
        if (!tipFor) return;
        warmUntil = Date.now() + 500;          // the next tip shows instantly
        restoreTitle(tipFor);
        tipFor = null;
        tipEl.classList.remove('is-on');
    }

    document.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch') return;
        const el = tipTarget(e.target);
        if (el === tipFor) return;
        clearTimeout(tipTimer);
        if (!el) { if (tipFor) hideTip(); return; }
        const text = tipTextOf(el);
        const delay = Date.now() < warmUntil || tipFor ? 0 : 420;
        if (tipFor) hideTip();
        tipTimer = setTimeout(() => showTip(el, text), delay);
    }, { passive: true });

    document.addEventListener('pointerout', (e) => {
        if (!tipFor) { clearTimeout(tipTimer); return; }
        const to = e.relatedTarget;
        if (to && tipFor.contains(to)) return;
        if (e.target.closest && e.target.closest('[data-tip], button, a, [role="button"]') === tipFor) hideTip();
    }, { passive: true });

    document.addEventListener('focusin', (e) => {
        let visible = false;
        try { visible = e.target.matches(':focus-visible'); } catch { /* old engines */ }
        const el = visible ? tipTarget(e.target) : null;
        if (el && el === e.target) showTip(el, tipTextOf(el));
        else if (tipFor) hideTip();
    });
    document.addEventListener('focusout', () => { if (tipFor) hideTip(); });
    document.addEventListener('pointerdown', () => { if (tipFor) hideTip(); }, { passive: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipFor) hideTip(); });
    window.addEventListener('scroll', () => { if (tipFor) hideTip(); }, { passive: true, capture: true });

    function tip(el, text, ms = 1600) {
        if (!el) return;
        showTip(el, text || tipTextOf(el));
        clearTimeout(tipHideTimer);
        tipHideTimer = setTimeout(() => { if (tipFor === el) hideTip(); }, ms);
    }

    /* =====================================================================
       4. Copy feedback — icon morphs into a drawn check
       ===================================================================== */

    const CHECK = '<svg class="mi-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';

    function copied(btn, label = 'Copied') {
        if (!btn || btn.dataset.miCopied === '1') return;
        btn.dataset.miCopied = '1';
        const svg = btn.querySelector('svg:not(.mi-check)');
        let restore = null;
        if (svg) {
            const size = svg.getAttribute('width') || 16;
            const tmp = document.createElement('span');
            tmp.innerHTML = CHECK.replace(/width="16" height="16"/, `width="${size}" height="${size}"`);
            const check = tmp.firstElementChild;
            svg.replaceWith(check);
            restore = () => { if (check.isConnected) check.replaceWith(svg); };
        }
        if (!reduced()) {
            const flag = document.createElement('span');
            flag.className = 'mi-copied';
            flag.textContent = label;
            flag.setAttribute('aria-hidden', 'true');
            const r = btn.getBoundingClientRect();
            flag.style.left = `${r.left + r.width / 2}px`;
            flag.style.top = `${r.top}px`;
            document.body.appendChild(flag);
            setTimeout(() => flag.remove(), 1100);
        }
        haptic('success');
        setTimeout(() => {
            if (restore) restore();
            delete btn.dataset.miCopied;
        }, 1500);
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-copy], #copyView, [data-share-do="copy"]');
        if (!btn || off(btn, 'copy')) return;
        // Let the real copy handler run first; it may fall back to a prompt.
        setTimeout(() => copied(btn), 30);
    });

    /* =====================================================================
       5. (Theme toggle morph + reveal live in js/theme.js.)
       6. Toast deck — stacked, fans out on hover, swipe to dismiss
       ===================================================================== */

    const toastBox = document.getElementById('toasts');

    if (toastBox && !reduced()) {
        toastBox.classList.add('mi-deck');
        let hovering = false;

        const live = () => Array.from(toastBox.children).filter((t) => t.classList.contains('toast') && !t.classList.contains('mi-gone'));

        function layout() {
            const items = live().reverse();             // newest first
            let y = 0;
            items.forEach((t, i) => {
                t.style.setProperty('--i', String(i));
                t.style.setProperty('--y', `${y}px`);
                t.style.zIndex = String(100 - i);
                t.classList.toggle('mi-hidden', i > 2 && !hovering);
                y += t.offsetHeight + 8;
            });
            toastBox.style.setProperty('--deck-h', `${items.length ? (hovering ? y : (items[0].offsetHeight + Math.min(items.length - 1, 2) * 10)) : 0}px`);
            toastBox.classList.toggle('is-fanned', hovering);
        }

        /* app.js dismisses with is-out → remove() 260ms later. While the deck
           is hovered (or being swiped) we hold that dismissal, so a toast
           never vanishes from under the pointer. */
        function adopt(t) {
            if (t.dataset.miToast) return;
            t.dataset.miToast = '1';
            const life = t.classList.contains('toast--progress') ? 0 : (t.querySelector('.toast-action') ? 8000 : 3200);
            if (life) {
                const bar = document.createElement('span');
                bar.className = 'mi-toast-life';
                bar.style.animationDuration = `${life}ms`;
                t.appendChild(bar);
            }
            const realRemove = t.remove.bind(t);
            t.remove = () => {
                if (hovering && !t.dataset.miForce) { t.dataset.miHeld = '1'; t.classList.remove('is-out'); return; }
                t.classList.add('mi-gone');
                realRemove();
                layout();
            };
            t.addEventListener('pointerdown', (e) => swipeStart(t, e));
        }

        function dismiss(t, dir = 0) {
            t.dataset.miForce = '1';
            t.classList.add('mi-gone');
            const from = getComputedStyle(t).transform;
            const base = from && from !== 'none' ? from : '';
            const anim = t.animate && t.animate(
                [{ transform: `${base} translateX(0px)`, opacity: Number(t.style.opacity || 1) },
                 { transform: `${base} translateX(${dir * 160}px)`, opacity: 0 }],
                { duration: 220, easing: 'ease-in', fill: 'forwards' });
            const done = () => { t.remove(); layout(); };
            if (anim) anim.finished.then(done, done); else done();
        }

        /* Swipe: horizontal drag with velocity. */
        function swipeStart(t, e) {
            if (e.button !== 0 || e.target.closest('button')) return;
            const x0 = e.clientX;
            const t0 = performance.now();
            let dx = 0;
            t.setPointerCapture && t.setPointerCapture(e.pointerId);
            t.classList.add('is-swiping');
            const move = (ev) => {
                dx = ev.clientX - x0;
                t.style.setProperty('--sx', `${dx}px`);
                t.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220));
            };
            const up = () => {
                t.removeEventListener('pointermove', move);
                t.removeEventListener('pointerup', up);
                t.removeEventListener('pointercancel', up);
                t.classList.remove('is-swiping');
                const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
                if (Math.abs(dx) > 90 || v > 0.6) { haptic('tap'); dismiss(t, Math.sign(dx) || 1); }
                else { t.style.removeProperty('--sx'); t.style.opacity = ''; }
            };
            t.addEventListener('pointermove', move);
            t.addEventListener('pointerup', up);
            t.addEventListener('pointercancel', up);
        }

        toastBox.addEventListener('pointerenter', () => { hovering = true; layout(); });
        toastBox.addEventListener('pointerleave', () => {
            hovering = false;
            layout();
            // Release anything that tried to leave while we held it.
            setTimeout(() => {
                if (hovering) return;
                live().forEach((t) => { if (t.dataset.miHeld) { t.classList.add('is-out'); setTimeout(() => t.remove(), 260); } });
            }, 900);
        });

        new MutationObserver((records) => {
            records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList.contains('toast')) adopt(n); }));
            requestAnimationFrame(layout);
        }).observe(toastBox, { childList: true });
    }

    /* =====================================================================
       7. Smart nav — out of the way while reading, back on the way up
       ===================================================================== */

    const nav = document.querySelector('.nav');
    if (nav && !off(nav, 'nav')) {
        let lastY = window.scrollY;
        let ticking = false;
        const busyUi = () => !!document.querySelector('.sheet.is-open, .palette.is-open') || nav.contains(document.activeElement) || nav.classList.contains('is-open');

        const update = () => {
            ticking = false;
            const y = window.scrollY;
            const dy = y - lastY;
            lastY = y;
            let hide = root.classList.contains('mi-nav-up');
            if (y < window.innerHeight * 0.75 || busyUi()) hide = false;
            else if (dy > 7) hide = true;
            else if (dy < -5) hide = false;
            root.classList.toggle('mi-nav-up', hide);
        };
        window.addEventListener('scroll', () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(update);
        }, { passive: true });
        nav.addEventListener('focusin', () => root.classList.remove('mi-nav-up'));
    }

    /* =====================================================================
       8. Link underlines that draw in from the entry side
       ===================================================================== */

    const LINKS = '.detail-prose a, .case-block a, .case-prose a, .footer-col a, .ai-text a, .now-body a, '
        + '.now-block a, .sheet-head p a, .about-copy a, .resume a, .hc-sum a, [data-underline]';

    document.addEventListener('pointerover', (e) => {
        const a = e.target.closest && e.target.closest(LINKS);
        if (!a || off(a, 'links') || (e.relatedTarget && a.contains(e.relatedTarget))) return;
        const r = a.getBoundingClientRect();
        a.classList.add('mi-u');
        a.style.setProperty('--u-origin', e.clientX < r.left + r.width / 2 ? 'left' : 'right');
        requestAnimationFrame(() => a.classList.add('is-u'));
    }, { passive: true });
    document.addEventListener('pointerout', (e) => {
        const a = e.target.closest && e.target.closest(LINKS);
        if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
        const r = a.getBoundingClientRect();
        // Retract toward the side the pointer left by.
        a.style.setProperty('--u-origin', e.clientX < r.left + r.width / 2 ? 'left' : 'right');
        a.classList.remove('is-u');
    }, { passive: true });

    /* =====================================================================
       9. Inputs
       ===================================================================== */

    /* Search: a real clear button (the native one is hidden in CSS). */
    function wireSearch(label) {
        if (!label || label.dataset.miSearch) return;
        const input = label.querySelector('input');
        if (!input) return;
        label.dataset.miSearch = '1';
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'mi-clear';
        clear.setAttribute('aria-label', 'Clear the search');
        clear.innerHTML = window.icon ? window.icon('x', { raw: true, size: 13 }) : '×';
        label.appendChild(clear);
        const paint = () => label.classList.toggle('has-value', !!input.value);
        input.addEventListener('input', paint);
        clear.addEventListener('click', (e) => {
            e.preventDefault();
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            paint();
            input.focus();
        });
        paint();
        // Values set by code (URL-seeded search) don't fire input.
        setTimeout(paint, 400);
    }
    document.querySelectorAll('label.search').forEach(wireSearch);

    /* The result count pulses whenever its number changes. */
    const countEl = document.getElementById('resultCount');
    if (countEl) {
        let last = countEl.textContent;
        new MutationObserver(() => {
            if (countEl.textContent === last) return;
            last = countEl.textContent;
            if (reduced()) return;
            countEl.classList.remove('mi-bump');
            void countEl.offsetWidth;
            countEl.classList.add('mi-bump');
        }).observe(countEl, { childList: true, characterData: true, subtree: true });
    }

    /* Near-limit counters on long fields. */
    document.addEventListener('input', (e) => {
        const el = e.target;
        if (!el.matches || !el.matches('textarea[maxlength], input[maxlength]')) return;
        const max = Number(el.getAttribute('maxlength'));
        if (!max || max < 60) return;
        const host = el.closest('.field') || el.parentElement;
        let counter = host.querySelector(':scope > .mi-count');
        const used = el.value.length;
        if (used < max * 0.8) { if (counter) counter.classList.remove('is-on'); return; }
        if (!counter) {
            counter = document.createElement('span');
            counter.className = 'mi-count';
            counter.setAttribute('aria-live', 'polite');
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
            host.appendChild(counter);
        }
        counter.textContent = `${used} / ${max}`;
        counter.classList.add('is-on');
        counter.classList.toggle('is-full', used >= max);
    });

    /* Invalid submit: shake the first offender and put the caret in it. */
    let shakeQueued = false;
    document.addEventListener('invalid', (e) => {
        const el = e.target;
        if (shakeQueued) return;
        shakeQueued = true;
        requestAnimationFrame(() => { shakeQueued = false; });
        shake(el.closest('.field') || el);
        haptic('error');
    }, true);

    function shake(el) {
        if (!el || reduced() || !el.animate) return;
        el.animate([
            { transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' },
            { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }
        ], { duration: 380, easing: 'ease-out' });
    }

    /* busy(btn): the label gives way to a spinner at the same width, then
       done(true) draws a check, done(false) shakes a cross; the original
       content comes back on its own. */
    const SPIN = '<svg class="mi-spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';
    const CROSS = '<svg class="mi-check mi-cross" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';

    function busy(btn) {
        if (!btn) return { done() {} };
        if (btn._miBusy) return btn._miBusy;
        const html = btn.innerHTML;
        const width = btn.getBoundingClientRect().width;
        const wasDisabled = btn.disabled;
        btn.style.minWidth = `${Math.ceil(width)}px`;
        btn.classList.add('mi-busy');
        btn.setAttribute('aria-busy', 'true');
        btn.disabled = true;
        btn.innerHTML = `<span class="mi-busy-in">${SPIN}</span>`;
        const restore = () => {
            btn.innerHTML = html;
            btn.classList.remove('mi-busy', 'is-ok', 'is-bad');
            btn.style.minWidth = '';
            btn.removeAttribute('aria-busy');
            btn.disabled = wasDisabled;
            btn._miBusy = null;
            if (window.hydrateIcons) window.hydrateIcons(btn);
        };
        const handle = {
            done(ok = true) {
                if (!btn.isConnected) return;
                btn.innerHTML = `<span class="mi-busy-in">${ok ? CHECK : CROSS}</span>`;
                btn.classList.add(ok ? 'is-ok' : 'is-bad');
                haptic(ok ? 'success' : 'error');
                if (!ok) shake(btn);
                setTimeout(restore, ok ? 900 : 1100);
            },
            cancel: restore
        };
        btn._miBusy = handle;
        return handle;
    }

    /* =====================================================================
       11. Keycap echo
       ===================================================================== */

    const KEYNAMES = {
        escape: ['esc', 'escape'], arrowleft: ['←'], arrowright: ['→'], arrowup: ['↑'], arrowdown: ['↓'],
        enter: ['↵', 'enter', 'return'], ' ': ['space'], meta: ['⌘', 'cmd'], control: ['ctrl', '⌘'], shift: ['⇧', 'shift']
    };

    function keyLabels(e) {
        const k = e.key.toLowerCase();
        const base = KEYNAMES[k] ? KEYNAMES[k].slice() : [k];
        if (e.metaKey || e.ctrlKey) base.slice().forEach((b) => base.push(`⌘${b}`, `ctrl${b}`, `ctrl+${b}`));
        return new Set(base);
    }

    const downKeys = new Set();
    document.addEventListener('keydown', (e) => {
        if (reduced() || e.repeat) return;
        const labels = keyLabels(e);
        document.querySelectorAll('kbd').forEach((kbd) => {
            const t = kbd.textContent.replace(/\s+/g, '').toLowerCase();
            if (labels.has(t) && kbd.offsetParent) { kbd.classList.add('mi-key-down'); downKeys.add(kbd); }
        });
    });
    const keysUp = () => { downKeys.forEach((k) => k.classList.remove('mi-key-down')); downKeys.clear(); };
    document.addEventListener('keyup', () => setTimeout(keysUp, 90));
    window.addEventListener('blur', keysUp);

    /* =====================================================================
       12. Images — blur-up on load, step aside when broken
       ===================================================================== */

    /* No CSS transition is declared on images (other modules animate their
       own transforms); the blur-up is a one-off Web Animation instead. */
    const watched = (img) => img.tagName === 'IMG' && (img.loading === 'lazy' || img.hasAttribute('data-blur'));
    const markLoaded = (img, animate = true) => {
        if (img.classList.contains('mi-loaded')) return;
        img.classList.add('mi-loaded');
        if (animate && !reduced() && img.animate) {
            img.animate([{ opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)' }],
                { duration: 620, easing: 'cubic-bezier(.22,.61,.36,1)' });
        }
    };

    document.addEventListener('load', (e) => { if (watched(e.target)) markLoaded(e.target); }, true);
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (img.tagName !== 'IMG' || !watched(img)) return;
        img.classList.add('mi-broken');
        if (img.parentElement) img.parentElement.classList.add('mi-img-broken');
    }, true);
    // Anything that finished before this script ran.
    root.classList.add('mi-img');
    document.querySelectorAll('img').forEach((img) => {
        if (!watched(img)) return;
        if (img.complete && img.naturalWidth) markLoaded(img, false);
        else if (img.complete) img.classList.add('mi-broken');
    });
    // Images rendered later but already cached may complete before 'load' is observed.
    setInterval(() => {
        document.querySelectorAll('img[loading="lazy"]:not(.mi-loaded):not(.mi-broken), img[data-blur]:not(.mi-loaded):not(.mi-broken)')
            .forEach((img) => { if (img.complete && img.naturalWidth) markLoaded(img, false); });
    }, 1200);

    /* =====================================================================
       13. Long-press a card on touch to open it
       ===================================================================== */

    const HOLD = '.card, .ix-row, .tl-item, .rel-card';
    let hold = null;

    function cancelHold() {
        if (!hold) return;
        clearTimeout(hold.timer);
        hold.dot.remove();
        hold = null;
    }

    document.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        const el = e.target.closest && e.target.closest(HOLD);
        if (!el || off(el, 'hold') || e.target.closest('a, button:not(.card-open):not(.ix-title):not(.tl-title)')) return;
        const id = el.dataset.id || el.dataset.open;
        if (!id || !window.openProject) return;
        cancelHold();
        const dot = document.createElement('span');
        dot.className = 'mi-hold';
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
        document.body.appendChild(dot);
        hold = {
            x: e.clientX, y: e.clientY, dot,
            timer: setTimeout(() => {
                const h = hold;
                hold = null;
                if (!h) return;
                h.dot.classList.add('is-done');
                setTimeout(() => h.dot.remove(), 300);
                haptic('success');
                swallowClick = true;
                setTimeout(() => { swallowClick = false; }, 600);
                window.openProject(id);
            }, 450)
        };
    }, { passive: true });
    document.addEventListener('pointermove', (e) => {
        if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) cancelHold();
    }, { passive: true });
    document.addEventListener('pointerup', cancelHold, { passive: true });
    document.addEventListener('pointercancel', cancelHold, { passive: true });
    window.addEventListener('scroll', cancelHold, { passive: true });

    // The click that ends a long-press must not open the project twice.
    let swallowClick = false;
    document.addEventListener('click', (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    document.addEventListener('contextmenu', (e) => { if (hold) e.preventDefault(); });

    /* =====================================================================
       14. Delight — bursts, and one hidden word
       ===================================================================== */

    function accentColors() {
        const cs = getComputedStyle(root);
        return ['--accent', '--accent-lift', '--ink', '--tone-blue-a', '--tone-emerald-a', '--tone-yellow-b']
            .map((v) => cs.getPropertyValue(v).trim()).filter(Boolean);
    }

    function burst(el, { colors = null, count = 18, spread = 70 } = {}) {
        if (reduced()) return;
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const palette = colors && colors.length ? colors : accentColors();
        for (let i = 0; i < count; i++) {
            const p = document.createElement('i');
            p.className = 'mi-burst';
            const size = 4 + Math.random() * 5;
            p.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 0.45)}px;background:${palette[i % palette.length]}`;
            document.body.appendChild(p);
            const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
            const d = spread * (0.6 + Math.random() * 0.7);
            p.animate([
                { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
                { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 18}px)) scale(.4) rotate(${Math.random() * 360}deg)`, opacity: 0 }
            ], { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' })
                .finished.then(() => p.remove(), () => p.remove());
        }
    }

    /* Type "arnav" (outside a field) and the dot lattice waves hello. */
    let typed = '';
    document.addEventListener('keydown', (e) => {
        if (typingIn(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
        typed = (typed + e.key.toLowerCase()).slice(-5);
        if (typed !== 'arnav') return;
        typed = '';
        if (!reduced()) {
            const steps = 16;
            for (let i = 0; i <= steps; i++) {
                setTimeout(() => {
                    const x = (i / steps) * window.innerWidth;
                    const y = window.innerHeight / 2 + Math.sin((i / steps) * Math.PI * 2) * window.innerHeight * 0.22;
                    // backdrop.js turns window pointerdowns into lattice ripples.
                    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y }));
                }, i * 55);
            }
        }
        setTimeout(() => window.celebrate && window.celebrate(), 500);
        if (window.toast) window.toast('Hello to you too.', 'success');
    });

    window.Micro = { busy, tip, haptic, burst, copied, ripple, shake };
})();
