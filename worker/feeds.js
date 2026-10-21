/* ===========================================================================
   worker/feeds.js  —  GET /feed.xml (RSS 2.0) and /feed.json (JSON Feed 1.1)

   The newest thirty projects, generated from Firestore on request. Item
   links point at /p/<slug>, the share route that carries per-project
   preview tags; projects with a case study link that page too.
   =========================================================================== */

import { fetchProjects } from '../api/_project.js';

const SITE = 'https://www.arnavdugad.in';
const TITLE = 'Arnav Dugad — Interactive web work';
const DESCRIPTION = 'New projects from Arnav Dugad: interactive web experiences, games and tools.';
const CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

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
        .filter((p) => p.slug && p.title)
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

export async function handleRss() {
    const list = await items();
    const latest = list.find((p) => p.date)?.date || new Date();

    const entries = list.map((p) => {
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
    }).join('\n');

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

export async function handleJsonFeed() {
    const list = await items();
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
        }))
    };
    return new Response(JSON.stringify(feed, null, 2), {
        headers: { 'content-type': 'application/feed+json; charset=utf-8', 'cache-control': CACHE }
    });
}
