/* ===========================================================================
   firebase.js  (ES module)
   Firebase init + the entire data layer. Projects live in Firestore — this
   file is the ONLY place that reads/writes them. It exposes a small set of
   window.* functions that the classic scripts (ui.js / render.js) call.

   Loaded last (after the classic scripts) so window.renderAllProjects and
   window.showToast already exist when this runs.
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
try { getAnalytics(app); } catch (e) { console.log("Analytics not enabled or configured"); }
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'arnav-portfolio-v1';

const projectsCol = () => collection(db, 'artifacts', appId, 'public', 'data', 'projects');

let user = null;
let dynamicProjects = [];
let hasLoadedProjects = false;      // false until the first Firestore snapshot arrives
const statusSpan = document.getElementById('connection-status');

/* -------- Auth flow with friendly fallbacks ----------------------------- */
const initAuth = async () => {
    statusSpan.innerText = "Authenticating...";
    try {
        await signInAnonymously(auth);
    } catch (err) {
        console.error("Auth failed:", err);
        if (err.code === 'auth/configuration-not-found') {
            statusSpan.innerText = "⚠️ Setup Needed";
            statusSpan.classList.add("text-yellow-400", "cursor-pointer");
            statusSpan.onclick = () => showToast("Error: Auth Config Not Found. Enable Anonymous Auth in Firebase Console.", "error");
        } else if (err.code === 'auth/admin-restricted-operation' || err.code === 'auth/operation-not-allowed') {
            statusSpan.innerText = "⚠️ Enable Anonymous";
            statusSpan.classList.add("text-yellow-400", "cursor-pointer");
            statusSpan.onclick = () => showToast("Error: Anonymous Auth Disabled. Enable it in Firebase Console.", "error");
        } else {
            statusSpan.innerText = "Auth Error";
            statusSpan.classList.add("text-red-400");
        }
    }
};
initAuth();

onAuthStateChanged(auth, (u) => {
    user = u;
    if (user) {
        console.log("Authenticated as", user.uid);
        subscribeToProjects();
        updateVisitorCount();
        statusSpan.innerText = "🟢 Connected";
        statusSpan.classList.remove("text-yellow-400", "text-red-400");
        statusSpan.classList.add("text-green-400");
        statusSpan.onclick = null;
        statusSpan.style.cursor = "default";
    }
});

/* -------- Visitor counter ----------------------------------------------- */
async function updateVisitorCount() {
    if (!user) return;
    const statsRef = doc(db, 'artifacts', appId, 'public', 'data', 'stats', 'general');
    const visitorSpan = document.getElementById('visitor-count');
    const hasVisited = localStorage.getItem('hasVisitedPortfolio');

    try {
        if (!hasVisited) {
            try {
                await updateDoc(statsRef, { visitCount: increment(1) });
            } catch (e) {
                await setDoc(statsRef, { visitCount: 1 });
            }
            localStorage.setItem('hasVisitedPortfolio', 'true');
        }
        onSnapshot(statsRef, (docSnap) => {
            if (visitorSpan) visitorSpan.innerText = docSnap.exists() ? (docSnap.data().visitCount || 0) : 1;
        });
    } catch (e) {
        console.error("Visitor count error", e);
        if (visitorSpan) visitorSpan.innerText = "-";
    }
}

/* -------- Projects subscription (the live source of truth) -------------- */
function subscribeToProjects() {
    if (!user) return;
    const q = query(projectsCol(), orderBy("createdAt", "desc"));
    onSnapshot(q, (snapshot) => {
        dynamicProjects = [];
        snapshot.forEach((d) => dynamicProjects.push({ id: d.id, ...d.data() }));
        hasLoadedProjects = true;
        window.renderAllProjects();
    }, (error) => {
        console.error("Firestore Error:", error);
        hasLoadedProjects = true;          // stop showing skeletons even on error
        window.renderAllProjects();
        statusSpan.innerText = "Data Error";
        statusSpan.classList.add("text-red-400");
    });
}

/* -------- Writes -------------------------------------------------------- */
window.saveProjectToDb = async (projectData) => {
    const btn = document.getElementById('submitProjectBtn');
    const originalText = btn ? btn.innerText : '';
    if (!user) { showToast("Database not connected yet.", "error"); return; }
    try {
        if (btn) { btn.innerText = "Saving..."; btn.disabled = true; btn.classList.add("opacity-50", "cursor-not-allowed"); }
        await addDoc(projectsCol(), { ...projectData, createdAt: Date.now() });
        toggleModal(false);
        document.getElementById('addProjectForm').reset();
        fireConfetti();
        showToast("Project added successfully!", "success");
    } catch (e) {
        console.error("Error adding document: ", e);
        showToast(`Failed to save: ${e.message}`, "error");
    } finally {
        if (btn) { btn.innerText = originalText; btn.disabled = false; btn.classList.remove("opacity-50", "cursor-not-allowed"); }
    }
};

window.deleteProjectFromDb = async (projectId) => {
    if (!user) return;
    if (!confirm("Are you sure you want to delete this project?")) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', projectId));
        showToast("Project deleted.", "success");
    } catch (e) {
        console.error("Error deleting document: ", e);
        showToast("Failed to delete project.", "error");
    }
};

window.saveMessageToDb = async (msgData) => {
    if (!user) { showToast("Service unavailable.", "error"); return; }
    const btn = document.getElementById('sendMsgBtn');
    const originalText = btn ? btn.innerText : '';
    try {
        if (btn) { btn.innerText = "Sending..."; btn.disabled = true; }
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'messages'), { ...msgData, createdAt: Date.now() });
        toggleContactModal(false);
        document.getElementById('contactForm').reset();
        showToast("Message sent! I'll be in touch.", "success");
    } catch (e) {
        showToast("Failed to send message.", "error");
    } finally {
        if (btn) { btn.innerText = originalText; btn.disabled = false; }
    }
};

/* -------- Accessors for the renderer ------------------------------------ */
window.getDynamicProjects = () => dynamicProjects;
window.hasLoadedProjects  = () => hasLoadedProjects;
