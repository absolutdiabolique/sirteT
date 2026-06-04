import { auth, db } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { ref, get, set, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { loadStats, saveStats } from './stats.js';

const ADJS  = ['Swift','Bold','Neon','Frost','Blaze','Storm','Iron','Void','Solar','Cyber',
                'Dark','Hyper','Turbo','Pixel','Sonic','Rapid','Lunar','Hex','Prime','Ghost'];
const NOUNS = ['Falcon','Nova','Pulse','Byte','Comet','Drift','Echo','Flux','Grid','Prism',
                'Vortex','Shard','Quasar','Arc','Glitch','Stack','Apex','Core','Spike','Rift'];

function generateUsername() {
  const a = ADJS[Math.floor(Math.random() * ADJS.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const d = Math.floor(Math.random() * 9000) + 1000;
  return `${a}${n}${d}`;
}

let _user     = null;
let _username = null;

export function currentUser()     { return _user; }
export function currentUsername() { return _username; }

export async function signUp(email, password) {
  const cred     = await createUserWithEmailAndPassword(auth, email, password);
  const username = generateUsername();
  if (db) await set(ref(db, `users/${cred.user.uid}/username`), username);
  return cred.user;
}

export async function logIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export function logOut() { return signOut(auth); }

export async function changeUsername(newUsername) {
  if (!_user) throw new Error('Not signed in');
  if (!newUsername.trim()) throw new Error('Username cannot be empty');
  if (db) await set(ref(db, `users/${_user.uid}/username`), newUsername.trim());
  _username = newUsername.trim();
}

export async function deleteData() {
  if (!_user) throw new Error('Not signed in');
  if (db) await remove(ref(db, `users/${_user.uid}/pbs`));
  localStorage.removeItem('sirtet_stats');
}

export async function deleteAccount() {
  if (!_user) throw new Error('Not signed in');
  if (db) await remove(ref(db, `users/${_user.uid}`));
  await deleteUser(_user);
}

export async function uploadPB(key, data) {
  if (!_user || !db) return;
  try { await set(ref(db, `users/${_user.uid}/pbs/${key}`), data); } catch(e) {}
}

async function fetchUsername(uid) {
  if (!db) return null;
  try {
    const snap = await get(ref(db, `users/${uid}/username`));
    return snap.exists() ? snap.val() : null;
  } catch(e) { return null; }
}

async function syncFromCloud() {
  if (!_user || !db) return;
  try {
    const snap  = await get(ref(db, `users/${_user.uid}/pbs`));
    const local = loadStats();
    const cloud = snap.exists() ? snap.val() : {};

    for (const [key, val] of Object.entries(cloud)) {
      if (!local[key]) {
        local[key] = val;
      } else if (key.startsWith('sprint_')) {
        if (val.ms < local[key].ms) local[key] = val;
      } else {
        if (val.lines > local[key].lines) local[key] = val;
      }
    }
    saveStats(local);

    for (const [key, val] of Object.entries(local)) {
      const cv       = cloud[key];
      const isBetter = !cv
        || (key.startsWith('sprint_') ? val.ms < cv.ms : val.lines > cv.lines);
      if (isBetter) await set(ref(db, `users/${_user.uid}/pbs/${key}`), val);
    }
  } catch(e) { console.warn('Cloud sync failed:', e.message); }
}

export function initAuth(onUserChange) {
  if (!auth) { onUserChange(null, null); return; }
  onAuthStateChanged(auth, async user => {
    _user = user;
    if (user) {
      _username = await fetchUsername(user.uid);
      await syncFromCloud();
    } else {
      _username = null;
    }
    onUserChange(user, _username);
  });
}
