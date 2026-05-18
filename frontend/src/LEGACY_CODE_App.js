import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar, List, CheckCircle2, Circle, User, X, Menu, Home } from "lucide-react";

const COURSE_TIMEZONE = "America/New_York";

/**
 * Parse due values safely.
 * - null for missing/"No Date"
 * - YYYY-MM-DD is treated as a local calendar day (prevents UTC shift)
 * - full ISO strings are parsed normally
 */


 function tzOffsetMinutes(date, timeZone) {
  // Returns the offset (in minutes) between UTC and the given timeZone at `date`
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  // Interpret the formatted (timeZone) clock reading as UTC millis
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return (asUTC - date.getTime()) / 60000;
}

function dateFromYMDInTimeZone(y, mo, d, timeZone) {
  // Returns a Date object representing midnight (00:00) in `timeZone` for y/mo/d
  const utcGuess = new Date(Date.UTC(y, mo, d, 0, 0, 0));
  const offset = tzOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset * 60000);
}

 function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateOnly(dueStr) {
  const dt = parseDueToDate(dueStr);
  if (!dt) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: COURSE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}



function parseDueToDate(due) {
  if (!due) return null;
  if (typeof due === "string" && due.trim().toLowerCase() === "no date") return null;

  // Date-only: YYYY-MM-DD  (JS treats this as UTC if you do new Date(str) => BAD)
  const m = typeof due === "string" && due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);

    // Make a LOCAL date (your machine timezone). For GT courses you’re in the same TZ anyway.
    // This avoids the off-by-one behavior.
    return dateFromYMDInTimeZone(y, mo, d, COURSE_TIMEZONE);
  }

  const dt = new Date(due);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatDueInCourseTZ(dueStr) {
  const dt = parseDueToDate(dueStr);
  if (!dt) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: COURSE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function formatShortDueInCourseTZ(dueStr) {
  const dt = parseDueToDate(dueStr);
  if (!dt) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: COURSE_TIMEZONE,
    day: "numeric",
    month: "short",
  }).format(dt);
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
  if (c === "LECTURE") return <span className={`${base} bg-emerald-950/40 text-emerald-300 border-emerald-900/50`}>Lecture</span>;
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

  // Theme settings
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [colorMode, setColorMode] = useState(localStorage.getItem("color_mode") || "standard");

  // Subscription state
  const [currentPlan, setCurrentPlan] = useState(localStorage.getItem("subscription_plan") || "free");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [selectedPlanKey, setSelectedPlanKey] = useState(null);

  // Global font setting (applies app-wide)
  const FONT_OPTIONS = {
    sans: { label: "Inter", family: "'Inter', sans-serif" },
    notebook: { label: "Patrick Hand", family: "'Patrick Hand', cursive" },
    serif: { label: "Merriweather", family: "'Merriweather', serif" },
    mono: { label: "Space Mono", family: "'Space Mono', monospace" },
    roboto: { label: "Roboto", family: "'Roboto', sans-serif" },
    lato: { label: "Lato", family: "'Lato', sans-serif" },
    openSans: { label: "Open Sans", family: "'Open Sans', sans-serif" },
    poppins: { label: "Poppins", family: "'Poppins', sans-serif" },
  };


  const PLAN_OPTIONS = {
    free: {
      key: "free",
      name: "Free Tier",
      price: "$0 / month",
      summary: "Ads • Smaller model",
      features: ["Ads", "Smaller model"],
    },
    plus: {
      key: "plus",
      name: "Plus Tier",
      price: "$2 / month",
      summary: "No ads • Better model • 2 weekly refreshes",
      features: ["No ads", "Better model", "2 weekly refreshes"],
      badge: "Popular",
    },
    pro: {
      key: "pro",
      name: "Pro Tier",
      price: "$10 / month",
      summary: "No ads • Best model • Unlimited weekly refreshes",
      features: ["No ads", "Best model", "Unlimited weekly refreshes"],
    },
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


  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("color_mode", colorMode);
  }, [colorMode]);

  useEffect(() => {
    localStorage.setItem("subscription_plan", currentPlan);
  }, [currentPlan]);



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

      const assignList = (finalData && (finalData.a || finalData.assignments)) || [];

      const normalizedAssignments = assignList.map((a) => {
        const idPart = a.cid ?? a.canvas_assignment_id ?? a.nam ?? a.name ?? "item";

        return {
          id: `${courseId}-${idPart}`,
          courseId,
          courseName: courseObj?.name || "Unknown",
          courseCode: courseObj?.courseCode || "UNK",

          name: a.nam ?? a.name ?? "",
          due: a.due ?? a.normalized_due_at ?? a.due_at ?? a.original_due_at ?? null,

          status: a.st ?? a.status ?? null,
          category: String(a.cat ?? a.category ?? "ASSIGNMENT").toUpperCase(),
        };
      });





      setItemsByCourse((prev) => ({
        ...prev,
        [courseId]: normalizedAssignments,
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
    LECTURE: 5,
    PLACEHOLDER: 6,
    PENDING: 7,
  };

  const toTime = (iso) => {
    const d = parseDueToDate(iso);
    return d ? d.getTime() : Number.POSITIVE_INFINITY;
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
  // Filter items for current week
  const weekDates = getWeekDates(currentWeekStart);

    // Normalize week bounds to local midnight to avoid time-of-day bugs
  const weekStart = new Date(weekDates[0].getFullYear(), weekDates[0].getMonth(), weekDates[0].getDate(), 0, 0, 0, 0);
  const weekEnd = new Date(weekDates[6].getFullYear(), weekDates[6].getMonth(), weekDates[6].getDate(), 0, 0, 0, 0);


  const weekItems = allItems
    .filter((item) => {
      const due = parseDueToDate(item.due);
      if (!due) return false;
      return due >= weekStart && due <= addDays(weekEnd, 1);
    })
    .sort((a, b) => toTime(a.due) - toTime(b.due));


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
      items: weekItems
        .filter((item) => {
          const itemDate = parseDueToDate(item.due);
          if (!itemDate) return false;
          return itemDate.toDateString() === dateKey;
        })
        .sort((a, b) => {
          const aTime = parseDueToDate(a.due)?.getTime() ?? Number.POSITIVE_INFINITY;
          const bTime = parseDueToDate(b.due)?.getTime() ?? Number.POSITIVE_INFINITY;
          return aTime - bTime;

        }),

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
    return allItems.filter((item) => {
      const dueDate = parseDueToDate(item.due);
      if (!dueDate) return false;
      return isSameDay(dueDate, date);
    });
  };


  return (
    <div className={`h-screen flex flex-col bg-black app-font theme-app ${theme === "light" ? "theme-light" : "theme-dark"} ${colorMode === "vibrant" ? "mode-vibrant" : "mode-standard"}`}>
      {/* Font Imports */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Patrick+Hand&family=Merriweather:wght@400;700&family=Space+Mono:wght@400;700&family=Roboto:wght@400;700&family=Lato:wght@400;700&family=Open+Sans:wght@400;700&family=Poppins:wght@400;600;700&display=swap');

        :root { --app-font: 'Inter', sans-serif; }
        .app-font { font-family: var(--app-font); }

        /* Backwards compatibility: old class names now just use the global font */
        .font-notebook { font-family: var(--app-font); }


/* Theme variables */
.theme-app.theme-dark.mode-standard {
  --app-bg: #000000;
  --surface-1: #09090b;
  --surface-2: #18181b;
  --surface-3: #27272a;
  --surface-4: #3f3f46;
  --text-1: #ffffff;
  --text-2: #e4e4e7;
  --text-3: #d4d4d8;
  --text-4: #a1a1aa;
  --text-5: #71717a;
  --border-1: #27272a;
  --border-2: #3f3f46;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
}

.theme-app.theme-dark.mode-vibrant {
  --app-bg: #000000;
  --surface-1: #070a10;
  --surface-2: #0b1220;
  --surface-3: #0f1a2e;
  --surface-4: #172554;
  --text-1: #ffffff;
  --text-2: #e2e8f0;
  --text-3: #cbd5e1;
  --text-4: #93c5fd;
  --text-5: #60a5fa;
  --border-1: #1e3a8a;
  --border-2: #2563eb;
  --accent: #38bdf8;
  --accent-hover: #0ea5e9;
}

.theme-app.theme-light.mode-standard {
  --app-bg: #ffffff;
  --surface-1: #ffffff;
  --surface-2: #f4f4f5;
  --surface-3: #e4e4e7;
  --surface-4: #d4d4d8;
  --text-1: #0a0a0a;
  --text-2: #18181b;
  --text-3: #27272a;
  --text-4: #52525b;
  --text-5: #71717a;
  --border-1: #e4e4e7;
  --border-2: #d4d4d8;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
}

.theme-app.theme-light.mode-vibrant {
  --app-bg: #ffffff;
  --surface-1: #ffffff;
  --surface-2: #f8fafc;
  --surface-3: #e2e8f0;
  --surface-4: #cbd5e1;
  --text-1: #0b1220;
  --text-2: #0f172a;
  --text-3: #1e293b;
  --text-4: #334155;
  --text-5: #475569;
  --border-1: #cbd5e1;
  --border-2: #94a3b8;
  --accent: #0ea5e9;
  --accent-hover: #0284c7;
}

/* Map existing Tailwind utility classes to the theme variables */
.theme-app { background-color: var(--app-bg) !important; color: var(--text-1); }
.theme-app.bg-black { background-color: var(--app-bg) !important; }
.theme-app .bg-black { background-color: var(--app-bg) !important; }

.theme-app .bg-zinc-950 { background-color: var(--surface-1) !important; }
.theme-app .bg-zinc-900 { background-color: var(--surface-2) !important; }
.theme-app .bg-zinc-800 { background-color: var(--surface-3) !important; }
.theme-app .bg-zinc-700 { background-color: var(--surface-4) !important; }

.theme-app .hover\:bg-zinc-900:hover { background-color: var(--surface-2) !important; }
.theme-app .hover\:bg-zinc-800:hover { background-color: var(--surface-3) !important; }
.theme-app .hover\:bg-zinc-700:hover { background-color: var(--surface-4) !important; }

.theme-app .text-white { color: var(--text-1) !important; }
.theme-app .text-zinc-200 { color: var(--text-2) !important; }
.theme-app .text-zinc-300 { color: var(--text-3) !important; }
.theme-app .text-zinc-400 { color: var(--text-4) !important; }
.theme-app .text-zinc-500 { color: var(--text-5) !important; }

.theme-app .border-zinc-800 { border-color: var(--border-1) !important; }
.theme-app .border-zinc-700 { border-color: var(--border-2) !important; }

.theme-app .bg-blue-600 { background-color: var(--accent) !important; }
.theme-app .hover\:bg-blue-700:hover { background-color: var(--accent-hover) !important; }
.theme-app .focus\:border-blue-500:focus { border-color: var(--accent) !important; }


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

            {/* Sections */}
            <div className="flex gap-4">
              <div className="w-32 shrink-0">
                <div className="space-y-1">
                  <button
                    onClick={() => setProfileTab("account")}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      profileTab === "account"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white"
                    }`}
                  >
                    Account
                  </button>
                  <button
                    onClick={() => setProfileTab("settings")}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      profileTab === "settings"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white"
                    }`}
                  >
                    Settings
                  </button>
                  <button
                    onClick={() => setProfileTab("upgrade")}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      profileTab === "upgrade"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white"
                    }`}
                  >
                    Upgrade
                  </button>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                {/* SETTINGS TAB */}
                {profileTab === "settings" && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-zinc-200 mb-2">Theme</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setTheme("dark")}
                          className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                            theme === "dark"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                          }`}
                        >
                          Night
                        </button>
                        <button
                          onClick={() => setTheme("light")}
                          className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                            theme === "light"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                          }`}
                        >
                          Day
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500 mt-2">
                        Switch between a light (day) and dark (night) look.
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-zinc-200 mb-2">Color intensity</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setColorMode("standard")}
                          className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                            colorMode === "standard"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                          }`}
                        >
                          Standard
                        </button>
                        <button
                          onClick={() => setColorMode("vibrant")}
                          className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                            colorMode === "vibrant"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
                          }`}
                        >
                          Vibrant
                        </button>
                      </div>
                      <p className="text-xs text-zinc-500 mt-2">
                        Vibrant increases contrast and uses more colorful accents in both themes.
                      </p>
                    </div>

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

                {/* UPGRADE TAB */}
                {profileTab === "upgrade" && (
                  <div className="space-y-4">
                    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-zinc-200 font-medium">Current plan</p>
                          <p className="text-xs text-zinc-500 mt-1">
                            {PLAN_OPTIONS[currentPlan]?.name || "Free Tier"}
                          </p>
                        </div>
                        <span className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                          Mock
                        </span>
                      </div>
                    </div>

                    {/* Mini plan picker */}
                    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-sm text-zinc-200 font-medium mb-2">Choose a plan</p>

                      <div className="space-y-2">
                        {Object.values(PLAN_OPTIONS).map((plan) => (
                          <button
                            key={plan.key}
                            onClick={() => {
                              setSelectedPlanKey(plan.key);
                              setShowUpgradeModal(true);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                              plan.key === currentPlan
                                ? "bg-zinc-800 border-zinc-700"
                                : "bg-transparent border-zinc-800 hover:bg-zinc-900"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-white truncate">{plan.name}</p>
                                  {plan.badge && (
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white">
                                      {plan.badge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-500 mt-1">{plan.summary}</p>
                              </div>
                              <p className="text-xs text-zinc-400 whitespace-nowrap">{plan.price}</p>
                            </div>
                          </button>
                        ))}
                      </div>

                      <p className="text-xs text-zinc-500 mt-3">
                        This is a mock subscription selector (no real payments).
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

    </div>
  </div>
)}



{/* Upgrade Modal (large) */}
{showUpgradeModal && (
  <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[60]">
    <div className="bg-zinc-900 rounded-lg shadow-2xl w-full max-w-2xl p-6 relative border border-zinc-800">
      <button
        onClick={() => setShowUpgradeModal(false)}
        className="absolute top-4 right-4 text-zinc-500 hover:text-white"
        aria-label="Close"
      >
        <X size={20} />
      </button>

      <h3 className="text-lg font-semibold text-white">Upgrade account</h3>
      <p className="text-sm text-zinc-500 mt-1">
        Mock subscription selection (no real payment flow).
      </p>

      {selectedPlanKey && (
        <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-white">
                {PLAN_OPTIONS[selectedPlanKey]?.name}
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                {PLAN_OPTIONS[selectedPlanKey]?.summary}
              </p>
            </div>
            <p className="text-sm text-zinc-300 whitespace-nowrap">
              {PLAN_OPTIONS[selectedPlanKey]?.price}
            </p>
          </div>

          <ul className="mt-4 space-y-2">
            {(PLAN_OPTIONS[selectedPlanKey]?.features || []).map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-zinc-300">
                <CheckCircle2 size={16} className="mt-0.5 text-green-400" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white"
          onClick={() => setShowUpgradeModal(false)}
        >
          Cancel
        </button>

        <button
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
          onClick={() => {
            if (selectedPlanKey) setCurrentPlan(selectedPlanKey);
            setShowUpgradeModal(false);
          }}
        >
          {selectedPlanKey === currentPlan ? "Keep current plan" : "Select plan"}
        </button>
      </div>
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

                                      {/* Start of List */}
                                      <ul className="space-y-0">
                                          {dayData.items.map((item) => {
                                              const isLecture = item.category === "LECTURE";

                                              return (
                                                  <li key={item.id} className="group flex items-start gap-3 py-3 border-b border-zinc-800/60 hover:bg-zinc-900/30 transition-colors">
                                                      {/* Conditional Checkbox: Hide for Lectures */}
                                                      <button
                                                          onClick={() => !isLecture && setCompletedItems(p => ({...p, [item.id]: !p[item.id]}))}
                                                          className={`mt-1 ${isLecture ? "cursor-default opacity-0" : "text-zinc-600 hover:text-green-500"} transition-colors`}
                                                          disabled={isLecture}
                                                      >
                                                          {completedItems[item.id] ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} />}
                                                      </button>

                                                      <div className="flex-1 flex items-center justify-between gap-4 font-notebook text-lg tracking-wide">
                                                          <div className={`flex items-baseline gap-2 ${completedItems[item.id] ? 'line-through text-zinc-600' : 'text-zinc-200'}`}>
                                                              {/* Course Code */}
                                                              <span className="text-zinc-500 font-bold text-base">
                                                                [{item.courseCode ? item.courseCode.toUpperCase() : "UNK"}]
                                                              </span>
                                                              {/* Item Name */}
                                                              <span>{item.name}</span>
                                                          </div>

                                                          <div className="flex items-center gap-3 shrink-0">
                                                               {/* Conditional Time: Show "All Day" for Lectures */}
                                                               <span className="text-sm text-zinc-500 font-sans">
                                                                 {isLecture
                                                                   ? "All Day"
                                                                   : (() => {
                                                                      const dt = parseDueToDate(item.due);
                                                                      return dt
                                                                        ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                                                                        : "—";
                                                                    })()


                                                                 }
                                                               </span>
                                                               {getCategoryBadge(item.category, "opacity-90 scale-90")}
                                                          </div>
                                                      </div>
                                                  </li>
                                              );
                                          })}
                                      </ul>
                                      {/* End of List - This was missing! */}
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
                          <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Status</th>
                        </tr>
                      </thead>

                      <tbody>
                        {sortedCourseItems.map((a, idx) => {
                          const isLecture = a.category === "LECTURE"; // Detect Lecture

                          return (
                            <tr key={`${a.name}-${idx}`} className="border-b border-zinc-800 hover:bg-black transition-colors">
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-2">
                                  {/* Item Name: Dim text if it's just a lecture */}
                                  <span className={isLecture ? "text-zinc-400" : "text-white"}>
                                    {a.name}
                                  </span>
                                  {/* STATUS BADGE: Hide for Lectures */}
                                  {!isLecture && getStatusBadge(a.status)}
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
                                {/* DUE DATE: Show Date Only for Lectures */}
                                {a.due ? (
                                  a.status === "RESOLVED"
                                    ? formatDueInCourseTZ(a.due)   // keep timezone + time
                                    : formatDateOnly(a.due)        // DISCOVERED: date only, no tz/time
                                ) : (
                                  <span className="opacity-30">--</span>
                                )}

                              </td>

                              <td className="py-2 px-2 text-xs text-zinc-500">
                                {/* STATUS TEXT: Hide 'DISCOVERED' text for lectures */}
                                {isLecture ? "" : (a.status || "OK")}
                              </td>
                            </tr>
                          );
                        })}
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