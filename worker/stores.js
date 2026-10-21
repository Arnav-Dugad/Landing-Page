/* ===========================================================================
   worker/stores.js
   App-store and package-registry listings, from free public sources only:

     Apple App Store     iTunes Lookup API (official, JSON)
     Firefox add-ons     addons.mozilla.org API v5 (official, JSON)
     npm                 registry + api.npmjs.org download counts (official)
     PyPI                pypi.org JSON API (official)
     Google Play         the public listing page (JSON-LD + visible text)
     Microsoft Store     the public listing page (JSON-LD / Open Graph)
     Chrome Web Store    the public listing page (Open Graph + rating text)
     itch.io             the public page (Open Graph)

   Every reader returns a common shape (or null) and never throws for a
   missing field — a store changing its markup degrades to less detail, not
   to a failed import.
   =========================================================================== */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const decode = (s) => String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();

async function page(url) {
    const res = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return (await res.text()).slice(0, 2_500_000);
}

async function getJson(url) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return res.json();
}

const og = (html, prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
    return m ? decode(m[1]) : '';
};

function jsonLd(html, wantType) {
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        try {
            const data = JSON.parse(m[1].trim());
            const list = Array.isArray(data) ? data : (data['@graph'] || [data]);
            for (const d of list) {
                const t = [].concat(d['@type'] || []);
                if (!wantType || t.some((x) => wantType.test(String(x)))) return d;
            }
        } catch { /* malformed block */ }
    }
    return null;
}

const num = (v) => {
    const n = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/* ---- Detection ------------------------------------------------------------ */

export function storeOf(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch { return null; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname;
    if (host === 'play.google.com' && u.searchParams.get('id')) return { kind: 'play', id: u.searchParams.get('id'), url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(u.searchParams.get('id'))}` };
    if (host === 'apps.apple.com' || host === 'itunes.apple.com') {
        const m = path.match(/\/id(\d{5,})/);
        if (m) return { kind: 'appstore', id: m[1], url: `https://apps.apple.com/app/id${m[1]}` };
    }
    if (host === 'apps.microsoft.com') {
        const m = path.match(/\/(?:detail|store\/detail)\/(?:[^/]+\/)?([a-z0-9]{12})(?:$|[/?])/i);
        if (m) return { kind: 'microsoft', id: m[1].toUpperCase(), url: `https://apps.microsoft.com/detail/${m[1].toLowerCase()}` };
    }
    if (host === 'microsoft.com' && /\/store\/(apps|productid)\//i.test(path)) {
        const m = path.match(/\/([a-z0-9]{12})(?:$|[/?])/i);
        if (m) return { kind: 'microsoft', id: m[1].toUpperCase(), url: `https://apps.microsoft.com/detail/${m[1].toLowerCase()}` };
    }
    if (host === 'chromewebstore.google.com' || (host === 'chrome.google.com' && path.startsWith('/webstore'))) {
        const m = path.match(/\/([a-p]{32})(?:$|[/?])/);
        if (m) return { kind: 'chrome', id: m[1], url: `https://chromewebstore.google.com/detail/${m[1]}` };
    }
    if (host === 'addons.mozilla.org') {
        const m = path.match(/\/addon\/([^/]+)/);
        if (m) return { kind: 'firefox', id: m[1], url: `https://addons.mozilla.org/firefox/addon/${m[1]}/` };
    }
    if (host.endsWith('.itch.io') && path.replace(/\/+$/, '').length > 1) return { kind: 'itch', id: `${host}${path}`, url: u.href };
    if (host === 'npmjs.com' && path.startsWith('/package/')) return { kind: 'npm', id: decodeURIComponent(path.slice(9).replace(/\/+$/, '')), url: u.href };
    if (host === 'pypi.org' && path.startsWith('/project/')) return { kind: 'pypi', id: path.split('/')[2], url: u.href };
    return null;
}

/* Store links mentioned anywhere in a README or page. */
export function findStoreLinks(text) {
    const found = {};
    const re = /https?:\/\/(?:play\.google\.com\/store\/apps\/details\?id=[\w.]+|apps\.apple\.com\/[^\s)"'<>]+|apps\.microsoft\.com\/[^\s)"'<>]+|chromewebstore\.google\.com\/detail\/[^\s)"'<>]+|chrome\.google\.com\/webstore\/detail\/[^\s)"'<>]+|addons\.mozilla\.org\/[^\s)"'<>]+|[a-z0-9-]+\.itch\.io\/[^\s)"'<>]+)/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const s = storeOf(m[0].replace(/[).,]+$/, ''));
        if (s && !found[s.kind]) found[s.kind] = s;
    }
    return Object.values(found);
}

/* ---- Readers: each → { kind, url, name, description, icon, screenshots[], rating, ratings, installs, version, platform } */

async function readPlay(s) {
    const html = await page(`${s.url}&hl=en&gl=US`);
    const ld = jsonLd(html, /SoftwareApplication|MobileApplication/i) || {};
    const agg = ld.aggregateRating || {};
    const installs = (html.match(/>([\d.,]+[KMB]?\+)<\/div><div[^>]*>Downloads</i) || html.match(/([\d.,]+[KMB]?\+)\s*(?:downloads|installs)/i) || [])[1] || '';
    const shots = [...new Set((html.match(/https:\/\/play-lh\.googleusercontent\.com\/[\w-]+(?:=[\w-]+)?/g) || []))]
        .filter((u) => !u.includes('=s48') && !u.includes('=w48'))
        .slice(1, 9)
        .map((u) => u.replace(/=.*$/, '=w1080'));
    return {
        kind: 'play', url: s.url, platform: 'android',
        name: decode(ld.name || og(html, 'og:title').replace(/ - Apps on Google Play$/i, '')),
        description: decode(ld.description || og(html, 'og:description')),
        icon: (ld.image || '').replace(/=.*$/, '=s512') || '',
        screenshots: shots,
        rating: round1(num(agg.ratingValue)), ratings: num(agg.ratingCount),
        installs, version: ''
    };
}

async function readApple(s) {
    const data = await getJson(`https://itunes.apple.com/lookup?id=${s.id}&country=us`);
    const a = (data.results || [])[0];
    if (!a) throw new Error('not found');
    const shots = [...(a.screenshotUrls || []), ...(a.ipadScreenshotUrls || [])].slice(0, 8);
    return {
        kind: 'appstore', url: a.trackViewUrl || s.url, platform: (a.supportedDevices || []).some((d) => /mac/i.test(d)) ? 'macos' : 'ios',
        name: a.trackName || '', description: String(a.description || '').slice(0, 4000),
        icon: a.artworkUrl512 || a.artworkUrl100 || '',
        screenshots: shots,
        rating: round1(num(a.averageUserRating)), ratings: num(a.userRatingCount),
        installs: '', version: a.version || '', genres: a.genres || []
    };
}

async function readMicrosoft(s) {
    const html = await page(s.url);
    const ld = jsonLd(html, /SoftwareApplication|Product/i) || {};
    const agg = ld.aggregateRating || {};
    const shots = [...new Set(html.match(/https:\/\/store-images\.s-microsoft\.com\/image\/apps\.[\w.-]+/g) || [])].slice(1, 9);
    return {
        kind: 'microsoft', url: s.url, platform: 'windows',
        name: decode(ld.name || og(html, 'og:title').replace(/\s*-\s*(Free download and install on Windows|Official app in the Microsoft Store).*$/i, '')),
        description: decode(ld.description || og(html, 'og:description')),
        icon: og(html, 'og:image') || (typeof ld.image === 'string' ? ld.image : ''),
        screenshots: shots,
        rating: round1(num(agg.ratingValue)), ratings: num(agg.ratingCount || agg.reviewCount),
        installs: '', version: ''
    };
}

async function readChrome(s) {
    const html = await page(s.url);
    const users = (html.match(/([\d,]+\+?)\s*users/i) || [])[1] || '';
    const rating = num((html.match(/([\d.]+)\s*out of 5/i) || [])[1]);
    return {
        kind: 'chrome', url: s.url, platform: 'extension',
        name: og(html, 'og:title').replace(/ - Chrome Web Store$/i, ''),
        description: og(html, 'og:description'),
        icon: og(html, 'og:image'), screenshots: [],
        rating: round1(rating), ratings: null, installs: users ? `${users} users` : '', version: ''
    };
}

async function readFirefox(s) {
    const a = await getJson(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(s.id)}/?lang=en-US`);
    const pick = (v) => (v && typeof v === 'object' ? (v['en-US'] || Object.values(v)[0] || '') : (v || ''));
    return {
        kind: 'firefox', url: a.url || s.url, platform: 'extension',
        name: pick(a.name), description: decode(pick(a.summary)),
        icon: a.icon_url || '', screenshots: (a.previews || []).map((p) => p.image_url).filter(Boolean).slice(0, 8),
        rating: round1(num(a.ratings && a.ratings.average)), ratings: num(a.ratings && a.ratings.count),
        installs: a.average_daily_users ? `${Number(a.average_daily_users).toLocaleString('en-US')} daily users` : '',
        version: (a.current_version && a.current_version.version) || ''
    };
}

async function readItch(s) {
    const html = await page(s.url);
    const shots = [...new Set(html.match(/https:\/\/img\.itch\.zone\/[\w/=+-]+\.(?:png|jpg|gif)/g) || [])].slice(0, 8);
    return {
        kind: 'itch', url: s.url, platform: 'web',
        name: og(html, 'og:title'), description: og(html, 'og:description'),
        icon: '', screenshots: shots, cover: og(html, 'og:image'),
        rating: round1(num((html.match(/"ratingValue"\s*:\s*"?([\d.]+)/) || [])[1])), ratings: num((html.match(/"ratingCount"\s*:\s*"?(\d+)/) || [])[1]),
        installs: '', version: ''
    };
}

async function readNpm(s) {
    const [pkg, dl] = await Promise.all([
        getJson(`https://registry.npmjs.org/${encodeURIComponent(s.id).replace('%40', '@')}/latest`),
        getJson(`https://api.npmjs.org/downloads/point/last-month/${s.id}`).catch(() => null)
    ]);
    return {
        kind: 'npm', url: s.url, platform: 'cli',
        name: pkg.name || s.id, description: pkg.description || '', icon: '', screenshots: [],
        rating: null, ratings: null,
        installs: dl && dl.downloads ? `${Number(dl.downloads).toLocaleString('en-US')} downloads last month` : '',
        version: pkg.version || '', keywords: pkg.keywords || [],
        repo: pkg.repository && (pkg.repository.url || pkg.repository)
    };
}

async function readPypi(s) {
    const d = await getJson(`https://pypi.org/pypi/${encodeURIComponent(s.id)}/json`);
    const info = d.info || {};
    return {
        kind: 'pypi', url: s.url, platform: 'cli',
        name: info.name || s.id, description: info.summary || '', icon: '', screenshots: [],
        rating: null, ratings: null, installs: '', version: info.version || '',
        repo: Object.values(info.project_urls || {}).find((u) => /github\.com/.test(u)) || ''
    };
}

const READERS = { play: readPlay, appstore: readApple, microsoft: readMicrosoft, chrome: readChrome, firefox: readFirefox, itch: readItch, npm: readNpm, pypi: readPypi };

export async function readStore(s) {
    const reader = READERS[s.kind];
    if (!reader) return null;
    return reader(s);
}

/* The bit of a listing the metrics refresh keeps, per contract. */
export function storeMeta(listing) {
    if (!listing) return null;
    if (listing.kind === 'play') return { rating: listing.rating, ratings: listing.ratings, installs: listing.installs || '' };
    if (listing.kind === 'appstore') return { rating: listing.rating, ratings: listing.ratings, version: listing.version || '' };
    if (listing.kind === 'microsoft') return { rating: listing.rating, ratings: listing.ratings };
    return null;
}

export const STORE_LABELS = {
    play: 'Google Play', appstore: 'App Store', microsoft: 'Microsoft Store',
    chrome: 'Chrome Web Store', firefox: 'Firefox Add-ons', itch: 'itch.io', npm: 'npm', pypi: 'PyPI'
};
