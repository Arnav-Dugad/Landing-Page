/* ===========================================================================
   worker/activity.js  —  GET /api/activity, GET /api/contributions

   What's being shipped right now, straight from GitHub:

     /api/activity        the latest public pushes, releases and new repos
                          (REST events API — works without a token)
     /api/contributions   the year's contribution calendar (GraphQL — needs
                          GITHUB_TOKEN; answers 503 without one)

   Both are cached at the edge and per isolate for ten minutes.
   =========================================================================== */

import { json, HttpError } from './http.js';
import { gh, GitHubLimit } from './github.js';

const TTL_MS = 10 * 60 * 1000;
const memo = new Map();

async function cached(key, ctx, build) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    const cacheKey = new Request(`https://activity-cache.internal/v1/${key}`);
    try {
        const res = await caches.default.match(cacheKey);
        if (res) {
            const data = await res.json();
            memo.set(key, { at: Date.now(), data });
            return data;
        }
    } catch { /* no cache */ }
    const data = await build();
    memo.set(key, { at: Date.now(), data });
    ctx.waitUntil(caches.default.put(cacheKey, new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' }
    })).catch(() => {}));
    return data;
}

function itemFrom(e) {
    const repo = e.repo && e.repo.name ? e.repo.name : '';
    const short = repo.split('/').pop();
    const at = Date.parse(e.created_at) || null;
    const p = e.payload || {};
    if (e.type === 'PushEvent') {
        const commits = Array.isArray(p.commits) ? p.commits : [];
        const last = commits[commits.length - 1];
        const msg = last && last.message ? String(last.message).split('\n')[0].slice(0, 120) : '';
        const n = p.size || p.distinct_size || commits.length || 1;
        return {
            type: 'push', repo,
            title: msg || `Pushed ${n} commit${n === 1 ? '' : 's'} to ${short}`,
            url: last && last.sha ? `https://github.com/${repo}/commit/${last.sha}` : `https://github.com/${repo}`,
            at, commits: n
        };
    }
    if (e.type === 'ReleaseEvent' && p.action === 'published' && p.release) {
        return {
            type: 'release', repo,
            title: `Released ${short} ${p.release.tag_name || ''}`.trim(),
            url: p.release.html_url || `https://github.com/${repo}/releases`, at
        };
    }
    if (e.type === 'CreateEvent' && p.ref_type === 'repository') {
        return { type: 'create', repo, title: `Started ${short}`, url: `https://github.com/${repo}`, at };
    }
    if (e.type === 'WatchEvent') {
        return { type: 'star', repo, title: `Starred ${repo}`, url: `https://github.com/${repo}`, at };
    }
    return null;
}

export async function handleActivity(req, env, ctx) {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET');
    const user = env.GITHUB_USER || 'Arnav-Dugad';
    const data = await cached(`events/${user}`, ctx, async () => {
        let events;
        try {
            ({ data: events } = await gh(env, `/users/${encodeURIComponent(user)}/events/public?per_page=60`));
        } catch (e) {
            if (e instanceof GitHubLimit) throw new HttpError(503, e.message);
            throw e;
        }
        const items = [];
        const seenPush = new Set();
        for (const e of Array.isArray(events) ? events : []) {
            const it = itemFrom(e);
            if (!it) continue;
            // One line per repo per day of pushing, not one per push.
            if (it.type === 'push') {
                const k = `${it.repo}/${new Date(it.at).toISOString().slice(0, 10)}`;
                if (seenPush.has(k)) continue;
                seenPush.add(k);
            }
            items.push(it);
            if (items.length >= 20) break;
        }
        return { items };
    });
    return json(data, { cache: 'public, max-age=300' });
}

export async function handleContributions(req, env, ctx) {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET');
    if (!env.GITHUB_TOKEN) throw new HttpError(503, 'needs GITHUB_TOKEN');
    const user = env.GITHUB_USER || 'Arnav-Dugad';
    const data = await cached(`contrib/${user}`, ctx, async () => {
        const res = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${env.GITHUB_TOKEN}`,
                'content-type': 'application/json',
                'user-agent': 'arnav-portfolio-worker'
            },
            body: JSON.stringify({
                query: `query($login:String!){ user(login:$login){ contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`,
                variables: { login: user }
            }),
            signal: AbortSignal.timeout(10_000)
        });
        const body = await res.json().catch(() => null);
        const cal = body && body.data && body.data.user && body.data.user.contributionsCollection.contributionCalendar;
        if (!res.ok || !cal) throw new HttpError(502, (body && body.errors && body.errors[0] && body.errors[0].message) || `GitHub answered ${res.status}`);
        return {
            total: cal.totalContributions,
            weeks: cal.weeks.map((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })))
        };
    });
    return json(data, { cache: 'public, max-age=600' });
}
