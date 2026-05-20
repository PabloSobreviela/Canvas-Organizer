// Canvas OAuth Authentication
// Session via HttpOnly cookie on API domain (credentials: 'include')

import { API_BASE } from "./config";

const TOKEN_STORAGE_KEY = 'canvassync_session_token';
const USER_STORAGE_KEY = 'canvassync_user';
const DEMO_TOKEN_STORAGE_KEY = 'canvassync_demo_token';
const DEMO_USER_STORAGE_KEY = 'canvassync_demo_user';

let _authChangeCallbacks = [];
let _currentUser = null;
let _initialized = false;
let _memoryToken = null;

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
  _memoryToken = token;
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Storage unavailable
  }
}

function _clearSession() {
  _memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Storage unavailable
  }
}

function getStoredToken() {
  if (_memoryToken && !_isTokenExpired(_memoryToken)) {
    return _memoryToken;
  }
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token && !_isTokenExpired(token)) {
      if (isDemoJwt(token)) {
        _clearSession();
        return null;
      }
      _memoryToken = token;
      return token;
    }
    if (token && _isTokenExpired(token)) {
      _clearSession();
    }
  } catch {
    // Storage unavailable
  }
  return null;
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
      displayName: data.name,
      canvasInstanceUrl: data.canvas_instance_url || null,
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
  }

  _notifyAuthChange(_currentUser);
}

export function signInWithCanvas() {
  window.location.href = `${API_BASE}/api/auth/canvas/login`;
}

export async function logout() {
  try {
    const token = getStoredToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers,
      credentials: 'include',
    }).catch(() => {});
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
  return !!_currentUser || !!getStoredToken();
}

export function onAuthChange(callback) {
  _authChangeCallbacks.push(callback);
  callback({
    user: _currentUser,
    token: getStoredToken(),
  });
  return () => {
    _authChangeCallbacks = _authChangeCallbacks.filter(cb => cb !== callback);
  };
}

export function getCurrentUser() {
  return _currentUser;
}

export function apiFetchOptions(extra = {}) {
  const token = getStoredToken();
  const headers = {
    ...(extra.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return {
    ...extra,
    headers,
    credentials: 'include',
  };
}

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
