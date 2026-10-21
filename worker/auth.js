/* ===========================================================================
   worker/auth.js
   Verifies a Firebase ID token (RS256 JWT) with WebCrypto — no SDK. The
   admin routes accept a request only when the token is genuine, unexpired,
   issued for this project, from a password sign-in, and for ADMIN_EMAIL.

   `verifyIdToken` takes its key source and clock as options so it can be
   tested against a locally generated keypair.
   =========================================================================== */

import { PROJECT_ID } from '../api/_project.js';
import { HttpError, bearer } from './http.js';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/* Google rotates these keys every few hours and says how long to keep them
   in Cache-Control max-age. Cached per isolate. */
let jwksCache = { keys: null, expiresAt: 0 };

export async function googleJwks() {
    if (jwksCache.keys && Date.now() < jwksCache.expiresAt) return jwksCache.keys;
    const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600 } });
    if (!res.ok) throw new HttpError(503, 'Could not fetch Google signing keys');
    const { keys } = await res.json();
    const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    jwksCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
    return keys;
}

const b64urlBytes = (s) => {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

const deny = (why) => { throw new HttpError(401, `Not authorised: ${why}`); };

export async function verifyIdToken(token, {
    projectId = PROJECT_ID,
    adminEmail,
    getJwks = googleJwks,
    now = () => Math.floor(Date.now() / 1000)
} = {}) {
    if (!token) deny('no token');
    const parts = token.split('.');
    if (parts.length !== 3) deny('malformed token');

    let header, claims;
    try {
        header = b64urlJson(parts[0]);
        claims = b64urlJson(parts[1]);
    } catch {
        deny('malformed token');
    }
    if (header.alg !== 'RS256' || !header.kid) deny('unexpected algorithm');

    const jwk = (await getJwks()).find((k) => k.kid === header.kid);
    if (!jwk) deny('unknown signing key');

    const key = await crypto.subtle.importKey(
        'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) deny('bad signature');

    const t = now();
    const skew = 60;
    if (claims.aud !== projectId) deny('wrong audience');
    if (claims.iss !== `https://securetoken.google.com/${projectId}`) deny('wrong issuer');
    if (typeof claims.exp !== 'number' || claims.exp <= t - skew) deny('token expired');
    if (typeof claims.iat !== 'number' || claims.iat > t + skew) deny('token issued in the future');
    if (typeof claims.auth_time === 'number' && claims.auth_time > t + skew) deny('bad auth_time');
    if (!claims.sub) deny('no subject');

    const provider = claims.firebase && claims.firebase.sign_in_provider;
    if (provider !== 'password') deny('admin must use a password sign-in');
    if (!adminEmail || String(claims.email || '').toLowerCase() !== String(adminEmail).toLowerCase()) {
        deny('not the admin account');
    }
    return claims;
}

/* Router helper: returns { token, claims } or throws a 401 HttpError. */
export async function requireAdmin(req, env) {
    // Local testing only: DEV_ADMIN_BYPASS exists solely in a developer's
    // .dev.vars. It is never a deployed var or secret, so in production this
    // branch is unreachable.
    if (env.DEV_ADMIN_BYPASS === '1' && req.headers.get('x-dev-admin') === '1'
        && /^(localhost|127\.0\.0\.1)$/.test(new URL(req.url).hostname)) {
        return { token: '', claims: { email: env.ADMIN_EMAIL, dev: true } };
    }
    const token = bearer(req);
    const claims = await verifyIdToken(token, { adminEmail: env.ADMIN_EMAIL });
    return { token, claims };
}
