/* ===========================================================================
   worker/discover.js  —  GET /api/discover   (admin only)

   Every public repo of GITHUB_USER, each marked with whether it's already
   on the site and a first guess at its platforms — so adding the rest of
   your work is a list of checkboxes, not a list of chores.
   =========================================================================== */

import { fetchProjects } from '../api/_project.js';
import { requireAdmin } from './auth.js';
import { json, HttpError } from './http.js';
import { gh, GitHubLimit, repoSlugFrom } from './github.js';

const norm = (u) => {
    try {
        const x = new URL(String(u || ''));
        return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch { return ''; }
};

export function guessPlatforms(r) {
    const name = String(r.name || '').toLowerCase();
    const lang = String(r.language || '').toLowerCase();
    const topics = (r.topics || []).map((t) => t.toLowerCase());
    const has = (...xs) => xs.some((x) => topics.includes(x) || name.includes(x));
    const out = new Set();
    if (/-android$|android/.test(name) || (lang === 'kotlin' && !has('server', 'backend')) || has('android', 'jetpack-compose')) out.add('android');
    if (/-(windows|win)$/.test(name) || (lang === 'c#' && has('wpf', 'winui', 'winforms', 'windows')) || has('wpf', 'winui')) out.add('windows');
    if (/-ios$/.test(name) || lang === 'swift' || has('ios', 'swiftui')) out.add('ios');
    if (has('macos')) out.add('macos');
    if (has('chrome-extension', 'browser-extension', 'firefox-addon')) out.add('extension');
    if (has('tauri', 'electron')) { out.add('windows'); out.add('macos'); out.add('linux'); }
    if (has('cli', 'command-line')) out.add('cli');
    if (!out.size && (r.homepage || /^(html|css|javascript|typescript|vue|svelte|astro)$/.test(lang))) out.add('web');
    return [...out];
}

export async function handleDiscover(req, env) {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET');
    await requireAdmin(req, env);
    const user = env.GITHUB_USER || 'Arnav-Dugad';

    const repos = [];
    try {
        for (let page = 1; page <= 4; page++) {
            const { data } = await gh(env, `/users/${encodeURIComponent(user)}/repos?per_page=100&type=owner&sort=pushed&page=${page}`);
            if (!Array.isArray(data) || !data.length) break;
            repos.push(...data);
            if (data.length < 100) break;
        }
    } catch (e) {
        if (e instanceof GitHubLimit) throw new HttpError(503, e.message);
        throw e;
    }

    const projects = await fetchProjects().catch(() => []);
    const bySlug = new Map();
    const byLink = new Map();
    for (const p of projects) {
        const s = repoSlugFrom(p.repo) || repoSlugFrom(p.link);
        if (s) bySlug.set(s.toLowerCase(), String(p.id));
        if (p.link) byLink.set(norm(p.link), String(p.id));
    }

    const out = repos.map((r) => {
        const id = bySlug.get(String(r.full_name).toLowerCase())
            || (r.homepage && byLink.get(norm(r.homepage)))
            || byLink.get(`${user.toLowerCase()}.github.io/${String(r.name).toLowerCase()}`)
            || null;
        return {
            name: r.name,
            fullName: r.full_name,
            url: r.html_url,
            description: r.description || '',
            homepage: r.homepage || '',
            stars: r.stargazers_count || 0,
            pushedAt: Date.parse(r.pushed_at) || null,
            createdAt: Date.parse(r.created_at) || null,
            language: r.language || '',
            topics: r.topics || [],
            fork: !!r.fork,
            archived: !!r.archived,
            platformsGuess: guessPlatforms(r),
            inPortfolio: !!id,
            projectId: id
        };
    }).sort((a, b) => (a.fork - b.fork) || ((b.pushedAt || 0) - (a.pushedAt || 0)));

    return json({ user, repos: out });
}
