// Canvas OAuth Authentication
// Replaces Firebase Auth with Canvas LMS OAuth2 + JWT sessions

import { API_BASE } from "./config";

const TOKEN_STORAGE_KEY = 'canvassync_session_token';
const USER_STORAGE_KEY = 'canvassync_user';
const DEMO_TOKEN_STORAGE_KEY = 'canvassync_demo_token';
const DEMO_USER_STORAGE_KEY = 'canvassync_demo_user';

let _authChangeCallbacks = [];
let _currentUser = null;
let _initialized = false;

function _parseJwtPayload(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return payload;
  } catch {
    return null;
  }
}

function _isTokenExpired(token) {
  const payload = _parseJwtPayload(token);
  if (!payload || !payload.exp) return true;
  return Date.now() >= payload.exp * 1000;
}

export function isDemoJwt(token) {
  const payload = _parseJwtPayload(token);
  return Boolean(payload?.demo);
}

function _notifyAuthChange(user) {
  _currentUser = user;
  for (const cb of _authChangeCallbacks) {
    try {
      cb({ user: user || null, token: user ? getStoredToken() : null });
    } catch (e) {
      console.error('Auth change callback error:', e);
    }
  }
}

function _storeSession(token, user) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable
  }
}

function _clearSession() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Storage unavailable
  }
}

function getStoredToken() {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token && !_isTokenExpired(token)) {
      if (isDemoJwt(token)) {
        _clearSession();
        return null;
      }
      return token;
    }
    if (token && _isTokenExpired(token)) {
      _clearSession();
    }
    return null;
  } catch {
    return null;
  }
}

/** Demo tokens live in sessionStorage only — never mixed with the real account. */
export function storeDemoSession(token, user) {
  try {
    sessionStorage.setItem(DEMO_TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(DEMO_USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable
  }
}

export function getDemoToken() {
  try {
    const token = sessionStorage.getItem(DEMO_TOKEN_STORAGE_KEY);
    if (token && !_isTokenExpired(token)) {
      return token;
    }
    if (token && _isTokenExpired(token)) {
      clearDemoSession();
    }
    return null;
  } catch {
    return null;
  }
}

export function getDemoUser() {
  try {
    const raw = sessionStorage.getItem(DEMO_USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearDemoSession() {
  try {
    sessionStorage.removeItem(DEMO_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(DEMO_USER_STORAGE_KEY);
  } catch {
    // Storage unavailable
  }
}

/** Remove demo artifacts so the home page never treats demo as a signed-in user. */
export function purgeDemoAuthArtifacts() {
  clearDemoSession();
  try {
    const mainToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (mainToken && isDemoJwt(mainToken)) {
      _clearSession();
    }
  } catch {
    // Storage unavailable
  }
}

export function initAuth() {
  if (_initialized) return;
  _initialized = true;

  if (window.location.pathname !== '/demo') {
    purgeDemoAuthArtifacts();
  }

  const token = getStoredToken();
  if (token) {
    const payload = _parseJwtPayload(token);
    if (payload) {
      _currentUser = {
        uid: payload.sub,
        email: payload.email,
        displayName: payload.name,
        canvasInstanceUrl: payload.canvas_instance_url,
      };
    }
  }

  // Check for OAuth callback token in URL (supports both query and hash fragment)
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const callbackToken = hashParams.get('token') || params.get('token');
  if (callbackToken && !_isTokenExpired(callbackToken)) {
    const payload = _parseJwtPayload(callbackToken);
    if (payload && !payload.demo) {
      const user = {
        uid: payload.sub,
        email: payload.email,
        displayName: payload.name,
        canvasInstanceUrl: payload.canvas_instance_url,
      };
      _storeSession(callbackToken, user);
      _currentUser = user;

      // Clean the token from the URL
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }

  _notifyAuthChange(_currentUser);
}

export function signInWithCanvas() {
  const loginUrl = `${API_BASE}/api/auth/canvas/login`;
  window.location.href = loginUrl;
}

export async function logout() {
  try {
    const token = getStoredToken();
    if (token) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }
  } finally {
    _clearSession();
    _currentUser = null;
    _notifyAuthChange(null);
  }
}

export async function getAuthToken() {
  return getStoredToken();
}

export function isAuthenticated() {
  return !!getStoredToken();
}

export function onAuthChange(callback) {
  _authChangeCallbacks.push(callback);

  // Fire immediately with current state (never surface demo session here)
  const token = getStoredToken();
  if (token) {
    const payload = _parseJwtPayload(token);
    if (payload) {
      callback({
        user: {
          uid: payload.sub,
          email: payload.email,
          displayName: payload.name,
          canvasInstanceUrl: payload.canvas_instance_url,
        },
        token,
      });
    } else {
      callback({ user: null, token: null });
    }
  } else {
    callback({ user: null, token: null });
  }

  return () => {
    _authChangeCallbacks = _authChangeCallbacks.filter(cb => cb !== callback);
  };
}

export function getCurrentUser() {
  const token = getStoredToken();
  if (!token) return null;
  const payload = _parseJwtPayload(token);
  if (!payload) return null;
  return {
    uid: payload.sub,
    email: payload.email,
    displayName: payload.name,
    photoURL: payload.avatar_url || null,
    canvasInstanceUrl: payload.canvas_instance_url,
  };
}

// Placeholder auth object for compatibility with firebase.js patterns
export const auth = {
  get currentUser() {
    const user = getCurrentUser();
    if (!user) return null;
    return {
      ...user,
      getIdToken: async () => getStoredToken(),
    };
  }
};

export default { auth, initAuth };
