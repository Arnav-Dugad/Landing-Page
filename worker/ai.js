/* ===========================================================================
   worker/ai.js  —  POST /api/ai, GET /api/ai/config   (admin only)

   Writing help for the portfolio's admin, from Claude, Gemini or ChatGPT:

     · chat          ask about the portfolio, get concrete suggestions
     · improve       rewrite a project's copy from its README + current fields
     · search-terms  concepts a visitor might search for, for semantic search
     · alt-text      describe a screenshot for screen readers

   API keys live only in Worker secrets (ANTHROPIC_API_KEY, GEMINI_API_KEY,
   OPENAI_API_KEY) and never reach the browser. Prompts are built here, not
   sent by the client, so this endpoint can't be used as a general proxy.
   =========================================================================== */

import Anthropic from '@anthropic-ai/sdk';
import { fetchProjects } from '../api/_project.js';
import { requireAdmin } from './auth.js';
import { json, readJson, HttpError, toBase64 } from './http.js';

const PROVIDERS = {
    claude: { label: 'Claude', secret: 'ANTHROPIC_API_KEY', defaultModel: 'claude-opus-5-5' },
    gemini: { label: 'Gemini', secret: 'GEMINI_API_KEY', defaultModel: 'gemini-4-argon' },
    openai: { label: 'ChatGPT', secret: 'OPENAI_API_KEY', defaultModel: 'gpt-6-astra' }
};
const TASKS = ['chat', 'improve', 'search-terms', 'alt-text'];
const MODEL_RE = /^[A-Za-z0-9._:\-/]{1,80}$/;
const TIMEOUT_MS = 60_000;

/* ===========================================================================
   Providers — each takes { system, messages, schema } and returns text.
   A message's content is a string or a list of parts:
     { type: 'text', text } | { type: 'image', mediaType, data (base64) }
   =========================================================================== */

const asParts = (content) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);
const textOf = (content) => asParts(content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');

class ProviderError extends HttpError {
    constructor(label, message, status = 502) {
        super(status, `${label}: ${message}`);
    }
}

/* ---- Claude (official SDK) ---------------------------------------------- */

// Models that accept server-side refusal fallbacks in the "default" form.
const CLAUDE_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

async function callClaude({ apiKey, model, system, messages, schema, maxTokens }) {
    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

    const params = {
        model,
        max_tokens: maxTokens,
        system,
        messages: messages.map((m) => ({
            role: m.role,
            content: m.role === 'assistant'
                ? textOf(m.content)
                : asParts(m.content).map((p) => (p.type === 'image'
                    ? { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }
                    : { type: 'text', text: p.text }))
        })),
        output_config: {
            effort: 'medium',
            ...(schema ? { format: { type: 'json_schema', schema } } : {})
        }
    };
    if (CLAUDE_FALLBACK_MODELS.has(model)) {
        params.betas = ['server-side-fallback-2026-07-01'];
        params.fallbacks = 'default';
    }

    let res;
    try {
        res = await client.beta.messages.create(params);
    } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new ProviderError('Claude', 'invalid API key');
        if (e instanceof Anthropic.PermissionDeniedError) throw new ProviderError('Claude', 'this key cannot use that model');
        if (e instanceof Anthropic.NotFoundError) throw new ProviderError('Claude', `unknown model "${model}"`);
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError('Claude', 'rate limited — try again shortly', 429);
        if (e instanceof Anthropic.BadRequestError) throw new ProviderError('Claude', e.message || 'bad request');
        if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError('Claude', 'timed out', 504);
        if (e instanceof Anthropic.APIError) throw new ProviderError('Claude', e.message || `HTTP ${e.status}`);
        throw new ProviderError('Claude', (e && e.message) || 'request failed');
    }

    if (res.stop_reason === 'refusal') {
        throw new ProviderError('Claude', 'declined this request');
    }
    if (res.stop_reason === 'max_tokens') {
        throw new ProviderError('Claude', 'the answer was cut off — try a shorter request');
    }
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

/* ---- Gemini (Interactions API, generateContent as a fallback) ------------ */

const stripAdditional = (schema) => JSON.parse(JSON.stringify(schema, (k, v) => (k === 'additionalProperties' ? undefined : v)));

async function geminiFetch(url, apiKey, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    }).catch((e) => {
        throw new ProviderError('Gemini', e && e.name === 'TimeoutError' ? 'timed out' : 'could not be reached', 504);
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
}

const geminiError = (res, data) => {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) return new ProviderError('Gemini', 'invalid API key');
    if (res.status === 429) return new ProviderError('Gemini', 'rate limited — try again shortly', 429);
    return new ProviderError('Gemini', msg);
};

async function callGemini({ apiKey, model, system, messages, schema, maxTokens }) {
    const BASE = 'https://generativelanguage.googleapis.com/v1beta';

    const input = messages.map((m) => ({
        type: m.role === 'assistant' ? 'model_output' : 'user_input',
        content: asParts(m.content).map((p) => (p.type === 'image'
            ? { type: 'image', data: p.data, mime_type: p.mediaType }
            : { type: 'text', text: p.text }))
    }));

    const { res, data } = await geminiFetch(`${BASE}/interactions`, apiKey, {
        model,
        input,
        system_instruction: system,
        generation_config: { max_output_tokens: maxTokens, thinking_level: 'medium' },
        store: false,
        ...(schema ? { response_format: { type: 'text', mime_type: 'application/json', schema: stripAdditional(schema) } } : {})
    });

    if (res.ok) {
        if (data.status && !['completed', 'incomplete'].includes(data.status)) {
            throw new ProviderError('Gemini', `interaction ${data.status}`);
        }
        const fromSteps = (data.steps || [])
            .filter((s) => s.type === 'model_output')
            .flatMap((s) => s.content || [])
            .filter((c) => c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text).join('');
        const text = fromSteps || data.output_text || (data.outputs || []).map((o) => o.text || '').join('');
        if (!text) throw new ProviderError('Gemini', 'returned no text');
        return text.trim();
    }

    // Older models or a key without Interactions access: classic endpoint.
    if (res.status !== 404) throw geminiError(res, data);

    const legacy = await geminiFetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, apiKey, {
        system_instruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: asParts(m.content).map((p) => (p.type === 'image'
                ? { inline_data: { mime_type: p.mediaType, data: p.data } }
                : { text: p.text }))
        })),
        generationConfig: {
            maxOutputTokens: maxTokens,
            ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: stripAdditional(schema) } : {})
        }
    });
    if (!legacy.res.ok) throw geminiError(legacy.res, legacy.data);
    const cand = (legacy.data.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || '').join('');
    if (!text) throw new ProviderError('Gemini', cand && cand.finishReason ? `stopped: ${cand.finishReason}` : 'returned no text');
    return text.trim();
}

/* ---- OpenAI (Responses API) --------------------------------------------- */

async function callOpenAI({ apiKey, model, system, messages, schema, maxTokens }) {
    const body = {
        model,
        instructions: system,
        input: messages.map((m) => (m.role === 'assistant'
            ? { role: 'assistant', content: textOf(m.content) }
            : {
                role: 'user',
                content: asParts(m.content).map((p) => (p.type === 'image'
                    ? { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.data}` }
                    : { type: 'input_text', text: p.text }))
            })),
        max_output_tokens: maxTokens,
        store: false,
        ...(schema ? { text: { format: { type: 'json_schema', name: 'result', schema, strict: true } } } : {})
    };

    const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    }).catch((e) => {
        throw new ProviderError('ChatGPT', e && e.name === 'TimeoutError' ? 'timed out' : 'could not be reached', 504);
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
        if (res.status === 401) throw new ProviderError('ChatGPT', 'invalid API key');
        if (res.status === 429) throw new ProviderError('ChatGPT', 'rate limited or out of credit', 429);
        if (res.status === 404) throw new ProviderError('ChatGPT', `unknown model "${model}"`);
        throw new ProviderError('ChatGPT', msg);
    }
    if (data.status === 'incomplete') {
        throw new ProviderError('ChatGPT', `incomplete answer (${(data.incomplete_details && data.incomplete_details.reason) || 'unknown'})`);
    }

    const parts = (data.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []);
    const refusal = parts.find((c) => c.type === 'refusal');
    if (refusal) throw new ProviderError('ChatGPT', 'declined this request');
    const text = data.output_text || parts.filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    if (!text) throw new ProviderError('ChatGPT', 'returned no text');
    return text.trim();
}

const CALLERS = { claude: callClaude, gemini: callGemini, openai: callOpenAI };

/* ===========================================================================
   Shared helpers
   =========================================================================== */

/* Models occasionally wrap JSON in a fence or a sentence even in JSON mode;
   take the outermost object. */
function parseJson(text, label) {
    let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
    try {
        return JSON.parse(t);
    } catch {
        throw new ProviderError(label, 'returned something that was not valid JSON');
    }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, maxItems, maxLen = 300) => (Array.isArray(v)
    ? v.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems)
    : []);

/* Trim to a limit at a word boundary rather than mid-word. */
function clip(text, max) {
    const t = String(text || '').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const at = cut.lastIndexOf(' ');
    return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/* Same rules as resolveRepoUrl in js/github.js. */
function repoSlug(project) {
    const fromUrl = (raw) => {
        if (!raw) return null;
        try {
            if (/^https?:\/\//i.test(raw)) {
                const u = new URL(raw);
                if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
                const [owner, name] = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
                return owner && name ? `${owner}/${name}` : null;
            }
            const [owner, name] = String(raw).split('/');
            return owner && name ? `${owner}/${name}` : null;
        } catch { return null; }
    };
    if (project.repo) return fromUrl(project.repo);
    try {
        const u = new URL(project.link || '');
        const m = u.hostname.toLowerCase().match(/^([a-z0-9-]+)\.github\.io$/);
        const seg = u.pathname.replace(/^\/+/, '').split('/')[0];
        return m && seg ? `${m[1]}/${seg}` : null;
    } catch { return null; }
}

async function fetchReadme(project, env) {
    const slug = repoSlug(project);
    if (!slug) return '';
    try {
        const res = await fetch(`https://api.github.com/repos/${slug}/readme`, {
            headers: {
                accept: 'application/vnd.github.raw',
                'user-agent': 'arnav-portfolio-worker',
                ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {})
            },
            signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) return '';
        return (await res.text()).slice(0, 12_000);
    } catch { return ''; }
}

const SITE_VOICE = `House style for every word you write about this portfolio:
- Plain, specific and confident. Say what the thing does and how, in concrete terms.
- British English spelling (colour, visualisation, optimise).
- No hype: never "revolutionary", "cutting-edge", "seamless", "robust", "leverage", "unleash", "game-changing", "state-of-the-art".
- Never invent facts. No made-up user counts, metrics, dates, collaborators or features. If something isn't in the material you were given, leave it out.`;

/* A compact view of a project for prompts — the fields that describe it,
   not every byte of the record. */
const digest = (p) => ({
    title: p.title || '',
    slug: p.slug || '',
    desc: p.desc || '',
    category: p.category || '',
    tags: (p.tags || []).filter(Boolean),
    year: p.year || '',
    status: p.status || '',
    featured: !!p.featured,
    caseStudy: !!p.caseStudy,
    hasWriteUp: !!(p.longDesc && String(p.longDesc).trim()),
    highlights: Array.isArray(p.highlights) ? p.highlights.length : 0,
    screenshots: Array.isArray(p.gallery) ? p.gallery.length : 0,
    link: p.link || '',
    repo: p.repo || ''
});

/* Only the editor fields the improve/search tasks may read. */
function projectInput(raw) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Send the project as "project"');
    const out = {};
    for (const k of ['title', 'desc', 'longDesc', 'category', 'year', 'role', 'link', 'repo', 'problem', 'approach', 'outcome']) {
        if (typeof raw[k] === 'string') out[k] = raw[k].slice(0, 6000);
    }
    for (const k of ['highlights', 'tags', 'challenges']) {
        if (Array.isArray(raw[k])) out[k] = raw[k].filter((x) => typeof x === 'string').map((x) => x.slice(0, 400)).slice(0, 30);
    }
    if (!out.title) throw new HttpError(400, 'The project needs a title');
    return out;
}

/* ===========================================================================
   Tasks
   =========================================================================== */

async function taskChat(body) {
    const raw = Array.isArray(body.messages) ? body.messages : null;
    if (!raw || !raw.length) throw new HttpError(400, 'Send at least one message');
    if (raw.length > 30) throw new HttpError(400, 'Too many messages — start a new chat');

    const messages = raw.map((m, i) => {
        if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new HttpError(400, `Message ${i + 1} needs a role of user or assistant`);
        if (typeof m.content !== 'string' || !m.content.trim()) throw new HttpError(400, `Message ${i + 1} is empty`);
        if (m.content.length > 8000) throw new HttpError(400, `Message ${i + 1} is longer than 8000 characters`);
        return { role: m.role, content: m.content };
    });
    if (messages[0].role !== 'user') throw new HttpError(400, 'The first message must be from the user');
    if (messages[messages.length - 1].role !== 'user') throw new HttpError(400, 'The last message must be from the user');

    let projects = [];
    try { projects = await fetchProjects(); } catch { /* answer without the digest */ }

    const system = `You are the private assistant for Arnav Dugad's portfolio site, www.arnavdugad.in. You are talking to Arnav, the site's admin — not a visitor.

The site lists his projects from a database. Each one can have: a short description (shown on its card), a longer write-up, highlights, tech tags, a category, a year, a status (live / wip / archived), a "featured" flag that pins it to the top, a live link, a GitHub repo, screenshots, and an optional case-study page (problem, approach, what broke, outcome, numbers).

Your job: answer questions about the portfolio and give concrete, prioritised suggestions that make the projects look better — sharper copy, missing fields worth filling, which projects to feature, which deserve a case study, gaps in the range of work, inconsistent categories or tags. Name projects by title. When you suggest copy, write the actual replacement text. Keep answers tight; use markdown lists and short headings where they help.

${SITE_VOICE}

Current projects (${projects.length}), as JSON:
${JSON.stringify(projects.map(digest))}`;

    return { system, messages, schema: null, maxTokens: 16000, finish: (text) => ({ reply: text }) };
}

const IMPROVE_SCHEMA = {
    type: 'object',
    properties: {
        desc: { type: 'string', description: 'Card description, one or two sentences, at most 160 characters.' },
        longDesc: { type: 'string', description: 'Write-up: two to four short paragraphs separated by blank lines.' },
        highlights: { type: 'array', items: { type: 'string' }, description: 'Three to six concrete highlights.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Up to twelve real technologies used.' },
        problem: { type: 'string' },
        approach: { type: 'string' },
        challenges: { type: 'array', items: { type: 'string' }, description: 'Two to five things that were hard or broke.' },
        outcome: { type: 'string' }
    },
    required: ['desc', 'longDesc', 'highlights', 'tags', 'problem', 'approach', 'challenges', 'outcome'],
    additionalProperties: false
};

async function taskImprove(body, env) {
    const project = projectInput(body.project);
    const readme = await fetchReadme(project, env);

    const system = `You write portfolio copy for Arnav Dugad, a web developer who builds games, tools and interactive interfaces. You are rewriting one project's entry so it reads well on his site.

${SITE_VOICE}

Ground every statement in the README and the existing fields you are given. Improve what is there; where the material doesn't support a field, return an empty string (or an empty list) rather than guessing. Tags must be real technologies named in the material. Return only the JSON object.`;

    const user = `Existing fields:
${JSON.stringify(project, null, 2)}

${readme ? `README (may be truncated):\n"""\n${readme}\n"""` : 'No README was available — work only from the existing fields.'}

Write:
- desc: the card blurb, at most 160 characters.
- longDesc: 2–4 short paragraphs (what it is, how it works, what's interesting about how it was built).
- highlights: 3–6 concrete, specific points.
- tags: up to 12 technologies.
- problem, approach, challenges (2–5), outcome: case-study sections, honest and specific.`;

    return {
        system,
        messages: [{ role: 'user', content: user }],
        schema: IMPROVE_SCHEMA,
        maxTokens: 16000,
        finish: (text, label) => {
            const r = parseJson(text, label);
            const out = {};
            const desc = str(r.desc, 600);
            if (desc) out.desc = clip(desc, 160);
            const longDesc = str(r.longDesc, 5000);
            if (longDesc) out.longDesc = longDesc;
            const highlights = strList(r.highlights, 6);
            if (highlights.length) out.highlights = highlights;
            const seen = new Set();
            const tags = strList(r.tags, 30, 40).filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true))).slice(0, 12);
            if (tags.length) out.tags = tags;
            for (const k of ['problem', 'approach', 'outcome']) {
                const v = str(r[k], 5000);
                if (v) out[k] = v;
            }
            const challenges = strList(r.challenges, 5);
            if (challenges.length) out.challenges = challenges;
            out.usedReadme = !!readme;
            return out;
        }
    };
}

const TERMS_SCHEMA = {
    type: 'object',
    properties: { terms: { type: 'array', items: { type: 'string' } } },
    required: ['terms'],
    additionalProperties: false
};

async function taskSearchTerms(body) {
    const project = projectInput(body.project);
    const system = `You help a portfolio's search box understand meaning, not just exact words. Given one project, list 12–25 short lowercase search terms a visitor might type when looking for something like it: synonyms, underlying concepts, techniques, genres, use cases and related technologies (e.g. "multiplayer", "voice call", "webrtc", "3d", "physics", "productivity", "data viz"). Each term is 1–3 words. Do NOT repeat words that already appear in the title, description or tags. Only include terms that are genuinely true of this project. Return only the JSON object.`;

    const literal = `${project.title || ''} ${project.desc || ''} ${(project.tags || []).join(' ')}`.toLowerCase();

    return {
        system,
        messages: [{ role: 'user', content: JSON.stringify(project, null, 2) }],
        schema: TERMS_SCHEMA,
        maxTokens: 4000,
        finish: (text, label) => {
            const r = parseJson(text, label);
            const seen = new Set();
            const terms = strList(r.terms, 60, 40)
                .map((t) => t.toLowerCase().replace(/\s+/g, ' '))
                .filter((t) => t.length > 1 && !literal.includes(t))
                .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
                .slice(0, 25);
            return { terms };
        }
    };
}

const ALT_SCHEMA = {
    type: 'object',
    properties: { alt: { type: 'string' } },
    required: ['alt'],
    additionalProperties: false
};
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE = 4 * 1024 * 1024;

async function fetchImage(raw) {
    let url;
    try { url = new URL(String(raw || '')); } catch { throw new HttpError(400, 'imageUrl is not a valid URL'); }
    if (url.protocol !== 'https:') throw new HttpError(400, 'imageUrl must be https');

    let res;
    try {
        res = await fetch(url.href, {
            headers: { accept: 'image/*', 'user-agent': 'arnav-portfolio-worker' },
            signal: AbortSignal.timeout(15_000)
        });
    } catch {
        throw new HttpError(400, 'Could not download the image');
    }
    if (!res.ok) throw new HttpError(400, `The image URL answered ${res.status}`);

    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) throw new HttpError(400, 'That URL is not an image');
    if (!IMAGE_TYPES.has(type)) throw new HttpError(415, `Unsupported image type ${type} — use PNG, JPEG, GIF or WebP`);
    if (Number(res.headers.get('content-length') || 0) > MAX_IMAGE) throw new HttpError(413, 'The image is larger than 4 MB');

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE) throw new HttpError(413, 'The image is larger than 4 MB');
    return { mediaType: type, data: toBase64(buf) };
}

async function taskAltText(body) {
    const image = await fetchImage(body.imageUrl);
    const project = body.project && typeof body.project === 'object' ? body.project : {};
    const context = [project.title, project.desc].filter((x) => typeof x === 'string' && x.trim()).join(' — ').slice(0, 400);

    const system = `You write alt text for screenshots on a portfolio site. Describe what is actually visible — the interface, its layout, the key content and state — in one sentence of at most 160 characters. Don't start with "Image of", "Screenshot of" or "Picture of". Don't guess at things you can't see. Return only the JSON object.`;

    return {
        system,
        messages: [{
            role: 'user',
            content: [
                { type: 'image', ...image },
                { type: 'text', text: context ? `This screenshot is from the project: ${context}` : 'Describe this screenshot.' }
            ]
        }],
        schema: ALT_SCHEMA,
        maxTokens: 4000,
        finish: (text, label) => {
            const r = parseJson(text, label);
            let alt = str(r.alt, 400).replace(/^(an?\s+)?(image|screenshot|picture|photo)\s+(of|showing)\s+/i, '');
            alt = alt.charAt(0).toUpperCase() + alt.slice(1);
            if (!alt) throw new ProviderError(label, 'returned an empty description');
            return { alt: clip(alt, 160) };
        }
    };
}

const BUILDERS = { chat: taskChat, improve: taskImprove, 'search-terms': taskSearchTerms, 'alt-text': taskAltText };

/* ===========================================================================
   For other modules (the importer): one structured call to whichever
   provider is configured. `prefer` is tried first, then Claude → Gemini →
   ChatGPT, skipping any without a key. Returns { provider, model, data }.
   =========================================================================== */

export const SITE_VOICE_RULES = SITE_VOICE;
export { parseJson, clip, str, strList };

export function availableProvider(env, prefer) {
    const order = [prefer, 'claude', 'gemini', 'openai'].filter((p, i, a) => p && PROVIDERS[p] && a.indexOf(p) === i);
    return order.find((p) => !!env[PROVIDERS[p].secret]) || null;
}

export async function structured(env, { prefer, model, system, user, schema, maxTokens = 16000 }) {
    const provider = availableProvider(env, prefer);
    if (!provider) throw new HttpError(503, 'No AI provider key is configured');
    const meta = PROVIDERS[provider];
    const useModel = provider === prefer && typeof model === 'string' && MODEL_RE.test(model) ? model : meta.defaultModel;
    const text = await CALLERS[provider]({
        apiKey: env[meta.secret], model: useModel, system,
        messages: [{ role: 'user', content: user }], schema, maxTokens
    });
    return { provider, label: meta.label, model: useModel, data: parseJson(text, meta.label) };
}

/* ===========================================================================
   Routes
   =========================================================================== */

export async function handleAiConfig(req, env) {
    if (req.method !== 'GET') throw new HttpError(405, 'Use GET');
    await requireAdmin(req, env);
    const providers = {};
    for (const [id, p] of Object.entries(PROVIDERS)) {
        providers[id] = { configured: !!env[p.secret], defaultModel: p.defaultModel };
    }
    return json({ providers });
}

export async function handleAi(req, env) {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
    await requireAdmin(req, env);
    const body = await readJson(req, 512 * 1024);

    const provider = String(body.provider || '');
    const meta = PROVIDERS[provider];
    if (!meta) throw new HttpError(400, 'provider must be claude, gemini or openai');

    const task = String(body.task || '');
    if (!TASKS.includes(task)) throw new HttpError(400, `task must be one of: ${TASKS.join(', ')}`);

    let model = meta.defaultModel;
    if (body.model !== undefined && body.model !== null && body.model !== '') {
        if (typeof body.model !== 'string' || !MODEL_RE.test(body.model)) throw new HttpError(400, 'That model name is not valid');
        model = body.model;
    }

    const apiKey = env[meta.secret];
    if (!apiKey) throw new HttpError(503, `${meta.label} is not set up — add the ${meta.secret} secret to the worker`);

    const job = await BUILDERS[task](body, env);
    const text = await CALLERS[provider]({
        apiKey, model, system: job.system, messages: job.messages, schema: job.schema, maxTokens: job.maxTokens
    });
    const result = job.finish(text, meta.label);

    return json({ ok: true, provider, model, result });
}
