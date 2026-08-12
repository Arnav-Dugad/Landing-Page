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

   The classic scripts run before this module, so window.renderProjects and
   window.toast already exist by the time the first snapshot lands.
   =========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, deleteDoc, doc,
    onSnapshot, query, orderBy, setDoc, updateDoc, increment
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

onAuthStateChanged(auth, (u) => {
    if (!u) return;
    user = u;
    setStatus('Live', 'ok');
    subscribe();
    countVisit();
});

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

/* Strips undefined/null/'' so a cleared optional field is removed rather than
   written as an empty string that later renders as a blank badge. */
function clean(data) {
    const out = {};
    Object.entries(data).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        if (typeof v === 'string' && !v.trim()) return;
        if (Array.isArray(v) && !v.length) return;
        out[k] = v;
    });
    REQUIRED.forEach((k) => { out[k] = String(data[k] ?? '').trim(); });
    // Booleans must survive even when false.
    out.featured = !!data.featured;
    return out;
}

window.saveProjectToDb = async (data) => {
    if (!user) { window.toast('Not connected to the database yet', 'error'); return false; }
    try {
        await addDoc(projectsCol(), { ...clean(data), createdAt: Date.now(), updatedAt: Date.now() });
        window.toast('Project added', 'success');
        return true;
    } catch (e) {
        console.error('Add failed:', e);
        window.toast(`Could not save: ${e.message}`, 'error');
        return false;
    }
};

window.updateProjectInDb = async (id, data) => {
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
        window.toast('Changes saved', 'success');
        return true;
    } catch (e) {
        console.error('Update failed:', e);
        window.toast(`Could not save: ${e.message}`, 'error');
        return false;
    }
};

window.deleteProjectFromDb = async (id) => {
    if (!user) return false;
    try {
        await deleteDoc(projectDoc(id));
        window.toast('Project deleted', 'success');
        return true;
    } catch (e) {
        console.error('Delete failed:', e);
        window.toast('Could not delete the project', 'error');
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

/* -------- Accessors ------------------------------------------------------ */

window.getProjects = () => projects;
window.projectsLoaded = () => loaded;
