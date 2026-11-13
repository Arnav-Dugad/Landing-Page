// firebase-admin is not available on this host (no server credentials).
// lib/firebase/admin.ts catches these and falls back to local persistence.
const unavailable = () => { throw new Error('firebase-admin is not configured on this host'); };
module.exports = {
  cert: unavailable, getApp: unavailable, getApps: () => [], initializeApp: unavailable,
  getAuth: unavailable, getFirestore: unavailable
};
