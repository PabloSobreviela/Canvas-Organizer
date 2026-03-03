// Firebase Configuration and Authentication
// src/firebase.js

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

function assertFirebaseConfig() {
  const missing = [];
  for (const [key, value] of Object.entries(firebaseConfig)) {
    if (!value) missing.push(key);
  }

  if (missing.length) {
    const err = new Error(
      `Missing Firebase env vars: ${missing.join(", ")}. ` +
        `Check frontend/.env.local or frontend/.env.production, then rebuild.`
    );
    // Firebase-like code so callers can branch.
    err.code = "config/missing-firebase-env";
    err.missing = missing;
    throw err;
  }
}

// Initialize Firebase
assertFirebaseConfig();
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();
// Avoid silently reusing an unexpected cached account.
googleProvider.setCustomParameters({ prompt: "select_account" });

let signInPromise = null;
const REDIRECT_SIGNIN_PENDING_SESSION_KEY = "canvassync_redirect_signin_pending";

// For redirect flows (popup blocked / some mobile browsers), finalize sign-in on app load.
export async function completeRedirectSignIn() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const pending = window.sessionStorage.getItem(REDIRECT_SIGNIN_PENDING_SESSION_KEY) === "1";
      if (!pending) return null;
    }

    const result = await getRedirectResult(auth);
    if (!result || !result.user) return null;
    const idToken = await result.user.getIdToken();
    return { user: result.user, token: idToken };
  } finally {
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.removeItem(REDIRECT_SIGNIN_PENDING_SESSION_KEY);
      }
    } catch {
      // Ignore sessionStorage access issues.
    }
  }
}

// Sign in with Google
export async function signInWithGoogle() {
  if (signInPromise) return await signInPromise;

  signInPromise = (async () => {
    const startedAt = Date.now();
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();

      console.log("Signed in as:", result.user.email);

      return {
        user: result.user,
        token: idToken,
        redirect: false,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      // These values are safe to log (they're already public in the web config).
      console.error("Sign-in error:", {
        code: error?.code,
        message: error?.message,
        origin: window?.location?.origin,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        elapsedMs,
      });

      // If popups are blocked, fall back to redirect-based sign-in.
      if (error?.code === "auth/popup-blocked") {
        try {
          if (typeof window !== "undefined" && window.sessionStorage) {
            window.sessionStorage.setItem(REDIRECT_SIGNIN_PENDING_SESSION_KEY, "1");
          }
        } catch {
          // Ignore sessionStorage access issues.
        }
        await signInWithRedirect(auth, googleProvider);
        return { user: null, token: null, redirect: true };
      }

      // If the popup closes quickly (often CSP/COOP/extensions), try redirect once.
      // If the user truly cancelled, redirect is a bit annoying, but it's better than a hard failure.
      if (error?.code === "auth/popup-closed-by-user" && elapsedMs < 15000) {
        try {
          if (typeof window !== "undefined" && window.sessionStorage) {
            window.sessionStorage.setItem(REDIRECT_SIGNIN_PENDING_SESSION_KEY, "1");
          }
        } catch {
          // Ignore sessionStorage access issues.
        }
        await signInWithRedirect(auth, googleProvider);
        return { user: null, token: null, redirect: true };
      }

      throw error;
    }
  })();

  try {
    return await signInPromise;
  } finally {
    signInPromise = null;
  }
}

// Sign out
export async function logout() {
  await signOut(auth);
  console.log("Signed out");
}

// Get current auth token (refreshes if needed)
export async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
}

// Check if user is authenticated
export function isAuthenticated() {
  return !!auth.currentUser;
}

// Subscribe to auth state changes
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    // Do not block auth state delivery on token refresh/network.
    // Boot logic can fetch tokens lazily for API calls.
    callback({ user: user || null, token: null });
  });
}

// Get current user info
export function getCurrentUser() {
  const user = auth.currentUser;
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

export default app;
