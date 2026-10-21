/* ===========================================================================
   worker/github.js
   GitHub, read-only, for the importer, the metrics refresh, discovery and
   the activity feed. Uses env.GITHUB_TOKEN when present (5,000 requests an
   hour); otherwise the unauthenticated 60/hour quota, which Cloudflare's
   shared egress addresses can exhaust — a rate limit is reported as a
   GitHubLimit error so callers can say exactly what to fix.
   =========================================================================== */

export class GitHubLimit extends Error {
    constructor() { super('GitHub rate limit — add a GITHUB_TOKEN secret'); }
}

const API = 'https://api.github.com';

export async function gh(env, path, { accept = 'application/vnd.github+json', raw = false, timeout = 10_000 } = {}) {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
        headers: {
            accept,
            'user-agent': 'arnav-portfolio-worker',
            'x-github-api-version': '2022-11-28',
            ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {})
        },
        signal: AbortSignal.timeout(timeout)
    });
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        try { await res.body?.cancel(); } catch { /* closed */ }
        throw new GitHubLimit();
    }
    if (res.status === 404) { try { await res.body?.cancel(); } catch { /* closed */ } return { status: 404, data: null }; }
    if (raw) return { status: res.status, data: res.ok ? await res.text() : null };
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data: res.ok ? data : null };
}

/* github.com/owner/repo[...] or owner.github.io/repo[...] → "owner/repo". */
export function repoSlugFrom(raw) {
    try {
        const u = new URL(String(raw || '').trim());
        const host = u.hostname.toLowerCase();
        const parts = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/').filter(Boolean);
        if (host === 'github.com' || host === 'www.github.com') {
            if (parts.length >= 2 && !['orgs', 'users', 'settings', 'marketplace', 'topics'].includes(parts[0])) {
                return `${parts[0]}/${parts[1]}`;
            }
            return null;
        }
        const m = host.match(/^([a-z0-9-]+)\.github\.io$/);
        if (m) return parts[0] ? `${m[1]}/${parts[0]}` : `${m[1]}/${m[1]}.github.io`;
    } catch { /* not a URL */ }
    return null;
}

/* ---- Release assets → platforms ------------------------------------------ */

const SKIP_ASSET = /(\.sig|\.sha\d*|\.asc|\.blockmap|\.sym|\.pdb|\.dsym(\.zip)?|\.txt|\.json|\.ya?ml|\.md|\.sbom.*)$|sha\d*sums|checksums|^source|[-_.]src[-_.]|source[-_.]v?\d/i;

export function classifyAsset(name) {
    const n = String(name || '').toLowerCase();
    if (SKIP_ASSET.test(n)) return null;
    if (/\.(apk|aab)$/.test(n)) return 'android';
    if (/\.ipa$/.test(n)) return 'ios';
    if (/\.(exe|msi|msix|msixbundle|appx|appxbundle|appinstaller)$/.test(n)) return 'windows';
    if (/\.(dmg|pkg)$/.test(n)) return 'macos';
    if (/\.(appimage|deb|rpm|snap|flatpak)$/.test(n)) return 'linux';
    if (/\.(crx|xpi)$/.test(n)) return 'extension';
    if (/\.(zip|7z|tar\.gz|tgz|tar\.xz)$/.test(n)) {
        if (/(chrom|edge|firefox|extension|addon)/.test(n)) return 'extension';
        if (/(win|windows|x64|x86|amd64)/.test(n) && !/(linux|mac|darwin|osx)/.test(n)) return 'windows';
        if (/(mac|darwin|osx)/.test(n)) return 'macos';
        if (/linux/.test(n)) return 'linux';
        if (/android/.test(n)) return 'android';
    }
    return null;
}

const archOf = (n) => {
    const s = String(n).toLowerCase();
    if (/arm64|aarch64/.test(s)) return 'arm64';
    if (/x64|amd64|x86_64|win64/.test(s)) return 'x64';
    if (/x86|win32|i386|i686/.test(s)) return 'x86';
    if (/universal/.test(s)) return 'universal';
    return '';
};

const LABELS = {
    windows: (n) => (/\.(zip|7z)$/i.test(n) ? 'Windows (portable)' : /\.(msi|msix|msixbundle|appx|appinstaller)$/i.test(n) ? 'Windows installer' : 'Windows app'),
    android: (n) => (/\.aab$/i.test(n) ? 'Android bundle' : 'Android APK'),
    ios: () => 'iOS (sideload .ipa)',
    macos: (n) => (/\.dmg$/i.test(n) ? 'macOS disk image' : 'macOS package'),
    linux: (n) => (/\.appimage$/i.test(n) ? 'Linux AppImage' : /\.deb$/i.test(n) ? 'Linux .deb' : /\.rpm$/i.test(n) ? 'Linux .rpm' : 'Linux'),
    extension: (n) => (/\.xpi$/i.test(n) ? 'Firefox add-on' : 'Browser extension')
};

const stripV = (tag) => String(tag || '').replace(/^v(?=\d)/i, '');

/* Releases → { downloads[], total, latest, platforms[] }.
   downloads lists each platform's assets from the newest release that has
   any for that platform (so an old Linux build still shows if it's the
   latest Linux build); total counts every binary ever downloaded. */
export function summariseReleases(releases) {
    const list = (Array.isArray(releases) ? releases : []).filter((r) => !r.draft);
    let total = 0;
    for (const r of list) {
        for (const a of r.assets || []) if (classifyAsset(a.name)) total += a.download_count || 0;
    }

    const downloads = [];
    const done = new Set();
    for (const r of list) {
        const byPlatform = {};
        for (const a of r.assets || []) {
            const platform = classifyAsset(a.name);
            if (!platform || done.has(platform)) continue;
            (byPlatform[platform] = byPlatform[platform] || []).push(a);
        }
        for (const [platform, assets] of Object.entries(byPlatform)) {
            done.add(platform);
            // Installers before portable zips; bigger first is a decent proxy
            // for "the real app" vs a helper.
            assets.sort((x, y) => (/\.(zip|7z)$/i.test(x.name) - /\.(zip|7z)$/i.test(y.name)) || (y.size - x.size));
            for (const a of assets.slice(0, 3)) {
                downloads.push({
                    platform,
                    label: LABELS[platform](a.name),
                    url: a.browser_download_url,
                    size: Number(a.size) || 0,
                    count: Number(a.download_count) || 0,
                    version: stripV(r.tag_name),
                    arch: archOf(a.name)
                });
            }
        }
    }

    const newest = list.find((r) => !r.prerelease) || list[0] || null;
    // `notes` (the raw release body) is for summarising only — callers strip
    // it before storing anything.
    const latest = newest ? {
        tag: newest.tag_name || '',
        name: newest.name || newest.tag_name || '',
        date: Date.parse(newest.published_at || newest.created_at) || null,
        url: newest.html_url || '',
        notes: String(newest.body || '').slice(0, 6000)
    } : null;

    return { downloads: downloads.slice(0, 12), total, latest, platforms: [...done] };
}

/* Release notes → up to five plain bullet lines, without AI: list items
   first, else the first sentences. Markdown links, images, headings and
   "Full Changelog" boilerplate are dropped. */
export function bulletsFromNotes(notes, max = 5) {
    const text = String(notes || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*|__|`/g, '');
    const clean = (l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();
    const skip = (l) => !l || /^#/.test(l) || /full changelog|^\*?\*?what's changed|^contributors?:|^sha-?256|^checksums?/i.test(l)
        || /^https?:\/\//.test(l) || l.length < 6;
    const lines = text.split(/\r?\n/);
    const items = lines.filter((l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l)).map(clean).filter((l) => !skip(l));
    const pick = items.length ? items : text.replace(/^#.*$/gm, '').split(/(?<=[.!?])\s+/).map(clean).filter((l) => !skip(l));
    return pick.slice(0, max).map((l) => (l.length > 160 ? `${l.slice(0, 157).replace(/\s+\S*$/, '')}…` : l));
}

/* /stats/commit_activity answers 202 while GitHub computes it. One retry. */
export async function commitWeeks(env, slug) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const { status, data } = await gh(env, `/repos/${slug}/stats/commit_activity`);
        if (status === 200 && Array.isArray(data)) return data.slice(-52).map((w) => Number(w.total) || 0);
        if (status !== 202) return [];
        await new Promise((r) => setTimeout(r, 1500));
    }
    return [];
}

export function languagePercents(langs) {
    const entries = Object.entries(langs || {});
    const sum = entries.reduce((a, [, b]) => a + b, 0) || 1;
    return entries.sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([name, bytes]) => ({ name, pct: Math.round((bytes / sum) * 1000) / 10 }));
}

/* Everything the metrics refresh needs for one repo: 4 subrequests
   (repo, languages, releases, commit stats — +1 if stats are computing). */
export async function githubMeta(env, slug) {
    const [repo, langs, rels, weeks] = await Promise.all([
        gh(env, `/repos/${slug}`),
        gh(env, `/repos/${slug}/languages`),
        gh(env, `/repos/${slug}/releases?per_page=30`),
        commitWeeks(env, slug).catch((e) => { if (e instanceof GitHubLimit) throw e; return []; })
    ]);
    if (!repo.data) return null;
    const r = repo.data;
    const rel = summariseReleases(rels.data);
    return {
        repo: r.full_name,
        stars: r.stargazers_count || 0,
        forks: r.forks_count || 0,
        watchers: r.subscribers_count ?? r.watchers_count ?? 0,
        openIssues: r.open_issues_count || 0,
        pushedAt: Date.parse(r.pushed_at) || null,
        createdAt: Date.parse(r.created_at) || null,
        license: (r.license && (r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : r.license.name)) || null,
        languages: languagePercents(langs.data),
        commitWeeks: weeks,
        release: rel.latest,
        downloads: rel.total
    };
}
