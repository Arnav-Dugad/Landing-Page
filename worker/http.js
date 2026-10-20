/* ===========================================================================
   worker/http.js
   Small response helpers shared by every route. Errors always have the shape
   { ok: false, error } so the client never has to guess.
   =========================================================================== */

/* Mirrors the `/(.*)` header block in vercel.json; static files get the same
   set from _headers. */
export const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()'
};

export function withHeaders(res) {
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
}

export function json(data, { status = 200, cache = 'no-store', headers = {} } = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': cache,
            ...headers
        }
    });
}

/* A thrown HttpError becomes a JSON error response at the router. */
export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export const fail = (status, error) => json({ ok: false, error }, { status });

/* Mutating routes only accept JSON. A cross-site form can't send that
   content type without a CORS preflight, and the worker never answers
   preflights — so this doubles as CSRF protection. */
export async function readJson(req, maxBytes = 64 * 1024) {
    const type = req.headers.get('content-type') || '';
    if (!type.toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'Send the body as application/json');
    }
    const text = await req.text();
    if (text.length > maxBytes) throw new HttpError(413, 'Request body is too large');
    try {
        return JSON.parse(text || '{}');
    } catch {
        throw new HttpError(400, 'The body is not valid JSON');
    }
}

export function bearer(req) {
    const header = req.headers.get('authorization') || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : '';
}

/* btoa over a large buffer in chunks — String.fromCharCode(...bigArray)
   blows the argument limit past ~100k bytes. */
export function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
