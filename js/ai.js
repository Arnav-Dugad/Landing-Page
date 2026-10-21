/* ===========================================================================
   ai.js  (classic script) — admin only
   The AI tools: Claude, Gemini or ChatGPT, chosen per call.

     · Ask my portfolio   a chat that knows every project and suggests what
                          to improve (the server injects the project digest)
     · Improve with AI    rewrites a project's copy + case study from its
                          README; every change is reviewed before it lands
     · Search terms       synonyms and concepts per project, so visitor
                          search works by idea, not just by literal words
     · Alt text           describes screenshots for screen readers

   No key ever touches the browser. Every call goes to the Worker
   (/api/ai) with the admin's Firebase ID token; the Worker verifies the
   token against Google's keys and the admin address, then calls the
   provider with a key held in Worker secrets.
   =========================================================================== */

(() => {
    const esc = window.esc;
    const PROVIDERS = [
        { key: 'claude', name: 'Claude', by: 'Anthropic', secret: 'ANTHROPIC_API_KEY' },
        { key: 'gemini', name: 'Gemini', by: 'Google', secret: 'GEMINI_API_KEY' },
        { key: 'openai', name: 'ChatGPT', by: 'OpenAI', secret: 'OPENAI_API_KEY' }
    ];

    const store = {
        get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
    };

    let provider = store.get('ai:provider', 'claude');
    let models = store.get('ai:models', { claude: '', gemini: '', openai: '' });
    let config = null;          // { providers: { claude: { configured, defaultModel } … } }
    let history = [];

    const nameOf = (key) => (PROVIDERS.find((p) => p.key === key) || PROVIDERS[0]).name;

    /* =====================================================================
       Transport
       ===================================================================== */

    async function call(task, input) {
        if (!window.isAdmin) throw new Error('Sign in as admin first');
        if (!window.EDGE) throw new Error('AI tools run on the live Cloudflare site, not this host');
        const token = await window.adminIdToken();
        const body = { provider, task, ...input };
        if (models[provider]) body.model = models[provider];
        try {
            const res = await window.edgeFetch('/api/ai', { method: 'POST', body, token });
            return res.result;
        } catch (e) {
            if (e.status === 503) {
                const p = PROVIDERS.find((x) => x.key === provider);
                throw new Error(`${p.name} isn't set up — add ${p.secret} as a Worker secret`);
            }
            if (e.status === 401) throw new Error('The server did not accept your sign-in — sign out and in again');
            throw e;
        }
    }

    async function loadConfig() {
        if (!window.isAdmin || !window.EDGE) return null;
        try {
            const token = await window.adminIdToken();
            config = await window.edgeFetch('/api/ai/config', { token });
        } catch (e) {
            console.error('AI config failed:', e);
            config = null;
        }
        return config;
    }

    /* A button that shows it's working and can't be double-fired. */
    async function busy(btn, run) {
        if (!btn || btn.disabled) return;
        const html = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('is-busy');
        const svg = btn.querySelector('svg');
        if (svg) svg.classList.add('is-spinning');
        try { return await run(); }
        catch (e) { window.toast(e.message || 'That did not work', 'error'); return null; }
        finally { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = html; }
    }

    /* =====================================================================
       Studio sheet: provider picker, chat, tools
       ===================================================================== */

    const sheet = document.getElementById('aiSheet');
    const providerBox = document.getElementById('aiProviders');
    const log = document.getElementById('aiLog');
    const form = document.getElementById('aiForm');
    const input = document.getElementById('aiInput');
    const suggest = document.getElementById('aiSuggest');
    const modelBox = document.getElementById('aiModels');

    const SUGGESTIONS = [
        'Which projects have the weakest descriptions, and how would you rewrite them?',
        'What should I feature first, and why?',
        'Which three projects deserve a case study?',
        'What is missing from my portfolio for a front-end role?',
        'Give me a sharper one-line intro for the hero.'
    ];

    function paintProviders() {
        if (!providerBox) return;
        providerBox.innerHTML = PROVIDERS.map((p) => {
            const c = config && config.providers && config.providers[p.key];
            const ready = c ? c.configured : null;
            return `<button type="button" role="radio" aria-checked="${provider === p.key}"
                        class="ai-prov ${provider === p.key ? 'is-on' : ''} ${ready === false ? 'is-off' : ''}" data-provider="${p.key}">
                <b>${p.name}</b>
                <small>${ready === false ? 'No key set' : (c && (models[p.key] || c.defaultModel)) || p.by}</small>
            </button>`;
        }).join('');
    }

    function paintModels() {
        if (!modelBox) return;
        modelBox.innerHTML = PROVIDERS.map((p) => {
            const def = config && config.providers && config.providers[p.key] ? config.providers[p.key].defaultModel : '';
            return `<label class="field"><span>${p.name}</span>
                <input class="input" data-model="${p.key}" value="${esc(models[p.key] || '')}" placeholder="${esc(def || 'default')}" spellcheck="false"></label>`;
        }).join('');
    }

    /* A small, safe markdown subset: escape everything first, then allow
       bold, inline code, headings and lists. Project names become links. */
    function md(text) {
        const lines = esc(text).split('\n');
        let html = '', list = null;
        const close = () => { if (list) { html += `</${list}>`; list = null; } };
        lines.forEach((raw) => {
            const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
            let m;
            if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${m[1]}</li>`; }
            else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${m[1]}</li>`; }
            else if ((m = line.match(/^#{1,4}\s+(.*)$/))) { close(); html += `<h5>${m[1]}</h5>`; }
            else if (!line.trim()) { close(); }
            else { close(); html += `<p>${line}</p>`; }
        });
        close();

        // Link the first mention of each project title (text nodes only).
        const titles = (window.getProjects ? window.getProjects() : [])
            .filter((p) => String(p.title || '').length >= 3)
            .sort((a, b) => String(b.title).length - String(a.title).length);
        const done = new Set();
        return html.split(/(<[^>]+>)/).map((chunk) => {
            if (chunk.startsWith('<')) return chunk;
            let out = chunk;
            titles.forEach((p) => {
                if (done.has(p.id)) return;
                const t = esc(p.title);
                const at = out.indexOf(t);
                if (at === -1) return;
                done.add(p.id);
                out = `${out.slice(0, at)}\u0000${p.id}\u0001${t}\u0002${out.slice(at + t.length)}`;
            });
            return out.replace(/\u0000([^\u0001]+)\u0001([^\u0002]+)\u0002/g,
                (_, id, t) => `<button type="button" class="ai-ref" data-ai-open="${esc(id)}">${t}</button>`);
        }).join('');
    }

    function paintLog() {
        if (!log) return;
        if (!history.length) {
            log.innerHTML = `<div class="ai-empty">${window.icon('sparkles', { raw: true, size: 22 })}
                <p>Ask anything about the portfolio. ${esc(nameOf(provider))} sees every project's copy, tags and status.</p></div>`;
        } else {
            log.innerHTML = history.map((m) => `
                <div class="ai-msg ai-msg--${m.role}${m.error ? ' is-error' : ''}">
                    ${m.role === 'assistant' ? `<span class="ai-who">${esc(m.by || nameOf(provider))}</span>` : ''}
                    <div class="ai-text">${m.role === 'assistant' ? md(m.content) : `<p>${esc(m.content)}</p>`}</div>
                </div>`).join('');
        }
        log.scrollTop = log.scrollHeight;
        if (suggest) {
            suggest.innerHTML = history.length ? '' : SUGGESTIONS.map((s) =>
                `<button type="button" class="chip" data-ai-suggest="${esc(s)}">${esc(s)}</button>`).join('');
        }
    }

    async function ask(text) {
        const q = String(text || '').trim();
        if (!q) return;
        history.push({ role: 'user', content: q });
        history.push({ role: 'assistant', content: 'Thinking…', pending: true, by: nameOf(provider) });
        paintLog();
        input.value = '';

        const send = document.getElementById('aiSend');
        if (send) send.disabled = true;
        try {
            const messages = history.filter((m) => !m.pending && !m.error).map(({ role, content }) => ({ role, content }));
            const result = await call('chat', { messages: messages.slice(-20) });
            history[history.length - 1] = { role: 'assistant', content: (result && result.reply) || '(no reply)', by: nameOf(provider) };
        } catch (e) {
            history[history.length - 1] = { role: 'assistant', content: e.message || 'That did not work', error: true, by: nameOf(provider) };
        } finally {
            if (send) send.disabled = false;
            try { sessionStorage.setItem('ai:history', JSON.stringify(history.filter((m) => !m.pending))); } catch { /* full */ }
            paintLog();
        }
    }

    window.openAiStudio = async () => {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        if (!sheet) return;
        try { history = JSON.parse(sessionStorage.getItem('ai:history') || '[]'); } catch { history = []; }
        paintProviders();
        paintModels();
        paintLog();
        window.openSheet(sheet);
        await loadConfig();
        paintProviders();
        paintModels();
        if (!window.EDGE) window.toast('AI tools only run on the Cloudflare-hosted site', 'info');
    };

    if (sheet) {
        sheet.addEventListener('click', (e) => {
            if (e.target === sheet || e.target.closest('[data-close]')) { window.closeSheet(sheet); return; }

            const prov = e.target.closest('[data-provider]');
            if (prov) { provider = prov.dataset.provider; store.set('ai:provider', provider); paintProviders(); paintLog(); return; }

            const tab = e.target.closest('[data-ai-tab]');
            if (tab) {
                sheet.querySelectorAll('[data-ai-tab]').forEach((t) => {
                    const on = t === tab;
                    t.classList.toggle('is-active', on);
                    t.setAttribute('aria-selected', String(on));
                });
                sheet.querySelectorAll('[data-ai-pane]').forEach((p) => p.classList.toggle('u-hidden', p.dataset.aiPane !== tab.dataset.aiTab));
                return;
            }

            const s = e.target.closest('[data-ai-suggest]');
            if (s) { ask(s.dataset.aiSuggest); return; }

            const ref = e.target.closest('[data-ai-open]');
            if (ref) { window.closeSheet(sheet); window.openProject(ref.dataset.aiOpen); }
        });

        sheet.addEventListener('input', (e) => {
            const m = e.target.closest('[data-model]');
            if (!m) return;
            models[m.dataset.model] = m.value.trim();
            store.set('ai:models', models);
            paintProviders();
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
        });
    }

    document.getElementById('aiOpen')?.addEventListener('click', () => window.openAiStudio());

    /* =====================================================================
       Batch tools
       ===================================================================== */

    const projects = () => (window.getProjects ? window.getProjects() : []).slice();
    const strip = ({ id, ...rest }) => rest;

    /* Search terms for every project. Two at a time: fast, but gentle on
       provider rate limits. */
    async function indexAll(btn) {
        const list = projects();
        if (!list.length) return;
        await busy(btn, async () => {
            const progress = window.progressToast(`Indexing — 0 of ${list.length}`);
            let done = 0, ok = 0, failed = 0;
            const queue = list.slice();
            const worker = async () => {
                while (queue.length) {
                    const p = queue.shift();
                    try {
                        const r = await call('search-terms', { project: strip(p) });
                        const terms = Array.from(new Set((r && r.terms || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))).slice(0, 40);
                        if (terms.length && await window.updateProjectInDb(p.id, { ...strip(p), searchTerms: terms }, { quiet: true })) ok++;
                    } catch (e) {
                        failed++;
                        console.error('Index failed for', p.title, e);
                        if (failed === 1) window.toast(e.message, 'error');
                    }
                    done++;
                    progress.update(`Indexing — ${done} of ${list.length}`, done / list.length);
                }
            };
            await Promise.all([worker(), worker()]);
            progress.close();
            window.toast(`Search terms written for ${ok} project${ok === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`, ok ? 'success' : 'error');
        });
    }

    async function altAll(btn) {
        const list = projects().filter((p) => (p.gallery || []).length);
        const todo = list.filter((p) => (p.gallery || []).some((_, i) => !String((p.galleryAlt || [])[i] || '').trim()));
        if (!todo.length) { window.toast(list.length ? 'Every screenshot already has a description' : 'No screenshots to describe yet', 'info'); return; }
        await busy(btn, async () => {
            const total = todo.reduce((n, p) => n + p.gallery.length, 0);
            const progress = window.progressToast(`Describing — 0 of ${total}`);
            let done = 0, saved = 0;
            for (const p of todo) {
                const alts = (p.gallery || []).map((_, i) => String((p.galleryAlt || [])[i] || '').trim());
                for (let i = 0; i < p.gallery.length; i++) {
                    if (!alts[i]) {
                        try {
                            const r = await call('alt-text', { imageUrl: p.gallery[i], project: { title: p.title, desc: p.desc } });
                            if (r && r.alt) alts[i] = String(r.alt).trim();
                        } catch (e) { console.error('Alt failed', p.title, e); }
                    }
                    done++;
                    progress.update(`Describing — ${done} of ${total}`, done / total);
                }
                if (alts.some(Boolean) && await window.updateProjectInDb(p.id, { ...strip(p), galleryAlt: alts }, { quiet: true })) saved++;
            }
            progress.close();
            window.toast(`Descriptions saved on ${saved} project${saved === 1 ? '' : 's'}`, saved ? 'success' : 'error');
        });
    }

    document.getElementById('aiIndexAll')?.addEventListener('click', (e) => indexAll(e.currentTarget));
    document.getElementById('aiAltAll')?.addEventListener('click', (e) => altAll(e.currentTarget));

    /* =====================================================================
       Editor: Improve with AI — nothing is applied without review
       ===================================================================== */

    const FIELDS = [
        ['desc', 'Short description'], ['longDesc', 'Write-up'], ['highlights', 'Highlights'],
        ['tags', 'Tech'], ['problem', 'The problem'], ['approach', 'The approach'],
        ['challenges', 'What broke'], ['outcome', 'The outcome']
    ];
    const asText = (v) => (Array.isArray(v) ? v.join('\n') : String(v || ''));

    function review(current, proposal) {
        return new Promise((resolve) => {
            const changes = FIELDS.filter(([k]) => {
                const next = proposal[k];
                if (next === undefined || next === null) return false;
                const nextText = asText(next).trim();
                return nextText && nextText !== asText(current[k]).trim();
            });
            if (!changes.length) { window.toast('The model had nothing to add', 'info'); resolve(null); return; }

            const box = document.createElement('div');
            box.className = 'sheet';
            box.innerHTML = `
                <div class="sheet-panel sheet-panel--lg" role="dialog" aria-modal="true" aria-label="Review AI changes">
                    <div class="sheet-head">
                        <h2>Review ${esc(nameOf(provider))}'s suggestions</h2>
                        <p>Untick anything you don't want. Nothing is saved until you save the project.</p>
                    </div>
                    <div class="sheet-body ai-review">
                        ${changes.map(([k, label]) => {
                            const empty = !asText(current[k]).trim();
                            return `
                            <label class="ai-change">
                                <span class="check"><input type="checkbox" data-take="${k}" checked><span class="box">${window.icon('check', { raw: true, size: 12 })}</span>
                                    <b>${label}</b>${empty ? '<em>new</em>' : ''}</span>
                                <span class="ai-diff">
                                    ${empty ? '' : `<span class="ai-old">${esc(asText(current[k]))}</span>`}
                                    <span class="ai-new">${esc(asText(proposal[k]))}</span>
                                </span>
                            </label>`;
                        }).join('')}
                    </div>
                    <div class="sheet-foot">
                        <button class="btn btn--quiet" data-no>Discard</button>
                        <button class="btn btn--primary" data-yes>Apply to the form</button>
                    </div>
                </div>`;
            document.body.appendChild(box);
            const finish = (value) => { window.closeSheet(box); setTimeout(() => box.remove(), 400); resolve(value); };
            box.querySelector('[data-yes]').addEventListener('click', () => {
                const take = {};
                box.querySelectorAll('[data-take]').forEach((cb) => { if (cb.checked) take[cb.dataset.take] = proposal[cb.dataset.take]; });
                finish(take);
            });
            box.querySelector('[data-no]').addEventListener('click', () => finish(null));
            box.addEventListener('click', (e) => { if (e.target === box) finish(null); });
            requestAnimationFrame(() => window.openSheet(box));
        });
    }

    document.getElementById('aiImprove')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const current = window.readEditorForm();
        if (!current.title) throw new Error('Give the project a title first');
        if (!current.repo && !current.link) throw new Error('Add a repo or live URL so the model has a README to read');
        const proposal = await call('improve', { project: current });
        const take = await review(current, proposal || {});
        if (!take || !Object.keys(take).length) return;
        const next = { ...current, ...take };
        // Writing a case study only makes sense if the page gets published.
        if (take.problem || take.approach || take.outcome) {
            const fold = document.getElementById('caseFold');
            if (fold) fold.open = true;
        }
        window.writeEditorForm(next);
        window.refreshEditorPreview();
        window.toast(`Applied ${Object.keys(take).length} change${Object.keys(take).length === 1 ? '' : 's'} — review and save`, 'success');
    }));

    document.getElementById('aiTerms')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const current = window.readEditorForm();
        if (!current.title) throw new Error('Give the project a title first');
        const r = await call('search-terms', { project: current });
        const merged = Array.from(new Set([...(current.searchTerms || []), ...((r && r.terms) || []).map((t) => String(t).toLowerCase().trim())].filter(Boolean))).slice(0, 40);
        const field = document.getElementById('fSearchTerms');
        if (field) field.value = merged.join(', ');
        window.refreshEditorPreview();
        window.toast(`${merged.length} search terms`, 'success');
    }));

    document.getElementById('aiAlt')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const current = window.readEditorForm();
        if (!current.gallery.length) throw new Error('Add screenshot URLs first');
        const alts = current.gallery.map((_, i) => current.galleryAlt[i] || '');
        for (let i = 0; i < current.gallery.length; i++) {
            if (alts[i]) continue;
            const r = await call('alt-text', { imageUrl: current.gallery[i], project: { title: current.title, desc: current.desc } });
            alts[i] = (r && r.alt) || '';
        }
        const field = document.getElementById('fGalleryAlt');
        if (field) field.value = alts.join('\n');
        window.refreshEditorPreview();
        window.toast('Screenshots described', 'success');
    }));

    /* The importer shares this choice — one provider picker, remembered once. */
    const getProvider = () => provider;
    const setProvider = (key) => {
        if (!PROVIDERS.some((p) => p.key === key)) return;
        provider = key;
        store.set('ai:provider', provider);
        paintProviders();
    };
    const modelFor = (key) => models[key] || '';
    const getConfig = () => config;

    window.Ai = { call, loadConfig, getProvider, setProvider, modelFor, getConfig, PROVIDERS };
})();
