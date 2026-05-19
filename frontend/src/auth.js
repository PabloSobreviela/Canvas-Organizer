// Canvas OAuth Authentication
// Replaces Firebase Auth with Canvas LMS OAuth2 + JWT sessions

const API_BASE = (() => {
  const url = process.env.REACT_APP_API_URL?.trim();
  if (process.env.NODE_ENV === 'production' && !url) {
    throw new Error('REACT_APP_API_URL is required for production builds.');
  }
  return url || 'http://localhost:5000';
})();

const TOKEN_STORAGE_KEY = 'canvassync_session_token';
const USER_STORAGE_KEY = 'canvassync_user';

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

export function initAuth() {
  if (_initialized) return;
  _initialized = true;

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

  // Check for OAuth callback token in URL
  const params = new URLSearchParams(window.location.search);
  const callbackToken = params.get('token');
  if (callbackToken && !_isTokenExpired(callbackToken)) {
    const payload = _parseJwtPayload(callbackToken);
    if (payload) {
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

/** Store a demo session JWT issued by /api/demo/session */
export function storeDemoSession(token, user) {
  _storeSession(token, user);
  _currentUser = user;
  _notifyAuthChange(_currentUser);
}

export function isAuthenticated() {
  return !!getStoredToken();
}

export function onAuthChange(callback) {
  _authChangeCallbacks.push(callback);

  // Fire immediately with current state
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
        token: null,
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
