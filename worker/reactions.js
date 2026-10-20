/* ===========================================================================
   worker/reactions.js  —  GET/POST /api/reactions

   Five emoji per project. Counts live in reactions/{slug}; each vote is its
   own document, reactionVotes/{slug}__{emoji}__{voter}, so "has this visitor
   already reacted?" is a document-exists check and a toggle is one atomic
   commit: the vote document plus an `increment` on the count, guarded by a
   precondition so a double-click can never count twice.

   A voter is a SHA-256 of IP + user agent + salt — stable enough to make a
   reaction toggle, never stored in a recoverable form.
   =========================================================================== */

import { fetchProjects } from '../api/_project.js';
import { getDoc, commit, existing, docName, edgeToken, FirestoreError } from './firestore.js';
import { json, readJson, HttpError, sha256Hex } from './http.js';

export const EMOJI = ['fire', 'clap', 'mind', 'heart', 'idea'];
const SLUG = /^[a-z0-9-]{1,120}$/;

const voteRel = (slug, emoji, voter) => `reactionVotes/${slug}__${emoji}__${voter}`;

async function voterId(req, env) {
    const ip = req.headers.get('cf-connecting-ip') || '';
    const ua = req.headers.get('user-agent') || '';
    return sha256Hex(`${ip}|${ua}|${env.VOTER_SALT || 'arnav-portfolio-reactions-v1'}`);
}

async function assertProject(slug) {
    if (!SLUG.test(slug || '')) throw new HttpError(400, 'Unknown project');
    const projects = await fetchProjects();
    if (!projects.some((p) => p.slug === slug)) throw new HttpError(404, 'Unknown project');
}

async function counts(slug) {
    const doc = await getDoc(`reactions/${slug}`);
    const out = {};
    for (const e of EMOJI) out[e] = Math.max(0, Number((doc && doc[e]) || 0));
    return out;
}

async function mine(slug, voter, token) {
    const rels = EMOJI.map((e) => voteRel(slug, e, voter));
    const found = await existing(rels, token);
    return EMOJI.filter((e) => found.has(voteRel(slug, e, voter)));
}

/* ---- Rate limit: 20 toggles per voter per 10 minutes ------------------
   Best effort. The Cache API is per data centre (and a no-op on
   workers.dev), so an isolate-local map backs it up. */
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 20;
const local = new Map();

async function rateLimit(voter) {
    const now = Date.now();
    const key = new Request(`https://ratelimit.internal/reactions/${voter}`);
    let entry = local.get(voter);
    try {
        const hit = await caches.default.match(key);
        if (hit) {
            const cached = await hit.json();
            if (!entry || cached.n > entry.n) entry = cached;
        }
    } catch { /* cache unavailable */ }

    if (!entry || now - entry.start > WINDOW_MS) entry = { start: now, n: 0 };
    if (entry.n >= LIMIT) throw new HttpError(429, 'Too many reactions — try again in a few minutes');
    entry.n++;
    local.set(voter, entry);

    try {
        const ttl = Math.max(1, Math.ceil((entry.start + WINDOW_MS - now) / 1000));
        await caches.default.put(key, new Response(JSON.stringify(entry), {
            headers: { 'cache-control': `max-age=${ttl}`, 'content-type': 'application/json' }
        }));
    } catch { /* cache unavailable */ }
}

const isPrecondition = (e) => e instanceof FirestoreError
    && (e.code === 'FAILED_PRECONDITION' || e.code === 'ALREADY_EXISTS' || e.code === 'NOT_FOUND'
        || e.httpStatus === 409);

const bump = (slug, emoji, by) => ({
    update: { name: docName(`reactions/${slug}`), fields: {} },
    // An empty mask touches no fields but still creates the document the
    // first time, so the transform always has something to land on.
    updateMask: { fieldPaths: [] },
    updateTransforms: [{ fieldPath: emoji, increment: { integerValue: String(by) } }]
});

async function toggle(slug, emoji, voter, token) {
    const vote = docName(voteRel(slug, emoji, voter));
    try {
        await commit([
            {
                update: {
                    name: vote,
                    fields: {
                        at: { integerValue: String(Date.now()) },
                        p: { stringValue: slug },
                        e: { stringValue: emoji }
                    }
                },
                currentDocument: { exists: false }
            },
            bump(slug, emoji, 1)
        ], token);
        return;
    } catch (e) {
        if (!isPrecondition(e)) throw e;
    }
    // The vote already exists, so this click takes it back.
    try {
        await commit([
            { delete: vote, currentDocument: { exists: true } },
            bump(slug, emoji, -1)
        ], token);
    } catch (e) {
        if (!isPrecondition(e)) throw e;   // raced with another toggle: nothing to undo
    }
}

export async function handleReactions(req, env) {
    if (req.method === 'GET') {
        const slug = new URL(req.url).searchParams.get('p') || '';
        await assertProject(slug);
        const voter = await voterId(req, env);
        const [c, m] = await Promise.all([
            counts(slug),
            edgeToken(env).then((t) => mine(slug, voter, t)).catch((e) => {
                console.error('reactions: mine', e && e.message);
                return [];
            })
        ]);
        return json({ counts: c, mine: m });
    }

    if (req.method === 'POST') {
        const body = await readJson(req, 2048);
        const slug = String(body.p || '');
        const emoji = String(body.e || '');
        if (!EMOJI.includes(emoji)) throw new HttpError(400, 'Unknown reaction');
        await assertProject(slug);

        const voter = await voterId(req, env);
        await rateLimit(voter);

        const token = await edgeToken(env);
        try {
            await toggle(slug, emoji, voter, token);
        } catch (e) {
            console.error('reactions: toggle', e && e.message);
            if (e instanceof FirestoreError && e.code === 'PERMISSION_DENIED') throw e;
            throw new HttpError(502, 'Could not save the reaction');
        }
        const [c, m] = await Promise.all([counts(slug), mine(slug, voter, token)]);
        return json({ counts: c, mine: m });
    }

    throw new HttpError(405, 'Use GET or POST');
}
