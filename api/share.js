/* ===========================================================================
   api/share.js  —  GET /p/<slug>   (rewritten in vercel.json)

   A hash fragment is never sent to the server, so `/#project-slug` can never
   carry per-project Open Graph tags — a crawler only ever sees the homepage.
   This route fixes that: it returns a small HTML document with the right
   title, description and OG image for one project, then sends a real visitor
   on to the site with that project already open.
   =========================================================================== */

import { findProject, escapeHtml } from './_project.js';

export const config = { runtime: 'edge' };

const SITE = 'https://www.arnavdugad.in';

function page({ title, description, image, canonical, redirect }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Arnav Dugad">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">

<!-- Crawlers stop at the tags above; people continue to the site. -->
<meta http-equiv="refresh" content="0; url=${escapeHtml(redirect)}">
<style>
  html { background: #F7F5F0; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { html { background: #131110; } }
  body { font-family: system-ui, sans-serif; display: grid; place-items: center;
         min-height: 100svh; margin: 0; color: #6E6759; }
</style>
</head>
<body>
  <p>Opening ${escapeHtml(title)}… <a href="${escapeHtml(redirect)}">continue</a></p>
  <script>location.replace(${JSON.stringify(redirect)});</script>
</body>
</html>`;
}

export default async function handler(req) {
    const url = new URL(req.url);
    // Accept both the rewritten ?slug= and a direct /p/<slug> hit.
    const slug = url.searchParams.get('slug')
        || decodeURIComponent(url.pathname.replace(/^\/p\/?/, '')).trim();

    let project = null;
    try {
        if (slug) project = await findProject(slug);
    } catch {
        /* fall through to the generic card below */
    }

    const found = Boolean(project);
    const title = found ? `${project.title} — Arnav Dugad` : 'Arnav Dugad — Interactive web work';
    const description = found
        ? project.desc
        : 'Interactive web experiences, games and tools — every project live, with real GitHub data.';

    // A case study is a real page; everything else deep-links into the grid.
    const redirect = found
        ? (project.caseStudy ? `${SITE}/case.html?p=${encodeURIComponent(slug)}` : `${SITE}/#${encodeURIComponent(slug)}`)
        : `${SITE}/`;

    const image = found ? `${SITE}/api/og?p=${encodeURIComponent(slug)}` : `${SITE}/api/og`;

    return new Response(page({
        title,
        description,
        image,
        canonical: found ? `${SITE}/p/${encodeURIComponent(slug)}` : `${SITE}/`,
        redirect
    }), {
        status: found ? 200 : 404,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400'
        }
    });
}
