/* ===========================================================================
   api/_card.js
   The 1200x630 social card layout, shared by both hosts: api/og.js renders
   it with @vercel/og on Vercel, worker/index.js with @cf-wasm/og on
   Cloudflare. Both renderers are Satori underneath and take the same
   element tree and options.

   Built with plain element objects rather than JSX so this file needs no
   transpilation step. Satori requires an explicit `display: flex` on any
   element with more than one child — the layout below follows that rule
   everywhere.
   =========================================================================== */

import { findProject, toneOf } from './_project.js';

const W = 1200;
const H = 630;

/* Both palettes restate css/tokens.css, so a card matches the theme it was
   asked for — ?theme=dark gives the dark site's paper, ink and duotones. */
const PALETTES = {
    light: {
        PAPER: '#F7F5F0', INK: '#100E0C', INK_50: '#4F493F', INK_35: '#6E6759',
        ACCENT: '#C43E1F', LINE: 'rgba(16,14,12,0.14)', TAG_BG: '#EDEAE1', PLAQUE_INK: '#FFFFFF'
    },
    dark: {
        PAPER: '#131110', INK: '#FAF7F1', INK_50: '#B2AA9A', INK_35: '#8B8373',
        ACCENT: '#F2764E', LINE: 'rgba(250,247,241,0.13)', TAG_BG: 'rgba(250,247,241,0.07)', PLAQUE_INK: '#131110'
    }
};

export const themeOf = (value) => (value === 'dark' ? 'dark' : 'light');

/* Tiny hyperscript: h(type, style, ...children) */
const h = (type, props, ...children) => ({
    type,
    props: {
        ...props,
        children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children)
    }
});
const div = (style, ...kids) => h('div', { style }, ...kids);
const text = (style, value) => h('div', { style }, value);

/* Google serves TTF rather than WOFF2 to clients that don't advertise modern
   support, which is the only format satori can use. Any failure here falls
   back to the bundled font — a plain card beats a broken one. */
async function loadFont(family, weight) {
    try {
        const cssUrl = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
        const css = await fetch(cssUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8)' }
        }).then((r) => r.text());

        const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](?:opentype|truetype)['"]\)/);
        if (!match) return null;

        const data = await fetch(match[1]).then((r) => r.arrayBuffer());
        return { name: family.split(':')[0].replace(/\+/g, ' '), data, weight, style: 'normal' };
    } catch {
        return null;
    }
}

/* A project's real app icon as a data URL, so the card can show it in the
   plaque. PNG/JPEG only (what Satori decodes); anything else, or any
   failure, falls back to the lettered plaque. */
async function loadIcon(url) {
    try {
        const u = new URL(String(url || ''));
        if (u.protocol !== 'https:') return null;
        const res = await fetch(u.href, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return null;
        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (type !== 'image/png' && type !== 'image/jpeg') return null;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > 600_000) return null;
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return `data:${type};base64,${btoa(bin)}`;
    } catch {
        return null;
    }
}

/* Everything an ImageResponse needs, minus the ImageResponse itself, so the
   Vercel and Cloudflare entry points can each use their own renderer.
   A caller that already holds the project (the worker does, to version its
   cache key) passes it in to skip the second lookup. */
export async function buildCard(req, opts = {}) {
    const url = new URL(req.url);
    const slug = url.searchParams.get('p');
    const theme = themeOf(opts.theme || url.searchParams.get('theme'));
    const { PAPER, INK, INK_50, INK_35, ACCENT, LINE, TAG_BG, PLAQUE_INK } = PALETTES[theme];

    let project = opts.project !== undefined ? opts.project : null;
    if (opts.project === undefined) {
        try {
            if (slug) project = await findProject(slug);
        } catch {
            /* fall through to the generic card */
        }
    }

    const title = project?.title || 'Arnav Dugad';
    const desc = project?.tagline || project?.desc || 'Interactive web experiences, games and tools.';
    const category = (project?.category || 'portfolio').toUpperCase();
    const year = project?.year || '';
    const tags = (project?.tags || []).filter(Boolean).slice(0, 4);
    const [toneA, toneB] = toneOf(project?.color, theme);
    const initial = String(title).trim().charAt(0).toUpperCase() || 'A';

    const [display, body, iconSrc] = await Promise.all([
        loadFont('Fraunces:opsz,wght@9..144,600', 600),
        loadFont('Inter+Tight:wght@500', 500),
        project?.appIcon ? loadIcon(project.appIcon) : Promise.resolve(null)
    ]);
    const fonts = [display, body].filter(Boolean);

    const displayFamily = display ? 'Fraunces' : 'sans-serif';
    const bodyFamily = body ? 'Inter Tight' : 'sans-serif';

    const card = div(
        {
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            background: PAPER,
            padding: '68px 72px',
            fontFamily: bodyFamily,
            position: 'relative'
        },

        // Accent rule across the very top.
        div({
            position: 'absolute', top: 0, left: 0,
            width: `${W}px`, height: '10px',
            display: 'flex',
            background: `linear-gradient(90deg, ${toneA}, ${toneB})`
        }),

        // ---- Header row: plaque + category ----
        div(
            { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
            div(
                { display: 'flex', alignItems: 'center' },
                iconSrc
                    ? h('img', {
                        src: iconSrc, width: 86, height: 86,
                        style: { width: '86px', height: '86px', borderRadius: '22px', marginRight: '26px', objectFit: 'cover' }
                    })
                    : div(
                        {
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '86px', height: '86px',
                            borderRadius: '24px',
                            background: `linear-gradient(140deg, ${toneA}, ${toneB})`,
                            color: PLAQUE_INK,
                            fontSize: '44px',
                            fontFamily: displayFamily,
                            marginRight: '26px'
                        },
                        initial
                    ),
                div(
                    { display: 'flex', flexDirection: 'column' },
                    text({ fontSize: '22px', color: INK_35, letterSpacing: '0.16em' }, category),
                    text({ fontSize: '22px', color: INK_50, marginTop: '8px' }, year ? String(year) : 'Live project')
                )
            ),
            text(
                {
                    fontSize: '24px', color: INK_50,
                    border: `2px solid ${LINE}`, borderRadius: '999px',
                    padding: '12px 26px', display: 'flex'
                },
                'arnavdugad.in'
            )
        ),

        // ---- Middle: title + description ----
        div(
            { display: 'flex', flexDirection: 'column', marginTop: '30px' },
            text(
                {
                    fontSize: title.length > 26 ? '78px' : '96px',
                    fontFamily: displayFamily,
                    color: INK,
                    lineHeight: 1.04,
                    letterSpacing: '-0.03em',
                    display: 'flex'
                },
                title
            ),
            text(
                {
                    fontSize: '32px', color: INK_50,
                    marginTop: '26px', lineHeight: 1.45,
                    maxWidth: '920px', display: 'flex'
                },
                desc.length > 130 ? `${desc.slice(0, 127)}…` : desc
            )
        ),

        // ---- Footer: tags + wordmark ----
        div(
            { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
            div(
                { display: 'flex', alignItems: 'center' },
                ...(tags.length
                    ? tags.map((t) => text(
                        {
                            fontSize: '22px', color: INK_50,
                            background: TAG_BG, border: `2px solid ${LINE}`,
                            borderRadius: '10px', padding: '10px 18px',
                            marginRight: '12px', display: 'flex'
                        },
                        t))
                    : [text({ fontSize: '22px', color: INK_35, display: 'flex' }, 'Portfolio')])
            ),
            div(
                { display: 'flex', alignItems: 'center' },
                div({
                    width: '14px', height: '14px', borderRadius: '999px',
                    background: ACCENT, marginRight: '14px', display: 'flex'
                }),
                text({ fontSize: '26px', color: INK, fontFamily: displayFamily }, 'Arnav Dugad')
            )
        )
    );

    return [card, {
        width: W,
        height: H,
        ...(fonts.length ? { fonts } : {}),
        headers: {
            // Long CDN cache, but revalidated so an edit shows up quickly.
            'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
        }
    }];
}
