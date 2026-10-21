/* ===========================================================================
   worker/firestore.js
   Firestore over REST — the only database this site uses. Projects are read
   with the public web key; the worker's own writes (reactions, link status)
   go through a dedicated Firebase email/password account, and the admin's
   writes go through the admin's own ID token, so firestore.rules stays the
   single place that decides who may write what.
   =========================================================================== */

import { PROJECT_ID, API_KEY, DATA_PATH, unwrapFields } from '../api/_project.js';
import { HttpError } from './http.js';

const ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${ROOT}`;

/* "reactions/foo" → the full resource name Firestore wants in writes. */
export const docName = (rel) => `${ROOT}/${DATA_PATH}/${rel}`;
const docUrl = (rel) => `${BASE}/${DATA_PATH}/${rel}`;

/* Plain JS → Firestore typed value. Integers stay integers so `increment`
   transforms keep working on them. */
export function wrap(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(wrap) } };
    if (typeof value === 'object') return { mapValue: { fields: wrapFields(value) } };
    return { stringValue: String(value) };
}

export function wrapFields(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = wrap(v);
    return out;
}

/* Firestore REST errors carry { error: { code, status, message } }. The
   gRPC-style `status` string is what callers branch on. */
export class FirestoreError extends Error {
    constructor(httpStatus, body) {
        const err = (body && body.error) || {};
        super(err.message || `Firestore responded ${httpStatus}`);
        this.httpStatus = httpStatus;
        this.code = err.status || '';
    }
}

async function call(url, { method = 'GET', token, body } = {}) {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${API_KEY}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new FirestoreError(res.status, data);
    return data;
}

/* Returns the document's plain fields, or null when it doesn't exist. */
export async function getDoc(rel, token) {
    try {
        const doc = await call(docUrl(rel), { token });
        return unwrapFields(doc.fields || {});
    } catch (e) {
        if (e instanceof FirestoreError && e.httpStatus === 404) return null;
        throw e;
    }
}

/* Full overwrite of one document (PATCH without an update mask). */
export async function setDoc(rel, data, token) {
    const doc = await call(docUrl(rel), { method: 'PATCH', token, body: { fields: wrapFields(data) } });
    return unwrapFields(doc.fields || {});
}

/* New document with a Firestore-generated id in a collection under
   DATA_PATH (history entries). Returns the new id. */
export async function createDoc(collection, data, token) {
    const doc = await call(`${BASE}/${DATA_PATH}/${collection}`, { method: 'POST', token, body: { fields: wrapFields(data) } });
    return String(doc.name || '').split('/').pop();
}

/* Atomic multi-write. Each write is a raw REST Write object. */
export const commit = (writes, token) =>
    call(`${BASE}:commit`, { method: 'POST', token, body: { writes } });

/* Every document in a collection under DATA_PATH → { [docId]: fields }.
   Collections here are small (one doc per project), so one page of 300 is
   the whole set. */
export async function listDocs(collection, token) {
    const out = {};
    let pageToken = '';
    for (let page = 0; page < 4; page++) {
        const url = `${BASE}/${DATA_PATH}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const res = await call(url, { token });
        for (const d of res.documents || []) out[d.name.split('/').pop()] = unwrapFields(d.fields || {});
        if (!res.nextPageToken) break;
        pageToken = res.nextPageToken;
    }
    return out;
}

/* Which of these documents exist? → Set of the rel paths that do. */
export async function existing(rels, token) {
    if (!rels.length) return new Set();
    const res = await call(`${BASE}:batchGet`, {
        method: 'POST', token, body: { documents: rels.map(docName) }
    });
    const found = new Set();
    for (const item of Array.isArray(res) ? res : []) {
        if (item.found && item.found.name) {
            const name = item.found.name;
            found.add(name.slice(name.indexOf(`${DATA_PATH}/`) + DATA_PATH.length + 1));
        }
    }
    return found;
}

/* ---------------------------------------------------------------------------
   The worker's own identity. A dedicated email/password account whose
   address firestore.rules names; its ID token is cached per isolate and
   refreshed a few minutes before it expires.
   --------------------------------------------------------------------------- */

let edge = null; // { idToken, refreshToken, expiresAt }

async function identity(url, body, form = false) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = (data.error && (data.error.message || data.error)) || `HTTP ${res.status}`;
        throw new HttpError(503, `Edge account sign-in failed: ${msg}`);
    }
    return data;
}

export async function edgeToken(env) {
    if (edge && Date.now() < edge.expiresAt - 5 * 60 * 1000) return edge.idToken;

    if (!env.EDGE_EMAIL || !env.EDGE_PASSWORD) {
        throw new HttpError(503, 'The edge account is not configured (EDGE_EMAIL / EDGE_PASSWORD)');
    }

    if (edge && edge.refreshToken) {
        try {
            const r = await identity(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
                { grant_type: 'refresh_token', refresh_token: edge.refreshToken }, true);
            edge = {
                idToken: r.id_token,
                refreshToken: r.refresh_token,
                expiresAt: Date.now() + Number(r.expires_in || 3600) * 1000
            };
            return edge.idToken;
        } catch {
            edge = null;                // fall through to a fresh sign-in
        }
    }

    const s = await identity(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
        { email: env.EDGE_EMAIL, password: env.EDGE_PASSWORD, returnSecureToken: true });
    edge = {
        idToken: s.idToken,
        refreshToken: s.refreshToken,
        expiresAt: Date.now() + Number(s.expiresIn || 3600) * 1000
    };
    return edge.idToken;
}
