/* ===========================================================================
   worker/rehost.js  —  POST /api/rehost, GET /api/rehost?projectId=  (admin)

   One click to bring a project whose host died (the blocked Vercel account)
   back to life on Cloudflare Pages, built straight from its GitHub repo:

     1. read the repo and work out how it builds (Vite, Astro, CRA, static
        Next export, SvelteKit, Nuxt generate, Gatsby, plain static HTML…)
     2. create — or reuse — a Pages project connected to that repo
     3. start a production deployment and report its state

   It never changes the project's link: when the build succeeds the admin
   is offered "Use this URL". Server-only apps (server-rendered Next.js,
   Remix, API backends) are reported honestly rather than half-deployed.

   Needs two things the admin sets up once (needs-setup explains both):
     · CF_API_TOKEN  — an API token with "Cloudflare Pages: Edit"
     · the Cloudflare Pages GitHub app, allowed to see the repo
   =========================================================================== */

import { fetchProjects, slugify } from '../api/_project.js';
import { requireAdmin } from './auth.js';
import { json, readJson, HttpError } from './http.js';
import { gh, GitHubLimit, repoSlugFrom } from './github.js';
import { writeHistory, change } from './history.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

const SETUP_TOKEN = [
    'Rehosting needs a Cloudflare API token (one-time setup):',
    '1. dash.cloudflare.com → My Profile (top right) → API Tokens → Create Token.',
    '2. Choose "Create Custom Token". Name it "portfolio rehost".',
    '3. Permissions: Account → Cloudflare Pages → Edit. Account resources: Include → your account.',
    '4. Create the token and copy it.',
    '5. In the portfolio folder run: npx wrangler secret put CF_API_TOKEN  (paste the token).'
].join('\n');

const SETUP_GITHUB = (owner, repo) => [
    `Cloudflare Pages can't see ${owner}/${repo} yet (one-time setup):`,
    '1. dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git.',
    '2. Choose GitHub → "Add account" / "Configure" and install the Cloudflare Workers and Pages app.',
    `3. Under Repository access pick "All repositories", or "Only select repositories" and include ${repo}.`,
    '4. Save, close that window (you don\'t need to finish creating a project there), then press Rehost again.'
].join('\n');

/* ---------------------------------------------------------------------------
   Framework detection — from the repo alone, no clone
   --------------------------------------------------------------------------- */

const raw = async (slug, branch, path) => {
    try {
        const res = await fetch(`https://raw.githubusercontent.com/${slug}/${branch}/${path}`, {
            headers: { 'user-agent': 'arnav-portfolio-worker' },
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) { res.body?.cancel().catch(() => {}); return ''; }
        return (await res.text()).slice(0, 200_000);
    } catch { return ''; }
};

const envKeysFrom = (text) => [...new Set(String(text || '').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^export\s+/, '').split('=')[0].trim())
    .filter((k) => /^[A-Z][A-Z0-9_]{1,60}$/.test(k)))].slice(0, 30);

/* → { supported, preset, label, build_command, destination_dir, root_dir,
       nodeVersion, envKeys, notes, branch } */
export async function detectPreset(env, slug) {
    const repo = await gh(env, `/repos/${slug}`);
    if (!repo.data) throw new HttpError(404, `GitHub has no public repo ${slug}`);
    const branch = repo.data.default_branch || 'main';
    const tree = await gh(env, `/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const paths = new Set((tree.data && tree.data.tree || []).filter((t) => t.type === 'blob').map((t) => t.path));

    // Where the app lives: the root, or one obvious sub-folder.
    let root = '';
    if (!paths.has('package.json') && !paths.has('index.html')) {
        root = ['web', 'frontend', 'client', 'app', 'site', 'website'].find((d) => paths.has(`${d}/package.json`) || paths.has(`${d}/index.html`)) || '';
    }
    const at = (p) => (root ? `${root}/${p}` : p);
    const has = (p) => paths.has(at(p));

    const notes = [];
    const envFile = ['.env.example', '.env.sample', '.env.template', '.env.local.example'].find((f) => has(f));
    const envKeys = envFile ? envKeysFrom(await raw(slug, branch, at(envFile))) : [];
    if (paths.has('vercel.json') || [...paths].some((p) => /^api\/[^/]+\.(js|ts|mjs)$/.test(p))) {
        notes.push('This repo has Vercel serverless functions (/api) — they won\'t run on Pages; the front end will.');
    }

    let pkg = null;
    if (has('package.json')) {
        try { pkg = JSON.parse(await raw(slug, branch, at('package.json'))); } catch { pkg = null; }
    }
    const nvm = has('.nvmrc') ? (await raw(slug, branch, at('.nvmrc'))).trim().replace(/^v/, '') : '';
    const engines = pkg && pkg.engines && pkg.engines.node ? String(pkg.engines.node).match(/\d+/) : null;
    const nodeVersion = (nvm.match(/^\d+/) || [])[0] || (engines && engines[0]) || '20';

    const base = { branch, root_dir: root, nodeVersion, envKeys, notes };

    if (!pkg) {
        // Plain static site: index.html at the root, or in docs/ or public/.
        if (has('index.html')) return { ...base, supported: true, preset: 'static', label: 'Static HTML', build_command: '', destination_dir: '' };
        for (const d of ['docs', 'public', 'dist', 'site']) {
            if (has(`${d}/index.html`)) return { ...base, supported: true, preset: 'static', label: `Static HTML (${d}/)`, build_command: '', destination_dir: d };
        }
        return { ...base, supported: false, preset: 'unknown', label: 'Unknown', build_command: '', destination_dir: '', notes: [...notes, 'No package.json and no index.html — nothing a static host can serve.'] };
    }

    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};
    const build = scripts.build ? 'npm run build' : '';
    const dep = (n) => Object.prototype.hasOwnProperty.call(deps, n);

    if (dep('next')) {
        const cfgName = ['next.config.mjs', 'next.config.js', 'next.config.ts'].find((f) => has(f));
        const cfg = cfgName ? await raw(slug, branch, at(cfgName)) : '';
        if (/output\s*:\s*['"]export['"]/.test(cfg)) {
            return { ...base, supported: true, preset: 'next-static', label: 'Next.js (static export)', build_command: build || 'npx next build', destination_dir: 'out' };
        }
        return {
            ...base, supported: false, preset: 'next-ssr', label: 'Next.js (server-rendered)', build_command: '', destination_dir: '',
            notes: [...notes, 'Server-rendered Next.js needs a server runtime (OpenNext on Workers), which isn\'t automated. If the app can be static, add output: "export" to next.config and rehost again.']
        };
    }
    if (dep('@remix-run/react') || dep('@remix-run/node')) {
        return { ...base, supported: false, preset: 'remix', label: 'Remix', build_command: '', destination_dir: '', notes: [...notes, 'Remix needs a server runtime — not automated.'] };
    }
    if (dep('@sveltejs/kit')) {
        const isStatic = dep('@sveltejs/adapter-static');
        return {
            ...base, supported: true, preset: 'sveltekit', label: `SvelteKit${isStatic ? ' (static)' : ''}`,
            build_command: build || 'npx vite build', destination_dir: isStatic ? 'build' : '.svelte-kit/cloudflare',
            notes: isStatic || dep('@sveltejs/adapter-cloudflare') || dep('@sveltejs/adapter-auto') ? notes
                : [...notes, 'Uses a non-Cloudflare adapter — switch to @sveltejs/adapter-cloudflare if the build fails.']
        };
    }
    if (dep('astro')) return { ...base, supported: true, preset: 'astro', label: 'Astro', build_command: build || 'npx astro build', destination_dir: 'dist' };
    if (dep('nuxt') || dep('nuxt3')) return { ...base, supported: true, preset: 'nuxt', label: 'Nuxt (generated)', build_command: 'npx nuxi generate', destination_dir: '.output/public' };
    if (dep('gatsby')) return { ...base, supported: true, preset: 'gatsby', label: 'Gatsby', build_command: build || 'npx gatsby build', destination_dir: 'public' };
    if (dep('react-scripts')) return { ...base, supported: true, preset: 'cra', label: 'Create React App', build_command: build || 'npx react-scripts build', destination_dir: 'build' };
    if (dep('vite')) {
        const cfgName = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].find((f) => has(f));
        const cfg = cfgName ? await raw(slug, branch, at(cfgName)) : '';
        const outDir = (cfg.match(/outDir\s*:\s*['"]([^'"]+)['"]/) || [])[1] || 'dist';
        return { ...base, supported: true, preset: 'vite', label: 'Vite', build_command: build || 'npx vite build', destination_dir: outDir.replace(/^\.\//, '') };
    }
    if (dep('@angular/core')) {
        let out = 'dist';
        try {
            const ang = JSON.parse(await raw(slug, branch, at('angular.json')));
            const proj = Object.values(ang.projects || {})[0];
            const o = proj && proj.architect && proj.architect.build && proj.architect.build.options && proj.architect.build.options.outputPath;
            out = typeof o === 'string' ? `${o}/browser` : (o && o.base ? `${o.base}/browser` : out);
        } catch { /* keep the default */ }
        return { ...base, supported: true, preset: 'angular', label: 'Angular', build_command: build || 'npx ng build', destination_dir: out };
    }
    const serverOnly = ['express', 'fastify', 'koa', '@nestjs/core', 'hono'].find(dep);
    if (serverOnly && !has('index.html')) {
        return { ...base, supported: false, preset: 'server', label: `Node server (${serverOnly})`, build_command: '', destination_dir: '', notes: [...notes, 'This is a server app, not a static site — Pages can\'t run it as is.'] };
    }
    if (has('index.html') && !build) return { ...base, supported: true, preset: 'static', label: 'Static HTML', build_command: '', destination_dir: '' };
    if (build) {
        const guess = ['dist', 'build', 'public', 'out'].find((d) => [...paths].some((p) => p.startsWith(at(`${d}/`)))) || 'dist';
        return { ...base, supported: true, preset: 'custom', label: 'Custom build', build_command: build, destination_dir: guess, notes: [...notes, `Build output folder guessed as ${guess}/ — check it if the deploy is empty.`] };
    }
    return { ...base, supported: false, preset: 'unknown', label: 'Unknown', build_command: '', destination_dir: '', notes: [...notes, 'No build script and no index.html.'] };
}

/* ---------------------------------------------------------------------------
   Cloudflare API
   --------------------------------------------------------------------------- */

class CfError extends Error {
    constructor(status, errors) {
        const list = Array.isArray(errors) ? errors : [];
        super(list.map((e) => e.message).filter(Boolean).join('; ') || `Cloudflare API answered ${status}`);
        this.status = status;
        this.codes = list.map((e) => e.code);
    }
}

async function cf(env, path, { method = 'GET', body, form } = {}) {
    const res = await fetch(`${CF_API}/accounts/${env.CF_ACCOUNT_ID}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${env.CF_API_TOKEN}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        body: form || (body !== undefined ? JSON.stringify(body) : undefined),
        signal: AbortSignal.timeout(20_000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new CfError(res.status, data.errors);
    return data.result;
}

const isAuthError = (e) => e instanceof CfError && (e.status === 401 || e.status === 403 || e.codes.includes(10000) || e.codes.includes(9109));
const isGitHubAccessError = (e) => e instanceof CfError && /git ?hub|repositor|installation|access to/i.test(e.message);

async function findPagesProject(env, owner, repo) {
    for (let page = 1; page <= 5; page++) {
        const list = await cf(env, `/pages/projects?per_page=50&page=${page}`);
        if (!Array.isArray(list) || !list.length) return null;
        const hit = list.find((p) => p.source && p.source.config
            && String(p.source.config.repo_name || '').toLowerCase() === repo.toLowerCase()
            && String(p.source.config.owner || '').toLowerCase() === owner.toLowerCase());
        if (hit) return hit;
        if (list.length < 50) return null;
    }
    return null;
}

/* Latest deployment → our four states. */
function stateOf(p) {
    const dep = p && p.latest_deployment;
    const url = p && p.subdomain ? `https://${p.subdomain}` : '';
    if (!dep) return { state: 'building', url, detail: 'Waiting for the first build to start' };
    const stage = dep.latest_stage || {};
    if (stage.status === 'failure' || stage.status === 'canceled') {
        return { state: 'failure', url, detail: `The ${stage.name || 'build'} step ${stage.status === 'canceled' ? 'was cancelled' : 'failed'} — open the build log in the Cloudflare dashboard (Workers & Pages → ${p.name}).` };
    }
    if (stage.name === 'deploy' && stage.status === 'success') return { state: 'success', url: url || dep.url || '', detail: 'Live on Cloudflare Pages' };
    return { state: 'building', url, detail: `${stage.name || 'queued'}: ${stage.status || 'pending'}` };
}

const needsSetup = (detail, extra = {}) => json({ state: 'needs-setup', url: '', detail, ...extra });

async function projectAndRepo(id) {
    const projects = await fetchProjects();
    const project = projects.find((p) => String(p.id) === String(id));
    if (!project) throw new HttpError(404, 'No such project');
    const slug = repoSlugFrom(project.repo) || repoSlugFrom(project.link);
    if (!slug) throw new HttpError(400, 'This project has no GitHub repo to build from');
    const [owner, repo] = slug.split('/');
    return { project, slug, owner, repo };
}

/* ---------------------------------------------------------------------------
   Routes
   --------------------------------------------------------------------------- */

export async function handleRehost(req, env) {
    await requireAdmin(req, env);
    if (!env.CF_ACCOUNT_ID) throw new HttpError(500, 'CF_ACCOUNT_ID is missing from wrangler.jsonc vars');

    if (req.method === 'GET') {
        const id = new URL(req.url).searchParams.get('projectId');
        if (!id) throw new HttpError(400, 'Send ?projectId=');
        if (!env.CF_API_TOKEN) return needsSetup(SETUP_TOKEN);
        const { owner, repo } = await projectAndRepo(id);
        try {
            const found = await findPagesProject(env, owner, repo);
            if (!found) return json({ state: 'none', url: '', detail: 'Not rehosted yet' });
            const full = await cf(env, `/pages/projects/${encodeURIComponent(found.name)}`);
            return json({ ...stateOf(full), pagesProject: full.name });
        } catch (e) {
            if (isAuthError(e)) return needsSetup(`${SETUP_TOKEN}\n\n(Cloudflare said: ${e.message})`);
            throw new HttpError(502, `Cloudflare: ${e.message}`);
        }
    }

    if (req.method !== 'POST') throw new HttpError(405, 'Use GET or POST');
    const body = await readJson(req, 4 * 1024);
    if (!body.projectId) throw new HttpError(400, 'Send { projectId }');
    const { project, slug, owner, repo } = await projectAndRepo(body.projectId);

    let preset;
    try {
        preset = await detectPreset(env, slug);
    } catch (e) {
        if (e instanceof GitHubLimit) throw new HttpError(503, e.message);
        throw e;
    }
    if (!preset.supported) {
        return json({ state: 'error', url: '', pagesProject: '', detail: `${preset.label}: ${preset.notes.join(' ')}`.trim(), preset });
    }
    if (!env.CF_API_TOKEN) return needsSetup(SETUP_TOKEN, { preset });

    const envVars = { NODE_VERSION: { type: 'plain_text', value: String(preset.nodeVersion) } };
    let pages;
    try {
        pages = await findPagesProject(env, owner, repo);
        if (!pages) {
            const base = `ad-${slugify(repo)}`.slice(0, 50).replace(/-+$/, '');
            const create = (name) => cf(env, '/pages/projects', {
                method: 'POST',
                body: {
                    name,
                    production_branch: preset.branch,
                    build_config: { build_command: preset.build_command, destination_dir: preset.destination_dir, root_dir: preset.root_dir },
                    source: {
                        type: 'github',
                        config: {
                            owner, repo_name: repo, production_branch: preset.branch,
                            production_deployments_enabled: true, preview_deployment_setting: 'none', pr_comments_enabled: false
                        }
                    },
                    deployment_configs: { production: { env_vars: envVars }, preview: { env_vars: envVars } }
                }
            });
            try {
                pages = await create(base);
            } catch (e) {
                // Name taken in this account by something else: add a suffix once.
                if (e instanceof CfError && /already|exists|taken/i.test(e.message)) pages = await create(`${base}-${Math.random().toString(36).slice(2, 6)}`);
                else throw e;
            }
        }

        // Kick off a production build from the latest commit.
        const form = new FormData();
        form.append('branch', preset.branch);
        await cf(env, `/pages/projects/${encodeURIComponent(pages.name)}/deployments`, { method: 'POST', form });
    } catch (e) {
        if (isAuthError(e)) return needsSetup(`${SETUP_TOKEN}\n\n(Cloudflare said: ${e.message})`, { preset });
        if (isGitHubAccessError(e)) return needsSetup(`${SETUP_GITHUB(owner, repo)}\n\n(Cloudflare said: ${e.message})`, { preset });
        return json({ state: 'error', url: '', pagesProject: pages ? pages.name : '', detail: `Cloudflare: ${e.message}`, preset });
    }

    const url = pages.subdomain ? `https://${pages.subdomain}` : '';
    const envNote = preset.envKeys.length
        ? ` It may need these environment variables, added in the Pages project settings: ${preset.envKeys.join(', ')}.` : '';
    await writeHistory(env, {
        projectId: project.id,
        kind: 'rehost',
        summary: `Rehosting ${project.title || repo} on Cloudflare Pages (${preset.label})`,
        changes: [change('host', project.link || '', url), change('build', '', `${preset.build_command || '(none)'} → ${preset.destination_dir || '/'}`)]
    });

    return json({
        state: 'building',
        url,
        pagesProject: pages.name,
        detail: `Building with ${preset.label}${preset.build_command ? ` (${preset.build_command} → ${preset.destination_dir || '/'})` : ''}.${envNote}${preset.notes.length ? ` ${preset.notes.join(' ')}` : ''}`,
        preset
    });
}
