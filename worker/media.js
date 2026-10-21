/* ===========================================================================
   worker/media.js  —  GET /api/media/<id>

   Images the admin drops into the editor. The browser compresses each one
   (WebP, longest edge ≤ 1920) and writes it to Firestore at media/{id},
   where id is the start of the image's SHA-256 — so the same picture
   uploaded twice is one document, and a URL's content can never change.

   That immutability is what makes this cheap: each image is read from
   Firestore about once per data centre, then served from the Cache API and
   the visitor's browser cache "forever".
   =========================================================================== */

import { getDoc, FirestoreError } from './firestore.js';
import { HttpError } from './http.js';

const ID_RE = /^[a-f0-9]{24}$/;
const TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);
const IMMUTABLE = 'public, max-age=31536000, immutable';

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function handleMedia(req, env, ctx) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Use GET');
    const url = new URL(req.url);
    // /api/media/<id> with an optional cosmetic extension (.webp, .jpg).
    const id = decodeURIComponent(url.pathname.slice('/api/media/'.length)).replace(/\.(webp|jpe?g|png)$/i, '').toLowerCase();
    if (!ID_RE.test(id)) throw new HttpError(400, 'Not a media id');

    const cacheKey = new Request(`https://media-cache.internal/v1/${id}`);
    try {
        const hit = await caches.default.match(cacheKey);
        if (hit) return new Response(req.method === 'HEAD' ? null : hit.body, hit);
    } catch { /* no cache */ }

    let doc;
    try {
        doc = await getDoc(`media/${id}`);
    } catch (e) {
        // Quota or network trouble: say "try again", and never cache it.
        if (e instanceof FirestoreError) {
            return new Response(JSON.stringify({ ok: false, error: 'The image store is busy — try again shortly' }), {
                status: 503,
                headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store' }
            });
        }
        throw e;
    }
    if (!doc || typeof doc.data !== 'string' || !doc.data) throw new HttpError(404, 'No such image');

    const type = TYPES.has(doc.type) ? doc.type : 'image/webp';
    const bytes = b64ToBytes(doc.data);
    const res = new Response(bytes, {
        headers: {
            'content-type': type,
            'content-length': String(bytes.byteLength),
            'cache-control': IMMUTABLE,
            ...(doc.w && doc.h ? { 'x-image-size': `${doc.w}x${doc.h}` } : {})
        }
    });
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()).catch(() => {}));
    return req.method === 'HEAD' ? new Response(null, res) : res;
}
