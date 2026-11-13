// Cloudflare Worker entry for DropLink (File Sharing): the three former
// Vercel functions on Web Crypto, everything else from the static files.

const STUN = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' }
];
const CRED_TTL_SECONDS = 8 * 60 * 60;

const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache }
});

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmacSha1Base64(secret, msg) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    return b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

function guard(req, allowed = ['GET']) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: allowed.concat('OPTIONS').join(', ') } });
    if (!allowed.includes(req.method)) return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { allow: allowed.join(', '), 'content-type': 'application/json' } });
    return null;
}

export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        const p = url.pathname;

        if (p === '/api/ice') {
            const g = guard(req); if (g) return g;
            const iceServers = STUN.slice();
            const urls = String(env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
            if (urls.length) {
                if (env.TURN_SECRET) {
                    const username = `${Math.floor(Date.now() / 1000) + CRED_TTL_SECONDS}:droplink`;
                    iceServers.push({ urls, username, credential: await hmacSha1Base64(env.TURN_SECRET, username) });
                } else if (env.TURN_USERNAME && env.TURN_CREDENTIAL) {
                    iceServers.push({ urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
                }
            }
            return json({ iceServers, ttl: CRED_TTL_SECONDS }, 200, 'private, max-age=300');
        }

        if (p === '/api/scope') {
            const g = guard(req); if (g) return g;
            const ip = req.headers.get('cf-connecting-ip') || '';
            if (!ip) return json({ scope: null, reason: 'no_client_ip' });
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.SCOPE_SALT}|${ip}`));
            return json({ scope: hex(digest).slice(0, 16) });
        }

        if (p === '/api/health') {
            const g = guard(req); if (g) return g;
            return json({
                ok: true,
                host: 'cloudflare-workers',
                turnConfigured: Boolean(env.TURN_URLS && (env.TURN_SECRET || (env.TURN_USERNAME && env.TURN_CREDENTIAL))),
                scopeSaltConfigured: Boolean(env.SCOPE_SALT),
                time: new Date().toISOString()
            });
        }

        return env.ASSETS.fetch(req);
    }
};
