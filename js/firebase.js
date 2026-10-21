/* ===========================================================================
   firebase.js  (ES module — loaded last)
   Firebase init and the entire data layer. This is the only file that reads
   or writes Firestore; everything else goes through the small window.* API
   it publishes:

       window.getProjects()           → live array
       window.projectsLoaded()        → false until the first snapshot
       window.saveProjectToDb(data)   → Promise<boolean>
       window.updateProjectInDb(id,d) → Promise<boolean>
       window.deleteProjectFromDb(id) → Promise<boolean>
       window.saveMessageToDb(msg)    → Promise<boolean>
       window.uploadMedia(file, opts) → Promise<{ id, url, w, h, bytes }>
       window.writeHistory(entry)     → Promise<boolean>   (admin)
       window.loadHistory(opts)       → Promise<entry[]>   (admin)

   The classic scripts run before this module, so window.renderProjects and
   window.toast already exist by the time the first snapshot lands.
   =========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import {
    getAuth, signInAnonymously, onAuthStateChanged,
    signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, deleteDoc, doc, getDoc, getDocs,
    onSnapshot, query, orderBy, limit, setDoc, updateDoc, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBVg4_5WjOjlA-xfoGAhjqNk75EyMG6sS8",
    authDomain: "landing-page-cc574.firebaseapp.com",
    projectId: "landing-page-cc574",
    storageBucket: "landing-page-cc574.firebasestorage.app",
    messagingSenderId: "144382319030",
    appId: "1:144382319030:web:9dad615eadf2047b338917",
    measurementId: "G-ZP45FJKS7Q"
};

const app = initializeApp(firebaseConfig);
try { getAnalytics(app); } catch { /* analytics is optional */ }

const auth = getAuth(app);
const db = getFirestore(app);
const APP_ID = 'arnav-portfolio-v1';

const projectsCol = () => collection(db, 'artifacts', APP_ID, 'public', 'data', 'projects');
const projectDoc = (id) => doc(db, 'artifacts', APP_ID, 'public', 'data', 'projects', id);

let user = null;
let projects = [];
let loaded = false;

const statusEl = document.getElementById('connStatus');
const setStatus = (text, tone) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.tone = tone || '';
};

/* -------- Auth ---------------------------------------------------------- */

(async function initAuth() {
    setStatus('Connecting');
    try {
        await signInAnonymously(auth);
    } catch (err) {
        console.error('Auth failed:', err);
        loaded = true;                       // stop the skeletons spinning forever
        window.renderProjects && window.renderProjects();

        const needsSetup = err.code === 'auth/configuration-not-found'
            || err.code === 'auth/admin-restricted-operation'
            || err.code === 'auth/operation-not-allowed';
        setStatus(needsSetup ? 'Setup needed' : 'Offline', 'warn');
        if (needsSetup && statusEl) {
            statusEl.style.cursor = 'pointer';
            statusEl.onclick = () => window.toast(
                'Enable Anonymous Auth in the Firebase console to load projects.', 'error');
        }
    }
})();

/* Two identities share one session:
     · anonymous  — every visitor, so reads/messages/visit counts work
     · password   — the admin, which is what firestore.rules actually checks
   Admin state is therefore derived from Firebase, never from a client flag. */
let subscribed = false;
let counted = false;
let edgeFailed = false;

/* Firestore's free tier allows 50k reads a day, and a realtime listener on
   the project list costs one read per project per visitor. On the Worker,
   visitors instead get the list from /api/projects (cached at the edge, so
   thousands of visits cost Firestore a handful of reads), falling back to
   the snapshot shipped with the site. Starts immediately — no need to wait
   for the anonymous sign-in to show the work. */
(async function loadForVisitors() {
    if (!window.EDGE) return;
    for (const url of ['/api/projects', '/data/projects-snapshot.json']) {
        try {
            const res = await fetch(url, { headers: { accept: 'application/json' } });
            if (!res.ok) continue;
            const json = await res.json();
            if (!Array.isArray(json.projects)) continue;
            if (subscribed && loaded) return;            // the admin's live listener won
            projects = json.projects
                .map(({ slug, ...p }) => p)
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            loaded = true;
            window.renderProjects && window.renderProjects();
            return;
        } catch { /* try the next source */ }
    }
    // Neither worked: fall back to a direct listener.
    edgeFailed = true;
    if (user && !subscribed) { subscribed = true; subscribe(); }
})();

onAuthStateChanged(auth, (u) => {
    user = u;

    if (!u) {
        // Signed out (e.g. the admin left) — drop straight back to a visitor.
        if (window.isAdmin) { window.isAdmin = false; window.applyAdminState && window.applyAdminState(); }
        signInAnonymously(auth).catch((e) => console.error('Re-auth failed:', e));
        return;
    }

    setStatus('Live', 'ok');

    const nowAdmin = !u.isAnonymous;
    if (window.isAdmin !== nowAdmin) {
        window.isAdmin = nowAdmin;
        window.applyAdminState && window.applyAdminState();
    }

    // Visitors read projects through the Worker (see loadForVisitors); only
    // the admin — or a host without the Worker — holds a realtime listener.
    if ((nowAdmin || !window.EDGE || edgeFailed) && !subscribed) { subscribed = true; subscribe(); }
    if (!counted) { counted = true; countVisit(); }
});

/* -------- Admin session --------------------------------------------------- */

const AUTH_MESSAGES = {
    'auth/invalid-credential': 'That email or password is not right',
    'auth/invalid-login-credentials': 'That email or password is not right',
    'auth/wrong-password': 'That email or password is not right',
    'auth/user-not-found': 'No admin account with that email',
    'auth/invalid-email': "That doesn't look like an email address",
    'auth/too-many-requests': 'Too many attempts — wait a moment and retry',
    'auth/operation-not-allowed': 'Enable Email/Password sign-in in the Firebase console',
    'auth/network-request-failed': 'Network problem — check your connection'
};

window.adminSignIn = async (email, password) => {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.toast('Signed in — admin unlocked', 'success');
        return true;
    } catch (e) {
        console.error('Admin sign-in failed:', e.code || e);
        window.toast(AUTH_MESSAGES[e.code] || 'Could not sign in', 'error');
        return false;
    }
};

window.adminSignOut = async () => {
    try {
        await signOut(auth);            // onAuthStateChanged re-auths anonymously
        window.toast('Signed out', 'info');
        return true;
    } catch (e) {
        console.error('Sign-out failed:', e);
        return false;
    }
};

window.adminEmail = () => (user && !user.isAnonymous ? user.email : null);

/* A fresh ID token for calls to the Worker (the AI tools). The Worker
   verifies it against Google's keys and the admin address itself, so this
   proves identity rather than merely claiming it. */
window.adminIdToken = async () => {
    if (!user || user.isAnonymous) throw new Error('Sign in as admin first');
    return user.getIdToken();
};

/* -------- Projects subscription ----------------------------------------- */

function subscribe() {
    const q = query(projectsCol(), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snap) => {
        projects = [];
        snap.forEach((d) => projects.push({ id: d.id, ...d.data() }));
        loaded = true;
        window.renderProjects && window.renderProjects();
    }, (err) => {
        console.error('Firestore error:', err);
        loaded = true;
        window.renderProjects && window.renderProjects();
        setStatus('Data error', 'warn');
    });
}

/* -------- Visitor counter ------------------------------------------------ */

async function countVisit() {
    const ref = doc(db, 'artifacts', APP_ID, 'public', 'data', 'stats', 'general');
    const out = document.getElementById('visitors');
    try {
        if (!localStorage.getItem('visited')) {
            try { await updateDoc(ref, { visitCount: increment(1) }); }
            catch { await setDoc(ref, { visitCount: 1 }); }
            localStorage.setItem('visited', '1');
        }
        onSnapshot(ref, (snap) => {
            if (out) out.textContent = (snap.exists() ? (snap.data().visitCount || 0) : 1).toLocaleString();
        });
    } catch (e) {
        console.error('Visitor count error', e);
        if (out) out.textContent = '—';
    }
}

/* -------- Writes --------------------------------------------------------- */

/* firestore.rules requires these on create, so they are always written even
   when empty — a project with no live URL is legitimate. */
const REQUIRED = ['title', 'desc', 'link'];

/* Strips undefined/null/''/NaN so a cleared optional field is removed rather
   than written as an empty string that later renders as a blank badge. It
   recurses into maps (stores) and arrays of maps (downloads), dropping empty
   entries, so an importer draft can be saved as-is. */
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function prune(v) {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'string') return v.trim() ? v : undefined;
    if (Array.isArray(v)) {
        const arr = v.map(prune).filter((x) => x !== undefined);
        return arr.length ? arr : undefined;
    }
    if (isPlainObject(v)) {
        const obj = {};
        Object.entries(v).forEach(([k, x]) => {
            const c = prune(x);
            if (c !== undefined) obj[k] = c;
        });
        return Object.keys(obj).length ? obj : undefined;
    }
    return v;                                   // booleans
}

function clean(data) {
    const out = {};
    Object.entries(data).forEach(([k, v]) => {
        if (k === 'id') return;                 // the doc id is never a field
        const c = prune(v);
        if (c !== undefined) out[k] = c;
    });
    // A download without a URL is not a download.
    if (Array.isArray(out.downloads)) {
        out.downloads = out.downloads.filter((d) => isPlainObject(d) && d.url).slice(0, 12);
        if (!out.downloads.length) delete out.downloads;
    }
    if (Array.isArray(out.sources)) out.sources = out.sources.slice(0, 10);
    REQUIRED.forEach((k) => { out[k] = String(data[k] ?? '').trim(); });
    // Booleans must survive even when false.
    out.featured = !!data.featured;
    return out;
}
window.cleanProjectData = clean;

/* `quiet` keeps a batch import from stacking thirty "Project added" toasts.
   Resolves to the new document's id (truthy) or false. */
window.saveProjectToDb = async (data, { quiet = false } = {}) => {
    if (!user) { window.toast('Not connected to the database yet', 'error'); return false; }
    try {
        const ref = await addDoc(projectsCol(), { ...clean(data), createdAt: Date.now(), updatedAt: Date.now() });
        if (!quiet) window.toast('Project added', 'success');
        return ref.id || true;
    } catch (e) {
        console.error('Add failed:', e);
        window.toast(`Could not save: ${e.message}`, 'error');
        return false;
    }
};

/* `quiet` suppresses the toast — the bulk enrichment pass shows one progress
   bar rather than thirty "Changes saved" notifications. */
window.updateProjectInDb = async (id, data, { quiet = false } = {}) => {
    if (!user) { window.toast('Not connected to the database yet', 'error'); return false; }
    try {
        // setDoc with merge:false so fields the editor cleared are actually
        // removed; createdAt is preserved from the doc we already hold.
        const existing = projects.find((p) => String(p.id) === String(id));
        await setDoc(projectDoc(id), {
            ...clean(data),
            createdAt: existing?.createdAt || Date.now(),
            updatedAt: Date.now()
        });
        if (!quiet) window.toast('Changes saved', 'success');
        return true;
    } catch (e) {
        console.error('Update failed:', e);
        if (!quiet) window.toast(`Could not save: ${e.message}`, 'error');
        return false;
    }
};

window.deleteProjectFromDb = async (id) => {
    if (!user) return false;
    // Snapshot the doc before it goes, so the toast can offer a real undo.
    const backup = projects.find((p) => String(p.id) === String(id));
    try {
        await deleteDoc(projectDoc(id));
        if (backup && window.toastWithAction) {
            window.toastWithAction('Project deleted', 'Undo', async () => {
                const { id: _drop, ...data } = backup;
                await setDoc(projectDoc(id), data);   // same id, so links survive
                window.toast('Project restored', 'success');
            });
        } else {
            window.toast('Project deleted', 'success');
        }
        return true;
    } catch (e) {
        console.error('Delete failed:', e);
        window.toast('Could not delete the project', 'error');
        return false;
    }
};

/* Writes a whole new ordering in one atomic batch. Firestore caps a batch at
   500 writes, which is far beyond any realistic project count here. */
window.reorderProjectsInDb = async (orderedIds) => {
    if (!user) { window.toast('Not connected to the database yet', 'error'); return false; }
    try {
        const batch = writeBatch(db);
        orderedIds.forEach((id, i) => batch.update(projectDoc(String(id)), { order: i + 1 }));
        await batch.commit();
        window.toast('Order saved', 'success');
        return true;
    } catch (e) {
        console.error('Reorder failed:', e);
        window.toast(`Could not save the order: ${e.message}`, 'error');
        return false;
    }
};

window.saveMessageToDb = async (msg) => {
    if (!user) { window.toast('Messaging is unavailable right now', 'error'); return false; }
    const btn = document.getElementById('contactSend');
    const label = btn ? btn.textContent : '';
    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'messages'),
            { ...msg, createdAt: Date.now() });
        window.toast("Message sent — I'll be in touch", 'success');
        return true;
    } catch (e) {
        console.error('Message failed:', e);
        window.toast('Could not send the message', 'error');
        return false;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = label; }
    }
};

/* -------- The /now page -------------------------------------------------- */

const nowDoc = () => doc(db, 'artifacts', APP_ID, 'public', 'data', 'site', 'now');

window.loadNowFromDb = async () => {
    try {
        const snap = await getDoc(nowDoc());
        return snap.exists() ? snap.data() : null;
    } catch (e) {
        console.error('Now load failed:', e);
        return null;
    }
};

window.saveNowToDb = async (data) => {
    if (!user || user.isAnonymous) { window.toast('Sign in as admin first', 'error'); return false; }
    try {
        const clip = (v) => String(v || '').slice(0, 2000);
        await setDoc(nowDoc(), {
            building: clip(data.building), reading: clip(data.reading),
            learning: clip(data.learning), note: clip(data.note),
            updatedAt: Date.now()
        });
        window.toast('Now page published', 'success');
        return true;
    } catch (e) {
        console.error('Now save failed:', e);
        window.toast(e.code === 'permission-denied'
            ? 'Firestore refused — publish the updated firestore.rules first'
            : `Could not save: ${e.message}`, 'error');
        return false;
    }
};

/* -------- Uploaded media ----------------------------------------------- */

/* Screenshots dropped in from the admin's computer. There is no file storage
   on the free plan, so each image is compressed in the browser (WebP, longest
   edge ≤ 1920px) until its base64 fits comfortably in one Firestore document,
   then stored at media/{id}. The id is a content hash, so dropping the same
   file twice costs nothing. The Worker serves /api/media/<id> with an
   immutable edge cache, so visitors almost never cause a read. */

const mediaDoc = (id) => doc(db, 'artifacts', APP_ID, 'public', 'data', 'media', id);
const MAX_B64 = 900_000;
const MAX_EDGE = 1920;
const UNSUPPORTED = /\.(heic|heif|tiff?|psd|raw|cr2|nef|dng)$/i;

function unreadable(file) {
    const n = String((file && file.name) || '').toLowerCase();
    if (/\.(heic|heif)$/.test(n) || /heic|heif/.test((file && file.type) || '')) {
        return new Error('HEIC photos can’t be read by browsers — export it as JPEG or PNG first');
    }
    return new Error('That file isn’t an image the browser can read — try PNG, JPEG, WebP or GIF');
}

async function decodeImage(file) {
    if (UNSUPPORTED.test(file.name || '') || (file.type && !/^image\//.test(file.type))) throw unreadable(file);
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        // Some engines can't createImageBitmap every format — fall back to <img>.
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.decoding = 'async';
            img.src = url;
            await img.decode();
            return img;
        } catch {
            throw unreadable(file);
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

async function encodeImage(source, w, h, quality) {
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(w, h);
    } else {
        canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    const toBlob = (type, q) => (canvas.convertToBlob
        ? canvas.convertToBlob({ type, quality: q })
        : new Promise((res) => canvas.toBlob(res, type, q)));
    let blob = await toBlob('image/webp', quality);
    // Browsers that can't encode WebP hand back PNG — use JPEG instead.
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', quality);
    return blob;
}

const bytesToBase64 = (bytes) => {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
};

/* Compress only — no network. Exposed so the UI can show the final size
   before (or without) uploading. */
window.compressImage = async (file, { onStage = () => {} } = {}) => {
    onStage('decode');
    const src = await decodeImage(file);
    const sw = src.width || src.naturalWidth;
    const sh = src.height || src.naturalHeight;
    if (!sw || !sh) throw unreadable(file);

    onStage('encode');
    let scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
    let quality = 0.84;
    try {
        for (let tries = 0; tries < 10; tries++) {
            const w = Math.max(1, Math.round(sw * scale));
            const h = Math.max(1, Math.round(sh * scale));
            const blob = await encodeImage(src, w, h, quality);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const b64 = bytesToBase64(bytes);
            if (b64.length <= MAX_B64) {
                const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
                const id = Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
                return { id, b64, type: blob.type, w, h, bytes: bytes.length, original: file.size || 0 };
            }
            // Too big: give up quality first, then pixels.
            if (quality > 0.62) quality -= 0.08;
            else scale *= 0.82;
        }
    } finally {
        if (src.close) src.close();
    }
    throw new Error('That image is too detailed to fit even after compressing — try a smaller one');
};

window.uploadMedia = async (file, { name = '', onStage = () => {} } = {}) => {
    if (!user || user.isAnonymous) throw new Error('Sign in as admin first');
    const c = await window.compressImage(file, { onStage });
    onStage('upload', c);
    try {
        await setDoc(mediaDoc(c.id), {
            data: c.b64, type: c.type, w: c.w, h: c.h, bytes: c.bytes,
            name: String(name || file.name || '').slice(0, 120), createdAt: Date.now()
        });
    } catch (e) {
        throw new Error(e.code === 'permission-denied'
            ? 'Firestore refused the upload — publish the latest firestore.rules'
            : e.code === 'resource-exhausted' ? 'Firestore’s free daily quota is used up — try again after it resets'
                : `Upload failed: ${e.message}`);
    }
    onStage('done', c);
    return { id: c.id, url: `/api/media/${c.id}`, w: c.w, h: c.h, bytes: c.bytes };
};

/* -------- History ------------------------------------------------------ */

const historyCol = () => collection(db, 'artifacts', APP_ID, 'public', 'data', 'history');
const clip300 = (v) => {
    const s = v === undefined || v === null ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
    return s.length > 300 ? `${s.slice(0, 299)}…` : s;
};

/* One line in the admin's history. Best effort: a failed history write must
   never make a successful save look like it failed. */
window.writeHistory = async ({ projectId, kind = 'edit', summary = '', changes = [] } = {}) => {
    if (!user || user.isAnonymous || !projectId) return false;
    try {
        await addDoc(historyCol(), {
            projectId: String(projectId), kind, by: 'admin', at: Date.now(),
            summary: String(summary).slice(0, 200),
            changes: (changes || []).slice(0, 20).map((c) => ({
                field: String(c.field).slice(0, 60), before: clip300(c.before), after: clip300(c.after)
            }))
        });
        return true;
    } catch (e) {
        console.warn('History write skipped:', e.code || e.message);
        return false;
    }
};

/* Newest first. Filtering by project happens on the client, so no composite
   index is needed. */
window.loadHistory = async ({ max = 120 } = {}) => {
    if (!user || user.isAnonymous) throw new Error('Sign in as admin first');
    const snap = await getDocs(query(historyCol(), orderBy('at', 'desc'), limit(max)));
    const out = [];
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    return out;
};

/* -------- Accessors ------------------------------------------------------ */

window.getProjects = () => projects;
window.projectsLoaded = () => loaded;
