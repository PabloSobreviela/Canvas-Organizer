import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar, List, CheckCircle2, Circle, User, X, Menu, Home } from "lucide-react";

const COURSE_TIMEZONE = "America/New_York";

function formatDueInCourseTZ(iso) {
  if (!iso) return "No due date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: COURSE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function getStatusBadge(status) {
  if (status === "CONFLICT") {
    return (
      <span className="ml-2 px-2 py-0.5 text-xs rounded bg-red-950 text-red-300 border border-red-900">
        Conflict
      </span>
    );
  }
  if (status === "RESOLVED") {
    return (
      <span className="ml-2 px-2 py-0.5 text-xs rounded bg-green-950 text-green-300 border border-green-900">
        Resolved
      </span>
    );
  }
  return null;
}

// INVERTED COLOR SCHEME (Light text, Dark BG) for badges
// NEW: Inverted Badges (Dark BG / Light Text)
function getCategoryBadge(category, className = "") {
  const c = (category || "ASSIGNMENT").toUpperCase();
  const base = `px-2 py-0.5 text-xs rounded border inline-flex items-center ${className}`;

  if (c === "EXAM") return <span className={`${base} bg-red-950/60 text-red-200 border-red-900`}>Exam</span>;
  if (c === "QUIZ") return <span className={`${base} bg-blue-950/60 text-blue-200 border-blue-900`}>Quiz</span>;
  if (c === "ATTENDANCE") return <span className={`${base} bg-yellow-950/60 text-yellow-200 border-yellow-900`}>Attendance</span>;
  if (c === "READING") return <span className={`${base} bg-purple-950/60 text-purple-200 border-purple-900`}>Reading</span>;
  if (c === "PLACEHOLDER") return <span className={`${base} bg-slate-800 text-slate-300 border-slate-700`}>Placeholder</span>;
  return <span className={`${base} bg-slate-800 text-slate-300 border-slate-700`}>{c === "ASSIGNMENT" ? "Assignment" : c}</span>;
}

function getWeekDates(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const sunday = new Date(d.setDate(diff));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(sunday);
    current.setDate(sunday.getDate() + i);
    week.push(current);
  }
  return week;
}

function getMonthDates(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const dates = [];

  for (let i = 0; i < startDay; i++) {
    const prevDate = new Date(year, month, -startDay + i + 1);
    dates.push({ date: prevDate, isCurrentMonth: false });
  }

  for (let i = 1; i <= daysInMonth; i++) {
    dates.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }

  const remainingDays = 42 - dates.length;
  for (let i = 1; i <= remainingDays; i++) {
    dates.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
  }

  return dates;
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

function App() {
  const [activeCourses, setActiveCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [itemsByCourse, setItemsByCourse] = useState({});
  const [syncStatus, setSyncStatus] = useState({});
  const [activeTab, setActiveTab] = useState("home"); // 'home', 'calendar', 'course'
  const [canvasStatus, setCanvasStatus] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingCourseId, setSyncingCourseId] = useState(null);
  const [showProfilePopup, setShowProfilePopup] = useState(false);

  // Profile modal tabs
  const [profileTab, setProfileTab] = useState("account");

  // Global font setting (applies app-wide)
  const FONT_OPTIONS = {
    sans: { label: "Sans (Inter)", family: "'Inter', sans-serif" },
    notebook: { label: "Notebook (Patrick Hand)", family: "'Patrick Hand', cursive" },
    serif: { label: "Serif (Merriweather)", family: "'Merriweather', serif" },
    mono: { label: "Mono (Space Mono)", family: "'Space Mono', monospace" },
  };

  const [globalFont, setGlobalFont] = useState(
    localStorage.getItem("global_font") || "sans"
  );

  // Canvas creds (kept in sync with localStorage)
  const [canvasBaseUrl, setCanvasBaseUrl] = useState(
    localStorage.getItem("canvas_base_url") || ""
  );
  const [canvasToken, setCanvasToken] = useState(
    localStorage.getItem("canvas_token") || ""
  );

  useEffect(() => {
    const family = (FONT_OPTIONS[globalFont]?.family) || FONT_OPTIONS.sans.family;
    document.documentElement.style.setProperty("--app-font", family);
    localStorage.setItem("global_font", globalFont);
  }, [globalFont]);


  // Home screen state
  const [currentWeekStart, setCurrentWeekStart] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [completedItems, setCompletedItems] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const allItems = Object.values(itemsByCourse).flat();

  async function connectCanvas() {
    const baseUrl = canvasBaseUrl.trim();
    const token = canvasToken.trim();


    if (!baseUrl || !token) {
      setCanvasStatus("Missing URL or token");
      return;
    }

    setCanvasStatus("Connecting…");

    try {
      const testRes = await fetch("http://localhost:5000/api/canvas/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl, token }),
      });

      const testData = await testRes.json();

      if (!testData.valid) {
        setCanvasStatus("Invalid token");
        return;
      }

      localStorage.setItem("canvas_base_url", baseUrl);
      localStorage.setItem("canvas_token", token);

      setCanvasStatus("Fetching courses…");

      const courseRes = await fetch("http://localhost:5000/api/canvas/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl, token }),
      });

      const courses = await courseRes.json();

      const active = courses
        .filter((c) => c.workflow_state === "available")
        .map((c) => ({
          id: c.id,
          name: c.name,
          courseCode: c.course_code || "UNK", // NEW
          status: "NOT_SYNCED",
        }));

      setActiveCourses(active);
      setCanvasStatus("Connected");
    } catch (err) {
      console.error(err);
      setCanvasStatus("Connection failed");
    }
  }

  function disconnectCanvas() {
    localStorage.removeItem("canvas_base_url");
    localStorage.removeItem("canvas_token");
    setCanvasBaseUrl("");
    setCanvasToken("");
    setActiveCourses([]);
    setItemsByCourse({});
    setCanvasStatus("Disconnected");
  }


  async function syncCourse(courseId) {
    const token = localStorage.getItem("canvas_token");
    const baseUrl = localStorage.getItem("canvas_base_url");

    if (!token || !baseUrl) {
      alert("Please connect to Canvas first");
      return;
    }

    setIsSyncing(true);
    setSyncingCourseId(courseId);
    setSyncStatus((prev) => ({ ...prev, [courseId]: "Syncing materials..." }));

    try {
      setSyncStatus((prev) => ({
        ...prev,
        [courseId]: "Fetching syllabus & schedule files...",
      }));

      const materialsRes = await fetch(
        "http://localhost:5000/api/sync_course_materials",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_url: baseUrl,
            token,
            course_id: courseId,
          }),
        }
      );

      const materialsData = await materialsRes.json();

      if (!materialsRes.ok) {
        throw new Error("Failed to sync materials");
      }

      setSyncStatus((prev) => ({
        ...prev,
        [courseId]: `Found ${materialsData.materials_extracted} materials`,
      }));

      await fetch("http://localhost:5000/api/sync_announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl,
          token,
          course_ids: [courseId],
        }),
      });

      setSyncStatus((prev) => ({
        ...prev,
        [courseId]: "Syncing assignments...",
      }));

      const assignmentsRes = await fetch(
        "http://localhost:5000/api/sync_assignments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_url: baseUrl,
            token,
            course_id: courseId,
          }),
        }
      );

      if (!assignmentsRes.ok) {
        throw new Error("Failed to sync assignments");
      }

      setSyncStatus((prev) => ({
        ...prev,
        [courseId]: "Resolving dates with AI...",
      }));

      const resolveRes = await fetch("http://localhost:5000/api/resolve_course_dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          course_timezone: "America/New_York",
        }),
      });

      if (!resolveRes.ok) {
        throw new Error("Failed to resolve course dates");
      }

      const finalRes = await fetch("http://localhost:5000/api/sync_assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl,
          token,
          course_id: courseId,
        }),
      });

      if (!finalRes.ok) {
        throw new Error("Failed to fetch final assignments");
      }

      const finalData = await finalRes.json();
      const courseObj = activeCourses.find(c => c.id === courseId);

      const normalizedAssignments = (finalData.assignments || []).map((a) => {
        const rawDate = a.normalized_due_at || a.due_at || a.original_due_at;
        return {
          id: `${courseId}-${a.canvas_assignment_id || a.name}`,
          courseId: courseId,
          courseName: courseObj?.name || "Unknown",
          courseCode: courseObj?.courseCode || "UNK",
          name: a.name,
          due: rawDate,
          source: a.source_of_truth || "Canvas",
          status: a.status,
          category: (a.category || "ASSIGNMENT").toUpperCase(),
        };
      });

      const readingsRes = await fetch(`http://localhost:5000/api/reading_items/${courseId}`);
      const readingsData = readingsRes.ok ? await readingsRes.json() : [];

      const normalizedReadings = readingsData.map((r, idx) => ({
        id: `${courseId}-reading-${idx}`,
        courseId: courseId,
        courseName: courseObj?.name || "Unknown",
        courseCode: courseObj?.courseCode || "UNK",
        name: r.name,
        due: r.due_at || null,
        source: r.source_of_truth || "Schedule",
        status: null,
        category: "READING",
      }));

      setItemsByCourse((prev) => ({
        ...prev,
        [courseId]: [...normalizedAssignments, ...normalizedReadings],
      }));

      setSyncStatus((prev) => ({ ...prev, [courseId]: "Sync Complete" }));

      setActiveCourses((prev) =>
        prev.map((c) => (c.id === courseId ? { ...c, status: "SYNCED" } : c))
      );
    } catch (err) {
      console.error("Sync failed", err);
      setSyncStatus((prev) => ({
        ...prev,
        [courseId]: `Sync Failed: ${err?.message || String(err)}`,
      }));
    } finally {
      setIsSyncing(false);
      setSyncingCourseId(null);
    }
  }

  const selectedCourse = activeCourses.find((c) => c.id === selectedCourseId);
  const courseItems = itemsByCourse[selectedCourseId] || [];
  const currentSyncStatus = syncStatus[selectedCourseId];

  const CATEGORY_ORDER = {
    EXAM: 0,
    QUIZ: 1,
    ATTENDANCE: 2,
    ASSIGNMENT: 3,
    READING: 4,
    PLACEHOLDER: 5,
    PENDING: 6,
  };

  const toTime = (iso) => {
    if (!iso) return Number.POSITIVE_INFINITY;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
  };

  const sortedCourseItems = [...courseItems]
    .map((i) => ({
      ...i,
      category: (i.category || "ASSIGNMENT").toUpperCase(),
    }))
    .sort((a, b) => {
      const ao = CATEGORY_ORDER[a.category] ?? 99;
      const bo = CATEGORY_ORDER[b.category] ?? 99;
      if (ao !== bo) return ao - bo;

      const at = toTime(a.due);
      const bt = toTime(b.due);
      if (at !== bt) return at - bt;

      return (a.name || "").localeCompare(b.name || "");
    });

  // Filter items for current week
  const weekDates = getWeekDates(currentWeekStart);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const weekItems = allItems.filter(item => {
    if (!item.due) return false;
    const dueDate = new Date(item.due);
    return dueDate >= weekStart && dueDate <= new Date(weekEnd.getTime() + 24*60*60*1000);
  }).sort((a, b) => toTime(a.due) - toTime(b.due));

  // Calculate progress
  const completedThisWeek = weekItems.filter(item => completedItems[item.id]).length;
  const progressPercent = weekItems.length > 0 ? (completedThisWeek / weekItems.length) * 100 : 0;

  // Group items by day for weekly todo view
  const itemsByDay = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  weekDates.forEach((date, idx) => {
    const dayName = dayNames[idx];
    const dateKey = date.toDateString();
    itemsByDay[dayName] = {
      date: date,
      items: weekItems.filter(item => {
        const itemDate = new Date(item.due);
        return itemDate.toDateString() === dateKey;
      }).sort((a, b) => {
        // Sort by time within the day
        const aTime = new Date(a.due).getTime();
        const bTime = new Date(b.due).getTime();
        return aTime - bTime;
      })
    };
  });

  const toggleComplete = (itemId) => {
    setCompletedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  const navigateWeek = (direction) => {
    setCurrentWeekStart(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + (direction * 7));
      return newDate;
    });
  };

  const navigateMonth = (direction) => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + direction);
      return newDate;
    });
  };

  // Get items by date for calendar
  const getItemsForDate = (date) => {
    return allItems.filter(item => {
      if (!item.due) return false;
      const dueDate = new Date(item.due);
      return isSameDay(dueDate, date);
    });
  };

  return (
    <div className="h-screen flex flex-col bg-black app-font">
      {/* Font Imports */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Patrick+Hand&family=Merriweather:wght@400;700&family=Space+Mono:wght@400;700&display=swap');

        :root { --app-font: 'Inter', sans-serif; }
        .app-font { font-family: var(--app-font); }

        /* Backwards compatibility: old class names now just use the global font */
        .font-notebook { font-family: var(--app-font); }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-enter { animation: fadeInUp 0.4s ease-out forwards; }
      `}</style>


      {/* Profile Popup */}
      {showProfilePopup && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-lg shadow-xl w-full max-w-md p-6 relative border border-zinc-800">
            <button
              onClick={() => setShowProfilePopup(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white"
              aria-label="Close"
            >
              <X size={20} />
            </button>

            <h2 className="text-xl font-semibold mb-4 text-white">Profile</h2>

            {/* Tabs */}
            <div className="flex gap-2 mb-5">
              <button
                onClick={() => setProfileTab("account")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  profileTab === "account"
                    ? "bg-blue-600 text-white"
                     : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                Account
              </button>
              <button
                onClick={() => setProfileTab("settings")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  profileTab === "settings"
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                Settings
              </button>
            </div>

            {/* SETTINGS TAB */}
            {profileTab === "settings" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    Font (global)
                  </label>
                  <select
                    value={globalFont}
                    onChange={(e) => setGlobalFont(e.target.value)}
                    className="w-full bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
                  >
                    {Object.entries(FONT_OPTIONS).map(([key, opt]) => (
                      <option key={key} value={key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-500 mt-2">
                    Applies to the whole app (including the “notebook” sections).
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white"
                    onClick={() => setShowProfilePopup(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

      {/* ACCOUNT TAB */}
      {profileTab === "account" && (
        <div className="space-y-4">
          {/* Quick summary */}
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-200 font-medium">Canvas</p>
              <span
                className={`text-xs px-2 py-1 rounded ${
                  canvasBaseUrl && canvasToken
                    ? "bg-green-950 text-green-300 border border-green-900"
                    : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                }`}
              >
                {canvasBaseUrl && canvasToken ? "Configured" : "Not configured"}
              </span>
            </div>
            <div className="mt-2 text-xs text-zinc-500 space-y-1">
              <div>
                Base URL: <span className="text-zinc-300">{canvasBaseUrl || "—"}</span>
              </div>
              <div>
                Token:{" "}
                <span className="text-zinc-300">
                  {canvasToken ? `••••${canvasToken.slice(-4)}` : "—"}
                </span>
              </div>
              <div>
                Current font:{" "}
                <span className="text-zinc-300">
                  {FONT_OPTIONS[globalFont]?.label || FONT_OPTIONS.sans.label}
                </span>
              </div>
            </div>
          </div>

          {/* Canvas credentials */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Canvas URL
            </label>
            <input
              value={canvasBaseUrl}
              onChange={(e) => setCanvasBaseUrl(e.target.value)}
              className="w-full bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
              placeholder="https://gatech.instructure.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Access Token
            </label>
            <input
              type="password"
              value={canvasToken}
              onChange={(e) => setCanvasToken(e.target.value)}
              className="w-full bg-zinc-800 text-white px-3 py-2 rounded border border-zinc-700 focus:border-blue-500 focus:outline-none"
              placeholder="Paste your Canvas token"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => connectCanvas()}
            >
              Connect
            </button>

            <button
              className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white"
              onClick={() => disconnectCanvas()}
            >
              Disconnect
            </button>

            <button
              className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white"
              onClick={() => setShowProfilePopup(false)}
            >
              Close
            </button>
          </div>

          {canvasStatus && (
            <div
              className={`mt-2 p-3 rounded text-sm ${
                canvasStatus.includes("Connected")
                  ? "bg-green-950 text-green-300 border border-green-900"
                  : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {canvasStatus}
            </div>
          )}
        </div>
      )}
    </div>
  </div>
)}


      {/* Top Bar with Profile */}
      <div className="flex items-center justify-between px-6 py-3 bg-zinc-950 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 hover:bg-zinc-800 rounded text-zinc-400"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-xl font-semibold text-white tracking-tight">CanvasORG</h1>
        </div>
        <button
          onClick={() => setShowProfilePopup(true)}
          className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white transition-colors"
        >
          <User size={20} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR */}
        {!sidebarCollapsed && (
          <aside className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col">
            <div className="px-4 py-4 border-b border-zinc-800">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Navigation</h2>
            </div>

            <div className="p-2 space-y-1">
                <button
                onClick={() => setActiveTab("home")}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "home"
                    ? "bg-blue-600 text-white"
                    : "bg-transparent hover:bg-zinc-900 text-zinc-400"
                }`}
                >
                <Home size={18} />
                Home
                </button>

                <button
                onClick={() => setActiveTab("calendar")}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "calendar"
                    ? "bg-blue-600 text-white"
                    : "bg-transparent hover:bg-zinc-900 text-zinc-400"
                }`}
                >
                <Calendar size={18} />
                Calendar
                </button>
            </div>

            <div className="px-4 py-3 border-t border-zinc-800 mt-2">
                 <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Courses</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-2 space-y-1">
              {activeCourses.map((course) => (
                <div key={course.id} className="space-y-1">
                  <button
                    onClick={() => {
                      setSelectedCourseId(course.id);
                      setActiveTab("course");
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      course.id === selectedCourseId && activeTab === "course"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    <span className="flex-1 text-left truncate">{course.name}</span>
                    {course.status === "SYNCED" && (
                      <span className="ml-2 text-xs text-green-400">✓</span>
                    )}
                  </button>

                  {course.status === "NOT_SYNCED" && (
                    <button
                      onClick={() => syncCourse(course.id)}
                      disabled={isSyncing}
                      className="w-full px-3 py-1 text-xs bg-green-900/40 text-green-400 rounded border border-green-900 hover:bg-green-900/60 disabled:opacity-50 font-medium"
                    >
                      {syncingCourseId === course.id ? "Syncing..." : "Sync Course"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* MAIN */}
        <main className="flex-1 flex flex-col overflow-hidden bg-black">
          {activeTab === "home" && (
            <div className="flex-1 flex flex-col overflow-hidden animate-enter"> {/* Animation added */}
              <header className="h-14 flex items-center justify-between px-6 border-b border-zinc-800 bg-zinc-950">
                <h1 className="text-lg font-semibold text-white">Weekly Tasks</h1>

                {/* Fixed Width Controls for Week Changer to prevent jumping */}
                <div className="flex items-center gap-2">
                    <button onClick={() => navigateWeek(-1)} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400"><ChevronLeft size={20} /></button>

                    <div className="w-48 text-center">
                        <span className="text-sm font-medium text-zinc-300">
                        {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                    </div>

                    <button onClick={() => navigateWeek(1)} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400"><ChevronRight size={20} /></button>
                    <button onClick={() => setCurrentWeekStart(new Date())} className="ml-2 text-xs px-2 py-1 bg-blue-900/30 text-blue-300 border border-blue-900 rounded hover:bg-blue-900/50">Today</button>
                </div>
              </header>

              <section className="flex-1 p-6 overflow-hidden flex gap-6">
                <div className="flex-1 h-full flex flex-col">
                    {/* Notebook Container */}
                    <div className="flex-1 bg-[#09090b] rounded-md shadow-2xl overflow-hidden border border-zinc-800 relative">
                        {/* Visual Binding Strip */}
                        <div className="absolute left-0 top-0 bottom-0 w-12 border-r border-zinc-800 bg-zinc-950 z-10 hidden sm:block"></div>

                        <div className="h-full overflow-y-auto pl-2 sm:pl-12 custom-scrollbar">
                            {weekItems.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-500 font-notebook text-xl"><p>Nothing due this week...</p></div>
                            ) : (
                                <div className="py-6 px-4 sm:px-8 space-y-8">
                                    {Object.entries(itemsByDay).map(([dayName, dayData]) => {
                                        if (dayData.items.length === 0) return null;
                                        const isToday = isSameDay(dayData.date, new Date());
                                        return (
                                            <div key={dayName} className="relative">
                                                <h3 className={`text-xl font-notebook mb-2 flex items-baseline gap-3 ${isToday ? 'text-blue-400' : 'text-zinc-500'}`}>
                                                    <span className="font-bold tracking-wide">{dayName}</span>
                                                    <span className="text-sm font-sans opacity-60">{dayData.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                                </h3>
                                                <ul className="space-y-0">
                                                    {dayData.items.map((item) => (
                                                        <li key={item.id} className="group flex items-start gap-3 py-3 border-b border-zinc-800/60 hover:bg-zinc-900/30 transition-colors">
                                                            <button onClick={() => setCompletedItems(p => ({...p, [item.id]: !p[item.id]}))} className="mt-1 text-zinc-600 hover:text-green-500 transition-colors">
                                                                {completedItems[item.id] ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} />}
                                                            </button>

                                                            {/* FORMAT: [SUBJECT] [CODENUM] Name ... Time {Badge} */}
                                                            <div className="flex-1 flex items-center justify-between gap-4 font-notebook text-lg tracking-wide">
                                                                <div className={`flex items-baseline gap-2 ${completedItems[item.id] ? 'line-through text-zinc-600' : 'text-zinc-200'}`}>
                                                                    {/* Force uppercase code, e.g., [CS 1331] */}
                                                                    <span className="text-zinc-500 font-bold text-base">
                                                                      [{item.courseCode ? item.courseCode.toUpperCase() : "UNK"}]
                                                                    </span>
                                                                    <span>{item.name}</span>
                                                                </div>
                                                                <div className="flex items-center gap-3 shrink-0">
                                                                     <span className="text-sm text-zinc-500 font-sans">
                                                                       {new Date(item.due).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                                                     </span>
                                                                     {getCategoryBadge(item.category, "opacity-90 scale-90")}
                                                                </div>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Re-implemented Progress Bar */}
                <div className="w-16 sm:w-24 bg-zinc-950 rounded-lg shadow-lg border border-zinc-800 p-2 sm:p-4 shrink-0 flex flex-col items-center">
                    <p className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2 vertical-text sm:horizontal-text text-center">Progress</p>
                    <div className="flex-1 w-2 sm:w-4 bg-zinc-900 rounded-full relative overflow-hidden">
                        <div className="absolute bottom-0 w-full bg-blue-600 transition-all duration-500 ease-out" style={{ height: `${progressPercent}%` }} />
                    </div>
                    <div className="mt-3 text-center"><p className="text-lg sm:text-xl font-bold text-blue-500">{Math.round(progressPercent)}%</p></div>
                </div>
              </section>
            </div>
          )}

          {activeTab === "calendar" && (
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="h-14 flex items-center justify-between px-6 border-b border-zinc-800 bg-zinc-950">
                    <h1 className="text-lg font-semibold text-white">Calendar</h1>
                    <div className="flex items-center gap-3">
                        <button
                          onClick={() => navigateMonth(-1)}
                          className="p-1 hover:bg-zinc-900 rounded text-zinc-400"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <h2 className="text-lg font-semibold text-white min-w-[140px] text-center">
                          {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                        </h2>
                        <button
                          onClick={() => navigateMonth(1)}
                          className="p-1 hover:bg-zinc-900 rounded text-zinc-400"
                        >
                          <ChevronRight size={20} />
                        </button>
                        <button
                        onClick={() => setCurrentMonth(new Date())}
                        className="ml-2 text-xs px-2 py-1 bg-blue-900/30 text-blue-300 border border-blue-900 rounded hover:bg-blue-900/50"
                        >
                        Today
                        </button>
                    </div>
                </header>

                <div className="flex-1 p-6 overflow-hidden flex flex-col">
                    <div className="grid grid-cols-7 gap-px bg-zinc-800 border border-zinc-800 rounded-lg overflow-hidden flex-1">
                        {/* Days Header */}
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                          <div key={day} className="bg-zinc-950 py-2 text-center text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                            {day}
                          </div>
                        ))}

                        {/* Calendar Grid */}
                        {getMonthDates(currentMonth).map(({ date, isCurrentMonth }, idx) => {
                          const items = getItemsForDate(date);
                          const isToday = isSameDay(date, new Date());

                          return (
                            <div
                              key={idx}
                              className={`min-h-[100px] bg-black p-2 relative flex flex-col gap-1 transition-colors hover:bg-zinc-900/30 ${
                                !isCurrentMonth ? 'bg-zinc-950/50 opacity-50' : ''
                              }`}
                            >
                              <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                                isToday ? 'bg-blue-600 text-white' : 'text-zinc-500'
                              }`}>
                                {date.getDate()}
                              </span>

                              <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                                {items.map((item, itemIdx) => (
                                  <div
                                    key={itemIdx}
                                    className="px-1.5 py-1 rounded text-[10px] leading-tight truncate border border-transparent hover:border-zinc-700 cursor-default"
                                    style={{
                                      backgroundColor: item.category === 'EXAM' ? '#450a0a' :
                                                      item.category === 'QUIZ' ? '#172554' :
                                                      item.category === 'READING' ? '#3b0764' :
                                                      '#27272a',
                                      color: '#e4e4e7'
                                    }}
                                    title={item.name}
                                  >
                                    <span className="font-bold opacity-75 mr-1">{item.courseCode}</span>
                                    {item.name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                </div>
            </div>
          )}

          {activeTab === "course" && (
            /* Course View */
            <div className="flex-1 flex flex-col overflow-hidden">
              <header className="h-14 flex items-center justify-between px-6 border-b border-zinc-800 bg-zinc-950">
                <h1 className="text-lg font-semibold text-white">
                  {selectedCourse ? selectedCourse.name : "Select a course"}
                </h1>
              </header>

              <section className="flex-1 p-6 overflow-y-auto">
                {currentSyncStatus && (
                  <div
                    className={`mb-4 p-3 rounded-lg text-sm font-medium ${
                      currentSyncStatus.includes("✓")
                        ? "bg-green-950 text-green-300 border border-green-900"
                        : currentSyncStatus.includes("❌")
                        ? "bg-red-950 text-red-300 border border-red-900"
                        : "bg-blue-950 text-blue-300 border border-blue-900"
                    }`}
                  >
                    {currentSyncStatus}
                  </div>
                )}

                <div className="bg-zinc-950 rounded-lg shadow-lg border border-zinc-800 p-5">
                  {selectedCourse?.status === "NOT_SYNCED" ? (
                    <div className="text-center py-8">
                      <p className="text-zinc-400 mb-4">
                        Click "Sync Course" to analyze this course
                      </p>
                      <button
                        onClick={() => syncCourse(selectedCourseId)}
                        disabled={isSyncing}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-zinc-800 font-medium"
                      >
                        {isSyncing ? "Syncing..." : "Sync Course"}
                      </button>
                    </div>
                  ) : courseItems.length === 0 ? (
                    <p className="text-sm text-zinc-500 text-center py-8">
                      No course items synced yet. Click "Sync Course" to load assignments + readings.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-black">
                          <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Item</th>
                          <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Category</th>
                          <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Due Date</th>
                          <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Source</th>
                          <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Status</th>
                        </tr>
                      </thead>

                      <tbody>
                        {sortedCourseItems.map((a, idx) => (
                          <tr key={`${a.name}-${idx}`} className="border-b border-zinc-800 hover:bg-black transition-colors">
                            <td className="py-2 px-2">
                              <div className="flex items-center">
                                <span className="text-white">{a.name}</span>
                                {getStatusBadge(a.status)}
                              </div>
                            </td>

                            <td className="py-2 px-2">
                              {getCategoryBadge(a.category)}
                            </td>

                            <td
                              className={`py-2 px-2 ${
                                a.status === "CONFLICT" ? "text-red-400 font-medium" : "text-zinc-400"
                              }`}
                            >
                              {a.due ? formatDueInCourseTZ(a.due) : "No due date"}
                            </td>

                            <td className="py-2 px-2">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  a.source === "Canvas"
                                    ? "bg-blue-950/60 text-blue-200"
                                    : a.source === "Announcement"
                                    ? "bg-purple-950/60 text-purple-200"
                                    : "bg-green-950/60 text-green-200"
                                }`}
                              >
                                {a.source || "Schedule"}
                              </span>
                            </td>

                            <td className="py-2 px-2 text-xs text-zinc-500">{a.status || "OK"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;