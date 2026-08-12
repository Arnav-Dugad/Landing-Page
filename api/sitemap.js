/* ===========================================================================
   api/sitemap.js  —  GET /sitemap.xml   (rewritten in vercel.json)

   The static sitemap listed one URL, which meant thirty projects were
   invisible to search engines. This generates the real thing from Firestore:
   the homepage, every /p/<slug> share route, and a case-study page for each
   project that has one.

   Regenerated per request (cached at the edge for an hour), so a project
   added this afternoon is in the sitemap this afternoon.
   =========================================================================== */

import { fetchProjects } from './_project.js';

export const config = { runtime: 'edge' };

const SITE = 'https://www.arnavdugad.in';

/* & < > " ' are the five characters that must not appear raw in XML. */
const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
}[c]));

const isoDate = (ms) => {
    const d = new Date(Number(ms));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function entry({ loc, lastmod, changefreq, priority }) {
    return `  <url>
    <loc>${xml(loc)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export default async function handler() {
    let projects = [];
    try {
        projects = await fetchProjects();
    } catch (e) {
        console.error('Sitemap: Firestore unreachable', e);
        // Still serve a valid sitemap with the pages we know exist statically.
    }

    const urls = [
        entry({ loc: `${SITE}/`, changefreq: 'weekly', priority: '1.0' })
    ];

    // Newest first, and skip anything without a usable slug.
    const ordered = projects
        .filter((p) => p.slug)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const seen = new Set();
    for (const p of ordered) {
        // Two projects sharing a title collapse to one slug; only the first
        // is reachable, so listing both would advertise a duplicate URL.
        if (seen.has(p.slug)) continue;
        seen.add(p.slug);

        const lastmod = isoDate(p.updatedAt || p.createdAt);

        urls.push(entry({
            loc: `${SITE}/p/${encodeURIComponent(p.slug)}`,
            lastmod,
            changefreq: 'monthly',
            priority: p.featured ? '0.9' : '0.7'
        }));

        if (p.caseStudy) {
            urls.push(entry({
                loc: `${SITE}/case?p=${encodeURIComponent(p.slug)}`,
                lastmod,
                changefreq: 'monthly',
                priority: '0.8'
            }));
        }
    }

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

    return new Response(body, {
        headers: {
            'content-type': 'application/xml; charset=utf-8',
            'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
        }
    });
}
