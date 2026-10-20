/* ===========================================================================
   worker/now.js  —  GET/PUT /api/now

   The "what I'm doing now" page, stored at site/now. Anyone can read it.
   A write is accepted only from the verified admin, and is made with the
   admin's OWN ID token rather than the worker's account — so even here
   firestore.rules is what finally decides.
   =========================================================================== */

import { getDoc, setDoc, FirestoreError } from './firestore.js';
import { requireAdmin } from './auth.js';
import { json, readJson, HttpError } from './http.js';

const FIELDS = ['building', 'reading', 'learning', 'note'];
const MAX = 2000;

const shape = (doc) => {
    const out = {};
    for (const f of FIELDS) out[f] = typeof doc?.[f] === 'string' ? doc[f] : '';
    out.updatedAt = typeof doc?.updatedAt === 'number' ? doc.updatedAt : null;
    return out;
};

export async function handleNow(req, env) {
    if (req.method === 'GET') {
        // A Firestore failure propagates to the router's error mapping.
        const doc = await getDoc('site/now');
        return json(shape(doc), { cache: 'public, max-age=60' });
    }

    if (req.method === 'PUT') {
        const { token } = await requireAdmin(req, env);
        const body = await readJson(req, 16 * 1024);

        const data = {};
        for (const f of FIELDS) {
            const v = body[f] === undefined ? '' : body[f];
            if (typeof v !== 'string') throw new HttpError(400, `"${f}" must be a string`);
            if (v.length > MAX) throw new HttpError(400, `"${f}" is longer than ${MAX} characters`);
            data[f] = v.trim();
        }
        data.updatedAt = Date.now();

        try {
            const saved = await setDoc('site/now', data, token);
            return json(shape(saved));
        } catch (e) {
            console.error('now: write', e && e.message);
            if (e instanceof FirestoreError && e.httpStatus === 403) {
                throw new HttpError(403, 'Firestore refused the write — publish the updated firestore.rules');
            }
            throw new HttpError(502, 'Could not save the Now page');
        }
    }

    throw new HttpError(405, 'Use GET or PUT');
}
