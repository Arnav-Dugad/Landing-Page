/* ===========================================================================
   app.js  (classic script)
   Application chrome: sheet management, toasts, dialogs, the contact form,
   sound, confetti, the intro curtain, clock and keyboard shortcuts.

   This is the last classic script to run, so it owns bootstrapping — it
   turns on the motion engine once the DOM the other modules produced exists.
   =========================================================================== */

(() => {
    /* =====================================================================
       Sheets — open/close with scroll lock and a focus trap
       ===================================================================== */

    const openSheets = [];

    window.openSheet = (sheet) => {
        if (!sheet || sheet.classList.contains('is-open')) return;
        sheet._returnTo = document.activeElement;
        sheet.classList.add('is-open');
        sheet.removeAttribute('aria-hidden');
        openSheets.push(sheet);
        document.body.style.overflow = 'hidden';
        // Focus the first thing worth focusing, not the close button.
        setTimeout(() => {
            const first = sheet.querySelector('input, textarea, select, button:not(.sheet-close)');
            if (first) first.focus({ preventScroll: true });
        }, 120);
    };

    window.closeSheet = (sheet) => {
        if (!sheet || !sheet.classList.contains('is-open')) return;
        sheet.classList.remove('is-open');
        sheet.setAttribute('aria-hidden', 'true');
        const at = openSheets.indexOf(sheet);
        if (at >= 0) openSheets.splice(at, 1);
        if (!openSheets.length) document.body.style.overflow = '';
        if (sheet._returnTo && sheet._returnTo.focus) sheet._returnTo.focus({ preventScroll: true });
    };

    const topSheet = () => openSheets[openSheets.length - 1] || null;

    // Trap Tab inside the topmost sheet so keyboard users can't wander behind it.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const sheet = topSheet();
        if (!sheet) return;
        const focusable = Array.from(sheet.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter((el) => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    /* =====================================================================
       Toasts
       ===================================================================== */

    const toastBox = document.getElementById('toasts');

    function makeToast(message, type, life) {
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');
        const mark = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
        el.innerHTML = `${window.icon(mark, { raw: true, size: 16 })}<span>${window.esc(message)}</span>`;
        toastBox.appendChild(el);

        const dismiss = () => {
            if (!el.isConnected) return;
            el.classList.add('is-out');
            setTimeout(() => el.remove(), 260);
        };
        const timer = setTimeout(dismiss, life);
        return { el, dismiss, timer };
    }

    window.toast = (message, type = 'info') => {
        if (!toastBox) return;
        makeToast(message, type, 3200);
    };

    /* A destructive action deserves a way back. The toast stays up longer and
       carries the undo itself, so nothing has to be confirmed twice. */
    window.toastWithAction = (message, label, run, life = 8000) => {
        if (!toastBox) return;
        const { el, dismiss, timer } = makeToast(message, 'success', life);
        const btn = document.createElement('button');
        btn.className = 'toast-action';
        btn.textContent = label;
        btn.addEventListener('click', async () => {
            clearTimeout(timer);
            btn.disabled = true;
            btn.textContent = '…';
            try { await run(); } catch (e) { window.toast('That did not work', 'error'); }
            dismiss();
        });
        el.appendChild(btn);
    };

    // Back-compat for anything still calling the old name.
    window.showToast = window.toast;

    /* =====================================================================
       Dialogs — a real confirm/prompt, because window.confirm looks cheap
       ===================================================================== */

    function dialog({ title, message, confirm = 'Confirm', danger = false, input = null }) {
        return new Promise((resolve) => {
            const sheet = document.createElement('div');
            sheet.className = 'sheet';
            sheet.innerHTML = `
                <div class="sheet-panel sheet-panel--sm" role="dialog" aria-modal="true" aria-label="${window.esc(title)}">
                    <div class="sheet-head">
                        <h2>${window.esc(title)}</h2>
                        <p>${window.esc(message)}</p>
                    </div>
                    ${input ? `<div class="sheet-body">
                        <div class="field">
                            <input class="input" id="dlgInput" type="${input.password ? 'password' : 'text'}"
                                   placeholder="${window.esc(input.placeholder || '')}"
                                   inputmode="${input.password ? 'numeric' : 'text'}" autocomplete="off">
                        </div>
                    </div>` : ''}
                    <div class="sheet-foot">
                        <button class="btn btn--quiet" data-no>Cancel</button>
                        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${window.esc(confirm)}</button>
                    </div>
                </div>`;
            document.body.appendChild(sheet);

            const field = sheet.querySelector('#dlgInput');
            const finish = (value) => {
                window.closeSheet(sheet);
                setTimeout(() => sheet.remove(), 400);
                resolve(value);
            };

            sheet.querySelector('[data-yes]').addEventListener('click', () => {
                finish(input ? (field ? field.value : '') : true);
            });
            sheet.querySelector('[data-no]').addEventListener('click', () => finish(input ? null : false));
            sheet.addEventListener('click', (e) => { if (e.target === sheet) finish(input ? null : false); });
            sheet.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && input) { e.preventDefault(); finish(field ? field.value : ''); }
            });

            requestAnimationFrame(() => window.openSheet(sheet));
            if (field) setTimeout(() => field.focus(), 200);
        });
    }

    window.confirmAction = (opts) => dialog(opts);
    window.promptAction = (opts) => dialog({ ...opts, input: { placeholder: opts.placeholder, password: opts.password } });

    /* =====================================================================
       Sound — off by default, synthesised so there are no audio assets
       ===================================================================== */

    let audio = null;
    let muted = localStorage.getItem('sound') !== 'on';

    const ctxOf = () => {
        if (!audio) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            audio = new AC();
        }
        if (audio.state === 'suspended') audio.resume();
        return audio;
    };

    function blip(from, to, type, gainValue, duration) {
        if (muted) return;
        const ctx = ctxOf();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2600;
        osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(from, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
        gain.gain.setValueAtTime(gainValue, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    }

    window.playHover = () => blip(520, 700, 'sine', 0.014, 0.06);
    window.playClick = () => blip(680, 260, 'triangle', 0.04, 0.11);

    function paintMute() {
        const btn = document.getElementById('soundToggle');
        if (!btn) return;
        btn.innerHTML = `${window.icon(muted ? 'x' : 'wave', { raw: true, size: 12 })} Sound ${muted ? 'off' : 'on'}`;
    }
    window.toggleSound = () => {
        muted = !muted;
        localStorage.setItem('sound', muted ? 'off' : 'on');
        paintMute();
        if (!muted) { ctxOf(); window.playClick(); }
        window.toast(muted ? 'Sound off' : 'Sound on', 'info');
    };

    document.addEventListener('pointerenter', (e) => {
        if (e.target.closest && e.target.closest('.btn, .chip, .card, .nav-link, .ibtn')) window.playHover();
    }, true);
    document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.btn, .chip, .ibtn, .card')) window.playClick();
    }, true);

    /* =====================================================================
       Confetti — paper-appropriate: ink and accent, no rainbow
       ===================================================================== */

    window.celebrate = () => {
        if (window.motionReduced && window.motionReduced()) return;
        const canvas = document.getElementById('confetti');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const colors = ['#D14424', '#F0623C', '#141210', '#1D6FE0', '#10653F', '#CA8A04'];
        const bits = Array.from({ length: 130 }, () => ({
            x: window.innerWidth / 2 + (Math.random() - 0.5) * 220,
            y: window.innerHeight * 0.42,
            w: 4 + Math.random() * 7,
            h: 3 + Math.random() * 5,
            vx: (Math.random() - 0.5) * 13,
            vy: -6 - Math.random() * 11,
            spin: (Math.random() - 0.5) * 0.34,
            angle: Math.random() * Math.PI * 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 1
        }));

        (function tick() {
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            let alive = false;
            bits.forEach((b) => {
                if (b.life <= 0) return;
                alive = true;
                b.vy += 0.36;
                b.vx *= 0.995;
                b.x += b.vx; b.y += b.vy;
                b.angle += b.spin;
                b.life -= 0.0085;
                ctx.save();
                ctx.translate(b.x, b.y);
                ctx.rotate(b.angle);
                ctx.globalAlpha = Math.max(0, b.life);
                ctx.fillStyle = b.color;
                ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
                ctx.restore();
            });
            if (alive) requestAnimationFrame(tick);
            else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        })();
    };

    /* =====================================================================
       Contact form
       ===================================================================== */

    const contactSheet = document.getElementById('contactSheet');
    const contactForm = document.getElementById('contactForm');

    window.openContact = () => window.openSheet(contactSheet);

    if (contactSheet) {
        contactSheet.addEventListener('click', (e) => {
            if (e.target === contactSheet || e.target.closest('[data-close]')) window.closeSheet(contactSheet);
        });
    }

    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                name: document.getElementById('cName').value.trim(),
                email: document.getElementById('cEmail').value.trim(),
                message: document.getElementById('cMessage').value.trim()
            };
            if (!data.name || !data.email || !data.message) {
                window.toast('Please fill in every field', 'error');
                return;
            }
            const ok = await window.saveMessageToDb(data);
            if (ok) { contactForm.reset(); window.closeSheet(contactSheet); }
        });
    }

    document.querySelectorAll('[data-contact]').forEach((el) => {
        el.addEventListener('click', (e) => { e.preventDefault(); window.openContact(); });
    });

    /* Email chip: copies rather than firing a mailto the user didn't ask for. */
    document.querySelectorAll('[data-copy]').forEach((el) => {
        el.addEventListener('click', async (e) => {
            e.preventDefault();
            const text = el.dataset.copy;
            try {
                await navigator.clipboard.writeText(text);
                window.toast('Email copied to clipboard', 'success');
                el.classList.add('is-popping');
                setTimeout(() => el.classList.remove('is-popping'), 420);
            } catch {
                window.open(`mailto:${text}`, '_self');
            }
        });
    });

    /* =====================================================================
       Detail sheet chrome
       ===================================================================== */

    const detailSheet = document.getElementById('detailSheet');
    if (detailSheet) {
        detailSheet.addEventListener('click', (e) => {
            if (e.target === detailSheet || e.target.closest('.sheet-close')) window.closeProject();
        });
        document.querySelectorAll('[data-detail-nav]').forEach((btn) => {
            btn.addEventListener('click', () => window.detailNav(Number(btn.dataset.detailNav)));
        });
    }

    /* =====================================================================
       Nav, toolbar and misc controls
       ===================================================================== */

    const nav = document.querySelector('.nav');
    const burger = document.getElementById('navBurger');
    if (burger && nav) {
        burger.addEventListener('click', () => {
            const open = nav.classList.toggle('is-open');
            burger.setAttribute('aria-expanded', String(open));
        });
        nav.querySelectorAll('.nav-link').forEach((a) => {
            a.addEventListener('click', () => {
                nav.classList.remove('is-open');
                burger.setAttribute('aria-expanded', 'false');
            });
        });
    }

    const search = document.getElementById('search');
    if (search) {
        let timer = null;
        search.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => window.setSearch(search.value), 130);
        });
    }

    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) sortSelect.addEventListener('change', () => window.setSort(sortSelect.value));

    document.querySelectorAll('.segment button[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => window.setView(btn.dataset.view));
    });

    const lucky = document.getElementById('lucky');
    if (lucky) lucky.addEventListener('click', () => window.randomProject());

    const toTop = document.querySelector('.totop');
    if (toTop) toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    const soundBtn = document.getElementById('soundToggle');
    if (soundBtn) soundBtn.addEventListener('click', window.toggleSound);
    paintMute();

    /* Rail dots scroll to their section. */
    document.querySelectorAll('.rail-dot').forEach((dot) => {
        dot.addEventListener('click', () => {
            document.getElementById(dot.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    /* =====================================================================
       Live clock
       ===================================================================== */

    const clock = document.getElementById('clock');
    if (clock) {
        const tick = () => {
            clock.textContent = new Date().toLocaleTimeString('en-GB', {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        };
        tick();
        setInterval(tick, 1000);
    }

    /* =====================================================================
       Keyboard shortcuts
       ===================================================================== */

    const helpSheet = document.getElementById('helpSheet');
    window.openHelp = () => window.openSheet(helpSheet);
    if (helpSheet) {
        helpSheet.addEventListener('click', (e) => {
            if (e.target === helpSheet || e.target.closest('[data-close]')) window.closeSheet(helpSheet);
        });
    }
    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) helpBtn.addEventListener('click', () => window.openHelp());

    document.addEventListener('keydown', (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
            || document.activeElement?.isContentEditable;

        if (e.key === 'Escape') {
            if (window.paletteOpen && window.paletteOpen()) { window.closePalette(); return; }
            const sheet = topSheet();
            if (!sheet) return;
            if (sheet === detailSheet) window.closeProject();
            else if (sheet.id === 'editorSheet') window.closeEditor();
            else window.closeSheet(sheet);
            return;
        }

        // Single-key shortcuts must never fire while someone is typing, and
        // never steal a browser or OS chord.
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === '/') { e.preventDefault(); search?.focus(); return; }
        if (e.key === '?') { e.preventDefault(); window.openHelp(); return; }

        if (detailSheet && detailSheet.classList.contains('is-open')) {
            if (e.key === 'ArrowLeft')  { e.preventDefault(); window.detailNav(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); window.detailNav(1); }
            return;
        }
        if (topSheet()) return;      // don't act behind an open sheet

        const k = e.key.toLowerCase();
        if (k === 'g') { e.preventDefault(); window.setView(window.PState.view === 'grid' ? 'list' : 'grid'); }
        else if (k === 't') { e.preventDefault(); window.cycleTheme(); }
        else if (k === 'r') { e.preventDefault(); window.randomProject(); }
    });

    /* =====================================================================
       Intro curtain — once per session, and never for reduced motion
       ===================================================================== */

    (function curtain() {
        const el = document.getElementById('curtain');
        if (!el) return;

        const skip = sessionStorage.getItem('intro') === '1'
            || (window.motionReduced && window.motionReduced());

        if (skip) { el.remove(); document.body.classList.remove('is-loading'); return; }

        // Stagger the letters of the name.
        const word = el.querySelector('.curtain-word');
        if (word) {
            const text = word.textContent.trim();
            word.innerHTML = text.split('').map((ch, i) =>
                `<i style="animation-delay:${i * 42}ms">${ch === ' ' ? '&nbsp;' : window.esc(ch)}</i>`).join('');
        }

        sessionStorage.setItem('intro', '1');
        setTimeout(() => {
            el.classList.add('is-done');
            document.body.classList.remove('is-loading');
            setTimeout(() => el.remove(), 1100);
        }, 1500);
    })();

    /* =====================================================================
       Boot the motion engine
       ===================================================================== */

    function boot() {
        window.hydrateIcons(document);

        const M = window.Motion;
        if (!M) return;

        document.querySelectorAll('[data-split]').forEach((el) => M.splitText(el));
        M.reveal(document);
        M.magnetic(document);
        M.tilt(document);
        M.cursor();
        M.scrollChrome();
        M.marquee(document.querySelector('.marquee'));

        const role = document.getElementById('heroRole');
        if (role) {
            M.scramble(role, [
                'building for the web',
                'games, tools & interfaces',
                'front-end engineering',
                'design that ships'
            ]);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
