/* ===========================================================================
   worker/history.js
   "What changed, when" — entries in Firestore at history/{autoId}, readable
   only by the admin. The Worker writes 'refresh', 'release' and 'rehost'
   entries as its edge account; the admin's browser writes 'import' and
   'edit' entries itself.

   Writing history must never break the thing it describes, so every error
   here is logged and swallowed.
   =========================================================================== */

import { createDoc, edgeToken } from './firestore.js';

const MAX_CHANGES = 20;
const MAX_VALUE = 300;

/* Values are stored as short strings so the diff UI never has to care
   about types, and a long write-up can't blow up a history document. */
export function stringify(v) {
    if (v === undefined || v === null) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s;
}

export const change = (field, before, after) => ({ field, before: stringify(before), after: stringify(after) });

export async function writeHistory(env, { projectId, kind, summary, changes = [], by = 'worker' }) {
    try {
        const token = await edgeToken(env);
        await createDoc('history', {
            projectId: String(projectId || ''),
            at: Date.now(),
            kind,
            summary: String(summary || '').slice(0, 200),
            changes: changes.slice(0, MAX_CHANGES),
            by
        }, token);
    } catch (e) {
        console.error('history write', kind, projectId, e && e.message);
    }
}
