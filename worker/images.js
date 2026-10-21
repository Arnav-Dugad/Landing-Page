/* ===========================================================================
   worker/images.js
   Choosing a project's cover and describing its screenshots.

     · imageInfo(url)      dimensions from the first few KB of the file
                           (PNG, JPEG, GIF, WebP headers) — a Range request,
                           not a full download
     · pickCover(...)      the heuristic: the largest landscape image that
                           isn't a logo; used when no AI key is set and as
                           the starting point the model can overrule
     · visionPick(...)     ONE multimodal call over up to 8 images: which is
                           the best cover, and alt text for every screenshot
   =========================================================================== */

import { structured, availableProvider, strList, clip } from './ai.js';
import { toBase64 } from './http.js';

const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

/* Width/height from the header bytes, or null. */
export function dimsFromBytes(b) {
    if (!b || b.length < 24) return null;
    // PNG: IHDR right after the signature.
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32be(b, 16), h: u32be(b, 20), type: 'png' };
    // GIF
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: u16le(b, 6), h: u16le(b, 8), type: 'gif' };
    // WebP: RIFF....WEBP then VP8 / VP8L / VP8X
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 && b.length >= 30) {
        const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
        if (chunk === 'VP8X') return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1, type: 'webp' };
        if (chunk === 'VP8L') {
            const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
            return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, type: 'webp' };
        }
        if (chunk === 'VP8 ') return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff, type: 'webp' };
    }
    // JPEG: walk segments to the first SOFn.
    if (b[0] === 0xff && b[1] === 0xd8) {
        let o = 2;
        while (o + 9 < b.length) {
            if (b[o] !== 0xff) { o++; continue; }
            const marker = b[o + 1];
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                return { w: u16be(b, o + 7), h: u16be(b, o + 5), type: 'jpeg' };
            }
            const len = u16be(b, o + 2);
            if (len < 2) return null;
            o += 2 + len;
        }
    }
    return null;
}

export async function imageInfo(url) {
    try {
        const res = await fetch(url, {
            headers: { range: 'bytes=0-65535', 'user-agent': 'arnav-portfolio-worker', accept: 'image/*' },
            redirect: 'follow',
            signal: AbortSignal.timeout(6000)
        });
        if (!res.ok && res.status !== 206) { res.body?.cancel().catch(() => {}); return null; }
        // Read at most 64 KB even if the server ignored the Range header.
        const reader = res.body.getReader();
        const parts = [];
        let size = 0;
        while (size < 65536) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            size += value.byteLength;
        }
        reader.cancel().catch(() => {});
        const buf = new Uint8Array(Math.min(size, 65536));
        let at = 0;
        for (const p of parts) { const take = Math.min(p.byteLength, buf.length - at); buf.set(p.subarray(0, take), at); at += take; if (at >= buf.length) break; }
        const dims = dimsFromBytes(buf);
        return dims && dims.w > 0 && dims.h > 0 ? dims : null;
    } catch { return null; }
}

const LOGOISH = /logo|icon|avatar|favicon|badge|banner-small|mark/i;

/* Candidates in priority order; returns the chosen URL. A landscape image at
   least 600 px wide that isn't a logo wins, largest first; otherwise the
   largest of anything; otherwise the first candidate. */
export function pickCover(candidates, infos) {
    const scored = candidates.map((url, i) => ({ url, i, d: infos[i] }))
        .filter((x) => x.url);
    const land = scored.filter((x) => x.d && x.d.w >= 600 && x.d.w >= x.d.h * 1.15 && !LOGOISH.test(x.url.split('/').pop()));
    const byArea = (a, b) => (b.d.w * b.d.h) - (a.d.w * a.d.h) || a.i - b.i;
    if (land.length) return land.sort(byArea)[0].url;
    // Never a logo or icon as the cover — no cover is better (the site
    // falls back to the app icon or a live screenshot).
    const notLogo = scored.filter((x) => !LOGOISH.test(x.url.split('/').pop().split('?')[0]));
    const any = notLogo.filter((x) => x.d && x.d.w >= 300 && x.d.h >= 200);
    if (any.length) return any.sort(byArea)[0].url;
    // Unmeasured candidates only if they at least look like image files.
    const unmeasured = notLogo.find((x) => !x.d && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(x.url));
    return unmeasured ? unmeasured.url : '';
}

const VISION_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_EACH = 3.5 * 1024 * 1024;
const MAX_TOTAL = 14 * 1024 * 1024;

async function download(url) {
    try {
        const res = await fetch(url, { headers: { accept: 'image/*', 'user-agent': 'arnav-portfolio-worker' }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) { res.body?.cancel().catch(() => {}); return null; }
        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!VISION_TYPES.has(type)) { res.body?.cancel().catch(() => {}); return null; }
        if (Number(res.headers.get('content-length') || 0) > MAX_EACH) { res.body?.cancel().catch(() => {}); return null; }
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_EACH) return null;
        return { mediaType: type, data: toBase64(buf), bytes: buf.byteLength };
    } catch { return null; }
}

const VISION_SCHEMA = {
    type: 'object',
    properties: {
        cover: { type: 'integer', description: 'Number (1-based) of the image that best represents the product as a hero/cover: the real interface, landscape, readable — not a logo, icon, badge or diagram. 0 if none is suitable.' },
        alts: { type: 'array', items: { type: 'string' }, description: 'One alt text per image, in order. What is visible, one sentence, max 140 characters, no "Screenshot of".' }
    },
    required: ['cover', 'alts'],
    additionalProperties: false
};

/* → { cover: url|'' , alts: string[] (aligned with `images`), label } or null
   when no provider is configured or the call fails (callers keep their
   heuristic result). */
export async function visionPick(env, { prefer, model }, images, context) {
    if (!images.length || !availableProvider(env, prefer)) return null;
    const list = images.slice(0, 8);
    const loaded = [];
    let total = 0;
    for (const img of await Promise.all(list.map(download))) {
        if (img && total + img.bytes <= MAX_TOTAL) { loaded.push(img); total += img.bytes; }
        else loaded.push(null);
    }
    const usable = loaded.map((img, i) => (img ? { img, i } : null)).filter(Boolean);
    if (!usable.length) return null;

    const parts = [];
    usable.forEach(({ img }, n) => {
        parts.push({ type: 'text', text: `Image ${n + 1}:` });
        parts.push({ type: 'image', mediaType: img.mediaType, data: img.data });
    });
    parts.push({ type: 'text', text: `These images were found for the project "${context.title || ''}"${context.desc ? ` — ${context.desc}` : ''}. Pick the best cover and describe each image.` });

    try {
        const { data, label, model: used } = await structured(env, {
            prefer, model,
            system: 'You choose and describe screenshots for a portfolio entry. Describe only what is visible. British spelling. Return only the JSON object.',
            user: parts,
            schema: VISION_SCHEMA,
            maxTokens: 3000
        });
        const altsUsable = strList(data.alts, usable.length, 300).map((a) => clip(a.replace(/^(an?\s+)?(screenshot|image|picture)\s+(of|showing)\s+/i, ''), 140));
        const alts = list.map(() => '');
        usable.forEach(({ i }, n) => { const a = altsUsable[n] || ''; alts[i] = a ? a.charAt(0).toUpperCase() + a.slice(1) : ''; });
        const coverN = Number(data.cover);
        const cover = coverN >= 1 && coverN <= usable.length ? list[usable[coverN - 1].i] : '';
        return { cover, alts, label: `${label} (${used})` };
    } catch (e) {
        console.error('vision pick', e && e.message);
        return null;
    }
}
