/* ===========================================================================
   worker/feeds.js  —  GET /feed.xml (RSS 2.0) and /feed.json (JSON Feed 1.1)

   The newest thirty projects, generated from Firestore on request. Item
   links point at /p/<slug>, the share route that carries per-project
   preview tags; projects with a case study link that page too.
   =========================================================================== */

import { fetchProjects } from '../api/_project.js';
import { releaseItems } from './releases.js';

const SITE = 'https://www.arnavdugad.in';
const TITLE = 'Arnav Dugad — Interactive web work';
const DESCRIPTION = 'New projects and releases from Arnav Dugad: websites, Windows and Android apps, games and tools.';
const CACHE = 'public, max-age=600, stale-while-revalidate=86400';

/* Feeds are polled by readers on a timer; one rendered copy per data
   centre for ten minutes keeps that off Firestore entirely. */
async function cached(key, ctx, build) {
    const cacheKey = new Request(`https://feed-cache.internal/v2/${key}`);
    try {
        const hit = await caches.default.match(cacheKey);
        if (hit) return new Response(hit.body, hit);
    } catch { /* no cache */ }
    const res = await build();
    if (ctx) ctx.waitUntil(caches.default.put(cacheKey, res.clone()).catch(() => {}));
    return res;
}

/* Release items, shaped like project items so both feeds can mix them. */
async function releaseEntries() {
    const list = await releaseItems().catch(() => []);
    return list.slice(0, 15).map((r) => ({
        kind: 'release',
        slug: r.slug,
        title: `${r.title} ${r.name || r.tag}`.trim(),
        url: `${SITE}/p/${encodeURIComponent(r.slug)}`,
        id: `${SITE}/p/${encodeURIComponent(r.slug)}#release-${encodeURIComponent(r.tag)}`,
        releaseUrl: r.url,
        summary: r.summary,
        platforms: r.platforms,
        date: validDate(r.date)
    }));
}

const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[c]));

/* CDATA can't contain its own terminator; split it if it appears. */
const cdata = (v) => `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const validDate = (ms) => {
    const d = new Date(Number(ms));
    return Number.isNaN(d.getTime()) || !ms ? null : d;
};

async function items() {
    let projects = [];
    try {
        projects = await fetchProjects();
    } catch (e) {
        console.error('feeds: Firestore unreachable', e && e.message);
    }
    const seen = new Set();
    return projects
        .filter((p) => p.slug && p.title && !p.hidden)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .filter((p) => (seen.has(p.slug) ? false : (seen.add(p.slug), true)))
        .slice(0, 30)
        .map((p) => ({
            ...p,
            url: `${SITE}/p/${encodeURIComponent(p.slug)}`,
            caseUrl: p.caseStudy ? `${SITE}/case?p=${encodeURIComponent(p.slug)}` : null,
            date: validDate(p.createdAt)
        }));
}

export function handleRss(ctx) {
    return cached('rss', ctx, buildRss);
}

const releaseRss = (r) => {
    const body = [
        `<p><strong>New release:</strong> ${xml(r.title)}</p>`,
        r.summary && r.summary.length ? `<ul>${r.summary.map((b) => `<li>${xml(b)}</li>`).join('')}</ul>` : '',
        r.releaseUrl ? `<p><a href="${xml(r.releaseUrl)}">Release notes and downloads</a></p>` : ''
    ].join('');
    return `    <item>
      <title>${xml(r.title)}</title>
      <link>${xml(r.url)}</link>
      <guid isPermaLink="false">${xml(r.id)}</guid>${r.date ? `
      <pubDate>${r.date.toUTCString()}</pubDate>` : ''}
      <category>release</category>
      <description>${cdata(body)}</description>
    </item>`;
};

async function buildRss() {
    const [list, releases] = await Promise.all([items(), releaseEntries()]);
    const latest = [...list, ...releases].map((x) => x.date).filter(Boolean).sort((a, b) => b - a)[0] || new Date();

    const projectEntries = list.map((p) => {
        const body = [
            p.cover ? `<p><img src="${xml(p.cover)}" alt="${xml(p.title)}"></p>` : '',
            p.tagline ? `<p><strong>${xml(p.tagline)}</strong></p>` : '',
            `<p>${xml(p.desc || '')}</p>`,
            p.platforms && p.platforms.length ? `<p>Runs on ${xml(p.platforms.join(', '))}${p.version ? ` · v${xml(p.version)}` : ''}</p>` : '',
            p.tags && p.tags.length ? `<p>Built with ${xml(p.tags.filter(Boolean).join(', '))}</p>` : '',
            p.caseUrl ? `<p><a href="${xml(p.caseUrl)}">Read the case study</a></p>` : '',
            p.link ? `<p><a href="${xml(p.link)}">Open it live</a></p>` : ''
        ].join('');
        return `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(p.url)}</link>
      <guid isPermaLink="true">${xml(p.url)}</guid>${p.date ? `
      <pubDate>${p.date.toUTCString()}</pubDate>` : ''}${p.category ? `
      <category>${xml(p.category)}</category>` : ''}${p.caseUrl ? `
      <comments>${xml(p.caseUrl)}</comments>` : ''}
      <description>${cdata(body)}</description>
    </item>`;
    });

    // Newest first across projects and releases.
    const dated = [
        ...list.map((p, i) => ({ date: p.date, xml: projectEntries[i] })),
        ...releases.map((r) => ({ date: r.date, xml: releaseRss(r) }))
    ].sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
    const entries = dated.slice(0, 45).map((x) => x.xml).join('\n');

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(TITLE)}</title>
    <link>${SITE}/</link>
    <description>${xml(DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${latest.toUTCString()}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
${entries}
  </channel>
</rss>
`;
    return new Response(body, {
        headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': CACHE }
    });
}

export function handleJsonFeed(ctx) {
    return cached('json', ctx, buildJsonFeed);
}

async function buildJsonFeed() {
    const [list, releases] = await Promise.all([items(), releaseEntries()]);
    const releaseJson = releases.map((r) => ({
        id: r.id,
        url: r.url,
        ...(r.releaseUrl ? { external_url: r.releaseUrl } : {}),
        title: r.title,
        summary: (r.summary || [])[0] || `New release: ${r.title}`,
        content_text: (r.summary || []).map((b) => `• ${b}`).join('\n') || r.title,
        ...(r.date ? { date_published: r.date.toISOString() } : {}),
        tags: ['release', ...(r.platforms || [])]
    }));
    const feed = {
        version: 'https://jsonfeed.org/version/1.1',
        title: TITLE,
        home_page_url: `${SITE}/`,
        feed_url: `${SITE}/feed.json`,
        description: DESCRIPTION,
        language: 'en',
        authors: [{ name: 'Arnav Dugad', url: `${SITE}/` }],
        items: list.map((p) => ({
            id: p.url,
            url: p.url,
            ...(p.caseUrl ? { external_url: p.caseUrl } : (p.link ? { external_url: p.link } : {})),
            title: p.title,
            summary: p.tagline || p.desc || '',
            content_text: [p.desc, p.longDesc].filter(Boolean).join('\n\n') || p.title,
            image: p.cover || `${SITE}/api/og?p=${encodeURIComponent(p.slug)}`,
            ...(p.appIcon ? { banner_image: `${SITE}/api/og?p=${encodeURIComponent(p.slug)}` } : {}),
            ...(p.date ? { date_published: p.date.toISOString() } : {}),
            ...(p.updatedAt && validDate(p.updatedAt) ? { date_modified: validDate(p.updatedAt).toISOString() } : {}),
            tags: [p.category, ...(p.platforms || []), ...(p.tags || [])].filter(Boolean)
        })).concat(releaseJson)
            .sort((a, b) => Date.parse(b.date_published || 0) - Date.parse(a.date_published || 0))
            .slice(0, 45)
    };
    return new Response(JSON.stringify(feed, null, 2), {
        headers: { 'content-type': 'application/feed+json; charset=utf-8', 'cache-control': CACHE }
    });
}
