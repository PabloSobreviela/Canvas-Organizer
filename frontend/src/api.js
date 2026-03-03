// API Client with Authentication
// src/api.js
// Matches the sync patterns from App.js syncCourse() function

const API_BASE = (() => {
  const url = process.env.REACT_APP_API_URL?.trim();
  if (process.env.NODE_ENV === 'production' && !url) {
    throw new Error('REACT_APP_API_URL is required for production builds. Set it in your build environment.');
  }
  return url || 'https://canvas-organizer-backend-93870731079.us-central1.run.app';
})();

/**
 * Get fresh auth token from Firebase.
 * Matches the getAuthToken() pattern used in App.js.
 */
async function getAuthToken() {
    try {
        const { getAuthToken: firebaseGetToken } = await import('./firebase');
        return await firebaseGetToken();
    } catch (e) {
        console.warn('Could not get auth token:', e);
        return null;
    }
}

/**
 * Make authenticated API calls to the backend.
 * Uses the same auth header pattern as App.js syncCourse().
 */
async function apiCall(endpoint, options = {}) {
    const authToken = await getAuthToken();

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    // Add auth header if we have a token (same as App.js)
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });

        // Handle unauthorized (token expired or invalid)
        if (response.status === 401) {
            console.warn('Unauthorized - token may be expired');
            throw new Error('Unauthorized');
        }

        return response;
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// ============================================
// Canvas API Endpoints (matching App.js patterns)
// ============================================

export async function testCanvas(baseUrl, token) {
    const response = await apiCall('/api/canvas/test', {
        method: 'POST',
        body: JSON.stringify({ base_url: baseUrl, token })
    });
    return response.json();
}

export async function fetchCourses(baseUrl, token) {
    const response = await apiCall('/api/canvas/courses', {
        method: 'POST',
        body: JSON.stringify({ base_url: baseUrl, token })
    });
    return response.json();
}

/**
 * Sync course materials (syllabus & schedule files)
 * Matches: App.js lines 651-668
 */
export async function syncCourseMaterials(baseUrl, token, courseId) {
    const response = await apiCall('/api/sync_course_materials', {
        method: 'POST',
        body: JSON.stringify({
            base_url: baseUrl,
            token,
            course_id: courseId
        })
    });

    if (!response.ok) {
        throw new Error('Failed to sync materials');
    }

    return response.json();
}

/**
 * Sync announcements
 * Matches: App.js lines 675-683
 */
export async function syncAnnouncements(baseUrl, token, courseIds) {
    const response = await apiCall('/api/sync_announcements', {
        method: 'POST',
        body: JSON.stringify({
            base_url: baseUrl,
            token,
            course_ids: courseIds
        })
    });
    return response.json();
}

/**
 * Sync assignments from Canvas
 * Matches: App.js lines 690-704 and 725-737
 */
export async function syncAssignments(baseUrl, token, courseId) {
    const response = await apiCall('/api/sync_assignments', {
        method: 'POST',
        body: JSON.stringify({
            base_url: baseUrl,
            token,
            course_id: courseId
        })
    });

    if (!response.ok) {
        throw new Error('Failed to sync assignments');
    }

    return response.json();
}

/**
 * Resolve course dates with AI
 * Matches: App.js lines 712-723
 */
export async function resolveCourseDates(courseId, timezone = 'America/New_York') {
    const response = await apiCall('/api/resolve_course_dates', {
        method: 'POST',
        body: JSON.stringify({
            course_id: courseId,
            course_timezone: timezone
        })
    });

    if (!response.ok) {
        throw new Error('Failed to resolve course dates');
    }

    return response.json();
}

export async function getReadingItems(courseId) {
    const response = await apiCall(`/api/reading_items/${courseId}`);
    return response.json();
}

// ============================================
// Auth Endpoints
// ============================================

export async function getCurrentAuthUser() {
    const response = await apiCall('/api/auth/me');
    return response.json();
}

export async function checkHealth() {
    const response = await apiCall('/api/health');
    return response.json();
}

export { getAuthToken };
export default apiCall;
