/* ===========================================================================
   worker/reposhots.js  —  GET /api/repo-shots?repo=<github url>  (admin)

   The images in a project's repo that are probably screenshots, best first,
   so the admin can pick some for the gallery without downloading and
   re-uploading anything. Ranked by what the repo itself says:

     · shown in the README                       strongest signal
     · fastlane store screenshots (phoneScreenshots/, tenInchScreenshots/…)
     · a screenshots / screens / docs / preview / media folder
     · size — icons, glyphs and sprites are small; screenshots are not

   Launcher icons, build output, Android resource folders and fonts are left
   out. README images hosted elsewhere (GitHub user-attachments, imgur…) are
   included too; badges and SVGs are not.
   =========================================================================== */

import { requireAdmin } from './auth.js';
import { json, HttpError } from './http.js';
import { gh, GitHubLimit, repoSlugFrom } from './github.js';

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const SKIP = /(^|\/)(node_modules|build|dist|out|\.next|\.gradle|\.idea|vendor|third_party|fonts?|mipmap-[\w-]+|drawable[\w-]*|res\/raw|icons?|favicons?|emoji|sprites?|textures?|tiles?)(\/|$)/i;
const ICONISH = /(^|[\/_-])(ic_|icon|logo|launcher|favicon|badge|avatar|splash|playstore|feature[-_]?graphic)/i;
const SHOTDIR = /(^|\/)(screenshots?|screens?|shots?|docs?|preview|previews|media|images?|assets\/screenshots|readme|gallery|showcase|store)(\/|$)/i;
const FASTLANE = /fastlane\/metadata\/android\/[^/]+\/images\/(phone|sevenInch|tenInch|tv|wear)Screenshots\//i;
const MAX_ITEMS = 60;

const rawUrl = (slug, branch, path) =>
    `https://raw.githubusercontent.com/${slug}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;

/* Image references in a README: markdown ![](…) and <img src="…">. */
function readmeImages(md) {
    const out = [];
    for (const m of String(md || '').matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img[^>]+src=["']([^"']+)["']/gi)) {
        out.push((m[1] || m[2] || '').trim());
    }
    return out.filter(Boolean);
}

export async function handleRepoShots(req, env) {
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');
    await requireAdmin(req, env);

    const url = new URL(req.url);
    const slug = repoSlugFrom(url.searchParams.get('repo'));
    if (!slug) throw new HttpError(400, 'Give a GitHub repo link, like https://github.com/you/app');

    try {
        const meta = await gh(env, `/repos/${slug}`);
        if (!meta.data) throw new HttpError(404, `Couldn’t find ${slug} on GitHub (is it private?)`);
        const branch = meta.data.default_branch || 'main';

        const [tree, readme] = await Promise.all([
            gh(env, `/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`),
            gh(env, `/repos/${slug}/readme`, { accept: 'application/vnd.github.raw', raw: true })
        ]);

        // README paths are relative to the README itself (nearly always the root).
        const shown = new Set();
        const external = [];
        readmeImages(readme.data).forEach((src) => {
            if (/^https?:\/\//i.test(src)) {
                if (/shields\.io|badge|\.svg(\?|$)|githubusercontent\.com\/[^/]+\/[^/]+\/workflows|\/actions\/workflows\//i.test(src)) return;
                const local = src.match(/github\.com\/[^/]+\/[^/]+\/(?:blob|raw)\/[^/]+\/(.+)$/i)
                    || src.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/i);
                if (local) shown.add(decodeURIComponent(local[1].split(/[?#]/)[0]));
                else if (IMG.test(src.split(/[?#]/)[0]) || /user-attachments|user-images\.githubusercontent/i.test(src)) external.push(src);
            } else {
                shown.add(decodeURIComponent(src.replace(/^\.?\//, '').split(/[?#]/)[0]));
            }
        });

        const files = ((tree.data && tree.data.tree) || [])
            .filter((t) => t.type === 'blob' && IMG.test(t.path) && !SKIP.test(t.path))
            .map((t) => {
                const inReadme = shown.has(t.path);
                let score = 0;
                if (inReadme) score += 60;
                if (FASTLANE.test(t.path)) score += 50;
                if (SHOTDIR.test(t.path)) score += 25;
                if (/screen|shot|preview|demo/i.test(t.path)) score += 15;
                if (ICONISH.test(t.path)) score -= 50;
                if (t.size < 15_000) score -= 40;             // icons and glyphs
                else if (t.size > 60_000) score += 10;
                return { url: rawUrl(slug, branch, t.path), path: t.path, size: t.size, score, inReadme };
            })
            .filter((f) => f.score > -20)
            .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, undefined, { numeric: true }));

        const items = [
            ...external.map((u, i) => ({ url: u, path: 'README image', size: 0, score: 70 - i, inReadme: true })),
            ...files
        ].slice(0, MAX_ITEMS);

        return json({ repo: slug, branch, items }, { cache: 'private, max-age=60' });
    } catch (e) {
        if (e instanceof GitHubLimit) throw new HttpError(429, e.message);
        throw e;
    }
}
