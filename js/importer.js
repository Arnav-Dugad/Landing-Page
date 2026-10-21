/* ===========================================================================
   importer.js  (classic script) — admin only
   The minimal-input way to add work.

     · Magic import   paste any link(s) — GitHub repo, website, Play Store,
                      Microsoft Store, App Store, itch.io… The Worker reads
                      every source (/api/ingest, streamed as NDJSON), and the
                      sheet shows each stage as it lands, then a finished
                      draft you can publish in one click.
     · Discover       every repo on GitHub that isn't on the site yet, with
                      platform guesses; tick some and they are imported,
                      written up and published one after another.
     · Refresh        re-reads live metrics for every project.
     · Extras         screenshots dropped in the Add sheet ride along and
                      lead the gallery; the server's duplicate check and
                      cover pick are shown before you publish.

   Nothing here holds a key. Every call carries the admin's Firebase ID
   token, which the Worker verifies before doing anything.
   =========================================================================== */

(() => {
    const esc = (v) => (window.esc ? window.esc(v) : String(v ?? ''));
    const icon = (k, size = 16) => (window.icon ? window.icon(k, { raw: true, size }) : '');

    const STAGES = [
        ['detect', 'Reading the links'],
        ['dupes', 'Already on the site?'],
        ['github', 'GitHub repository'],
        ['releases', 'Releases & downloads'],
        ['readme', 'README'],
        ['website', 'Live site'],
        ['lighthouse', 'Lighthouse audit'],
        ['store', 'Store listings'],
        ['screenshots', 'Screenshots'],
        ['ai', 'Writing the copy'],
        ['done', 'Ready']
    ];

    const PROVIDERS = [['claude', 'Claude'], ['gemini', 'Gemini'], ['openai', 'ChatGPT']];

    /* What a pasted line most likely is — drives the little chips under the
       paste box, so you can see the importer understood you before it runs. */
    function sourceOf(raw) {
        let u;
        try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
        if (!/\./.test(u.hostname)) return null;
        const h = u.hostname.replace(/^www\./, '').toLowerCase();
        const path = u.pathname.split('/').filter(Boolean);
        if (h === 'github.com' && path.length >= 2) return { kind: 'GitHub repo', icon: 'github', url: u.href };
        if (h === 'github.com') return { kind: 'GitHub profile', icon: 'github', url: u.href };
        if (h.endsWith('github.io')) return { kind: 'GitHub Pages site', icon: 'globe', url: u.href };
        if (h === 'play.google.com') return { kind: 'Google Play', icon: 'mobile', url: u.href };
        if (h === 'apps.microsoft.com' || (h.endsWith('microsoft.com') && /store/i.test(u.pathname))) return { kind: 'Microsoft Store', icon: 'desktop', url: u.href };
        if (h === 'apps.apple.com' || h === 'itunes.apple.com') return { kind: 'App Store', icon: 'mobile', url: u.href };
        if (h.endsWith('itch.io')) return { kind: 'itch.io', icon: 'gamepad', url: u.href };
        if (h === 'chromewebstore.google.com' || h === 'chrome.google.com') return { kind: 'Chrome Web Store', icon: 'puzzle', url: u.href };
        if (h === 'addons.mozilla.org') return { kind: 'Firefox Add-ons', icon: 'puzzle', url: u.href };
        if (h === 'www.npmjs.com' || h === 'npmjs.com') return { kind: 'npm package', icon: 'blocks', url: u.href };
        return { kind: 'Website', icon: 'globe', url: u.href };
    }

    const parseUrls = (text) => String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
        .map(sourceOf).filter(Boolean);

    /* =====================================================================
       Transport — streamed NDJSON from /api/ingest
       ===================================================================== */

    async function ingest(body, onEvent = () => {}, signal) {
        if (!window.EDGE) throw new Error('Importing runs on the live Cloudflare site, not this host');
        if (!window.adminIdToken) throw new Error('Still connecting — try again in a second');
        const token = await window.adminIdToken();
        const res = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok || !res.body) {
            let msg = '';
            try { msg = (await res.json()).error; } catch { /* not JSON */ }
            const err = new Error(
                res.status === 401 ? 'The server did not accept your sign-in — sign out and in again'
                    : res.status === 404 ? 'The importer isn’t deployed on this server yet'
                        : msg || `Import failed (HTTP ${res.status})`);
            err.status = res.status;
            throw err;
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let final = null;
        const take = (line) => {
            const t = line.trim();
            if (!t) return;
            let ev;
            try { ev = JSON.parse(t); } catch { return; }
            onEvent(ev);
            if (ev.stage === 'done') final = ev;
        };
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let at;
            while ((at = buf.indexOf('\n')) >= 0) {
                take(buf.slice(0, at));
                buf = buf.slice(at + 1);
            }
        }
        take(buf + dec.decode());
        if (!final) throw new Error('The import stopped before it finished — try again');
        if (final.status === 'error') throw new Error(final.detail || final.label || 'The import failed');
        return final;
    }

    window.Importer = { ingest, sourceOf, findExisting: (d) => findExisting(d) };

    /* Same project already on the site? Match by repo, then by live link. */
    const normUrl = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    function findExisting(draft) {
        const all = window.getProjects ? window.getProjects() : [];
        const repo = normUrl(draft.repo);
        const link = normUrl(draft.link);
        return all.find((p) => (repo && normUrl(p.repo || (window.resolveRepoUrl && window.resolveRepoUrl(p))) === repo)
            || (link && normUrl(p.link) === link)) || null;
    }

    /* Keep what the admin locked; take everything else from the draft. */
    function mergeInto(existing, draft) {
        const keep = new Set(existing.locked || []);
        const out = { ...existing };
        Object.entries(draft).forEach(([k, v]) => {
            if (keep.has(k) || k === 'id' || k === 'locked' || k === 'featured' || k === 'order') return;
            out[k] = v;
        });
        out.auto = true;
        return out;
    }

    const providerNow = () => (window.Ai && window.Ai.getProvider ? window.Ai.getProvider() : 'claude');
    const modelNow = (p) => (window.Ai && window.Ai.modelFor ? window.Ai.modelFor(p) : '');

    /* =====================================================================
       Sheet scaffolding
       ===================================================================== */

    function makeSheet(id, size, label, inner) {
        let el = document.getElementById(id);
        if (el) return el;
        el = document.createElement('div');
        el.className = 'sheet imp-sheet';
        el.id = id;
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `<div class="sheet-panel sheet-panel--${size}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
            <button class="sheet-close" data-close aria-label="Close">${icon('x')}</button>${inner}</div>`;
        document.body.appendChild(el);
        return el;
    }

    /* =====================================================================
       Magic import
       ===================================================================== */

    let impSheet = null;
    let impAbort = null;
    let impDraft = null;
    let impMeta = null;
    let impDupes = [];              // server-side matches from the 'dupes' stage
    let impExtra = [];              // [{ url, alt }] screenshots from the Add sheet

    function stageList() {
        return STAGES.map(([key, label]) => `
            <li class="imp-stage" data-stage="${key}" data-state="idle">
                <span class="imp-ico" aria-hidden="true"></span>
                <span class="imp-txt"><b>${esc(label)}</b><small></small></span>
            </li>`).join('');
    }

    function buildImporter() {
        impSheet = makeSheet('importSheet', 'lg', 'Magic import', `
            <div class="sheet-head">
                <h2>Magic import</h2>
                <p>Paste a link. Copy, platforms, downloads, screenshots and scores are filled in for you — you just check and publish.</p>
            </div>
            <div class="sheet-body imp-body">
                <div class="imp-left">
                    <form class="imp-form" id="impForm" novalidate>
                        <label class="imp-paste">
                            <span class="u-sr">Links to import</span>
                            <textarea id="impUrls" rows="3" spellcheck="false" autocomplete="off"
                                placeholder="Paste any link — GitHub repo, website, Play Store, Microsoft Store, App Store, itch.io… one per line"></textarea>
                        </label>
                        <div class="imp-detect" id="impDetect" aria-live="polite"></div>
                        <div class="imp-row">
                            <div class="imp-provs" role="radiogroup" aria-label="Write the copy with">
                                ${PROVIDERS.map(([k, n]) => `<button type="button" role="radio" class="imp-prov" data-imp-prov="${k}">${n}</button>`).join('')}
                            </div>
                            <label class="switch imp-ai">
                                <input type="checkbox" id="impAi" checked>
                                <span class="switch-track"><i></i></span>
                                <span>AI copy</span>
                            </label>
                            <button class="btn btn--primary" type="submit" id="impGo">${icon('wand', 17)} Import</button>
                        </div>
                    </form>
                    <ol class="imp-stages" id="impStages" aria-live="polite">${stageList()}</ol>
                </div>
                <div class="imp-right" id="impResult"></div>
            </div>
            <div class="sheet-foot imp-foot u-hidden" id="impFoot">
                <button class="btn btn--quiet" type="button" data-imp="discard">Discard</button>
                <span class="imp-foot-gap"></span>
                <button class="btn btn--ghost" type="button" data-imp="edit">${icon('pencil', 15)} Review in editor</button>
                <button class="btn btn--primary" type="button" data-imp="publish" id="impPublish">${icon('check', 16)} Publish</button>
            </div>`);

        const urls = impSheet.querySelector('#impUrls');
        urls.addEventListener('input', paintDetect);
        urls.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); impSheet.querySelector('#impForm').requestSubmit(); }
        });
        impSheet.querySelector('#impForm').addEventListener('submit', (e) => { e.preventDefault(); runImport(); });

        impSheet.addEventListener('click', (e) => {
            if (e.target === impSheet || e.target.closest('[data-close]')) { closeImporter(); return; }
            const prov = e.target.closest('[data-imp-prov]');
            if (prov) {
                if (window.Ai && window.Ai.setProvider) window.Ai.setProvider(prov.dataset.impProv);
                else try { localStorage.setItem('ai:provider', JSON.stringify(prov.dataset.impProv)); } catch { /* private */ }
                paintProviders(prov.dataset.impProv);
                return;
            }
            const pick = e.target.closest('[data-imp-cover]');
            if (pick && impDraft) { impDraft.cover = pick.dataset.impCover; paintResult(); return; }
            const act = e.target.closest('[data-imp]');
            if (act) onResultAction(act.dataset.imp, act);
        });
        paintEmptyResult();
    }

    function paintProviders(current = providerNow()) {
        const cfg = window.Ai && window.Ai.getConfig ? window.Ai.getConfig() : null;
        impSheet.querySelectorAll('[data-imp-prov]').forEach((b) => {
            const on = b.dataset.impProv === current;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', String(on));
            const c = cfg && cfg.providers && cfg.providers[b.dataset.impProv];
            b.classList.toggle('is-off', !!c && !c.configured);
            if (c && !c.configured) b.setAttribute('data-tip', 'No API key set for this provider');
            else b.removeAttribute('data-tip');
        });
    }

    function paintDetect() {
        const box = impSheet.querySelector('#impDetect');
        const found = parseUrls(impSheet.querySelector('#impUrls').value);
        box.innerHTML = found.slice(0, 5).map((s) => `<span class="imp-src">${icon(s.icon, 13)}<b>${esc(s.kind)}</b><em>${esc(s.url.replace(/^https?:\/\//, '').slice(0, 42))}</em></span>`).join('')
            + (found.length > 5 ? '<span class="imp-src is-warn">Only the first five links are read</span>' : '');
        impSheet.querySelector('#impGo').disabled = !found.length;
    }

    function paintEmptyResult() {
        const box = impSheet.querySelector('#impResult');
        box.innerHTML = `
            <div class="imp-empty">
                <div class="imp-empty-art" aria-hidden="true">
                    <span></span><span></span><span></span>
                    ${icon('wand', 26)}
                </div>
                <h4>Your finished project appears here</h4>
                <p>Title, tagline, write-up, platforms, download files, store ratings, screenshots, Lighthouse scores and a case study — read from the sources, never invented.</p>
                <ul class="imp-tips">
                    <li>${icon('github', 13)} A repo alone is enough — releases become downloads.</li>
                    <li>${icon('globe', 13)} Add the live site for screenshots and a performance audit.</li>
                    <li>${icon('mobile', 13)} Store links add ratings and installs.</li>
                </ul>
            </div>`;
        impSheet.querySelector('#impFoot').classList.add('u-hidden');
    }

    function setStage(ev) {
        const li = impSheet.querySelector(`.imp-stage[data-stage="${CSS.escape(ev.stage)}"]`);
        if (!li) return;
        const state = { run: 'run', ok: 'ok', skip: 'skip', error: 'error' }[ev.status] || 'run';
        li.dataset.state = state;
        if (ev.label) li.querySelector('b').textContent = ev.label;
        li.querySelector('small').textContent = ev.detail || '';
        // Everything before a stage that has started is, at worst, skipped.
        let prev = li.previousElementSibling;
        while (prev) {
            if (prev.dataset.state === 'idle' || prev.dataset.state === 'run') prev.dataset.state = prev.dataset.state === 'run' ? 'ok' : 'skip';
            prev = prev.previousElementSibling;
        }
    }

    function resetStages() {
        impSheet.querySelector('#impStages').innerHTML = stageList();
    }

    async function runImport() {
        const found = parseUrls(impSheet.querySelector('#impUrls').value).slice(0, 5);
        if (!found.length) { window.toast('Paste at least one link', 'error'); return; }
        if (impAbort) impAbort.abort();
        impAbort = new AbortController();
        impDraft = null;
        impMeta = null;

        const go = impSheet.querySelector('#impGo');
        const busy = window.Micro ? window.Micro.busy(go) : { done() {}, cancel() {} };
        impSheet.querySelector('.imp-body').classList.add('is-running');
        resetStages();
        paintEmptyResult();
        impSheet.querySelector('#impResult').classList.add('is-waiting');

        const provider = providerNow();
        const body = { urls: found.map((s) => s.url), provider, ai: impSheet.querySelector('#impAi').checked };
        const model = modelNow(provider);
        if (model) body.model = model;

        impDupes = [];
        try {
            const final = await ingest(body, (ev) => {
                if (ev.stage === 'dupes' && Array.isArray(ev.matches)) impDupes = ev.matches;
                setStage(ev);
            }, impAbort.signal);
            impDraft = withExtras({ ...(final.project || {}), auto: true });
            impMeta = final.meta || null;
            setStage({ stage: 'done', status: 'ok', label: 'Ready' });
            busy.done(true);
            paintResult();
        } catch (e) {
            if (e.name === 'AbortError') { busy.cancel && busy.cancel(); return; }
            busy.done(false);
            const running = impSheet.querySelector('.imp-stage[data-state="run"]');
            if (running) { running.dataset.state = 'error'; running.querySelector('small').textContent = e.message; }
            impSheet.querySelector('#impResult').innerHTML = `
                <div class="imp-empty imp-fail">
                    ${icon('alert', 24)}
                    <h4>That didn’t work</h4>
                    <p>${esc(e.message)}</p>
                </div>`;
        } finally {
            impSheet.querySelector('.imp-body').classList.remove('is-running');
            impSheet.querySelector('#impResult').classList.remove('is-waiting');
            impAbort = null;
        }
    }

    const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1)} MB` : b ? `${Math.round(b / 1024)} KB` : '');
    const platformLabel = (k) => (window.PLATFORMS && window.PLATFORMS[k] && window.PLATFORMS[k].label) || k;
    const platformIcon = (k) => (window.PLATFORMS && window.PLATFORMS[k] && window.PLATFORMS[k].icon)
        || ({ web: 'globe', windows: 'desktop', android: 'mobile', ios: 'mobile', macos: 'monitor', linux: 'terminal', extension: 'puzzle', cli: 'terminal' })[k] || 'cube';

    /* Screenshots the admin dropped in lead the gallery, and the first one
       becomes the cover — they chose them on purpose. */
    function withExtras(draft) {
        if (!impExtra.length) return draft;
        const urls = impExtra.map((m) => m.url);
        const alts = impExtra.map((m) => m.alt || '');
        const g = Array.isArray(draft.gallery) ? draft.gallery : [];
        const ga = Array.isArray(draft.galleryAlt) ? draft.galleryAlt : [];
        g.forEach((u, i) => { if (!urls.includes(u)) { urls.push(u); alts.push(ga[i] || ''); } });
        return { ...draft, gallery: urls.slice(0, 20), galleryAlt: alts.slice(0, 20), cover: impExtra[0].url };
    }

    /* Everything that could be the same project: the server's matches plus a
       local check by repo and live link. */
    function duplicates(d) {
        const all = window.getProjects ? window.getProjects() : [];
        const out = [];
        const seen = new Set();
        impDupes.forEach((m) => {
            const id = String(m.projectId);
            if (seen.has(id)) return;
            seen.add(id);
            const p = all.find((x) => String(x.id) === id);
            out.push({ id, title: (p && p.title) || m.title || 'A project', why: m.why || 'looks the same' });
        });
        const local = findExisting(d);
        if (local && !seen.has(String(local.id))) out.push({ id: String(local.id), title: local.title, why: 'same repo or live link' });
        return out;
    }

    function paintResult() {
        const d = impDraft;
        const box = impSheet.querySelector('#impResult');
        const dupes = duplicates(d);
        const existing = dupes.length
            ? (window.getProjects ? window.getProjects() : []).find((p) => String(p.id) === dupes[0].id) || null
            : null;
        let card = '';
        try {
            card = window.projectCardHtml ? window.projectCardHtml({ ...d, id: 'import-preview' }, 0) : '';
        } catch (e) { console.error('Preview card failed:', e); }

        const psi = impMeta && impMeta.web && impMeta.web.psi;
        const gh = impMeta && impMeta.github;
        const stats = [
            gh && gh.stars ? `${icon('star', 12)} ${gh.stars.toLocaleString()} stars` : '',
            gh && gh.downloads ? `${icon('download', 12)} ${gh.downloads.toLocaleString()} downloads` : '',
            psi ? `${icon('bolt', 12)} Performance ${psi.performance}` : '',
            psi ? `${icon('eye', 12)} Accessibility ${psi.accessibility}` : ''
        ].filter(Boolean);

        const coverChoices = Array.from(new Set([d.cover, ...(d.gallery || [])].filter(Boolean))).slice(0, 8);
        box.innerHTML = `
            ${dupes.length ? `<div class="imp-dupe">${icon('info', 15)}
                <span>${dupes.length === 1
                    ? `<b>${esc(dupes[0].title)}</b> looks like the same project <em>(${esc(dupes[0].why)})</em>.`
                    : `This looks like ${dupes.map((x) => `<b>${esc(x.title)}</b>`).join(', ')}.`}</span>
                ${existing ? '<button type="button" class="btn btn--quiet" data-imp="update">Update it instead</button>' : ''}</div>` : ''}
            <div class="imp-preview">${card}</div>
            ${coverChoices.length > 1 ? `<div class="imp-cover" role="radiogroup" aria-label="Cover image">
                <span class="imp-cover-l">Cover <em>${d.cover ? 'picked for you — tap to change' : 'tap one'}</em></span>
                <div class="imp-cover-row">${coverChoices.map((src) => `
                    <button type="button" role="radio" aria-checked="${src === d.cover}" class="imp-cover-pick ${src === d.cover ? 'is-on' : ''}" data-imp-cover="${esc(src)}" aria-label="Use this image as the cover">
                        <img src="${esc(window.safeUrl ? window.safeUrl(src) || src : src)}" alt="" loading="lazy"></button>`).join('')}</div>
            </div>` : ''}
            ${d.tagline ? `<p class="imp-tagline">“${esc(d.tagline)}”</p>` : ''}
            <dl class="imp-sum">
                ${(d.platforms || []).length ? `<div><dt>Runs on</dt><dd>${d.platforms.map((k) => `<span class="imp-chip">${icon(platformIcon(k), 12)}${esc(platformLabel(k))}</span>`).join('')}</dd></div>` : ''}
                ${(d.downloads || []).length ? `<div><dt>Downloads</dt><dd class="imp-dls">${d.downloads.slice(0, 6).map((x) =>
                    `<span class="imp-dl">${icon(platformIcon(x.platform), 12)}<b>${esc(x.label || x.platform)}</b><em>${esc([x.version, fmtSize(x.size), x.count ? `${x.count}↓` : ''].filter(Boolean).join(' · '))}</em></span>`).join('')}</dd></div>` : ''}
                ${d.stores && Object.keys(d.stores).length ? `<div><dt>Stores</dt><dd>${Object.keys(d.stores).map((k) => `<span class="imp-chip">${esc(k)}</span>`).join('')}</dd></div>` : ''}
                ${stats.length ? `<div><dt>Signals</dt><dd>${stats.map((s) => `<span class="imp-chip">${s}</span>`).join('')}</dd></div>` : ''}
                ${(d.tags || []).length ? `<div><dt>Tech</dt><dd>${d.tags.slice(0, 10).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</dd></div>` : ''}
                ${(d.gallery || []).length ? `<div><dt>Screens</dt><dd class="imp-shots">${d.gallery.slice(0, 6).map((src, i) =>
                    `<img src="${esc(window.safeUrl ? window.safeUrl(src) : src)}" alt="${esc((d.galleryAlt || [])[i] || '')}" loading="lazy">`).join('')}</dd></div>` : ''}
                ${d.caseStudy ? `<div><dt>Case study</dt><dd>${icon('doc', 12)} Drafted from the README</dd></div>` : ''}
            </dl>`;
        box.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
        // A preview isn't a real project yet — no admin controls on it.
        box.querySelectorAll('.imp-preview .card-admin, .imp-preview [data-card-menu], .imp-preview [data-drag]').forEach((el) => el.remove());
        if (window.Motion) window.Motion.tilt(box);
        const foot = impSheet.querySelector('#impFoot');
        foot.classList.remove('u-hidden');
        impSheet.querySelector('#impPublish').innerHTML = `${icon('check', 16)} ${existing ? 'Publish as new' : 'Publish'}`;
        if (window.Micro && !window.motionReduced?.() && !box.dataset.burst) {
            box.dataset.burst = '1';
            window.Micro.burst(box.querySelector('.imp-preview'), { count: 14, spread: 90 });
        }
    }

    async function onResultAction(act, btn) {
        if (!impDraft) { if (act === 'discard') closeImporter(); return; }
        if (act === 'discard') { impDraft = null; paintEmptyResult(); resetStages(); return; }
        if (act === 'edit') {
            const draft = impDraft;
            closeImporter(true);
            setTimeout(() => window.openEditorWith ? window.openEditorWith(draft) : window.toast('Editor unavailable', 'error'), 260);
            return;
        }
        if (act === 'publish' || act === 'update') {
            const busy = window.Micro ? window.Micro.busy(btn) : { done() {} };
            let ok;
            if (act === 'update') {
                const dupes = duplicates(impDraft);
                const all = window.getProjects ? window.getProjects() : [];
                const existing = (dupes[0] && all.find((p) => String(p.id) === dupes[0].id)) || findExisting(impDraft);
                if (!existing) { busy.done(false); window.toast('That project isn’t loaded — publish as new instead', 'error'); return; }
                const { id, ...rest } = mergeInto(existing, impDraft);
                ok = await window.updateProjectInDb(id, rest);
                if (ok && window.writeHistory) {
                    const changes = window.diffProjects ? window.diffProjects(existing, rest) : [];
                    window.writeHistory({ projectId: id, kind: 'import', summary: `Re-imported — ${changes.length} field${changes.length === 1 ? '' : 's'} updated`, changes });
                }
            } else {
                ok = await window.saveProjectToDb(impDraft);
                const n = (impDraft.sources || []).length || 1;
                if (ok && typeof ok === 'string' && window.writeHistory) {
                    window.writeHistory({ projectId: ok, kind: 'import', summary: `Imported from ${n} source${n === 1 ? '' : 's'}`, changes: [] });
                }
            }
            busy.done(!!ok);
            if (!ok) return;
            if (window.Micro) window.Micro.burst(btn, { count: 26, spread: 120 });
            if (window.celebrate) window.celebrate();
            impDraft = null;
            impExtra = [];
            setTimeout(() => closeImporter(true), 650);
        }
    }

    function openImporter(prefill = '', { gallery = [] } = {}) {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        if (!impSheet) buildImporter();
        impExtra = Array.isArray(gallery) ? gallery.filter((m) => m && m.url) : [];
        const resultBox = impSheet.querySelector('#impResult');
        if (resultBox) delete resultBox.dataset.burst;
        const urls = impSheet.querySelector('#impUrls');
        if (prefill) urls.value = Array.isArray(prefill) ? prefill.join('\n') : String(prefill);
        paintProviders();
        paintDetect();
        if (!impDraft && !impAbort) { resetStages(); paintEmptyResult(); }
        window.openSheet(impSheet);
        setTimeout(() => { urls.focus(); urls.setSelectionRange(urls.value.length, urls.value.length); }, 140);
        // Mark providers without keys once we know.
        if (window.Ai && window.Ai.loadConfig && !window.Ai.getConfig()) window.Ai.loadConfig().then(() => paintProviders());
        // Auto-start when opened with a link (drag-and-drop, Discover).
        if (prefill && !impAbort) setTimeout(runImport, 220);
    }

    async function closeImporter(force) {
        if (!impSheet) return;
        if (!force && impDraft) {
            const ok = await window.confirmAction({
                title: 'Discard this import?',
                message: 'The draft hasn’t been published. Close anyway?',
                confirm: 'Discard', danger: true
            });
            if (!ok) return;
            impDraft = null;
        }
        if (impAbort) impAbort.abort();
        window.closeSheet(impSheet);
    }

    window.openImporter = openImporter;

    /* =====================================================================
       Discover — repos that aren't on the site yet
       ===================================================================== */

    let discSheet = null;
    let discRepos = [];
    let discAbort = null;
    let showAll = false;

    function buildDiscover() {
        discSheet = makeSheet('discoverSheet', 'lg', 'Discover repos', `
            <div class="sheet-head">
                <h2>Discover</h2>
                <p>Repos on GitHub that aren’t on the site yet. Tick some — they’re read, written up and published for you.</p>
            </div>
            <div class="sheet-body disc-body">
                <div class="disc-bar">
                    <label class="check disc-all"><input type="checkbox" id="discAll"><span class="box">${icon('check', 12)}</span> Select all</label>
                    <label class="search disc-search"><span class="u-sr">Filter repos</span>${icon('search', 16)}<input type="search" id="discFilter" placeholder="Filter by name, language, topic…" autocomplete="off"></label>
                    <label class="switch"><input type="checkbox" id="discShowAll"><span class="switch-track"><i></i></span><span>Show all</span></label>
                </div>
                <div class="disc-list" id="discList" aria-live="polite"></div>
            </div>
            <div class="sheet-foot disc-foot">
                <button class="btn btn--quiet" type="button" id="discRefresh" data-tip="Re-read stars, downloads, versions, uptime and scores for every project">${icon('refresh', 15)} Refresh metrics</button>
                <span class="imp-foot-gap"></span>
                <span class="disc-count" id="discCount"></span>
                <button class="btn btn--primary" type="button" id="discGo" disabled>${icon('wand', 16)} Import selected</button>
            </div>`);

        discSheet.addEventListener('click', (e) => {
            if (e.target === discSheet || e.target.closest('[data-close]')) { closeDiscover(); return; }
            const one = e.target.closest('[data-disc-one]');
            if (one) {
                const repo = discRepos.find((r) => r.fullName === one.dataset.discOne);
                if (!repo) return;
                window.closeSheet(discSheet);
                setTimeout(() => openImporter([repo.url, repo.homepage].filter(Boolean)), 240);
            }
        });
        discSheet.addEventListener('change', (e) => {
            if (e.target.id === 'discAll') {
                discSheet.querySelectorAll('.disc-row:not(.u-hidden) input[data-disc]').forEach((cb) => { if (!cb.disabled) cb.checked = e.target.checked; });
            }
            if (e.target.id === 'discShowAll') { showAll = e.target.checked; paintRepos(); }
            paintCount();
        });
        discSheet.querySelector('#discFilter').addEventListener('input', filterRepos);
        discSheet.querySelector('#discGo').addEventListener('click', importSelected);
        discSheet.querySelector('#discRefresh').addEventListener('click', (e) => refreshMetrics(e.currentTarget));
    }

    const ago = (ms) => (window.relativeTime ? window.relativeTime(new Date(ms).toISOString()) : new Date(ms).toLocaleDateString());

    function paintRepos() {
        const list = discSheet.querySelector('#discList');
        const shown = discRepos.filter((r) => showAll || !r.inPortfolio);
        if (!shown.length) {
            list.innerHTML = `<div class="imp-empty">${icon('check', 22)}<h4>Everything’s on the site</h4><p>Every repo you’ve pushed is already in the portfolio. Toggle “Show all” to see them.</p></div>`;
            paintCount();
            return;
        }
        list.innerHTML = shown.map((r) => {
            const plats = (r.platformsGuess || []).map((k) => `<span class="imp-chip">${icon(platformIcon(k), 11)}${esc(platformLabel(k))}</span>`).join('');
            let host = '';
            try { host = r.homepage ? new URL(r.homepage).hostname.replace(/^www\./, '') : ''; } catch { /* bad URL */ }
            const hay = [r.name, r.description, r.language, ...(r.topics || [])].join(' ').toLowerCase();
            return `
                <div class="disc-row ${r.inPortfolio ? 'is-in' : ''}" data-full="${esc(r.fullName)}" data-hay="${esc(hay)}">
                    <label class="check disc-pick"><input type="checkbox" data-disc="${esc(r.fullName)}" ${r.inPortfolio ? 'disabled' : ''}><span class="box">${icon('check', 12)}</span><span class="u-sr">Select ${esc(r.name)}</span></label>
                    <div class="disc-main">
                        <div class="disc-name"><b>${esc(r.name)}</b>${r.archived ? '<span class="badge badge--archived"><s></s>Archived</span>' : ''}${r.fork ? '<span class="imp-chip">fork</span>' : ''}${r.inPortfolio ? '<span class="badge badge--live"><s></s>On the site</span>' : ''}</div>
                        ${r.description ? `<p>${esc(r.description)}</p>` : '<p class="is-muted">No description</p>'}
                        <div class="disc-meta">
                            ${plats}
                            ${r.language ? `<span>${esc(r.language)}</span>` : ''}
                            ${r.stars ? `<span>${icon('star', 11)} ${r.stars}</span>` : ''}
                            ${r.pushedAt ? `<span>pushed ${esc(ago(r.pushedAt))}</span>` : ''}
                            ${host ? `<span>${icon('globe', 11)} ${esc(host)}</span>` : ''}
                        </div>
                    </div>
                    <div class="disc-state" data-state="idle"><span class="imp-ico" aria-hidden="true"></span><small></small></div>
                    ${r.inPortfolio ? '' : `<button type="button" class="btn btn--quiet disc-one" data-disc-one="${esc(r.fullName)}">Import…</button>`}
                </div>`;
        }).join('');
        filterRepos();
    }

    function filterRepos() {
        const q = String(discSheet.querySelector('#discFilter').value || '').toLowerCase().trim();
        discSheet.querySelectorAll('.disc-row').forEach((row) => {
            row.classList.toggle('u-hidden', !!q && !row.dataset.hay.includes(q));
        });
        paintCount();
    }

    function paintCount() {
        const picked = discSheet.querySelectorAll('input[data-disc]:checked').length;
        const total = discRepos.filter((r) => !r.inPortfolio).length;
        discSheet.querySelector('#discCount').textContent = picked ? `${picked} selected` : `${total} not on the site`;
        const go = discSheet.querySelector('#discGo');
        if (!discAbort) {
            go.disabled = !picked;
            go.innerHTML = `${icon('wand', 16)} Import ${picked || ''} selected`.replace('  ', ' ');
        }
    }

    async function loadRepos() {
        const list = discSheet.querySelector('#discList');
        list.innerHTML = Array.from({ length: 5 }, () => '<div class="disc-row disc-skel"><span></span><span></span></div>').join('');
        try {
            const token = await window.adminIdToken();
            const data = await window.edgeFetch('/api/discover', { token });
            discRepos = (data && data.repos) || [];
            paintRepos();
        } catch (e) {
            list.innerHTML = `<div class="imp-empty imp-fail">${icon('alert', 22)}<h4>Couldn’t reach GitHub</h4><p>${esc(e.status === 404 ? 'Discovery isn’t deployed on this server yet.' : e.message)}</p></div>`;
        }
    }

    function setRow(fullName, state, text) {
        const row = discSheet.querySelector(`.disc-row[data-full="${CSS.escape(fullName)}"]`);
        if (!row) return;
        const st = row.querySelector('.disc-state');
        st.dataset.state = state;
        st.querySelector('small').textContent = text || '';
        row.classList.toggle('is-running', state === 'run');
        if (state === 'ok') {
            row.classList.add('is-in');
            const cb = row.querySelector('input[data-disc]');
            if (cb) { cb.checked = false; cb.disabled = true; }
            row.querySelector('.disc-one')?.remove();
        }
        if (state === 'run') row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function importSelected() {
        const go = discSheet.querySelector('#discGo');
        if (discAbort) { discAbort.abort(); return; }           // the button doubles as Stop
        const picked = Array.from(discSheet.querySelectorAll('input[data-disc]:checked')).map((cb) => cb.dataset.disc);
        if (!picked.length) return;
        discAbort = new AbortController();
        go.disabled = false;
        go.innerHTML = `${icon('x', 15)} Stop`;
        go.classList.add('is-stop');

        let ok = 0, failed = 0;
        const provider = providerNow();
        for (const full of picked) {
            if (discAbort.signal.aborted) break;
            const repo = discRepos.find((r) => r.fullName === full);
            if (!repo) continue;
            setRow(full, 'run', 'Starting…');
            try {
                const body = { urls: [repo.url, repo.homepage].filter(Boolean), provider, ai: true };
                const model = modelNow(provider);
                if (model) body.model = model;
                const final = await ingest(body, (ev) => { if (ev.status === 'run' && ev.label) setRow(full, 'run', ev.label); }, discAbort.signal);
                const id = await window.saveProjectToDb({ ...(final.project || {}), auto: true }, { quiet: true });
                if (!id) throw new Error('Saving was refused');
                if (typeof id === 'string' && window.writeHistory) {
                    window.writeHistory({ projectId: id, kind: 'import', summary: `Imported from GitHub (${repo.name})`, changes: [] });
                }
                repo.inPortfolio = true;
                setRow(full, 'ok', 'Published');
                ok++;
            } catch (e) {
                if (e.name === 'AbortError') { setRow(full, 'idle', 'Stopped'); break; }
                setRow(full, 'error', e.message);
                failed++;
            }
        }
        discAbort = null;
        go.classList.remove('is-stop');
        paintCount();
        if (ok) {
            if (window.Micro) window.Micro.burst(go, { count: 30, spread: 130 });
            if (window.celebrate) window.celebrate();
        }
        window.toast(ok
            ? `Published ${ok} project${ok === 1 ? '' : 's'}${failed ? ` — ${failed} failed` : ''}`
            : failed ? `Nothing was imported — ${failed} failed` : 'Import stopped', ok ? 'success' : (failed ? 'error' : 'info'));
    }

    /* Re-read metrics for every project, four at a time, until done. */
    async function refreshMetrics(btn) {
        if (!window.EDGE) { window.toast('Metrics refresh runs on the live site', 'info'); return; }
        const busy = window.Micro ? window.Micro.busy(btn) : { done() {} };
        const progress = window.progressToast('Refreshing metrics…');
        let done = 0, total = 0, rounds = 0;
        try {
            const token = await window.adminIdToken();
            for (;;) {
                const r = await window.edgeFetch('/api/meta/refresh', { method: 'POST', body: {}, token });
                done += (r.refreshed || []).length;
                if (!total) total = done + (r.remaining || 0);
                progress.update(`Refreshing metrics — ${done} of ${total || '?'}`, total ? done / total : 0);
                if (!r.remaining || ++rounds > 60 || !(r.refreshed || []).length) break;
            }
            busy.done(true);
            window.toast(`Metrics refreshed for ${done} project${done === 1 ? '' : 's'}`, 'success');
            window.dispatchEvent(new CustomEvent('metarefresh'));
        } catch (e) {
            busy.done(false);
            window.toast(e.status === 404 ? 'Metrics refresh isn’t deployed yet' : (e.message || 'Refresh failed'), 'error');
        } finally {
            progress.close();
        }
    }
    window.refreshAllMetrics = () => refreshMetrics(null);

    function openDiscover() {
        if (!window.isAdmin) { window.toast('Sign in as admin first', 'error'); return; }
        if (!discSheet) buildDiscover();
        window.openSheet(discSheet);
        if (!discRepos.length) loadRepos(); else paintRepos();
    }

    function closeDiscover() {
        if (discAbort) { window.toast('Stop the import first', 'info'); return; }
        window.closeSheet(discSheet);
    }

    window.openDiscover = openDiscover;

    /* =====================================================================
       Wiring — Shift+I (the admin dock owns the buttons and page drops)
       ===================================================================== */

    document.addEventListener('keydown', (e) => {
        if (!window.isAdmin || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'i') return;
        const a = document.activeElement;
        if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
        if (document.querySelector('.sheet.is-open, .palette.is-open')) return;
        e.preventDefault();
        openImporter();
    });

})();
