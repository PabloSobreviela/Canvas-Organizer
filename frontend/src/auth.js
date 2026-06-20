// Canvas OAuth Authentication
// Session via HttpOnly cookie on API domain (credentials: 'include' only).

import { API_BASE } from "./config";

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
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function isDemoJwt(token) {
  const payload = _parseJwtPayload(token);
  return Boolean(payload?.demo);
}

function _notifyAuthChange(user) {
  _currentUser = user;
  for (const cb of _authChangeCallbacks) {
    try {
      cb({ user: user || null, token: null });
    } catch (e) {
      console.error('Auth change callback error:', e);
    }
  }
}

function _clearCachedUser() {
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Storage unavailable
  }
}

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
    if (!token) return null;
    const payload = _parseJwtPayload(token);
    if (!payload?.exp) return token;
    if (Date.now() >= payload.exp * 1000) {
      clearDemoSession();
      return null;
    }
    return token;
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

export function purgeDemoAuthArtifacts() {
  clearDemoSession();
}

async function fetchSessionFromServer() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: 'include',
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (!data?.user_id) {
      return null;
    }
    return {
      uid: data.user_id,
      email: data.email,
      name: data.name,
      canvasInstanceUrl: data.canvas_instance_url || null,
      legalConsentAccepted: Boolean(data.legal_consent_accepted),
      legalConsentCurrent: data.legal_consent_current !== false,
    };
  } catch {
    return null;
  }
}

export async function initAuth() {
  if (_initialized) return;
  _initialized = true;

  if (window.location.pathname !== '/demo') {
    purgeDemoAuthArtifacts();
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('oauth') === 'success') {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  const serverUser = await fetchSessionFromServer();
  if (serverUser) {
    _currentUser = serverUser;
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(serverUser));
    } catch {
      // Storage unavailable
    }
  } else {
    _currentUser = null;
    _clearCachedUser();
  }

  _notifyAuthChange(_currentUser);
}

export function signInWithCanvas() {
  window.location.href = `${API_BASE}/api/auth/canvas/login`;
}

export async function logout() {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CanvasSync-CSRF': '1' },
    }).catch(() => {});
  } finally {
    _clearCachedUser();
    _currentUser = null;
    _notifyAuthChange(null);
  }
}

export async function getAuthToken() {
  return null;
}

export function isAuthenticated() {
  return !!_currentUser;
}

export function onAuthChange(callback) {
  _authChangeCallbacks.push(callback);
  callback({
    user: _currentUser,
    token: null,
  });
  return () => {
    _authChangeCallbacks = _authChangeCallbacks.filter(cb => cb !== callback);
  };
}

export function getCurrentUser() {
  return _currentUser;
}

export function apiFetchOptions(extra = {}) {
  const headers = { ...(extra.headers || {}) };
  const method = String(extra.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !headers["X-CanvasSync-CSRF"]) {
    headers["X-CanvasSync-CSRF"] = "1";
  }
  const demoToken = getDemoToken();
  if (demoToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${demoToken}`;
  }
  return {
    ...extra,
    headers,
    credentials: 'include',
  };
}

export const auth = {
  get currentUser() {
    return getCurrentUser();
  },
};

export default { auth, initAuth };
