import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey: "----",
  authDomain: "----",
  databaseURL: "----",
  projectId: "----",
  storageBucket: "----",
  messagingSenderId: "----",
  appId: "----"
};

export let db = null;
export let auth = null;
try {
  const app = initializeApp(FIREBASE_CONFIG);
  db = getDatabase(app);
  auth = getAuth(app);
} catch(e) {
  console.warn('Firebase init failed:', e.message);
}
