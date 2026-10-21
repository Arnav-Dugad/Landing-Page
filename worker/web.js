/* ===========================================================================
   worker/web.js
   What a live website says about itself, read the way a browser would:
   title, description, Open Graph image, theme colour, the best icon, the
   PWA manifest, what it's built with (script and markup fingerprints) and
   where it's hosted (response headers). Plus Lighthouse scores from Google
   PageSpeed Insights — free, official, and slow (10–40 s), so it only runs
   when someone is waiting for it on purpose.
   =========================================================================== */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ArnavPortfolioBot/2.0';
const MAX_HTML = 1_500_000;

const decode = (s) => String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();

/* Attributes of every <tag ...> as objects. Regex HTML parsing is crude,
   but head tags are regular enough, and it costs no CPU to speak of. */
function tags(html, name) {
    const out = [];
    const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
    let m;
    while ((m = re.exec(html)) && out.length < 400) {
        const attrs = {};
        const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
        let a;
        while ((a = ar.exec(m[1]))) attrs[a[1].toLowerCase()] = decode(a[3] ?? a[4] ?? a[5] ?? '');
        out.push(attrs);
    }
    return out;
}

const abs = (href, base) => {
    // An empty href would resolve to the page itself — that's "no image",
    // not an image.
    if (!href || !String(href).trim()) return '';
    try {
        const u = new URL(href, base);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch { return ''; }
};

/* Signature → technology. Checked against script/link URLs, inline
   markers and response headers. Ordered roughly by how specific it is. */
const FINGERPRINTS = [
    [/__NEXT_DATA__|\/_next\//, 'Next.js'], [/__NUXT__|\/_nuxt\//, 'Nuxt'],
    [/astro-island|\/_astro\//, 'Astro'], [/data-sveltekit|\/_app\/immutable\//, 'SvelteKit'],
    [/data-reactroot|react-dom|__REACT_DEVTOOLS|react\.production/i, 'React'],
    [/vue(\.runtime)?(\.global)?(\.prod)?\.js|data-v-[0-9a-f]{8}/i, 'Vue'],
    [/svelte/i, 'Svelte'], [/angular(\.min)?\.js|ng-version=/i, 'Angular'],
    [/\/@vite\/|vite\/modulepreload|type="module" crossorigin src="\/assets\/index-/i, 'Vite'],
    [/three(\.module)?(\.min)?\.js|three@|THREE\./, 'Three.js'],
    [/babylon(js)?/i, 'Babylon.js'], [/phaser/i, 'Phaser'], [/pixi(\.min)?\.js|pixi\.js@/i, 'PixiJS'],
    [/firebase(app)?|gstatic\.com\/firebasejs/i, 'Firebase'], [/supabase/i, 'Supabase'],
    [/cdn\.tailwindcss\.com|tailwindcss/i, 'Tailwind'], [/bootstrap(\.min)?\.(css|js)/i, 'Bootstrap'],
    [/gsap(\.min)?\.js|gsap@|ScrollTrigger/, 'GSAP'], [/lenis/i, 'Lenis'],
    [/cesium/i, 'Cesium'], [/leaflet/i, 'Leaflet'], [/mapbox-gl/i, 'Mapbox'], [/maplibre/i, 'MapLibre'],
    [/chart(\.umd)?(\.min)?\.js|chart\.js@/i, 'Chart.js'], [/\bd3(\.v\d)?(\.min)?\.js|d3@\d/i, 'D3'],
    [/plotly/i, 'Plotly'], [/echarts/i, 'ECharts'],
    [/tone(\.min)?\.js|tone@\d/i, 'Tone.js'], [/howler/i, 'Howler.js'],
    [/socket\.io/i, 'WebSockets'], [/peerjs|simple-peer|RTCPeerConnection/i, 'WebRTC'],
    [/serviceWorker\.register|navigator\.serviceWorker/i, 'PWA'],
    [/googletagmanager|gtag\(/i, 'Google Analytics'], [/plausible\.io/i, 'Plausible'],
    [/alpinejs|x-data=/i, 'Alpine.js'], [/htmx\.org|hx-get=/i, 'htmx'],
    [/jquery(\.min)?\.js|jquery@/i, 'jQuery'], [/fonts\.googleapis\.com/i, 'Google Fonts'],
    [/stripe\.com\/v3/i, 'Stripe'], [/clerk/i, 'Clerk'], [/auth0/i, 'Auth0'],
    [/workbox/i, 'Workbox']
];

function hostingFrom(headers, finalUrl) {
    const h = (k) => (headers.get(k) || '').toLowerCase();
    let host = '';
    try { host = new URL(finalUrl).hostname.toLowerCase(); } catch { /* ignore */ }
    if (h('x-vercel-id') || host.endsWith('vercel.app')) return 'Vercel';
    if (host.endsWith('github.io') || h('server') === 'github.com') return 'GitHub Pages';
    if (h('x-nf-request-id') || host.endsWith('netlify.app')) return 'Netlify';
    if (host.endsWith('web.app') || host.endsWith('firebaseapp.com') || /firebase/.test(h('x-served-by'))) return 'Firebase Hosting';
    if (host.endsWith('pages.dev') || host.endsWith('workers.dev') || h('server') === 'cloudflare') return 'Cloudflare';
    if (host.endsWith('onrender.com') || h('x-render-origin-server')) return 'Render';
    if (host.endsWith('fly.dev')) return 'Fly.io';
    if (host.endsWith('herokuapp.com')) return 'Heroku';
    return '';
}

/* Read up to MAX_HTML bytes, no more — some "pages" are 50 MB files. */
async function readCapped(res) {
    const reader = res.body && res.body.getReader();
    if (!reader) return '';
    const chunks = [];
    let size = 0;
    while (size < MAX_HTML) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
    }
    try { await reader.cancel(); } catch { /* closed */ }
    const buf = new Uint8Array(Math.min(size, MAX_HTML));
    let at = 0;
    for (const c of chunks) {
        const take = Math.min(c.byteLength, buf.length - at);
        buf.set(c.subarray(0, take), at);
        at += take;
        if (at >= buf.length) break;
    }
    return new TextDecoder().decode(buf);
}

export async function inspectSite(url) {
    const started = Date.now();
    const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en' },
        signal: AbortSignal.timeout(8000)
    });
    const ms = Date.now() - started;
    const finalUrl = res.url || url;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const html = type.includes('html') ? await readCapped(res) : (await res.body?.cancel().catch(() => {}), '');

    const metas = tags(html, 'meta');
    const links = tags(html, 'link');
    const meta = (key) => {
        const m = metas.find((x) => (x.property || x.name || '').toLowerCase() === key);
        return m ? m.content || '' : '';
    };

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = decode(titleMatch ? titleMatch[1] : '');

    // Icons: apple-touch-icon (usually 180px, opaque) beats a favicon.
    const iconLinks = links.filter((l) => /icon/i.test(l.rel || ''));
    const sizeOf = (l) => Math.max(0, ...String(l.sizes || '').split(/\s+/).map((s) => parseInt(s, 10) || 0));
    const apple = iconLinks.filter((l) => /apple-touch-icon/i.test(l.rel)).sort((a, b) => sizeOf(b) - sizeOf(a))[0];
    const pngIcon = iconLinks.filter((l) => !/apple/i.test(l.rel) && !/\.ico(\?|$)/i.test(l.href || '')).sort((a, b) => sizeOf(b) - sizeOf(a))[0];

    // PWA manifest — one more request, but it has the best icon and colours.
    let manifest = null;
    const manLink = links.find((l) => /manifest/i.test(l.rel || ''));
    if (manLink && manLink.href) {
        const manUrl = abs(manLink.href, finalUrl);
        try {
            const mr = await fetch(manUrl, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(5000) });
            if (mr.ok) {
                const m = await mr.json();
                const icons = (Array.isArray(m.icons) ? m.icons : [])
                    .map((i) => ({ src: abs(i.src, manUrl), size: Math.max(0, ...String(i.sizes || '').split(/\s+/).map((s) => parseInt(s, 10) || 0)), purpose: i.purpose || '' }))
                    .filter((i) => i.src)
                    .sort((a, b) => (/maskable/.test(a.purpose) - /maskable/.test(b.purpose)) || b.size - a.size);
                manifest = {
                    name: String(m.name || m.short_name || '').slice(0, 120),
                    themeColor: m.theme_color || '',
                    backgroundColor: m.background_color || '',
                    icon: icons[0] ? icons[0].src : '',
                    display: m.display || ''
                };
            }
        } catch { /* optional */ }
    }

    const icon = (manifest && manifest.icon) || (apple && abs(apple.href, finalUrl)) || (pngIcon && abs(pngIcon.href, finalUrl)) || '';

    // Fingerprint over script/link URLs, a slice of inline script and markup.
    const scripts = tags(html, 'script').map((s) => s.src || '').join(' ');
    const sheets = links.map((l) => l.href || '').join(' ');
    const sample = `${scripts} ${sheets} ${html.slice(0, 400_000)}`;
    const tech = [];
    for (const [re, name] of FINGERPRINTS) if (re.test(sample) && !tech.includes(name)) tech.push(name);
    const generator = meta('generator');
    if (/wordpress/i.test(generator)) tech.unshift('WordPress');
    if (/framer/i.test(generator)) tech.unshift('Framer');
    if (/webflow/i.test(generator)) tech.unshift('Webflow');
    if (manifest && !tech.includes('PWA')) tech.push('PWA');

    return {
        ok: res.ok,
        code: res.status,
        ms,
        finalUrl,
        title: meta('og:title') || rawTitle,
        rawTitle,
        siteName: meta('og:site_name') || (manifest && manifest.name) || '',
        description: meta('og:description') || meta('description') || meta('twitter:description'),
        image: abs(meta('og:image') || meta('twitter:image') || meta('og:image:url'), finalUrl),
        themeColor: meta('theme-color') || (manifest && (manifest.themeColor || manifest.backgroundColor)) || '',
        icon,
        manifest,
        generator,
        tech: tech.slice(0, 14),
        hosting: hostingFrom(res.headers, finalUrl)
    };
}

/* Google PageSpeed Insights v5. Scores as 0–100 ints. */
export async function pageSpeed(env, url, { timeout = 45_000 } = {}) {
    const q = new URLSearchParams({ url, strategy: 'mobile' });
    for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) q.append('category', c);
    if (env.PSI_API_KEY) q.set('key', env.PSI_API_KEY);
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {
        signal: AbortSignal.timeout(timeout)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.lighthouseResult) {
        const msg = data && data.error && data.error.message;
        throw new Error(res.status === 429 ? 'PageSpeed quota reached — add a PSI_API_KEY secret' : (msg || `PageSpeed answered ${res.status}`).slice(0, 140));
    }
    const cats = data.lighthouseResult.categories || {};
    const score = (k) => (cats[k] && typeof cats[k].score === 'number' ? Math.round(cats[k].score * 100) : null);
    return {
        performance: score('performance'),
        accessibility: score('accessibility'),
        bestPractices: score('best-practices'),
        seo: score('seo'),
        checkedAt: Date.now()
    };
}

/* Strip the " | Brand" / " — Site" tail most <title>s carry. */
export function cleanSiteTitle(title, siteName) {
    let t = decode(title);
    if (siteName && t.toLowerCase() !== siteName.toLowerCase()) {
        t = t.replace(new RegExp(`\\s*[|·•–—:-]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '');
    }
    const parts = t.split(/\s+[|·•–—]\s+/);
    return (parts[0] || t).trim().slice(0, 120);
}
