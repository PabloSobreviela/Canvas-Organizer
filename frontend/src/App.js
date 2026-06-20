import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Filter,
  List,
  Loader2,
  Menu,
  Palette,
  RefreshCw,
  Settings2,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  signInWithCanvas,
  logout,
  onAuthChange,
  getDemoToken,
  initAuth,
  storeDemoSession,
  purgeDemoAuthArtifacts,
  apiFetchOptions,
  isAuthenticated,
} from './auth';
import { API_BASE } from "./config";
import { ConsentModal } from "./components/ConsentModal";
import { LegalFooter } from "./components/LegalFooter";
import { MobileNotice } from "./components/MobileNotice";
import { sileo, Toaster } from "sileo";

// GT-first default timezone, overridable for future non-GT tenants.
const COURSE_TIMEZONE = process.env.REACT_APP_DEFAULT_COURSE_TIMEZONE || "America/New_York";
const SHOW_PILOT_BANNER =
  (process.env.REACT_APP_SHOW_PILOT_BANNER || "").trim().toLowerCase() === "true";

async function fetchLegalConsentStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, apiFetchOptions());
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.legal_consent_accepted) && data.legal_consent_current !== false;
  } catch {
    return false;
  }
}

function PilotBanner() {
  if (!SHOW_PILOT_BANNER) return null;
  return (
    <div className="shrink-0 bg-amber-950/80 border-b border-amber-900/60 px-4 py-2 text-center text-xs text-amber-200">
      <strong>Pilot.</strong> CanvasSync is not an official Georgia Tech service. Verify deadlines in Canvas.
    </div>
  );
}

function BrandWordmark({ className = "", height = 26 }) {
  return (
    <img
      src="/canvassync-wordmark.png"
      alt="CanvasSync"
      height={height}
      style={{ height: `${height}px`, width: "auto" }}
      className={className}
    />
  );
}

const LANDING_DEMO_ITEMS = [
  {
    id: "d1",
    courseCode: "CS 1331",
    name: "Project checkpoint",
    due: "11:59 PM",
    day: "Today",
    date: "Jun 7",
    category: "ASSIGNMENT",
    color: "#22c55e",
    urgency: "Today",
    sourcePills: [{ label: "Canvas", tone: "canvas" }],
  },
  {
    id: "d2",
    courseCode: "MATH 2552",
    name: "Problem set 4",
    due: "8:00 PM",
    day: "Today",
    date: "Jun 7",
    category: "ASSIGNMENT",
    color: "#3b82f6",
    urgency: "Review date",
    sourcePills: [{ label: "From materials", tone: "materials" }, { label: "Review date", tone: "review" }],
  },
  {
    id: "d3",
    courseCode: "PHYS 2211",
    name: "Lab report",
    due: "5:00 PM",
    day: "Tomorrow",
    date: "Jun 8",
    category: "ASSIGNMENT",
    color: "#ef4444",
    urgency: "Tomorrow",
    sourcePills: [{ label: "From materials", tone: "materials" }, { label: "Date updated", tone: "updated" }],
  },
  {
    id: "d4",
    courseCode: "HIST 2112",
    name: "Primary source response",
    due: "Done",
    day: "Tomorrow",
    date: "Jun 8",
    category: "ASSIGNMENT",
    color: "#f59e0b",
    completed: true,
    sourcePills: [{ label: "Canvas", tone: "canvas" }],
  },
];

function LandingDemoSquare() {
  const [completed, setCompleted] = useState(() => new Set(LANDING_DEMO_ITEMS.filter((item) => item.completed).map((item) => item.id)));
  const toggle = (id) => setCompleted((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const groupedItems = LANDING_DEMO_ITEMS.reduce((groups, item) => {
    const key = `${item.day}|${item.date}`;
    if (!groups[key]) groups[key] = { day: item.day, date: item.date, items: [] };
    groups[key].items.push(item);
    return groups;
  }, {});

  return (
    <section className="relative rounded-lg border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/30">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-100">Weekly timeline</p>
            <p className="mt-0.5 text-xs text-zinc-500">Canvas assignments and material dates stay labeled.</p>
          </div>
          <span className="shrink-0 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-200">
            Synced
          </span>
        </div>
      </div>

      <div className="px-3 py-2">
        {Object.values(groupedItems).map((group) => (
          <div key={`${group.day}-${group.date}`} className="py-2">
            <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
              <p className="text-[11px] font-semibold uppercase text-zinc-500">{group.day}</p>
              <p className="text-xs text-zinc-600">{group.date}</p>
            </div>

            <div className="overflow-hidden rounded-md border border-zinc-800/80 bg-black/25">
              {group.items.map((item) => {
                const isCompleted = completed.has(item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    className={`group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-800/70 px-3 py-2.5 text-left last:border-b-0 transition-colors hover:bg-zinc-900/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/60 ${isCompleted ? "text-zinc-500" : "text-zinc-100"}`}
                  >
                    <span className={`grid h-5 w-5 place-items-center rounded-full transition-colors ${isCompleted ? "text-green-400" : "text-zinc-500 group-hover:text-zinc-200"}`}>
                      {isCompleted ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                    </span>

                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-medium ${isCompleted ? "text-zinc-500 line-through decoration-zinc-600" : "text-zinc-100"}`}>
                        {item.name}
                      </span>
                      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getCourseColorClasses(item.color).tag}`}>
                          {item.courseCode}
                        </span>
                        {item.sourcePills.map((pill) => (
                          <SourceStatusPill key={`${item.id}-${pill.label}`} pill={pill} size="xs" />
                        ))}
                      </span>
                    </span>

                    <span className="flex min-w-[72px] flex-col items-end gap-1">
                      <span className={`text-xs font-semibold ${item.urgency === "Today" ? "text-red-300" : isCompleted ? "text-zinc-600" : "text-zinc-300"}`}>
                        {item.due}
                      </span>
                      {item.urgency && !isCompleted ? (
                        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-200">
                          {item.urgency}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const SYNC_DEFAULT_TIMEOUT_MS = 30000;
/** AI resolve sends large syllabus payloads to DeepInfra and often exceeds 30s. */
const AI_RESOLVE_TIMEOUT_MS = 120000;

async function fetchWithTimeout(resource, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(
      new DOMException(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, "TimeoutError"),
    );
  }, timeoutMs);
  try {
    return await fetch(resource, {
      ...apiFetchOptions(options || {}),
      signal: controller.signal,
    });
  } catch (err) {
    const isAbort = err?.name === "AbortError" || err?.name === "TimeoutError";
    if (isAbort) {
      const seconds = Math.round(timeoutMs / 1000);
      throw new Error(
        err?.message?.includes("timed out")
          ? err.message
          : `Request timed out after ${seconds} seconds. AI date resolution can take up to 2 minutes — try syncing again.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

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
  if (!dt) return "--";
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

    // Make a LOCAL date (your machine timezone). For GT courses you're in the same TZ anyway.
    // This avoids the off-by-one behavior.
    return dateFromYMDInTimeZone(y, mo, d, COURSE_TIMEZONE);
  }

  const dt = new Date(due);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function formatDueInCourseTZ(dueStr) {
  const dt = parseDueToDate(dueStr);
  if (!dt) return "--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: COURSE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

function formatDueTimeInCourseTZ(dueStr) {
  if (!dueStr) return "--";
  if (typeof dueStr === "string" && dueStr.trim().match(/^\d{4}-\d{2}-\d{2}$/)) return "Date only";
  const dt = parseDueToDate(dueStr);
  if (!dt) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: COURSE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}

function formatMobileDueLabel(dueStr) {
  const dt = parseDueToDate(dueStr);
  if (!dt) return "--";

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: COURSE_TIMEZONE,
    month: "short",
    day: "numeric",
  }).format(dt);

  if (typeof dueStr === "string" && dueStr.trim().match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateLabel;
  }

  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: COURSE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);

  return `${dateLabel}, ${timeLabel}`;
}

function formatMobileWeekRange(startDate, endDate) {
  const sameMonth = startDate.getFullYear() === endDate.getFullYear()
    && startDate.getMonth() === endDate.getMonth();
  if (sameMonth) {
    return `${startDate.toLocaleDateString("en-US", { month: "short" })} ${startDate.getDate()}–${endDate.getDate()}`;
  }
  return `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function getDayLabel(date) {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, tomorrow)) return "Tomorrow";
  if (date < new Date(today.getFullYear(), today.getMonth(), today.getDate())) return "Past due";
  return "";
}

function getDeadlineMeta(item, isCompleted = false) {
  if (isCompleted) return { label: "Done", tone: "text-green-300", pill: "border-green-500/30 bg-green-500/10 text-green-200" };
  const due = parseDueToDate(item?.due);
  if (!due) return { label: "No date", tone: "text-zinc-500", pill: "border-zinc-600/60 bg-zinc-900 text-zinc-400" };
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = addDays(todayStart, 1);
  const dayAfterTomorrow = addDays(todayStart, 2);

  if (due < now) return { label: "Overdue", tone: "text-red-300", pill: "border-red-500/35 bg-red-500/10 text-red-200" };
  if (due >= todayStart && due < tomorrow) return { label: "Today", tone: "text-red-300", pill: "border-red-500/35 bg-red-500/10 text-red-200" };
  if (due >= tomorrow && due < dayAfterTomorrow) return { label: "Tomorrow", tone: "text-amber-300", pill: "border-amber-500/35 bg-amber-500/10 text-amber-200" };
  return { label: "", tone: "text-zinc-400", pill: "" };
}


// INVERTED COLOR SCHEME (Light text, Dark BG) for badges
// Categories: ASSIGNMENT and EXAM only (QUIZ merged into EXAM)
function getCategoryBadge(category, className = "") {
  const c = (category || "ASSIGNMENT").toUpperCase();
  const base = `px-2 py-0.5 text-xs rounded border inline-flex items-center ${className}`;

  // EXAM covers both exams and quizzes
  if (c === "EXAM" || c === "QUIZ") return <span className={`${base} bg-red-950/60 text-red-200 border-red-900`}>Exam</span>;
  if (c === "PLACEHOLDER") return <span className={`${base} bg-slate-800 text-slate-300 border-slate-700`}>Placeholder</span>;
  // Default to Assignment
  return <span className={`${base} bg-blue-950/60 text-blue-200 border-blue-900`}>Assignment</span>;
}

const SOURCE_PILL_TONES = {
  canvas: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  materials: "border-teal-500/30 bg-teal-500/10 text-teal-200",
  updated: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  review: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  missing: "border-zinc-600/60 bg-zinc-900 text-zinc-400",
};

function makeSourcePill(label, tone) {
  return { label, tone };
}

function sourceTextForItem(item) {
  return String(item?.sourceOfTruth ?? item?.source_of_truth ?? item?.source ?? "").trim().toLowerCase();
}

function getSourceStatusPills(item) {
  const status = String(item?.status || "").trim().toUpperCase();
  const sourceText = sourceTextForItem(item);
  const hasCanvasSource = Boolean(extractAssignmentIdFromItem(item, item?.courseId))
    || sourceText.includes("canvas");
  const hasMaterialsSource = Boolean(extractDiscoveredKeyFromItem(item))
    || status === "DISCOVERED"
    || /schedule|material|syllabus|file|announcement|page|module/.test(sourceText);
  const pills = [];

  if (hasCanvasSource) {
    pills.push(makeSourcePill("Canvas", "canvas"));
  }
  if (hasMaterialsSource) {
    pills.push(makeSourcePill("AI-generated from materials", "materials"));
  }

  if (status === "RESOLVED") {
    pills.push(makeSourcePill("AI-assisted date", "updated"));
  }
  if (status === "CONFLICT") {
    pills.push(makeSourcePill("Review AI date", "review"));
  }
  if (!parseDueToDate(item?.due)) {
    pills.push(makeSourcePill("No date yet", "missing"));
  }

  return pills;
}

function SourceStatusPill({ pill, size = "sm", className = "" }) {
  if (!pill?.label) return null;
  const sizeClass = size === "xs"
    ? "px-1.5 py-0.5 text-[10px]"
    : "px-2 py-0.5 text-xs";
  const toneClass = SOURCE_PILL_TONES[pill.tone] || SOURCE_PILL_TONES.missing;

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border font-medium ${sizeClass} ${toneClass} ${className}`}>
      {pill.label}
    </span>
  );
}

function SourceStatusPills({ item, size = "sm", limit = 3, className = "" }) {
  const pills = getSourceStatusPills(item).slice(0, limit);
  if (!pills.length) return null;

  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      {pills.map((pill) => (
        <SourceStatusPill key={`${pill.label}-${pill.tone}`} pill={pill} size={size} />
      ))}
    </span>
  );
}

function normalizeCategoryForViews(category) {
  const c = String(category || "").trim().toUpperCase();
  if (c === "EXAM" || c === "QUIZ") return "EXAM";
  if (c === "PLACEHOLDER" || c === "READING" || c === "LECTURE" || c === "ATTENDANCE") return c;
  // Treat unknown deliverable-like categories (e.g. LAB) as ASSIGNMENT for weekly/calendar.
  return "ASSIGNMENT";
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

/**
 * Returns calendar dates for the given month with 4, 5, or 6 rows
 * depending on how many weeks the month actually needs.
 */
function getMonthDates(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const totalCellsNeeded = startDay + daysInMonth;
  const rows = Math.ceil(totalCellsNeeded / 7); // 4, 5, or 6
  const totalSlots = rows * 7;

  const dates = [];

  for (let i = 0; i < startDay; i++) {
    const prevDate = new Date(year, month, -startDay + i + 1);
    dates.push({ date: prevDate, isCurrentMonth: false });
  }

  for (let i = 1; i <= daysInMonth; i++) {
    dates.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }

  const remainingDays = totalSlots - dates.length;
  for (let i = 1; i <= remainingDays; i++) {
    dates.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
  }

  return { dates, rows };
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function normalizeCourseId(id) {
  return id == null ? "" : String(id);
}

function normalizeAssignmentToken(value) {
  return String(value ?? "").trim();
}

function normalizeMergedNameKey(value) {
  let text = normalizeCompletionText(value);
  text = text.replace(/#\s*(\d+)/g, " $1 ");
  text = text.replace(/\b(quizzes?|tests?|midterms?|finals?|exams?)\b/g, " exam ");
  text = text.replace(/\b(homeworks?|hws?|assignments?)\b/g, " assignment ");
  text = text.replace(/[^a-z0-9]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function normalizeCompletionText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function slugifyCompletionText(value) {
  const normalized = normalizeCompletionText(value);
  return normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function buildAssignmentStableId(courseId, assignmentId, name = "", due = "") {
  const cid = normalizeCourseId(courseId);
  const aid = normalizeAssignmentToken(assignmentId);
  if (aid) return `${cid}-${aid}`;

  const nameToken = slugifyCompletionText(name).slice(0, 64) || "assignment";
  const dueToken = slugifyCompletionText(due).slice(0, 32) || "no-due";
  return `${cid}-n-${nameToken}-d-${dueToken}`;
}

function extractAssignmentIdFromItem(item, courseId = "") {
  const direct = normalizeAssignmentToken(
    item?.canvasAssignmentId ??
    item?.canvas_assignment_id ??
    item?.assignmentId
  );
  if (direct) return direct;

  const cid = normalizeCourseId(courseId || item?.courseId);
  const rawItemId = normalizeAssignmentToken(item?.id);
  const prefix = `${cid}-`;
  if (rawItemId.startsWith(prefix)) {
    const suffix = rawItemId.slice(prefix.length).trim();
    if (suffix && /^\d+$/.test(suffix)) return suffix;
  }
  return "";
}

function extractDiscoveredKeyFromItem(item) {
  return normalizeAssignmentToken(
    item?.discoveredKey ??
    item?.discovered_key ??
    item?.dk
  ).toLowerCase();
}

function buildAssignmentCompletionSignatures({ courseId, assignmentId, discoveredKey = "", name = "", due = "" }) {
  const cid = normalizeCourseId(courseId);
  const signatures = [];
  const aid = normalizeAssignmentToken(assignmentId);
  if (aid) signatures.push(`${cid}|aid|${aid}`);
  const dk = normalizeAssignmentToken(discoveredKey).toLowerCase();
  if (dk) signatures.push(`${cid}|dk|${dk}`);

  const nameToken = normalizeCompletionText(name);
  if (nameToken) {
    signatures.push(`${cid}|name|${nameToken}|due|${normalizeCompletionText(due)}`);
  }
  return signatures;
}

function normalizeTruthyCourseMap(raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object") return normalized;
  for (const [courseId, enabled] of Object.entries(raw)) {
    const normalizedId = normalizeCourseId(courseId);
    if (normalizedId && enabled) normalized[normalizedId] = true;
  }
  return normalized;
}

function deriveCourseCode(rawCode, courseName = "") {
  const raw = String(rawCode || "").trim();
  const name = String(courseName || "").trim();
  const regex = /\b([A-Za-z]{2,6})\s*[- ]?\s*(\d{3,4})\b/;

  const rawMatch = raw.match(regex);
  if (rawMatch) return `${rawMatch[1].toUpperCase()} ${rawMatch[2]}`;

  const nameMatch = name.match(regex);
  if (nameMatch) return `${nameMatch[1].toUpperCase()} ${nameMatch[2]}`;

  if (raw && raw.toUpperCase() !== "UNK") return raw.toUpperCase();
  return "UNK";
}

function buildMergedItemKey(item) {
  const code = deriveCourseCode(item?.courseCode, item?.courseName || "");
  const normalizedCode = code && code !== "UNK" ? code : "";
  const codeKey = normalizedCode || normalizeCourseId(item?.courseId) || "UNK";
  const nameKey = normalizeMergedNameKey(item?.name || "");
  const parsedDue = parseDueToDate(item?.due);
  const dueKey = parsedDue ? String(parsedDue.getTime()) : String(item?.due || "").trim();
  const discoveredKey = extractDiscoveredKeyFromItem(item);
  const assignmentToken = extractAssignmentIdFromItem(item, item?.courseId);
  const hasSequenceToken = /\b\d{1,3}\b/.test(nameKey);
  const dueComponent = hasSequenceToken ? "" : `|d|${dueKey}`;

  if (discoveredKey) {
    return `${codeKey}|dk|${discoveredKey}`;
  }
  if (normalizedCode && (nameKey || dueKey)) {
    return `${codeKey}|n|${nameKey}${dueComponent}`;
  }
  if (assignmentToken) {
    return `${codeKey}|aid|${assignmentToken}`;
  }
  return `${codeKey}|n|${nameKey}${dueComponent}`;
}

function discoveredNameMatchesCanvas(discoveredNorm, canvasNorm) {
  if (!discoveredNorm || !canvasNorm || discoveredNorm.length < 3 || canvasNorm.length < 3) return false;
  const safeContains = (shorter, longer) => {
    if (!longer.includes(shorter)) return false;
    const idx = longer.indexOf(shorter);
    const end = idx + shorter.length;
    if (end < longer.length && /\d/.test(longer[end])) return false;
    return true;
  };
  if (safeContains(discoveredNorm, canvasNorm) || safeContains(canvasNorm, discoveredNorm)) return true;
  const aWords = new Set(discoveredNorm.split(/\s+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w)));
  const bWords = new Set(canvasNorm.split(/\s+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w)));
  if (!aWords.size || !bWords.size) return false;
  const overlap = [...aWords].filter((w) => bWords.has(w)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return overlap / union >= 0.8;
}

function buildInCourseDedupeKey(item, canvasNameDueMap = null) {
  const assignmentToken = extractAssignmentIdFromItem(item, item?.courseId);
  if (assignmentToken) return `aid|${assignmentToken}`;

  const nameKey = normalizeMergedNameKey(item?.name || "");
  const dueKey = getDueDateKey(item?.due);

  if (canvasNameDueMap && !assignmentToken) {
    for (const [cnKey, { aid, canvasNorm }] of canvasNameDueMap.entries()) {
      const [, cnDue] = cnKey.split("\x00");
      if (cnDue !== dueKey) continue;
      if (discoveredNameMatchesCanvas(nameKey, canvasNorm)) return `aid|${aid}`;
    }
  }

  const discoveredKey = extractDiscoveredKeyFromItem(item);
  if (discoveredKey) return `dk|${discoveredKey}`;

  const numberTokenMatch = nameKey.match(/\b(\d{1,3})\b/);
  if (numberTokenMatch) {
    return `nm|${nameKey}|n|${numberTokenMatch[1]}`;
  }
  return `nm|${nameKey}|d|${dueKey}`;
}

function getDueDateKey(due) {
  const parsed = parseDueToDate(due);
  if (!parsed) return String(due || "").trim();
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dedupeAssignmentsWithinCourse(items) {
  const merged = new Map();
  const arr = Array.isArray(items) ? items : [];

  const canvasNameDueMap = new Map();
  for (const item of arr) {
    const aid = extractAssignmentIdFromItem(item, item?.courseId);
    if (!aid) continue;
    const nameKey = normalizeMergedNameKey(item?.name || "");
    const dueKey = getDueDateKey(item?.due);
    const key = `${nameKey}\x00${dueKey}`;
    if (!canvasNameDueMap.has(key)) canvasNameDueMap.set(key, { aid, canvasNorm: nameKey });
  }

  const score = (item) => {
    const assignmentToken = extractAssignmentIdFromItem(item, item?.courseId);
    const discoveredKey = extractDiscoveredKeyFromItem(item);
    const hasDue = !!parseDueToDate(item?.due) || !!String(item?.due || "").trim();
    const nameLength = String(item?.name || "").trim().length;
    return [
      assignmentToken ? 1 : 0,
      discoveredKey ? 1 : 0,
      hasDue ? 1 : 0,
      nameLength,
    ];
  };

  const isIncomingBetter = (incoming, existing) => {
    const a = score(incoming);
    const b = score(existing);
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
  };

  for (const item of arr) {
    const key = buildInCourseDedupeKey(item, canvasNameDueMap);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }

    if (isIncomingBetter(item, existing)) {
      merged.set(key, item);
    }
  }

  return Array.from(merged.values());
}

function getMonthGridRowsClass(rows) {
  if (rows === 4) return "month-grid-rows-4";
  if (rows === 5) return "month-grid-rows-5";
  return "month-grid-rows-6";
}

const COURSE_COLOR_CLASS_MAP = {
  "#ef4444": { dot: "bg-red-500", tag: "bg-red-500/20 text-red-300 border border-red-500/40", accent: "border-l-red-500" },
  "#f97316": { dot: "bg-orange-500", tag: "bg-orange-500/20 text-orange-300 border border-orange-500/40", accent: "border-l-orange-500" },
  "#f59e0b": { dot: "bg-amber-500", tag: "bg-amber-500/20 text-amber-300 border border-amber-500/40", accent: "border-l-amber-500" },
  "#eab308": { dot: "bg-yellow-500", tag: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40", accent: "border-l-yellow-500" },
  "#84cc16": { dot: "bg-lime-500", tag: "bg-lime-500/20 text-lime-300 border border-lime-500/40", accent: "border-l-lime-500" },
  "#22c55e": { dot: "bg-green-500", tag: "bg-green-500/20 text-green-300 border border-green-500/40", accent: "border-l-green-500" },
  "#10b981": { dot: "bg-emerald-500", tag: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40", accent: "border-l-emerald-500" },
  "#14b8a6": { dot: "bg-teal-500", tag: "bg-teal-500/20 text-teal-300 border border-teal-500/40", accent: "border-l-teal-500" },
  "#06b6d4": { dot: "bg-cyan-500", tag: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40", accent: "border-l-cyan-500" },
  "#0ea5e9": { dot: "bg-sky-500", tag: "bg-sky-500/20 text-sky-300 border border-sky-500/40", accent: "border-l-sky-500" },
  "#3b82f6": { dot: "bg-blue-500", tag: "bg-blue-500/20 text-blue-300 border border-blue-500/40", accent: "border-l-blue-500" },
  "#6366f1": { dot: "bg-indigo-500", tag: "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40", accent: "border-l-indigo-500" },
  "#8b5cf6": { dot: "bg-violet-500", tag: "bg-violet-500/20 text-violet-300 border border-violet-500/40", accent: "border-l-violet-500" },
  "#a855f7": { dot: "bg-purple-500", tag: "bg-purple-500/20 text-purple-300 border border-purple-500/40", accent: "border-l-purple-500" },
  "#d946ef": { dot: "bg-fuchsia-500", tag: "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40", accent: "border-l-fuchsia-500" },
  "#ec4899": { dot: "bg-pink-500", tag: "bg-pink-500/20 text-pink-300 border border-pink-500/40", accent: "border-l-pink-500" },
  "#f43f5e": { dot: "bg-rose-500", tag: "bg-rose-500/20 text-rose-300 border border-rose-500/40", accent: "border-l-rose-500" },
  "#78716c": { dot: "bg-stone-500", tag: "bg-stone-500/20 text-stone-300 border border-stone-500/40", accent: "border-l-stone-500" },
};

function normalizeHexColor(color) {
  return String(color || "").trim().toLowerCase();
}

function getCourseColorClasses(color) {
  return COURSE_COLOR_CLASS_MAP[normalizeHexColor(color)] || {
    dot: "bg-zinc-500",
    tag: "bg-zinc-500/20 text-zinc-300 border border-zinc-500/40",
    accent: "border-l-zinc-500",
  };
}

const COURSE_SYNC_STATE_KEY_PREFIX = "course_sync_state";
const COURSE_SYNC_STATE_KEY_VERSION = "v2";
const LEGACY_COURSE_SYNC_STATE_KEY = "course_sync_state";
const COMPLETED_ITEMS_KEY_PREFIX = "completed_items_state";
const COMPLETED_ITEMS_KEY_VERSION = "v2";
const CANVAS_COMPLETION_REFRESH_KEY_PREFIX = "canvas_completion_refresh";
const CANVAS_COMPLETION_REFRESH_KEY_VERSION = "v1";
const CANVAS_COMPLETION_REFRESH_THROTTLE_MS = 15 * 60 * 1000;
const COURSES_CACHE_KEY_PREFIX = "courses_cache";
const COURSES_CACHE_KEY_VERSION = "v1";
const ASSIGNMENTS_CACHE_KEY_PREFIX = "assignments_cache";
const ASSIGNMENTS_CACHE_KEY_VERSION = "v1";

function normalizeCanvasBaseUrl(url) {
  return String(url || "").trim().toLowerCase().replace(/\/+$/, "");
}

function hashScopeToken(token = "") {
  // Non-reversible token fingerprint for localStorage keys (avoids token material in key names).
  const input = String(token || "").trim();
  if (!input) return "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildCourseSyncStateKey(baseUrl = "", token = "") {
  const normalizedBaseUrl = normalizeCanvasBaseUrl(baseUrl || localStorage.getItem("canvas_base_url"));
  const tokenHash = hashScopeToken(token);
  if (!normalizedBaseUrl || !tokenHash) return COURSE_SYNC_STATE_KEY_PREFIX;

  const scope = encodeURIComponent(`${normalizedBaseUrl}|${tokenHash}`);
  return `${COURSE_SYNC_STATE_KEY_PREFIX}:${COURSE_SYNC_STATE_KEY_VERSION}:${scope}`;
}

function getSavedCourseSyncState(baseUrl = "", token = "") {
  const scopedKey = buildCourseSyncStateKey(baseUrl, token);
  try {
    const raw = localStorage.getItem(scopedKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setSavedCourseSyncState(state, baseUrl = "", token = "") {
  const scopedKey = buildCourseSyncStateKey(baseUrl, token);
  localStorage.setItem(scopedKey, JSON.stringify(state));
}

function buildCompletedItemsKey(userId = "", baseUrl = "", token = "") {
  const normalizedUserId = String(userId || "").trim();
  const normalizedBaseUrl = normalizeCanvasBaseUrl(baseUrl || localStorage.getItem("canvas_base_url"));
  const tokenHash = hashScopeToken(token);
  const scope = encodeURIComponent(`${normalizedUserId}|${normalizedBaseUrl}|${tokenHash}`);
  return `${COMPLETED_ITEMS_KEY_PREFIX}:${COMPLETED_ITEMS_KEY_VERSION}:${scope}`;
}

function readCompletedItemsFromStorageKey(key = "") {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const normalized = {};
    for (const [itemId, checked] of Object.entries(parsed)) {
      if (checked) normalized[itemId] = true;
    }
    return normalized;
  } catch {
    return {};
  }
}

function getCompletedItemsFromAllTokenScopes(userId = "", baseUrl = "") {
  const normalizedUserId = String(userId || "").trim();
  const normalizedBaseUrl = normalizeCanvasBaseUrl(baseUrl || localStorage.getItem("canvas_base_url"));
  if (!normalizedUserId || !normalizedBaseUrl) return {};

  const prefix = `${COMPLETED_ITEMS_KEY_PREFIX}:${COMPLETED_ITEMS_KEY_VERSION}:`;
  const merged = {};

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;

      const encodedScope = key.slice(prefix.length);
      let decodedScope = "";
      try {
        decodedScope = decodeURIComponent(encodedScope);
      } catch {
        continue;
      }

      const [scopeUserId, scopeBaseUrl] = decodedScope.split("|");
      if (scopeUserId !== normalizedUserId) continue;
      if (normalizeCanvasBaseUrl(scopeBaseUrl) !== normalizedBaseUrl) continue;

      const scopedState = readCompletedItemsFromStorageKey(key);
      for (const itemId of Object.keys(scopedState)) {
        merged[itemId] = true;
      }
    }
  } catch {
    return {};
  }

  return merged;
}

function getSavedCompletedItems(userId = "", baseUrl = "", token = "") {
  const key = buildCompletedItemsKey(userId, baseUrl, token);
  const primaryState = readCompletedItemsFromStorageKey(key);
  if (Object.keys(primaryState).length > 0) return primaryState;

  // Cloud mode usually has no client token; fall back to token-less scope first.
  const tokenHash = hashScopeToken(token);
  if (tokenHash) {
    const tokenlessState = readCompletedItemsFromStorageKey(buildCompletedItemsKey(userId, baseUrl, ""));
    if (Object.keys(tokenlessState).length > 0) return tokenlessState;
  }

  // Last-resort migration path: merge all token scopes for this user + Canvas base.
  return getCompletedItemsFromAllTokenScopes(userId, baseUrl);
}

function setSavedCompletedItems(state, userId = "", baseUrl = "", token = "") {
  const key = buildCompletedItemsKey(userId, baseUrl, token);
  const tokenHash = hashScopeToken(token);
  const tokenlessKey = tokenHash ? buildCompletedItemsKey(userId, baseUrl, "") : "";
  // Persist only truthy entries so unchecked items don't linger in localStorage forever.
  // (Also keeps payload small and stable across reloads.)
  const normalized = {};
  for (const [itemId, checked] of Object.entries(state || {})) {
    if (checked) normalized[itemId] = true;
  }
  try {
    if (Object.keys(normalized).length === 0) {
      localStorage.removeItem(key);
      if (tokenlessKey && tokenlessKey !== key) {
        localStorage.removeItem(tokenlessKey);
      }
      return;
    }
    localStorage.setItem(key, JSON.stringify(normalized));
    if (tokenlessKey && tokenlessKey !== key) {
      localStorage.setItem(tokenlessKey, JSON.stringify(normalized));
    }
  } catch {
    // Best-effort cache; ignore quota/security errors.
  }
}

function buildCompletionRefreshKey(userId = "", baseUrl = "") {
  const normalizedUserId = String(userId || "").trim();
  const normalizedBaseUrl = normalizeCanvasBaseUrl(baseUrl || localStorage.getItem("canvas_base_url"));
  const scope = encodeURIComponent(`${normalizedUserId}|${normalizedBaseUrl}`);
  return `${CANVAS_COMPLETION_REFRESH_KEY_PREFIX}:${CANVAS_COMPLETION_REFRESH_KEY_VERSION}:${scope}`;
}

function getLastCompletionRefreshAt(userId = "", baseUrl = "") {
  const key = buildCompletionRefreshKey(userId, baseUrl);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  } catch {
    return 0;
  }
}

function setLastCompletionRefreshAt(userId = "", baseUrl = "", timestampMs = Date.now()) {
  const key = buildCompletionRefreshKey(userId, baseUrl);
  try {
    localStorage.setItem(key, String(Math.max(0, Number(timestampMs) || 0)));
  } catch {
    // Best-effort cache; ignore quota/security errors.
  }
}

function buildCoursesCacheKey(userId = "", baseUrl = "") {
  const normalizedUserId = String(userId || "").trim();
  const normalizedBaseUrl = normalizeCanvasBaseUrl(baseUrl || localStorage.getItem("canvas_base_url"));
  const scope = encodeURIComponent(`${normalizedUserId}|${normalizedBaseUrl}`);
  return `${COURSES_CACHE_KEY_PREFIX}:${COURSES_CACHE_KEY_VERSION}:${scope}`;
}

function getSavedCoursesCache(userId = "", baseUrl = "") {
  const key = buildCoursesCacheKey(userId, baseUrl);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const courses = Array.isArray(parsed.courses) ? parsed.courses : [];
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : null;
    return { courses, savedAt };
  } catch {
    return null;
  }
}

function setSavedCoursesCache(userId = "", baseUrl = "", courses = []) {
  const key = buildCoursesCacheKey(userId, baseUrl);
  const payload = {
    savedAt: Date.now(),
    courses: Array.isArray(courses) ? courses : [],
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore quota errors; cache is best-effort.
  }
}

function buildAssignmentsCacheKey(userId = "", baseUrl = "") {
  const normalizedUserId = String(userId || "").trim();
  const normalizedBaseUrl = normalizeCanvasBaseUrl(baseUrl || localStorage.getItem("canvas_base_url"));
  const scope = encodeURIComponent(`${normalizedUserId}|${normalizedBaseUrl}`);
  return `${ASSIGNMENTS_CACHE_KEY_PREFIX}:${ASSIGNMENTS_CACHE_KEY_VERSION}:${scope}`;
}

function getSavedAssignmentsCache(userId = "", baseUrl = "") {
  const key = buildAssignmentsCacheKey(userId, baseUrl);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const itemsByCourse = parsed.itemsByCourse && typeof parsed.itemsByCourse === "object" ? parsed.itemsByCourse : null;
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : null;
    return itemsByCourse ? { itemsByCourse, savedAt } : null;
  } catch {
    return null;
  }
}

function setSavedAssignmentsCache(userId = "", baseUrl = "", itemsByCourse = {}) {
  const key = buildAssignmentsCacheKey(userId, baseUrl);
  const payload = {
    savedAt: Date.now(),
    itemsByCourse: itemsByCourse && typeof itemsByCourse === "object" ? itemsByCourse : {},
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore quota errors; cache is best-effort.
  }
}

function clearAllLocalCanvasSyncData() {
  const exactKeys = new Set([
    "canvas_base_url",
    "course_colors",
    "starred_courses",
    "sync_enabled_courses",
    "weekly_filters",
    "last_sync_at",
    "subscription_plan",
    "global_font",
    "theme",
    "color_mode",
  ]);
  const prefixes = [
    COURSE_SYNC_STATE_KEY_PREFIX,
    COMPLETED_ITEMS_KEY_PREFIX,
    CANVAS_COMPLETION_REFRESH_KEY_PREFIX,
    COURSES_CACHE_KEY_PREFIX,
    ASSIGNMENTS_CACHE_KEY_PREFIX,
  ];

  try {
    const removals = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (exactKeys.has(key) || prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) {
        removals.push(key);
      }
    }
    removals.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Browser storage can be unavailable in hardened/private contexts.
  }
}

function App() {
  // Authentication State
  const [canvasUser, setCanvasUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [legalConsentAccepted, setLegalConsentAccepted] = useState(false);

  // Canvas credentials (must be declared before loadCachedData uses them)
  const [canvasBaseUrl, setCanvasBaseUrl] = useState(
    localStorage.getItem("canvas_base_url") || ""
  );
  const [canvasToken, setCanvasToken] = useState("");
  const [canvasStatus, setCanvasStatus] = useState(null);

  // Security migration: purge legacy persisted Canvas token from previous versions.
  useEffect(() => {
    localStorage.removeItem("canvas_token");
  }, []);

  // Security migration: remove pre-v2 scoped state keys that embedded raw token material.
  useEffect(() => {
    const removals = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (
        key.startsWith(`${COURSE_SYNC_STATE_KEY_PREFIX}:`) &&
        !key.startsWith(`${COURSE_SYNC_STATE_KEY_PREFIX}:${COURSE_SYNC_STATE_KEY_VERSION}:`)
      ) {
        removals.push(key);
        continue;
      }

      if (
        key.startsWith(`${COMPLETED_ITEMS_KEY_PREFIX}:`) &&
        !key.startsWith(`${COMPLETED_ITEMS_KEY_PREFIX}:${COMPLETED_ITEMS_KEY_VERSION}:`)
      ) {
        removals.push(key);
      }
    }

    removals.forEach((key) => localStorage.removeItem(key));
  }, []);

  // Course and assignment state (must be declared before loadCachedData)
  const [activeCourses, setActiveCourses] = useState([]);
  const [itemsByCourse, setItemsByCourse] = useState({});

  // Load cached user data from Supabase on login
  const loadCachedData = useCallback(async ({ userId } = {}) => {
    try {
      if (!userId && !isAuthenticated()) return;
      const normalizedUserId = String(userId || "").trim();
      if (!normalizedUserId) return;

      const localBaseUrl = localStorage.getItem("canvas_base_url") || "";
      const localToken = "";
      let resolvedBaseUrl = localBaseUrl;
      let resolvedToken = localToken;
      let hasServerCredentials = false;
      let coursesData = { courses: [] };
      let assignmentsFromBootstrap = null;
      let preferencesFromServer = null;
      let usedBootstrap = false;

      const applyServerPreferences = (prefs) => {
        if (!prefs || typeof prefs !== "object") return;

        if (prefs.courseColors && typeof prefs.courseColors === "object") {
          setCourseColors(prefs.courseColors);
          localStorage.setItem("course_colors", JSON.stringify(prefs.courseColors));
        }
        if (prefs.starredCourses && typeof prefs.starredCourses === "object") {
          setStarredCourses(prefs.starredCourses);
          localStorage.setItem("starred_courses", JSON.stringify(prefs.starredCourses));
        }
        if (prefs.syncEnabledCourses && typeof prefs.syncEnabledCourses === "object") {
          const normalizedSyncEnabled = normalizeTruthyCourseMap(prefs.syncEnabledCourses);
          setSyncEnabledCourses(normalizedSyncEnabled);
          localStorage.setItem("sync_enabled_courses", JSON.stringify(normalizedSyncEnabled));
        }
        if (prefs.completedItems && typeof prefs.completedItems === "object") {
          const normalized = {};
          for (const [itemId, checked] of Object.entries(prefs.completedItems || {})) {
            if (checked) normalized[itemId] = true;
          }

          setCompletedItems((prev) => {
            const next = { ...(prev || {}) };
            let changed = false;
            for (const [itemId, checked] of Object.entries(normalized)) {
              if (checked && !next[itemId]) {
                next[itemId] = true;
                changed = true;
              }
            }
            const finalState = changed ? next : (prev || {});
            if (resolvedBaseUrl) {
              setSavedCompletedItems(finalState, normalizedUserId, resolvedBaseUrl, "");
            }
            return changed ? finalState : (prev || finalState);
          });
        }
      };

      // Optimized startup path: one authenticated request for credentials + preferences + courses + assignments.
      const bootstrapRes = await fetchWithTimeout(
        `${API_BASE}/api/user/bootstrap?includeAssignments=1`,
        apiFetchOptions(),
        9000,
      ).catch(err => {
        console.warn(`Bootstrap fetch failed from ${API_BASE}:`, err.message);
        return null;
      });

      if (bootstrapRes && bootstrapRes.ok) {
        const bootstrap = await bootstrapRes.json().catch(() => null);
        if (bootstrap && typeof bootstrap === "object") {
          usedBootstrap = true;
          hasServerCredentials = !!bootstrap.has_credentials;
          if (hasServerCredentials) {
            resolvedBaseUrl = bootstrap.base_url || "";
            resolvedToken = "";
            setCanvasBaseUrl(resolvedBaseUrl);
            setCanvasToken(resolvedToken);
            localStorage.setItem("canvas_base_url", resolvedBaseUrl);
            setCanvasStatus("Connected");
          }
          coursesData = {
            courses: Array.isArray(bootstrap.courses) ? bootstrap.courses : [],
          };
          assignmentsFromBootstrap = Array.isArray(bootstrap.assignments) ? bootstrap.assignments : [];
          preferencesFromServer = bootstrap.preferences && typeof bootstrap.preferences === "object"
            ? bootstrap.preferences
            : null;
        }
      }

      if (!usedBootstrap) {
        // Fallback path for older backend revisions.
        const [credsRes, coursesRes, prefsRes] = await Promise.all([
          Promise.resolve(null),
          fetchWithTimeout(`${API_BASE}/api/user/courses`, apiFetchOptions(), 8000).catch(err => {
            console.error(`Failed to fetch cached courses from ${API_BASE}:`, err.message);
            return null;
          }),
          fetchWithTimeout(`${API_BASE}/api/user/preferences`, apiFetchOptions(), 6000).catch(err => {
            console.warn(`Failed to fetch preferences from ${API_BASE}:`, err.message);
            return null;
          }),
        ]);

        if (credsRes && credsRes.ok) {
          const credsData = await credsRes.json();
          if (credsData.has_credentials) {
            hasServerCredentials = true;
            resolvedBaseUrl = credsData.base_url || "";
            resolvedToken = "";
            setCanvasBaseUrl(resolvedBaseUrl);
            setCanvasToken(resolvedToken);
            localStorage.setItem("canvas_base_url", resolvedBaseUrl);
            setCanvasStatus("Connected");
          }
        } else if (credsRes) {
          console.warn(`Credentials fetch failed with status ${credsRes.status}`);
        }

        if (coursesRes && coursesRes.ok) {
          coursesData = await coursesRes.json();
        }

        if (prefsRes && prefsRes.ok) {
          preferencesFromServer = await prefsRes.json().catch(() => null);
        }
      }

      if (preferencesFromServer) {
        applyServerPreferences(preferencesFromServer);
      }

      const cachedCourseCodeById = {};
      const cachedCourseNameById = {};
      const savedCourseSyncState = getSavedCourseSyncState(resolvedBaseUrl, resolvedToken);
      const syncedCourseIds = new Set();

      if (coursesData.courses && coursesData.courses.length > 0) {
        const mappedCourses = coursesData.courses.map(c => {
          const id = normalizeCourseId(c.canvasCourseId ?? c.canvasId ?? c.id);
          const name = c.courseName || c.name || "Unknown";
          const code = deriveCourseCode(c.courseCode, name);
          const storedActive = typeof c.isCurrentlyActive === "boolean"
            ? c.isCurrentlyActive
            : typeof c?.metadata?.isCurrentlyActive === "boolean"
              ? c.metadata.isCurrentlyActive
              : null;
          cachedCourseCodeById[id] = code;
          cachedCourseNameById[id] = name;
          return {
            id,
            name,
            courseCode: code,
            status: savedCourseSyncState[id] || "NOT_SYNCED",
            // Prefer server-stored active/inactive when available; otherwise default to active
            // (matches Canvas UX better than "everything inactive" while waiting for refresh).
            isCurrentlyActive: storedActive ?? true,
          };
        });
        setActiveCourses(mappedCourses);
        setSavedCoursesCache(normalizedUserId, resolvedBaseUrl || localBaseUrl, mappedCourses);
      }

      const hydrateAssignments = (assignments) => {
        if (!assignments.length) return;

        const byCourse = {};
        for (const a of assignments) {
          const cid = normalizeCourseId(a.courseId);
          if (!cid) continue;
          if (!byCourse[cid]) byCourse[cid] = [];
          const resolvedCourseName = a.courseName || cachedCourseNameById[cid] || "Unknown";
          const resolvedCourseCode = cachedCourseCodeById[cid] || deriveCourseCode(a.courseCode, resolvedCourseName);
          const assignmentId = normalizeAssignmentToken(a.canvasAssignmentId);
          const discoveredKey = normalizeAssignmentToken(a.discoveredKey ?? a.discovered_key ?? a.dk).toLowerCase();
          const stableToken = assignmentId || (discoveredKey ? `disc:${discoveredKey}` : "");
          const dueValue = a.normalizedDueAt ?? a.originalDueAt ?? a.dueAt ?? null;
          const nameValue = a.name || "";
          byCourse[cid].push({
            id: buildAssignmentStableId(cid, stableToken, nameValue, dueValue),
            courseId: cid,
            canvasAssignmentId: assignmentId || null,
            discoveredKey: discoveredKey || null,
            courseName: resolvedCourseName,
            courseCode: resolvedCourseCode,
            name: nameValue,
            due: dueValue,
            status: a.status,
            sourceOfTruth: a.sourceOfTruth ?? a.source_of_truth ?? a.source ?? null,
            category: normalizeCategoryForViews(a.category),
          });
        }

        for (const cid of Object.keys(byCourse)) {
          byCourse[cid] = dedupeAssignmentsWithinCourse(byCourse[cid]);
        }

        setItemsByCourse(byCourse);
        setSavedAssignmentsCache(normalizedUserId, resolvedBaseUrl || localBaseUrl, byCourse);

        const mergedSyncState = { ...savedCourseSyncState };
        for (const cid of Object.keys(byCourse)) {
          mergedSyncState[normalizeCourseId(cid)] = "SYNCED";
          syncedCourseIds.add(normalizeCourseId(cid));
        }
        setSavedCourseSyncState(mergedSyncState, resolvedBaseUrl, resolvedToken);

        // Update course statuses once we know which courses have assignments.
        setActiveCourses((prev) => (prev || []).map((c) => {
          const cid = normalizeCourseId(c.id);
          const desired = mergedSyncState[cid] || (syncedCourseIds.has(cid) ? "SYNCED" : "NOT_SYNCED");
          if (!c || c.status === desired) return c;
          // Don't override in-progress statuses.
          if (["Reading course materials", "Syncing assignments", "Matching dates from materials", "Updating timeline", "Queued", "Sync failed"].includes(c.status)) return c;
          return { ...c, status: desired };
        }));
      };

      if (Array.isArray(assignmentsFromBootstrap)) {
        hydrateAssignments(assignmentsFromBootstrap);
      } else {
        // Fallback/background hydration when bootstrap payload is unavailable.
        void (async () => {
          const assignmentsRes = await fetchWithTimeout(
            `${API_BASE}/api/user/assignments?lite=1`,
            apiFetchOptions(),
          ).catch(err => {
            console.error(`Failed to fetch assignments from ${API_BASE}:`, err.message);
            return null;
          });

          if (!assignmentsRes || !assignmentsRes.ok) return;
          const assignmentsData = await assignmentsRes.json().catch(() => ({}));
          const assignments = Array.isArray(assignmentsData.assignments) ? assignmentsData.assignments : [];
          hydrateAssignments(assignments);
        })();
      }

      // Auto-reconnect on reload and refresh course list.
      // In cloud mode the Canvas token is stored server-side, so we may not have a local token.
      if (resolvedBaseUrl && (resolvedToken || hasServerCredentials)) {
        const cached = getSavedCoursesCache(normalizedUserId, resolvedBaseUrl || localBaseUrl);
        const lastSavedAt = cached?.savedAt || 0;
        const autoRefreshMinutes = 10;
        const shouldRefresh = !lastSavedAt || (Date.now() - lastSavedAt) > autoRefreshMinutes * 60 * 1000;

        if (shouldRefresh) {
          // Refresh is best-effort: run it in the background so courses render immediately.
          void (async () => {
            const refreshedCoursesRes = await fetchWithTimeout(
              `${API_BASE}/api/canvas/courses`,
              apiFetchOptions({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ base_url: resolvedBaseUrl, token: resolvedToken }),
              }),
            ).catch(() => null);

            if (!refreshedCoursesRes || !refreshedCoursesRes.ok) return;
            const refreshedCourses = await refreshedCoursesRes.json().catch(() => null);
            if (!Array.isArray(refreshedCourses)) return;

            const mapped = refreshedCourses
              .filter((c) => c.workflow_state === "available")
              .map((c) => {
                const cid = normalizeCourseId(c.id);
                const now = new Date();
                const backendActiveFlag = typeof c._app_is_currently_active === "boolean"
                  ? c._app_is_currently_active
                  : null;
                const isConcluded = c.concluded === true;
                const termEndAt = c.term?.end_at ? new Date(c.term.end_at) : null;
                const termStartAt = c.term?.start_at ? new Date(c.term.start_at) : null;
                const courseEndAt = c.end_at ? new Date(c.end_at) : null;
                const courseStartAt = c.start_at ? new Date(c.start_at) : null;
                const effectiveEndAt = termEndAt || courseEndAt;
                const effectiveStartAt = termStartAt || courseStartAt;

                let isCurrentlyActive;
                if (backendActiveFlag !== null) {
                  isCurrentlyActive = backendActiveFlag;
                } else if (isConcluded) {
                  isCurrentlyActive = false;
                } else if (effectiveEndAt && now > effectiveEndAt) {
                  isCurrentlyActive = false;
                } else if (effectiveStartAt && effectiveEndAt) {
                  isCurrentlyActive = now >= effectiveStartAt && now <= effectiveEndAt;
                } else if (effectiveStartAt && !effectiveEndAt) {
                  isCurrentlyActive = now >= effectiveStartAt;
                } else {
                  isCurrentlyActive = false;
                }

                const stableCode = deriveCourseCode(
                  cachedCourseCodeById[cid] || c.course_code,
                  c.name
                );

                return {
                  id: cid,
                  name: c.name,
                  courseCode: stableCode,
                  status: savedCourseSyncState[cid] || (syncedCourseIds.has(cid) ? "SYNCED" : "NOT_SYNCED"),
                  startAt: effectiveStartAt?.toISOString(),
                  endAt: effectiveEndAt?.toISOString(),
                  termName: c.term?.name || null,
                  isCurrentlyActive,
                };
              });

            setActiveCourses(mapped);
            setSavedCoursesCache(normalizedUserId, resolvedBaseUrl || localBaseUrl, mapped);
          })();
        }

        if (!hasServerCredentials && localBaseUrl && localToken) {
          setCanvasStatus("Connected");
        }
      }
    } catch (err) {
      console.error('Failed to load cached data:', err);
    }
  }, []);

  // Demo mode: isolated session (sessionStorage only), never mixed with real auth
  const isDemoMode = window.location.pathname === "/demo";
  const [demoSession, setDemoSession] = useState(null);
  const [demoBootstrapFailed, setDemoBootstrapFailed] = useState(false);
  const [demoCourseId, setDemoCourseId] = useState(null);
  const [showDemoIntro, setShowDemoIntro] = useState(() => window.location.pathname === "/demo");
  const [highlightDemoSync, setHighlightDemoSync] = useState(false);

  const handleExitDemo = useCallback(() => {
    purgeDemoAuthArtifacts();
    window.location.assign("/");
  }, []);

  useEffect(() => {
    if (!isDemoMode) return;

    let cancelled = false;
    setDemoBootstrapFailed(false);
    setDemoSession(null);

    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/demo/session`,
          apiFetchOptions({ method: "POST" }),
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Demo mode is unavailable");
        }

        const demoUser = {
          uid: data.user?.uid || "a0000000-0000-4000-8000-000000000001",
          email: data.user?.email || "demo@canvassync.dev",
          displayName: data.user?.displayName || "Demo User",
        };
        storeDemoSession(data.token, demoUser);
        if (cancelled) return;

        setDemoSession({ user: demoUser, token: data.token });
        setAuthLoading(false);
        setCanvasBaseUrl(data.canvas_base_url || "https://gatech.instructure.com");
        setCanvasStatus("connected");
        setItemsByCourse({});
        setCompletedItems({});

        const courses = Array.isArray(data.courses) ? data.courses : [];
        setActiveCourses(
          courses.map((course) => ({
            ...course,
            status: course.status || "NOT_SYNCED",
            isCurrentlyActive: true,
          }))
        );

        if (courses[0]?.id) {
          const firstCourseId = String(courses[0].id);
          setSelectedCourseId(firstCourseId);
          setDemoCourseId(firstCourseId);
          setShowDemoIntro(true);
          setHighlightDemoSync(false);
        }
      } catch (err) {
        console.error("Demo bootstrap failed:", err);
        setAuthLoading(false);
        setDemoBootstrapFailed(true);
        setCanvasStatus("Demo unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDemoMode]);

  const activeUser = isDemoMode ? demoSession?.user : canvasUser;

  // Canvas OAuth session bootstrap
  useEffect(() => {
    if (isDemoMode) return;
    // Initialize Canvas OAuth auth (check for callback tokens in URL, restore session)
    void initAuth();

    const unsubscribe = onAuthChange(async ({ user, token }) => {
      setCanvasUser(user);
      setAuthLoading(false);

      if (user) {
        const consent =
          typeof user.legalConsentAccepted === "boolean"
            ? user.legalConsentAccepted
            : await fetchLegalConsentStatus();
        setLegalConsentAccepted(consent);
      } else {
        setLegalConsentAccepted(false);
        clearAllLocalCanvasSyncData();
        setActiveCourses([]);
        setItemsByCourse({});
        setCanvasStatus(null);
      }

      // Load cached data when user is authenticated
      if (user) {
        const connectedBaseUrl = (localStorage.getItem("canvas_base_url") || "").trim();

        // Hydrate the sidebar immediately from localStorage (no network).
        const cached = getSavedCoursesCache(user.uid, connectedBaseUrl);
        if (cached?.courses?.length) {
          setActiveCourses(cached.courses);
        }
        const cachedAssignments = getSavedAssignmentsCache(user.uid, connectedBaseUrl);
        if (cachedAssignments?.itemsByCourse) {
          setItemsByCourse(cachedAssignments.itemsByCourse);
        }

        // Hydrate completed items immediately from localStorage.
        if (connectedBaseUrl) {
          setCompletedItems(getSavedCompletedItems(user.uid, connectedBaseUrl, ""));
        }

        loadCachedData({ userId: user.uid }).catch(err => {
          console.error("Background loadCachedData failed:", err);
        });

        // Reload completion watcher: keep this throttled to avoid repeat
        // all-course Canvas scans on each page load.
        const refreshBaseUrl = (localStorage.getItem("canvas_base_url") || connectedBaseUrl || "").trim();
        const refreshThrottleMs = CANVAS_COMPLETION_REFRESH_THROTTLE_MS;
        const lastRefreshAt = getLastCompletionRefreshAt(user.uid, refreshBaseUrl);
        const shouldRefreshCompletion = !!refreshBaseUrl && (!lastRefreshAt || (Date.now() - lastRefreshAt) >= refreshThrottleMs);

        if (shouldRefreshCompletion) {
          // Stamp before network call to prevent repeat reload storms.
          setLastCompletionRefreshAt(user.uid, refreshBaseUrl, Date.now());

          void (async () => {
            try {
              const savedSyncState = getSavedCourseSyncState(refreshBaseUrl, "");
              const syncedCourseIds = Object.entries(savedSyncState || {})
                .filter(([, status]) => status === "SYNCED")
                .map(([cid]) => normalizeCourseId(cid))
                .filter(Boolean);

              if (!syncedCourseIds.length) {
                return;
              }

              const refreshRes = await fetchWithTimeout(
                `${API_BASE}/api/assignments/refresh-completion`,
                apiFetchOptions({
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    base_url: refreshBaseUrl,
                    token: "",
                    course_ids: syncedCourseIds,
                  }),
                }),
              );

              if (!refreshRes.ok) {
                return;
              }

              const refreshData = await refreshRes.json().catch(() => ({}));
              const completedIds = Array.isArray(refreshData?.completed_item_ids)
                ? refreshData.completed_item_ids
                : [];

              if (!completedIds.length) {
                return;
              }

              // One-way completion sync: Canvas can auto-check items, never auto-uncheck them.
              setCompletedItems((prev) => {
                const next = { ...(prev || {}) };
                const completedSet = new Set(
                  completedIds
                    .map((rawId) => String(rawId || "").trim())
                    .filter(Boolean)
                );
                let changed = false;
                for (const rawId of completedIds) {
                  const itemId = String(rawId || "").trim();
                  if (!itemId) continue;
                  if (!next[itemId] && completedSet.has(itemId)) {
                    next[itemId] = true;
                    changed = true;
                  }
                }
                return changed ? next : prev;
              });
            } catch (e) {
              console.warn("Completion refresh failed:", e?.message || e);
            }
          })();
        }
      }
    });
    return () => unsubscribe();
  }, [loadCachedData]);

  const handleCanvasSignIn = () => {
    signInWithCanvas();
  };

  const handleSignOut = async () => {
    try {
      await logout();
      clearAllLocalCanvasSyncData();
      setActiveCourses([]);
      setItemsByCourse({});
      setCanvasStatus(null);
    } catch (err) {
      console.error('Sign-out failed:', err);
    }
  };

  // Other state (activeCourses, itemsByCourse, canvasStatus declared above)
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [syncStatus, setSyncStatus] = useState({});
  const [activeTab, setActiveTab] = useState("home"); // 'home', 'calendar', 'classSettings', 'course'
  const [showLandingPage, setShowLandingPage] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingCourseId, setSyncingCourseId] = useState(null);
  const [syncQueue, setSyncQueue] = useState([]);
  const isProcessingQueue = useRef(false);
  const syncProgressCardRef = useRef(null);
  const syncToastOrderRef = useRef([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showProfilePopup, setShowProfilePopup] = useState(false);
  const [showSyncProgressPopover, setShowSyncProgressPopover] = useState(false);
  const [syncToastOffset, setSyncToastOffset] = useState({ top: 72, right: 16 });
  const [isMobileLayout, setIsMobileLayout] = useState(() => (
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  ));
  const [mobileNotice, setMobileNotice] = useState(null);
  const mobileNoticeTimerRef = useRef(null);
  const [isDisconnectingCanvas, setIsDisconnectingCanvas] = useState(false);
  const [isExportingData, setIsExportingData] = useState(false);
  const [showDeleteDataConfirm, setShowDeleteDataConfirm] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileLayout(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const dismissMobileNotice = useCallback(() => {
    if (mobileNoticeTimerRef.current) {
      window.clearTimeout(mobileNoticeTimerRef.current);
      mobileNoticeTimerRef.current = null;
    }
    setMobileNotice(null);
  }, []);

  const showMobileNotice = useCallback((nextNotice) => {
    if (!nextNotice) return;
    if (mobileNoticeTimerRef.current) {
      window.clearTimeout(mobileNoticeTimerRef.current);
      mobileNoticeTimerRef.current = null;
    }

    const id = nextNotice.id || `mobile-notice-${Date.now()}`;
    const tone = nextNotice.tone || "info";
    const duration = nextNotice.duration === null
      ? null
      : Number(nextNotice.duration) > 0
        ? Number(nextNotice.duration)
        : tone === "error"
          ? 7000
          : 4200;

    setMobileNotice({ ...nextNotice, id, tone });

    if (duration) {
      mobileNoticeTimerRef.current = window.setTimeout(() => {
        mobileNoticeTimerRef.current = null;
        setMobileNotice((current) => current?.id === id ? null : current);
      }, duration);
    }
  }, []);

  const notifyUser = useCallback((notice) => {
    if (isMobileLayout) {
      showMobileNotice(notice);
      return;
    }

    if (notice?.tone === "error" || notice?.tone === "warning") {
      window.alert([notice.title, notice.message].filter(Boolean).join("\n\n"));
    }
  }, [isMobileLayout, showMobileNotice]);

  useEffect(() => () => {
    if (mobileNoticeTimerRef.current) {
      window.clearTimeout(mobileNoticeTimerRef.current);
    }
  }, []);

  const updateSyncToastOffset = useCallback(() => {
    if (typeof window === "undefined") return;
    const progressCard = syncProgressCardRef.current;
    if (!progressCard) {
      setSyncToastOffset({ top: 72, right: 16 });
      return;
    }

    const rect = progressCard.getBoundingClientRect();
    const rootStyle = window.getComputedStyle(document.documentElement);
    const widthVar = rootStyle.getPropertyValue("--sileo-width").trim();
    const parsedWidth = Number.parseFloat(widthVar);
    const toastWidth = Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : 350;
    const edgePadding = 12;
    const targetLeft = rect.left + rect.width / 2 - toastWidth / 2;
    const maxLeft = Math.max(edgePadding, window.innerWidth - toastWidth - edgePadding);
    const left = Math.round(Math.min(Math.max(targetLeft, edgePadding), maxLeft));
    const maxRight = Math.max(edgePadding, window.innerWidth - toastWidth - edgePadding);
    const right = Math.round(
      Math.min(
        Math.max(window.innerWidth - toastWidth - left, edgePadding),
        maxRight
      )
    );
    const top = Math.round(rect.bottom + 8);

    setSyncToastOffset((prev) => {
      if (prev.top === top && prev.right === right) return prev;
      return { top, right };
    });
  }, []);

  useEffect(() => {
    const updateOnFrame = () => {
      window.requestAnimationFrame(updateSyncToastOffset);
    };

    updateOnFrame();
    window.addEventListener("resize", updateOnFrame);
    window.addEventListener("scroll", updateOnFrame, true);
    return () => {
      window.removeEventListener("resize", updateOnFrame);
      window.removeEventListener("scroll", updateOnFrame, true);
    };
  }, [updateSyncToastOffset]);

  // Calendar day modal
  const [zoomedDate, setZoomedDate] = useState(null);

  // Daily view date
  const [currentDailyDate, setCurrentDailyDate] = useState(() => new Date());

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    updateSyncToastOffset();
  }, [updateSyncToastOffset, sidebarCollapsed, showSyncProgressPopover]);

  // Completed items tracking
  const [completedItems, setCompletedItems] = useState({});

  // Weekly view filters (only deliverable categories: ASSIGNMENT and EXAM)
  const [weeklyFilters, setWeeklyFilters] = useState(() => {
    const saved = localStorage.getItem("weekly_filters");
    const defaults = {
      ASSIGNMENT: true,
      EXAM: true,
    };
    if (saved) {
      const parsed = JSON.parse(saved);
      // Remove deprecated categories from old saved data
      delete parsed.LECTURE;
      delete parsed.READING;
      delete parsed.QUIZ;
      delete parsed.ATTENDANCE;
      return { ...defaults, ...parsed };
    }
    return defaults;
  });

  useEffect(() => {
    localStorage.setItem("weekly_filters", JSON.stringify(weeklyFilters));
  }, [weeklyFilters]);

  const [syncRunTotal, setSyncRunTotal] = useState(0);
  const [syncRunCompleted, setSyncRunCompleted] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState(() => localStorage.getItem("last_sync_at") || "");
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [syncNow, setSyncNow] = useState(() => Date.now());
  const [syncWarningsByCourse, setSyncWarningsByCourse] = useState({});
  const [showMobileSyncComplete, setShowMobileSyncComplete] = useState(false);
  const wasSyncInProgressRef = useRef(false);

  useEffect(() => {
    if (!lastSyncAt) {
      localStorage.removeItem("last_sync_at");
      return;
    }
    localStorage.setItem("last_sync_at", lastSyncAt);
  }, [lastSyncAt]);

  const queueSyncCourses = useCallback((courseIds) => {
    const normalizedCourseIds = Array.from(new Set((courseIds || []).map((id) => normalizeCourseId(id)).filter(Boolean)));
    if (!normalizedCourseIds.length) return [];

    const alreadyQueued = new Set((syncQueue || []).map((id) => normalizeCourseId(id)));
    const activeSyncCourseId = normalizeCourseId(syncingCourseId);
    if (activeSyncCourseId) alreadyQueued.add(activeSyncCourseId);

    const courseIdsToQueue = normalizedCourseIds.filter((courseId) => !alreadyQueued.has(courseId));
    if (!courseIdsToQueue.length) return [];

    setSyncQueue((prev) => [...(prev || []), ...courseIdsToQueue]);
    setSyncStartedAt(new Date().toISOString());
    setShowSyncProgressPopover(true);

    setSyncStatus((prev) => {
      const next = { ...(prev || {}) };
      for (const courseId of courseIdsToQueue) {
        next[courseId] = "Queued";
      }
      return next;
    });

    setSyncWarningsByCourse((prev) => {
      const next = { ...(prev || {}) };
      for (const courseId of courseIdsToQueue) {
        delete next[courseId];
      }
      return next;
    });

    return courseIdsToQueue;
  }, [syncQueue, syncingCourseId]);

  // Persist checklist state by user + connected Canvas credentials so reloads keep checkbox status.
  useEffect(() => {
    if (isDemoMode || !canvasUser?.uid) {
      if (!isDemoMode) setCompletedItems({});
      return;
    }

    const connectedBaseUrl = (canvasBaseUrl || localStorage.getItem("canvas_base_url") || "").trim();
    const connectedToken = (canvasToken || "").trim(); // may be empty in cloud mode
    if (!connectedBaseUrl) {
      setCompletedItems({});
      return;
    }

    setCompletedItems(getSavedCompletedItems(canvasUser.uid, connectedBaseUrl, connectedToken));
  }, [canvasUser?.uid, canvasBaseUrl, canvasToken, isDemoMode]);

  useEffect(() => {
    if (!canvasUser?.uid || isDemoMode) return;

    const connectedBaseUrl = (canvasBaseUrl || localStorage.getItem("canvas_base_url") || "").trim();
    const connectedToken = (canvasToken || "").trim(); // may be empty in cloud mode
    if (!connectedBaseUrl) return;

    setSavedCompletedItems(
      completedItems,
      canvasUser.uid,
      connectedBaseUrl,
      connectedToken
    );
  }, [completedItems, canvasUser?.uid, canvasBaseUrl, canvasToken, isDemoMode]);

  const toggleFilter = (category) => {
    setWeeklyFilters(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const resetWeeklyFilters = useCallback(() => {
    setWeeklyFilters({
      ASSIGNMENT: true,
      EXAM: true,
    });
  }, []);

  const hasDisabledWeeklyFilters = Object.values(weeklyFilters).some((value) => value === false);

  // Course colors for color coding - expanded palette with names
  const COURSE_COLOR_PALETTE = [
    { hex: '#ef4444', name: 'Red' },
    { hex: '#f97316', name: 'Orange' },
    { hex: '#f59e0b', name: 'Amber' },
    { hex: '#eab308', name: 'Yellow' },
    { hex: '#84cc16', name: 'Lime' },
    { hex: '#22c55e', name: 'Green' },
    { hex: '#10b981', name: 'Emerald' },
    { hex: '#14b8a6', name: 'Teal' },
    { hex: '#06b6d4', name: 'Cyan' },
    { hex: '#0ea5e9', name: 'Sky' },
    { hex: '#3b82f6', name: 'Blue' },
    { hex: '#6366f1', name: 'Indigo' },
    { hex: '#8b5cf6', name: 'Violet' },
    { hex: '#a855f7', name: 'Purple' },
    { hex: '#d946ef', name: 'Fuchsia' },
    { hex: '#ec4899', name: 'Pink' },
    { hex: '#f43f5e', name: 'Rose' },
    { hex: '#78716c', name: 'Stone' },
  ];

  const [courseColors, setCourseColors] = useState(() => {
    const saved = localStorage.getItem("course_colors");
    return saved ? JSON.parse(saved) : {};
  });

  const [starredCourses, setStarredCourses] = useState(() => {
    const saved = localStorage.getItem("starred_courses");
    return saved ? JSON.parse(saved) : {};
  });

  const [syncEnabledCourses, setSyncEnabledCourses] = useState(() => {
    const saved = localStorage.getItem("sync_enabled_courses");
    if (!saved) return {};
    try {
      return normalizeTruthyCourseMap(JSON.parse(saved));
    } catch {
      return {};
    }
  });

  const [showColorPicker, setShowColorPicker] = useState(null); // courseId or null
  const [showColorDropdown, setShowColorDropdown] = useState(false); // for toolbar

  useEffect(() => {
    localStorage.setItem("course_colors", JSON.stringify(courseColors));
  }, [courseColors]);

  useEffect(() => {
    localStorage.setItem("starred_courses", JSON.stringify(starredCourses));
  }, [starredCourses]);

  useEffect(() => {
    if (isDemoMode) return;
    localStorage.setItem("sync_enabled_courses", JSON.stringify(normalizeTruthyCourseMap(syncEnabledCourses)));
  }, [syncEnabledCourses, isDemoMode]);

  const courseColorByCode = useMemo(() => {
    const byCode = {};
    for (const course of activeCourses || []) {
      const cid = normalizeCourseId(course?.id);
      const code = deriveCourseCode(course?.courseCode, course?.name || "");
      if (!cid || !code || code === "UNK") continue;
      const explicitColor = courseColors?.[cid];
      if (explicitColor && !byCode[code]) {
        byCode[code] = explicitColor;
      }
    }
    return byCode;
  }, [activeCourses, courseColors]);

  const getEffectiveCourseColor = useCallback((courseId, courseCode = "", courseName = "") => {
    const cid = normalizeCourseId(courseId);
    const code = deriveCourseCode(courseCode, courseName);
    if (code && code !== "UNK" && courseColorByCode[code]) {
      return courseColorByCode[code];
    }
    return courseColors?.[cid];
  }, [courseColorByCode, courseColors]);

  const persistUserPreferences = useCallback(async (updates) => {
    try {
      if (!isAuthenticated()) return true;

      const res = await fetchWithTimeout(
        `${API_BASE}/api/user/preferences`,
        apiFetchOptions({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates || {}),
        }),
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("Failed to persist preferences:", res.status, text);
        if (isMobileLayout) {
          showMobileNotice({
            tone: "error",
            title: "Couldn’t save your changes",
            message: "Your update is still visible on this device. Check your connection and try again.",
            actionLabel: "Try again",
            onAction: () => {
              void persistUserPreferences(updates);
            },
            duration: null,
          });
        }
        return false;
      }
      return true;
    } catch (e) {
      console.warn("Failed to persist preferences:", e);
      if (isMobileLayout) {
        showMobileNotice({
          tone: "error",
          title: "Couldn’t save your changes",
          message: "Your update is still visible on this device. Check your connection and try again.",
          actionLabel: "Try again",
          onAction: () => {
            void persistUserPreferences(updates);
          },
          duration: null,
        });
      }
      return false;
    }
  }, [isMobileLayout, showMobileNotice]);

  const pendingPreferenceUpdatesRef = useRef({});
  const preferencePersistTimerRef = useRef(null);

  const flushQueuedPreferenceUpdates = useCallback(async () => {
    const pending = pendingPreferenceUpdatesRef.current || {};
    if (Object.keys(pending).length === 0) return;
    pendingPreferenceUpdatesRef.current = {};
    await persistUserPreferences(pending);
  }, [persistUserPreferences]);

  const queuePreferenceUpdates = useCallback((updates, delayMs = 900) => {
    if (!updates || typeof updates !== "object") return;
    pendingPreferenceUpdatesRef.current = {
      ...(pendingPreferenceUpdatesRef.current || {}),
      ...updates,
    };
    if (preferencePersistTimerRef.current) {
      clearTimeout(preferencePersistTimerRef.current);
      preferencePersistTimerRef.current = null;
    }
    preferencePersistTimerRef.current = setTimeout(() => {
      preferencePersistTimerRef.current = null;
      void flushQueuedPreferenceUpdates();
    }, Math.max(100, Number(delayMs) || 900));
  }, [flushQueuedPreferenceUpdates]);

  useEffect(() => {
    return () => {
      if (preferencePersistTimerRef.current) {
        clearTimeout(preferencePersistTimerRef.current);
        preferencePersistTimerRef.current = null;
      }
    };
  }, []);

  const persistCompletedItemsDebounced = useCallback((nextCompleted) => {
    queuePreferenceUpdates({ completedItems: nextCompleted || {} }, 650);
  }, [queuePreferenceUpdates]);

  const setCourseColor = (courseId, color) => {
    const cid = normalizeCourseId(courseId);
    const selectedCourse = (activeCourses || []).find((course) => normalizeCourseId(course?.id) === cid);
    const selectedCode = deriveCourseCode(selectedCourse?.courseCode, selectedCourse?.name || "");

    setCourseColors((prev) => {
      const next = { ...(prev || {}) };

      if (selectedCode && selectedCode !== "UNK") {
        for (const course of activeCourses || []) {
          const currentCode = deriveCourseCode(course?.courseCode, course?.name || "");
          if (currentCode === selectedCode) {
            const groupedCourseId = normalizeCourseId(course?.id);
            if (groupedCourseId) next[groupedCourseId] = color;
          }
        }
      } else if (cid) {
        next[cid] = color;
      }

      queuePreferenceUpdates({ courseColors: next }, 700);
      return next;
    });
    setShowColorPicker(null);
  };

  useEffect(() => {
    if (!isDemoMode || !demoCourseId) return;
    setSyncEnabledCourses({ [demoCourseId]: true });
  }, [isDemoMode, demoCourseId]);

  const handleDemoIntroOk = useCallback(() => {
    setShowDemoIntro(false);
    setHighlightDemoSync(true);
  }, []);

  const setSyncEnabledCoursesAndPersist = useCallback((updater) => {
    setSyncEnabledCourses((prev) => {
      const nextRaw = typeof updater === "function" ? updater(prev || {}) : (updater || {});
      const next = normalizeTruthyCourseMap(nextRaw);
      queuePreferenceUpdates({ syncEnabledCourses: next }, 700);
      return next;
    });
  }, [queuePreferenceUpdates]);

  const getGroupedCourseIdsByCode = useCallback((courseId, courseCode = "", courseName = "") => {
    const primaryId = normalizeCourseId(courseId);
    if (!primaryId) return [];
    const code = deriveCourseCode(courseCode, courseName);
    if (!code || code === "UNK") return [primaryId];

    const grouped = (activeCourses || [])
      .filter((course) => deriveCourseCode(course?.courseCode, course?.name || "") === code)
      .map((course) => normalizeCourseId(course?.id))
      .filter(Boolean);

    if (!grouped.includes(primaryId)) grouped.unshift(primaryId);
    return Array.from(new Set([primaryId, ...grouped]));
  }, [activeCourses]);

  const isCourseSyncEnabled = useCallback((courseId) => {
    return !!syncEnabledCourses[normalizeCourseId(courseId)];
  }, [syncEnabledCourses]);

  const isCourseStarred = useCallback((courseId) => {
    return !!starredCourses[normalizeCourseId(courseId)];
  }, [starredCourses]);

  const sortCourses = useCallback((a, b) => {
    const aStar = isCourseStarred(a.id) ? 1 : 0;
    const bStar = isCourseStarred(b.id) ? 1 : 0;
    if (aStar !== bStar) return bStar - aStar;
    const aName = String(a.courseCode || a.name || "");
    const bName = String(b.courseCode || b.name || "");
    return aName.localeCompare(bName);
  }, [isCourseStarred]);

  const allCourseList = useMemo(() => {
    return (activeCourses || [])
      .slice()
      .sort((a, b) => {
        if (Boolean(a?.isCurrentlyActive) !== Boolean(b?.isCurrentlyActive)) {
          return a?.isCurrentlyActive ? -1 : 1;
        }
        return sortCourses(a, b);
      });
  }, [activeCourses, sortCourses]);

  const syncEnabledCourseList = useMemo(() => {
    return allCourseList.filter((course) => isCourseSyncEnabled(course.id));
  }, [allCourseList, isCourseSyncEnabled]);

  const syncEnabledCourseIds = useMemo(() => {
    return syncEnabledCourseList.map((course) => normalizeCourseId(course.id)).filter(Boolean);
  }, [syncEnabledCourseList]);

  const syncedCourseList = useMemo(() => {
    return (activeCourses || [])
      .filter((c) => c.status === "SYNCED")
      .slice()
      .sort(sortCourses);
  }, [activeCourses, sortCourses]);

  const trackSyncToast = useCallback((toastId) => {
    if (!toastId) return;
    const nextOrder = [...syncToastOrderRef.current.filter((id) => id !== toastId), toastId];
    while (nextOrder.length > 2) {
      const oldest = nextOrder.shift();
      if (oldest) sileo.dismiss(oldest);
    }
    syncToastOrderRef.current = nextOrder;
  }, []);

  const runWithSyncFeedback = useCallback((promiseOrFactory, options = {}) => {
    const {
      id: toastId,
      position = "top-right",
      loadingTitle = "Syncing...",
      successTitle = "Sync complete",
      successDescription,
      successTone = "success",
      errorTitle = "Sync failed",
      errorDescription,
      errorActionLabel,
      onErrorAction,
    } = options;
    const resolveDescription = (value, arg) => (typeof value === "function" ? value(arg) : value);
    const resolveTone = (value, arg) => (typeof value === "function" ? value(arg) : value);

    const loadingId = toastId ? `${toastId}-loading` : `sync-loading-${Date.now()}`;
    if (!isMobileLayout) {
      trackSyncToast(loadingId);
      sileo.show({
        id: loadingId,
        position,
        state: "loading",
        title: loadingTitle,
        duration: null,
        fill: "#0b1020",
        styles: {
          title: "text-white",
        },
      });
    }

    const promise = typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory;

    return promise.then((data) => {
      const description = resolveDescription(successDescription, data);
      if (isMobileLayout) {
        showMobileNotice({
          tone: resolveTone(successTone, data) || "success",
          title: successTitle,
          message: description,
        });
      } else {
        sileo.success({
          id: loadingId,
          position,
          title: successTitle,
          description,
          duration: 4200,
          fill: "#0b1020",
          styles: {
            title: "text-white",
            description: "text-white/90",
          },
        });
      }
      return data;
    }).catch((err) => {
      const description = resolveDescription(errorDescription, err);
      if (isMobileLayout) {
        showMobileNotice({
          tone: "error",
          title: errorTitle,
          message: description,
          actionLabel: errorActionLabel,
          onAction: onErrorAction,
          duration: onErrorAction ? null : 7000,
        });
      } else {
        sileo.error({
          id: loadingId,
          position,
          title: errorTitle,
          description,
          duration: 4200,
          fill: "#0b1020",
          styles: {
            title: "text-white",
            description: "text-white/90",
          },
        });
      }
      throw err;
    });
  }, [isMobileLayout, showMobileNotice, trackSyncToast]);

  const queueSelectedSyncCourses = useCallback(() => {
    const queuedCourseIds = queueSyncCourses(syncEnabledCourseIds);
    if (!queuedCourseIds.length) return;
    setSyncRunTotal(queuedCourseIds.length);
    setSyncRunCompleted(0);
  }, [queueSyncCourses, syncEnabledCourseIds]);

  const fetchSyncWithRetry = useCallback(async (url, options = {}, retryOptions = {}) => {
    const timeoutMs = Number(retryOptions?.timeoutMs) > 0 ? Number(retryOptions.timeoutMs) : SYNC_DEFAULT_TIMEOUT_MS;
    return fetchWithTimeout(url, options, timeoutMs);
  }, []);

  const readSyncErrorMessage = useCallback(async (response, fallbackMessage) => {
    try {
      const payload = await response.json();
      const detail = payload?.detail || payload?.error || payload?.message;
      if (detail) return `${fallbackMessage}: ${detail}`;
    } catch (_) {
      try {
        const text = await response.text();
        if (text) return `${fallbackMessage}: ${text}`;
      } catch (__unused) {
        // ignore
      }
    }
    return `${fallbackMessage} (status ${response.status})`;
  }, []);

  const selectedSyncCourseCount = syncEnabledCourseIds.length;
  const selectedSyncSyncedCount = useMemo(() => {
    return syncEnabledCourseList.filter((course) => course.status === "SYNCED").length;
  }, [syncEnabledCourseList]);
  const baseSyncSelectionProgressPercent = selectedSyncCourseCount > 0
    ? Math.round((selectedSyncSyncedCount / selectedSyncCourseCount) * 100)
    : 0;
  const isSyncInProgress = isSyncing || Boolean(syncingCourseId) || syncQueue.length > 0;
  useEffect(() => {
    if (!isSyncInProgress) {
      setSyncStartedAt(null);
      return undefined;
    }

    setSyncNow(Date.now());
    const timer = window.setInterval(() => setSyncNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isSyncInProgress]);

  useEffect(() => {
    if (isSyncInProgress) {
      wasSyncInProgressRef.current = true;
      setShowMobileSyncComplete(false);
      return undefined;
    }

    if (wasSyncInProgressRef.current) {
      wasSyncInProgressRef.current = false;
      if (selectedSyncCourseCount > 0) {
        setShowMobileSyncComplete(true);
        const timer = window.setTimeout(() => setShowMobileSyncComplete(false), 2400);
        return () => window.clearTimeout(timer);
      }
    }

    return undefined;
  }, [isSyncInProgress, selectedSyncCourseCount]);

  const syncRunProgressPercent = useMemo(() => {
    if (!isSyncInProgress || syncRunTotal <= 0) return 0;
    const finished = Math.min(syncRunCompleted, syncRunTotal);
    const activeStatus = String(syncStatus[normalizeCourseId(syncingCourseId)] || "").toLowerCase();
    const inFlightProgress = !syncingCourseId
      ? 0
      : activeStatus.includes("updating")
        ? 0.86
        : activeStatus.includes("matching")
          ? 0.64
          : activeStatus.includes("assignment")
            ? 0.4
            : activeStatus.includes("material")
              ? 0.16
              : 0.08;
    return Math.min(99, Math.round(((finished + inFlightProgress) / syncRunTotal) * 100));
  }, [isSyncInProgress, syncRunCompleted, syncRunTotal, syncStatus, syncingCourseId]);
  const syncSelectionProgressPercent = isSyncInProgress && syncRunTotal > 0
    ? syncRunProgressPercent
    : baseSyncSelectionProgressPercent;
  const syncProgressDisplayPercent = selectedSyncCourseCount === 0 ? 0 : syncSelectionProgressPercent;
  const syncProgressLabel = isSyncInProgress && syncRunTotal > 0
    ? `${Math.min(syncRunCompleted, syncRunTotal)}/${syncRunTotal} completed`
    : `${selectedSyncSyncedCount}/${selectedSyncCourseCount || 0} synced`;
  const activeSyncCourse = useMemo(() => {
    const activeId = normalizeCourseId(syncingCourseId || syncQueue[0]);
    if (!activeId) return null;
    return activeCourses.find((course) => normalizeCourseId(course.id) === activeId) || null;
  }, [activeCourses, syncQueue, syncingCourseId]);
  const activeSyncCourseLabel = activeSyncCourse
    ? deriveCourseCode(activeSyncCourse.courseCode, activeSyncCourse.name) !== "UNK"
      ? deriveCourseCode(activeSyncCourse.courseCode, activeSyncCourse.name)
      : activeSyncCourse.name
    : "No active course";
  const activeSyncPhase = syncingCourseId
    ? syncStatus[normalizeCourseId(syncingCourseId)] || "Starting sync"
    : syncQueue.length > 0
      ? "Queued"
      : "Ready";
  const syncWaitingCount = Math.max(0, syncQueue.length - (syncingCourseId ? 1 : 0));
  const showMobileSyncProgress = isSyncInProgress || showMobileSyncComplete;
  const mobileSyncProgressPercent = showMobileSyncComplete ? 100 : syncProgressDisplayPercent;
  const mobileSyncComplete = showMobileSyncComplete || (!isSyncInProgress && mobileSyncProgressPercent >= 100);
  const mobileSyncPhaseLabel = showMobileSyncComplete ? "Synced" : activeSyncPhase;
  const mobileSyncDetailLabel = showMobileSyncComplete
    ? "Selected classes are up to date"
    : `${activeSyncCourseLabel} / ${syncProgressLabel}`;
  const syncElapsedLabel = useMemo(() => {
    if (!isSyncInProgress || !syncStartedAt) return "";
    const started = new Date(syncStartedAt).getTime();
    if (!Number.isFinite(started)) return "";
    const elapsedSeconds = Math.max(0, Math.floor((syncNow - started) / 1000));
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [isSyncInProgress, syncNow, syncStartedAt]);
  const visibleSyncWarnings = useMemo(() => {
    return Object.entries(syncWarningsByCourse || {})
      .filter(([, message]) => Boolean(message))
      .map(([courseId, message]) => {
        const course = activeCourses.find((c) => normalizeCourseId(c.id) === normalizeCourseId(courseId));
        const code = course ? deriveCourseCode(course.courseCode, course.name) : "";
        return {
          courseLabel: code && code !== "UNK" ? code : (course?.name || `Course ${courseId}`),
          message,
        };
      });
  }, [activeCourses, syncWarningsByCourse]);
  const lastSyncLabel = useMemo(() => {
    if (!lastSyncAt) return "Never";
    const dt = new Date(lastSyncAt);
    if (Number.isNaN(dt.getTime())) return "Never";
    return dt.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [lastSyncAt]);
  const allSelectedCoursesAlreadySynced = selectedSyncCourseCount > 0 && syncEnabledCourseList.every((course) => course.status === "SYNCED");

  const [isEditingSyncClasses, setIsEditingSyncClasses] = useState(false);
  const [syncEnabledDraft, setSyncEnabledDraft] = useState({});

  const startEditingSyncClasses = useCallback(() => {
    setSyncEnabledDraft(normalizeTruthyCourseMap(syncEnabledCourses));
    setIsEditingSyncClasses(true);
  }, [syncEnabledCourses]);

  const toggleSyncCourseInDraft = useCallback((courseId) => {
    const cid = normalizeCourseId(courseId);
    if (!cid) return;
    setSyncEnabledDraft((prev) => {
      const next = { ...(prev || {}) };
      if (next[cid]) delete next[cid];
      else next[cid] = true;
      return next;
    });
  }, []);

  const completeEditingSyncClasses = useCallback(() => {
    setSyncEnabledCoursesAndPersist(syncEnabledDraft);
    setIsEditingSyncClasses(false);
    if (isMobileLayout) {
      const count = Object.keys(syncEnabledDraft || {}).length;
      showMobileNotice({
        tone: count > 0 ? "success" : "info",
        title: count > 0 ? "Classes updated" : "Sync selection cleared",
        message: count > 0
          ? `${count} ${count === 1 ? "class is" : "classes are"} ready to sync.`
          : "Choose at least one class before running Sync.",
      });
    }
  }, [isMobileLayout, setSyncEnabledCoursesAndPersist, showMobileNotice, syncEnabledDraft]);

  const cancelEditingSyncClasses = useCallback(() => {
    setSyncEnabledDraft({});
    setIsEditingSyncClasses(false);
  }, []);

  const draftSelectedCount = useMemo(() => {
    return Object.keys(syncEnabledDraft || {}).length;
  }, [syncEnabledDraft]);

  const renderSyncToolbarControls = useCallback(() => (
    <div className="flex flex-col items-end gap-1">
      {isDemoMode && highlightDemoSync && !showDemoIntro ? (
        <p className="whitespace-nowrap text-[11px] font-medium text-amber-300/90">
          Ready for the demo sync
        </p>
      ) : null}
      <button
        onClick={() => {
          if (highlightDemoSync) setHighlightDemoSync(false);
          queueSelectedSyncCourses();
        }}
        disabled={selectedSyncCourseCount === 0 || isSyncInProgress || (isDemoMode && showDemoIntro)}
        className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-[background-color,border-color,color,opacity] duration-200 ${selectedSyncCourseCount === 0 || isSyncInProgress || (isDemoMode && showDemoIntro)
          ? "cursor-not-allowed bg-blue-700 text-blue-100 border-blue-700 opacity-70"
          : "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
          } ${highlightDemoSync && !showDemoIntro
            ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-amber-500/20"
            : ""
          }`}
        title={
          isDemoMode && showDemoIntro
            ? "Close the demo intro first"
            : selectedSyncCourseCount === 0
              ? "Select classes in Class Settings first"
              : "Sync all selected classes"
        }
      >
        {isSyncInProgress ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw size={16} aria-hidden="true" />
        )}
        <span>
          {isSyncInProgress
            ? "Syncing..."
            : allSelectedCoursesAlreadySynced
              ? "Resync"
              : "Sync"}
        </span>
      </button>
      {!isSyncInProgress && selectedSyncCourseCount === 0 ? (
        <p className="text-[11px] font-medium text-zinc-500">Select a class first</p>
      ) : null}
    </div>
  ), [
    allSelectedCoursesAlreadySynced,
    highlightDemoSync,
    isDemoMode,
    isSyncInProgress,
    queueSelectedSyncCourses,
    selectedSyncCourseCount,
    showDemoIntro,
  ]);

  // Profile modal tabs
  const [profileTab, setProfileTab] = useState("account");

  // Theme settings (dark mode only)
  const [theme] = useState("dark");
  const [colorMode] = useState("standard");

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
      summary: "Ads - Smaller model",
      features: ["Ads", "Smaller model"],
    },
    plus: {
      key: "plus",
      name: "Plus Tier",
      price: "$2 / month",
      summary: "No ads - Better model - 2 weekly refreshes",
      features: ["No ads", "Better model", "2 weekly refreshes"],
      badge: "Popular",
    },
    pro: {
      key: "pro",
      name: "Pro Tier",
      price: "$10 / month",
      summary: "No ads - Best model - Unlimited weekly refreshes",
      features: ["No ads", "Best model", "Unlimited weekly refreshes"],
    },
  };

  const [globalFont, setGlobalFont] = useState(
    localStorage.getItem("global_font") || "sans"
  );

  // Canvas creds now declared at top of component

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
  const [mobileSelectedWeekKey, setMobileSelectedWeekKey] = useState("");
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // useMemo for performance - itemsByCourse updates frequently
  // Only include deliverable categories (ASSIGNMENT, EXAM)
  const allItems = useMemo(() => {
    const merged = new Map();
    const flattened = Object.values(itemsByCourse)
      .flat()
      .map((item) => ({
        ...item,
        category: normalizeCategoryForViews(item.category),
      }))
      .filter((item) => item.category === "ASSIGNMENT" || item.category === "EXAM");

    for (const item of flattened) {
      const mergeKey = buildMergedItemKey(item);
      const existing = merged.get(mergeKey);
      if (!existing) {
        merged.set(mergeKey, {
          ...item,
          linkedItemIds: [item.id],
        });
        continue;
      }

      const linkedIds = new Set([
        ...(Array.isArray(existing.linkedItemIds) ? existing.linkedItemIds : [existing.id]),
        item.id,
      ]);
      existing.linkedItemIds = Array.from(linkedIds);

      const existingCode = deriveCourseCode(existing.courseCode, existing.courseName || "");
      const incomingCode = deriveCourseCode(item.courseCode, item.courseName || "");
      if ((!existingCode || existingCode === "UNK") && incomingCode && incomingCode !== "UNK") {
        existing.courseCode = incomingCode;
      }
      if (!existing.courseName && item.courseName) {
        existing.courseName = item.courseName;
      }
      if (!existing.due && item.due) {
        existing.due = item.due;
      }
      if (!existing.canvasAssignmentId && item.canvasAssignmentId) {
        existing.canvasAssignmentId = item.canvasAssignmentId;
      }
      if (!existing.discoveredKey && item.discoveredKey) {
        existing.discoveredKey = item.discoveredKey;
      }
      if (!existing.sourceOfTruth && item.sourceOfTruth) {
        existing.sourceOfTruth = item.sourceOfTruth;
      }
      if (item.status === "CONFLICT" || (!existing.status && item.status) || (item.status === "RESOLVED" && existing.status !== "CONFLICT")) {
        existing.status = item.status;
      }
    }

    return Array.from(merged.values());
  }, [itemsByCourse]);

  function connectCanvas() {
    signInWithCanvas();
  }

  async function disconnectCanvas() {
    if (isDisconnectingCanvas) return;
    setIsDisconnectingCanvas(true);
    // Revoke the OAuth token at Canvas and clear server-stored credentials first
    // (cloud, non-demo). The local cleanup below is best-effort UI state reset.
    if (!isDemoMode) {
      try {
        const res = await fetch(
          `${API_BASE}/api/user/disconnect-canvas`,
          apiFetchOptions({ method: "POST" }),
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed (${res.status})`);
        }
      } catch (err) {
        notifyUser({
          tone: "error",
          title: "Couldn’t disconnect Canvas",
          message: err?.message || String(err),
          actionLabel: "Try again",
          onAction: () => {
            void disconnectCanvas();
          },
          duration: null,
        });
        setIsDisconnectingCanvas(false);
        return;
      }
    }
    clearAllLocalCanvasSyncData();
    setCanvasBaseUrl("");
    setCanvasToken("");
    setActiveCourses([]);
    setItemsByCourse({});
    setCanvasStatus("Disconnected");
    setIsDisconnectingCanvas(false);
    notifyUser({
      tone: "success",
      title: "Canvas disconnected",
      message: "Saved course data was cleared from this device.",
    });
  }

  async function exportMyData() {
    if (isDemoMode) {
      notifyUser({
        tone: "info",
        title: "Export is unavailable in the demo",
        message: "The demo uses temporary sample data and does not create an account export.",
      });
      return;
    }
    if (isExportingData) return;
    setIsExportingData(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/export`, apiFetchOptions());
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "canvassync-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notifyUser({
        tone: "success",
        title: "Export downloaded",
        message: "Your CanvasSync data was saved as canvassync-export.json.",
      });
    } catch (err) {
      notifyUser({
        tone: "error",
        title: "Couldn’t export your data",
        message: err?.message || String(err),
        actionLabel: "Try again",
        onAction: () => {
          void exportMyData();
        },
        duration: null,
      });
    } finally {
      setIsExportingData(false);
    }
  }

  async function deleteAllMyData() {
    if (isDemoMode) {
      notifyUser({
        tone: "info",
        title: "Deletion is unavailable in the demo",
        message: "Demo data is temporary and is cleared automatically.",
      });
      return;
    }
    setShowDeleteDataConfirm(true);
  }

  async function confirmDeleteAllMyData() {
    if (isDeletingData) return;
    setIsDeletingData(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/user/delete-data`,
        apiFetchOptions({ method: "POST" }),
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      setShowDeleteDataConfirm(false);
      notifyUser({
        tone: "success",
        title: "Your data was deleted",
        message: "Server data and this device's CanvasSync cache were deleted. You are being signed out.",
      });
      clearAllLocalCanvasSyncData();
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      await logout();
    } catch (err) {
      notifyUser({
        tone: "error",
        title: "Couldn’t delete your data",
        message: err?.message || String(err),
        actionLabel: "Try again",
        onAction: () => {
          void confirmDeleteAllMyData();
        },
        duration: null,
      });
    } finally {
      setIsDeletingData(false);
    }
  }

  async function syncCourse(courseIdInput) {
    const courseId = normalizeCourseId(courseIdInput);
    const token = (canvasToken || "").trim();
    const baseUrl = (canvasBaseUrl || localStorage.getItem("canvas_base_url") || "").trim();
    const courseMeta = activeCourses.find((c) => normalizeCourseId(c.id) === courseId);
    const derivedCourseCode = deriveCourseCode(courseMeta?.courseCode, courseMeta?.name || "");
    const groupedCourseIds = getGroupedCourseIdsByCode(courseId, courseMeta?.courseCode, courseMeta?.name || "");
    const classCodeLabel = derivedCourseCode && derivedCourseCode !== "UNK"
      ? derivedCourseCode
      : (courseMeta?.name || `Course ${courseId}`);
    const syncToastId = `sync-live-status-${courseId || "unknown"}`;
    const syncWarnings = [];

    // In cloud mode, the Canvas token is stored server-side. A missing client-side token
    // is not necessarily an error, as long as we have saved credentials on the backend.
    if (!isDemoMode && !baseUrl && !token) {
      notifyUser({
        tone: "error",
        title: "Canvas is not connected",
        message: "Open Account options and connect Canvas before syncing.",
        duration: null,
      });
      return;
    }

    if (!isDemoMode && !isAuthenticated()) {
      notifyUser({
        tone: "error",
        title: "Sign in required",
        message: "Sign in with Canvas before syncing your courses.",
        duration: null,
      });
      return;
    }
    if (isDemoMode && !demoSession?.token && !getDemoToken()) {
      notifyUser({
        tone: "error",
        title: "Demo session expired",
        message: "Reload the demo to start a fresh session.",
        actionLabel: "Reload",
        onAction: () => window.location.reload(),
        duration: null,
      });
      return;
    }

    const syncFetchOptions = (body) =>
      apiFetchOptions({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    setIsSyncing(true);
    setSyncingCourseId(courseId);
    const updateGroupedSyncStatus = (message) => {
      setSyncStatus((prev) => {
        const next = { ...prev };
        for (const groupedId of groupedCourseIds) {
          next[groupedId] = message;
        }
        return next;
      });
    };
    setSyncWarningsByCourse((prev) => {
      const next = { ...(prev || {}) };
      for (const groupedId of groupedCourseIds) {
        delete next[groupedId];
      }
      return next;
    });
    updateGroupedSyncStatus("Reading course materials");

    try {
      await runWithSyncFeedback(async () => {
        updateGroupedSyncStatus("Reading course materials");

        for (const groupedId of groupedCourseIds) {
          const materialsRes = await fetchSyncWithRetry(
            `${API_BASE}/api/sync_course_materials`,
            syncFetchOptions({
              base_url: baseUrl,
              token,
              course_id: groupedId,
            }),
          );

          if (!materialsRes.ok) {
            throw new Error(await readSyncErrorMessage(materialsRes, "Failed to sync materials"));
          }
        }

        updateGroupedSyncStatus("Reading course materials");

        try {
          await fetchSyncWithRetry(
            `${API_BASE}/api/sync_announcements`,
            syncFetchOptions({
              base_url: baseUrl,
              token,
              course_ids: groupedCourseIds,
            }),
          );
        } catch (annErr) {
          console.warn("Announcement sync failed (non-fatal):", annErr);
          syncWarnings.push("Announcements could not be refreshed. Assignment and syllabus sync continued.");
          setSyncWarningsByCourse((prev) => {
            const next = { ...(prev || {}) };
            for (const groupedId of groupedCourseIds) {
              next[groupedId] = "Announcements could not be refreshed; timeline sync continued.";
            }
            return next;
          });
        }

        updateGroupedSyncStatus("Syncing assignments");

        const initialAssignmentsByCourse = {};
        for (const groupedId of groupedCourseIds) {
          const assignmentsRes = await fetchSyncWithRetry(
            `${API_BASE}/api/sync_assignments`,
            syncFetchOptions({
              base_url: baseUrl,
              token,
              course_id: groupedId,
            }),
          );

          if (!assignmentsRes.ok) {
            throw new Error(await readSyncErrorMessage(assignmentsRes, "Failed to sync assignments"));
          }
          const initialAssignmentsData = await assignmentsRes.json().catch(() => ({}));
          initialAssignmentsByCourse[groupedId] = Array.isArray(initialAssignmentsData?.a)
            ? initialAssignmentsData.a
            : Array.isArray(initialAssignmentsData?.assignments)
              ? initialAssignmentsData.assignments
              : [];
        }

        updateGroupedSyncStatus("Matching dates from materials");

        const resolveRes = await fetchSyncWithRetry(
          `${API_BASE}/api/resolve_course_dates`,
          syncFetchOptions({
            course_id: courseId,
            course_timezone: COURSE_TIMEZONE,
          }),
          { timeoutMs: AI_RESOLVE_TIMEOUT_MS },
        );

        if (!resolveRes.ok) {
          const resolveErr = await readSyncErrorMessage(resolveRes, "Failed to resolve course dates");
          if (resolveRes.status === 403 && /consent/i.test(resolveErr)) {
            setLegalConsentAccepted(false);
          }
          throw new Error(resolveErr);
        }

        const previousCourseItems = groupedCourseIds.flatMap((groupedId) => (
          Array.isArray(itemsByCourse[groupedId]) ? itemsByCourse[groupedId] : []
        ));

        const mapAssignmentsForCourse = (assignments, targetCourseId) => {
          const targetCourse = activeCourses.find((c) => normalizeCourseId(c.id) === normalizeCourseId(targetCourseId))
            || courseMeta;
          const mapped = (Array.isArray(assignments) ? assignments : []).map((a) => {
            const assignmentId = normalizeAssignmentToken(a.canvas_assignment_id ?? a.canvasAssignmentId ?? a.cid);
            const discoveredKey = normalizeAssignmentToken(a.discovered_key ?? a.discoveredKey ?? a.dk).toLowerCase();
            const stableToken = assignmentId || (discoveredKey ? `disc:${discoveredKey}` : "");
            const nameValue = a.nam ?? a.name ?? "";
            const dueValue = a.due ?? a.normalizedDueAt ?? a.originalDueAt ?? a.normalized_due_at ?? a.due_at ?? a.original_due_at ?? null;

            return {
              id: buildAssignmentStableId(targetCourseId, stableToken, nameValue, dueValue),
              courseId: targetCourseId,
              canvasAssignmentId: assignmentId || null,
              discoveredKey: discoveredKey || null,
              courseName: targetCourse?.name || "Unknown",
              courseCode: deriveCourseCode(targetCourse?.courseCode, targetCourse?.name),

              name: nameValue,
              due: dueValue,

              status: a.st ?? a.status ?? null,
              sourceOfTruth: a.sourceOfTruth ?? a.source_of_truth ?? a.source ?? null,
              category: normalizeCategoryForViews(a.cat ?? a.category),
            };
          });
          return dedupeAssignmentsWithinCourse(mapped);
        };

        updateGroupedSyncStatus("Updating timeline");

        const cachedRes = await fetchSyncWithRetry(
          `${API_BASE}/api/user/assignments?lite=1`,
          apiFetchOptions(),
        );
        if (!cachedRes.ok) {
          throw new Error(await readSyncErrorMessage(cachedRes, "Failed to load resolved assignments"));
        }
        const cachedData = await cachedRes.json().catch(() => ({}));
        const allCachedAssignments = Array.isArray(cachedData?.assignments) ? cachedData.assignments : [];
        const groupedIdSet = new Set(groupedCourseIds.map((id) => normalizeCourseId(id)));
        const resolvedAssignmentsByCourse = Object.fromEntries(
          groupedCourseIds.map((groupedId) => [groupedId, []])
        );
        for (const row of allCachedAssignments) {
          const rowCourseId = normalizeCourseId(row?.courseId || row?.course_id);
          if (!groupedIdSet.has(rowCourseId)) continue;
          const matchedId = groupedCourseIds.find((groupedId) => normalizeCourseId(groupedId) === rowCourseId);
          if (matchedId) {
            resolvedAssignmentsByCourse[matchedId].push(row);
          }
        }

        const normalizedAssignmentsByCourse = {};

        for (const groupedId of groupedCourseIds) {
          const initialNormalizedAssignments = mapAssignmentsForCourse(initialAssignmentsByCourse[groupedId] || [], groupedId);
          let normalizedAssignments = mapAssignmentsForCourse(resolvedAssignmentsByCourse[groupedId] || [], groupedId);
          if (!normalizedAssignments.length) {
            if (initialNormalizedAssignments.length > 0) {
              normalizedAssignments = initialNormalizedAssignments;
            } else if (Array.isArray(itemsByCourse[groupedId]) && itemsByCourse[groupedId].length > 0) {
              normalizedAssignments = itemsByCourse[groupedId];
              console.warn(`Sync returned an empty assignment payload for course ${groupedId}; keeping previous assignments.`);
            }
          }
          normalizedAssignmentsByCourse[groupedId] = normalizedAssignments;
        }

        const previousCompletedSignatures = new Set();
        for (const item of previousCourseItems) {
          if (!completedItems[item?.id]) continue;
          const itemSignatures = buildAssignmentCompletionSignatures({
            courseId: item?.courseId || courseId,
            assignmentId: extractAssignmentIdFromItem(item, item?.courseId || courseId),
            discoveredKey: extractDiscoveredKeyFromItem(item),
            name: item?.name,
            due: item?.due,
          });
          for (const signature of itemSignatures) {
            previousCompletedSignatures.add(signature);
          }
        }

        setItemsByCourse((prev) => ({
          ...prev,
          ...normalizedAssignmentsByCourse,
        }));

        const mergedNormalizedAssignments = dedupeAssignmentsWithinCourse(
          groupedCourseIds.flatMap((groupedId) => normalizedAssignmentsByCourse[groupedId] || [])
        );

        if (previousCompletedSignatures.size > 0) {
          setCompletedItems((prev) => {
            const next = { ...(prev || {}) };
            let changed = false;

            for (const item of mergedNormalizedAssignments) {
              const signatures = buildAssignmentCompletionSignatures({
                courseId: item?.courseId || courseId,
                assignmentId: extractAssignmentIdFromItem(item, item?.courseId || courseId),
                discoveredKey: extractDiscoveredKeyFromItem(item),
                name: item?.name,
                due: item?.due,
              });
              if (signatures.some((signature) => previousCompletedSignatures.has(signature))) {
                if (!next[item.id]) {
                  next[item.id] = true;
                  changed = true;
                }
              }
            }

            if (changed && activeUser?.uid && !isDemoMode) {
              persistCompletedItemsDebounced(next);
            }
            return changed ? next : prev;
          });
        }

        updateGroupedSyncStatus(syncWarnings.length > 0 ? "Sync complete with a warning" : "Sync complete");

        // Auto-assign random color if course doesn't have one yet (avoiding duplicates)
        setCourseColors(prev => {
          if (!prev[courseId]) {
            const usedColors = Object.values(prev);
            const availableColors = COURSE_COLOR_PALETTE.filter(c => !usedColors.includes(c.hex));
            const colorPool = availableColors.length > 0 ? availableColors : COURSE_COLOR_PALETTE;
            const randomColor = colorPool[Math.floor(Math.random() * colorPool.length)].hex;
            return { ...prev, [courseId]: randomColor };
          }
          return prev;
        });

        setActiveCourses((prev) =>
          prev.map((c) => (
            groupedCourseIds.includes(normalizeCourseId(c.id))
              ? { ...c, status: "SYNCED" }
              : c
          ))
        );
        const savedSyncState = getSavedCourseSyncState(baseUrl, token);
        for (const groupedId of groupedCourseIds) {
          savedSyncState[groupedId] = "SYNCED";
        }
        setSavedCourseSyncState(savedSyncState, baseUrl, token);
        setLastSyncAt(new Date().toISOString());

        return {
          itemCount: mergedNormalizedAssignments.length,
          warning: syncWarnings[0] || "",
        };
      }, {
        id: syncToastId,
        loadingTitle: `Syncing ${classCodeLabel}`,
        successTitle: `Synced ${classCodeLabel}`,
        successDescription: (data) => data?.warning
          ? data.warning
          : `${data?.itemCount || 0} ${data?.itemCount === 1 ? "item is" : "items are"} ready in your timeline.`,
        successTone: (data) => data?.warning ? "warning" : "success",
        errorTitle: `Couldn’t sync ${classCodeLabel}`,
        errorDescription: (err) => err?.message || String(err),
        errorActionLabel: "Try again",
        onErrorAction: () => {
          setSyncQueue((prev) => {
            const existing = new Set((prev || []).map((id) => normalizeCourseId(id)));
            if (existing.has(courseId)) return prev;
            return [...(prev || []), courseId];
          });
          setSyncStartedAt(new Date().toISOString());
          setSyncRunTotal(1);
          setSyncRunCompleted(0);
          setSyncStatus((prev) => ({ ...(prev || {}), [courseId]: "Queued" }));
          setSyncWarningsByCourse((prev) => {
            const next = { ...(prev || {}) };
            delete next[courseId];
            return next;
          });
        },
      });
    } catch (err) {
      console.error("Sync failed", err);
      updateGroupedSyncStatus(`Sync failed: ${err?.message || String(err)}`);
    } finally {
      setSyncRunCompleted((prev) => prev + 1);
      setIsSyncing(false);
      setSyncingCourseId(null);
      // Remove from queue and continue processing
      setSyncQueue(prev => prev.slice(1));
      isProcessingQueue.current = false;
    }
  }

  // Process the sync queue
  const processQueue = useCallback(async () => {
    if (syncQueue.length === 0 || isProcessingQueue.current || syncingCourseId) {
      return;
    }

    isProcessingQueue.current = true;
    const nextCourseId = syncQueue[0];
    await syncCourse(nextCourseId);
  }, [syncQueue, activeCourses, syncingCourseId]);

  // Effect to process queue when it changes
  useEffect(() => {
    if (syncQueue.length > 0 && !isProcessingQueue.current) {
      processQueue();
    }
  }, [syncQueue, processQueue]);

  const normalizedSelectedCourseId = normalizeCourseId(selectedCourseId);
  const selectedCourse = activeCourses.find((c) => normalizeCourseId(c.id) === normalizedSelectedCourseId);
  const selectedCourseGroupIds = useMemo(
    () => getGroupedCourseIdsByCode(
      normalizedSelectedCourseId,
      selectedCourse?.courseCode,
      selectedCourse?.name || "",
    ),
    [getGroupedCourseIdsByCode, normalizedSelectedCourseId, selectedCourse?.courseCode, selectedCourse?.name]
  );
  const courseItems = useMemo(() => (
    dedupeAssignmentsWithinCourse(
      selectedCourseGroupIds.flatMap((groupedId) => itemsByCourse[groupedId] || [])
    )
  ), [itemsByCourse, selectedCourseGroupIds]);
  const currentSyncStatus = selectedCourseGroupIds
    .map((groupedId) => syncStatus[groupedId])
    .find(Boolean);
  const selectedCourseIsSynced = selectedCourseGroupIds.some((groupedId) => {
    const groupedCourse = activeCourses.find((c) => normalizeCourseId(c.id) === groupedId);
    return groupedCourse?.status === "SYNCED";
  });

  const CATEGORY_ORDER = {
    EXAM: 0,
    ASSIGNMENT: 1,
    PLACEHOLDER: 2,
    PENDING: 3,
  };

  const toTime = (iso) => {
    const d = parseDueToDate(iso);
    return d ? d.getTime() : Number.POSITIVE_INFINITY;
  };


  const sortedCourseItems = [...courseItems]
    .map((i) => ({
      ...i,
      category: normalizeCategoryForViews(i.category),
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
  // Filter items for current week
  const weekDates = useMemo(() => getWeekDates(currentWeekStart), [currentWeekStart]);

  // Normalize week bounds to local midnight to avoid time-of-day bugs
  const weekStart = useMemo(() => new Date(weekDates[0].getFullYear(), weekDates[0].getMonth(), weekDates[0].getDate(), 0, 0, 0, 0), [weekDates]);
  const weekEnd = useMemo(() => new Date(weekDates[6].getFullYear(), weekDates[6].getMonth(), weekDates[6].getDate(), 0, 0, 0, 0), [weekDates]);


  const weekItems = useMemo(() => allItems
    .filter((item) => {
      // 1. Date Range Check
      const due = parseDueToDate(item.due);
      if (!due) return false;
      const inRange = due >= weekStart && due <= addDays(weekEnd, 1);
      if (!inRange) return false;

      // 2. Category Filter Check
      if (weeklyFilters[item.category] === false) return false;

      return true;
    })
    .sort((a, b) => toTime(a.due) - toTime(b.due)), [allItems, weekStart, weekEnd, weeklyFilters]);

  const unfilteredWeekItems = useMemo(() => allItems
    .filter((item) => {
      const due = parseDueToDate(item.due);
      return Boolean(due && due >= weekStart && due <= addDays(weekEnd, 1));
    })
    .sort((a, b) => toTime(a.due) - toTime(b.due)), [allItems, weekEnd, weekStart]);

  const filtersHideAllWeekItems = hasDisabledWeeklyFilters
    && weekItems.length === 0
    && unfilteredWeekItems.length > 0;


  const getLinkedItemIds = useCallback((item) => {
    const ids = [
      ...(Array.isArray(item?.linkedItemIds) ? item.linkedItemIds : []),
      item?.id,
    ]
      .map((id) => normalizeAssignmentToken(id))
      .filter(Boolean);
    return Array.from(new Set(ids));
  }, []);

  const isItemCompleted = useCallback((item) => {
    const ids = getLinkedItemIds(item);
    if (!ids.length) return false;
    return ids.some((id) => !!completedItems[id]);
  }, [completedItems, getLinkedItemIds]);

  // Calculate progress
  const completedThisWeek = weekItems.filter((item) => isItemCompleted(item)).length;
  const progressPercent = weekItems.length > 0 ? (completedThisWeek / weekItems.length) * 100 : 0;

  // Group items by day for weekly todo view
  const itemsByDay = useMemo(() => {
    const grouped = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    weekDates.forEach((date, idx) => {
      const dayName = dayNames[idx];
      const dateKey = date.toDateString();
      grouped[dayName] = {
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
    return grouped;
  }, [weekDates, weekItems]);

  const mobileSelectedWeekDate = useMemo(() => {
    const today = new Date();
    const todayInWeek = weekDates.find((date) => isSameDay(date, today));
    const fallbackDate = todayInWeek || weekDates[0];
    return weekDates.find((date) => date.toDateString() === mobileSelectedWeekKey) || fallbackDate;
  }, [mobileSelectedWeekKey, weekDates]);

  const mobileSelectedDayName = mobileSelectedWeekDate.toLocaleDateString('en-US', { weekday: 'long' });
  const mobileSelectedDayItems = itemsByDay[mobileSelectedDayName]?.items || [];
  const mobileSelectedDayCompleted = mobileSelectedDayItems.filter((item) => isItemCompleted(item)).length;
  const mobileUpcomingWeekItems = useMemo(() => {
    const selectedEnd = new Date(
      mobileSelectedWeekDate.getFullYear(),
      mobileSelectedWeekDate.getMonth(),
      mobileSelectedWeekDate.getDate() + 1,
      0,
      0,
      0,
      0,
    );
    return weekItems
      .filter((item) => {
        const due = parseDueToDate(item.due);
        if (!due) return false;
        return due >= selectedEnd;
      })
      .slice(0, 3);
  }, [mobileSelectedWeekDate, weekItems]);

  const toggleComplete = (item) => {
    const completionIds = getLinkedItemIds(item);
    if (!completionIds.length) return;

    setCompletedItems(prev => {
      const next = { ...(prev || {}) };
      const shouldMarkComplete = !completionIds.some((id) => !!next[id]);

      for (const id of completionIds) {
        if (shouldMarkComplete) {
          next[id] = true;
        } else {
          delete next[id];
        }
      }

      // Server-side preference persistence is best-effort and debounced.
      if (canvasUser?.uid) {
        persistCompletedItemsDebounced(next);
      }
      return next;
    });
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

  // Pre-compute items by date string for O(1) calendar lookup
  const itemsByDateStr = useMemo(() => {
    const map = {};
    allItems.forEach(item => {
      // Apply filters here too so calendar reflects filters
      if (weeklyFilters[item.category] === false) return;

      const d = parseDueToDate(item.due);
      if (d) {
        const key = d.toDateString();
        if (!map[key]) map[key] = [];
        map[key].push(item);
      }
    });
    // Sort each day's items once
    Object.values(map).forEach(list => {
      list.sort((a, b) => toTime(a.due) - toTime(b.due));
    });
    return map;
  }, [allItems, weeklyFilters]);

  // Get items by date for calendar (O(1) access)
  const getItemsForDate = useCallback((date) => {
    return itemsByDateStr[date.toDateString()] || [];
  }, [itemsByDateStr]);

  const mobileMonthAgenda = useMemo(() => {
    const days = [];
    const cursor = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const month = currentMonth.getMonth();

    while (cursor.getMonth() === month) {
      const items = getItemsForDate(cursor);
      if (items.length > 0) {
        days.push({
          date: new Date(cursor),
          items,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  }, [currentMonth, getItemsForDate]);

  const unfilteredMobileMonthItemCount = useMemo(() => allItems.filter((item) => {
    const due = parseDueToDate(item.due);
    if (!due) return false;
    return due.getFullYear() === currentMonth.getFullYear()
      && due.getMonth() === currentMonth.getMonth();
  }).length, [allItems, currentMonth]);

  const filtersHideAllMonthItems = hasDisabledWeeklyFilters
    && mobileMonthAgenda.length === 0
    && unfilteredMobileMonthItemCount > 0;

  const mobileActiveTitle = activeTab === "calendar"
    ? "Calendar"
    : activeTab === "classSettings"
      ? (isEditingSyncClasses ? "Select classes" : "Classes")
      : activeTab === "course"
        ? (selectedCourse?.courseCode || "Course")
        : "This week";
  const mobileActiveEyebrow = activeTab === "calendar"
    ? "Month agenda"
    : activeTab === "classSettings"
      ? "Sync selection"
      : activeTab === "course"
        ? "Class timeline"
        : "Weekly plan";

  const renderMobileFilters = () => (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {Object.keys(weeklyFilters).map((cat) => {
        const isActive = weeklyFilters[cat] !== false;
        const label = cat === "EXAM" ? "Exams" : cat.charAt(0) + cat.slice(1).toLowerCase();
        return (
          <button
            key={cat}
            type="button"
            onClick={() => toggleFilter(cat)}
            aria-pressed={isActive}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${isActive
              ? "border-blue-500/45 bg-blue-500/15 text-blue-100"
              : "border-zinc-800 bg-zinc-950 text-zinc-500"
              }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const renderMobileTaskItem = (item, rowKey = item.id) => {
    const isCompleted = isItemCompleted(item);
    const deadlineMeta = getDeadlineMeta(item, isCompleted);
    const subjectLabel = deriveCourseCode(item.courseCode, item.courseName || "");
    const categoryLabel = normalizeCategoryForViews(item.category) === "EXAM" ? "Exam" : "Assignment";
    const itemStatus = String(item.status || "").trim().toUpperCase();
    const hasDueDate = Boolean(parseDueToDate(item.due));
    const attentionLabel = !isCompleted && itemStatus === "CONFLICT"
      ? "Review"
      : !isCompleted && !hasDueDate
        ? "No date"
        : !isCompleted && deadlineMeta.label === "Overdue"
          ? "Overdue"
          : "";
    const attentionClass = attentionLabel === "Overdue"
      ? "text-red-300"
      : attentionLabel === "Review"
        ? "text-amber-300"
        : "text-zinc-500";
    const titleClass = isCompleted
      ? "text-zinc-500 line-through decoration-zinc-600"
      : deadlineMeta.label === "Overdue"
        ? "text-white"
        : "text-zinc-100";

    return (
      <li
        key={rowKey}
        className={`rounded-lg border border-zinc-800 bg-zinc-950/75 px-3 py-3 transition-[opacity,background-color,border-color] duration-200 ${isCompleted ? "opacity-70" : ""}`}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
          <button
            type="button"
            onClick={() => toggleComplete(item)}
            aria-label={isCompleted ? `Mark ${item.name} incomplete` : `Mark ${item.name} complete`}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-[background-color,border-color,color] duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/70 ${isCompleted
              ? "border-green-500/35 bg-green-500/10 text-green-300"
              : "border-zinc-700 bg-zinc-900 text-zinc-500"
              }`}
          >
            {isCompleted ? <CheckCircle2 size={21} className="od-mobile-check-pop" /> : <Circle size={21} />}
          </button>

          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <p className={`min-w-0 text-[15px] font-semibold leading-snug ${titleClass}`}>{item.name}</p>
              <span className={`shrink-0 pt-0.5 text-sm font-semibold tabular-nums ${deadlineMeta.tone}`}>
                {formatMobileDueLabel(item.due)}
              </span>
            </div>

            <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] font-medium text-zinc-500">
              <span className="min-w-0 truncate font-semibold uppercase text-zinc-300">
                {subjectLabel && subjectLabel !== "UNK" ? subjectLabel : "UNK"}
              </span>
              <span className="text-zinc-700">/</span>
              <span className="shrink-0 text-zinc-400">{categoryLabel}</span>
              {attentionLabel ? (
                <span className={`ml-auto shrink-0 font-semibold ${attentionClass}`}>
                  {attentionLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </li>
    );
  };

  const renderMobileWeeklyView = () => {
    const selectedDayCue = getDayLabel(mobileSelectedWeekDate);
    const selectedDateLabel = mobileSelectedWeekDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    return (
      <section key={`week-${weekDates[0].toDateString()}`} className="space-y-4 od-mobile-content-enter">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/85 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-zinc-500">Week plan</p>
              <h1 className="mt-1 whitespace-nowrap text-xl font-semibold text-zinc-100">
                {formatMobileWeekRange(weekDates[0], weekDates[6])}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-black p-1">
              <button type="button" onClick={() => navigateWeek(-1)} className="grid h-9 w-9 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Previous week">
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setCurrentWeekStart(today);
                  setMobileSelectedWeekKey(today.toDateString());
                }}
                className="h-9 rounded-md px-3 text-xs font-semibold text-blue-200 hover:bg-blue-500/10"
              >
                Today
              </button>
              <button type="button" onClick={() => navigateWeek(1)} className="grid h-9 w-9 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Next week">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-zinc-400">{completedThisWeek} of {weekItems.length} complete</span>
              <span className={progressPercent === 100 ? "font-semibold text-green-300" : "font-semibold text-blue-300"}>{Math.round(progressPercent)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-zinc-800 bg-black">
              <div
                className={`h-full transition-all duration-300 ${progressPercent === 100 ? "bg-green-500" : "bg-blue-500"}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {renderMobileFilters()}

        {weekItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-5 py-8 text-center">
            <p className="text-base font-medium text-zinc-200">
              {filtersHideAllWeekItems ? "No items match these filters." : "No dated assignments this week."}
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              {filtersHideAllWeekItems
                ? "Turn the hidden category back on to see the work already in this week."
                : selectedSyncCourseCount > 0
                  ? "Synced courses with due dates will appear here after the next refresh."
                  : "Select classes, then run Sync to build your timeline."}
            </p>
            {filtersHideAllWeekItems ? (
              <button
                type="button"
                onClick={resetWeeklyFilters}
                className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-300"
              >
                Show all categories
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/85 p-2">
              {weekDates.map((date) => {
                const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
                const dayItems = itemsByDay[dayName]?.items || [];
                const completedCount = dayItems.filter((item) => isItemCompleted(item)).length;
                const isSelected = isSameDay(date, mobileSelectedWeekDate);
                const isToday = isSameDay(date, new Date());
                return (
                  <button
                    key={date.toDateString()}
                    type="button"
                    onClick={() => setMobileSelectedWeekKey(date.toDateString())}
                    className={`min-h-[74px] rounded-lg border px-1.5 py-2 text-center transition-[background-color,border-color,color] duration-150 ${isSelected
                      ? "border-blue-500/45 bg-blue-500/15 text-blue-100"
                      : "border-zinc-800 bg-black text-zinc-500"
                      }`}
                    aria-pressed={isSelected}
                  >
                    <span className="block text-[10px] font-semibold uppercase leading-none">
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className={`mt-1 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${isToday ? "mx-auto bg-blue-600 text-white" : "mx-auto"}`}>
                      {date.getDate()}
                    </span>
                    <span className="mt-1 flex items-center justify-center gap-0.5">
                      {dayItems.length > 0 ? (
                        Array.from({ length: Math.min(dayItems.length, 3) }).map((_, idx) => (
                          <span key={idx} className={`h-1.5 w-1.5 rounded-full ${completedCount > idx ? "bg-green-500" : "bg-blue-500"}`} />
                        ))
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                      )}
                    </span>
                    <span className="mt-1 block text-[10px] font-medium tabular-nums">
                      {completedCount}/{dayItems.length}
                    </span>
                  </button>
                );
              })}
            </div>

            <section
              key={`selected-day-${mobileSelectedWeekDate.toDateString()}`}
              className="rounded-lg border border-zinc-800 bg-zinc-950/85 p-4 od-mobile-content-enter"
              aria-label={selectedDateLabel}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-zinc-100">{selectedDateLabel}</h2>
                    {selectedDayCue ? (
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${selectedDayCue === "Past due" ? "border-red-500/35 bg-red-500/10 text-red-200" : selectedDayCue === "Today" ? "border-blue-500/35 bg-blue-500/10 text-blue-200" : "border-amber-500/35 bg-amber-500/10 text-amber-200"}`}>
                        {selectedDayCue}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {mobileSelectedDayCompleted} of {mobileSelectedDayItems.length} due items complete
                  </p>
                </div>
                <span className="shrink-0 rounded-lg border border-zinc-800 bg-black px-2.5 py-1 text-xs font-semibold text-zinc-400">
                  {mobileSelectedDayItems.length} due
                </span>
              </div>

              {mobileSelectedDayItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-4 py-6 text-center">
                  <p className="text-sm font-medium text-zinc-200">No assignments due this day.</p>
                  <p className="mt-1 text-xs text-zinc-500">Use the week strip to check another day.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {mobileSelectedDayItems.map((item) => renderMobileTaskItem(item))}
                </ul>
              )}
            </section>

            {mobileUpcomingWeekItems.length > 0 ? (
              <section aria-label="Upcoming this week">
                <div className="mb-2 flex items-center justify-between px-0.5">
                  <h2 className="text-sm font-semibold text-zinc-200">Next in this week</h2>
                  <span className="text-xs text-zinc-600">after selected day</span>
                </div>
                <ul className="space-y-2">
                  {mobileUpcomingWeekItems.map((item) => renderMobileTaskItem(item, `upcoming-${item.id}`))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </section>
    );
  };

  const renderMobileCalendarView = () => (
    <section key={`month-${currentMonth.getFullYear()}-${currentMonth.getMonth()}`} className="space-y-4 od-mobile-content-enter">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/85 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">Month</p>
            <h1 className="mt-1 text-xl font-semibold text-zinc-100">
              {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-800 bg-black p-1">
            <button type="button" onClick={() => navigateMonth(-1)} className="grid h-9 w-9 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={() => setCurrentMonth(new Date())} className="h-9 rounded-md px-3 text-xs font-semibold text-blue-200 hover:bg-blue-500/10">
              Today
            </button>
            <button type="button" onClick={() => navigateMonth(1)} className="grid h-9 w-9 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {renderMobileFilters()}

      {mobileMonthAgenda.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-5 py-8 text-center">
          <p className="text-base font-medium text-zinc-200">
            {filtersHideAllMonthItems ? "No items match these filters." : "No dated items this month."}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {filtersHideAllMonthItems
              ? "Turn the hidden category back on to restore this month’s agenda."
              : "Try another month or sync your selected classes."}
          </p>
          {filtersHideAllMonthItems ? (
            <button
              type="button"
              onClick={resetWeeklyFilters}
              className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-300"
            >
              Show all categories
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {mobileMonthAgenda.map(({ date, items }) => {
            const dayCue = getDayLabel(date);
            const isToday = isSameDay(date, new Date());
            return (
              <section key={date.toDateString()}>
                <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-11 w-11 place-items-center rounded-lg border text-base font-semibold ${isToday ? "border-blue-500/45 bg-blue-500/15 text-blue-100" : "border-zinc-800 bg-zinc-950 text-zinc-300"}`}>
                      {date.getDate()}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">
                        {date.toLocaleDateString('en-US', { weekday: 'long' })}
                      </p>
                      <p className="text-xs text-zinc-600">
                        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  {dayCue && dayCue !== "Past due" ? (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${dayCue === "Past due" ? "border-red-500/35 bg-red-500/10 text-red-200" : dayCue === "Today" ? "border-blue-500/35 bg-blue-500/10 text-blue-200" : "border-amber-500/35 bg-amber-500/10 text-amber-200"}`}>
                      {dayCue}
                    </span>
                  ) : null}
                </div>
                <ul className="space-y-2">
                  {items.map((item) => renderMobileTaskItem(item, `${date.toDateString()}-${item.id}`))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderMobileClassSettingsView = () => (
    <section className="space-y-4 od-mobile-content-enter">
      {!isEditingSyncClasses ? (
        <>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/85 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-zinc-500">Selected classes</p>
                <h1 className="mt-1 text-xl font-semibold text-zinc-100">
                  {selectedSyncCourseCount > 0 ? `${selectedSyncCourseCount} ready to sync` : "Choose classes"}
                </h1>
              </div>
              <button
                type="button"
                onClick={startEditingSyncClasses}
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {selectedSyncCourseCount === 0 ? "Select" : "Edit"}
              </button>
            </div>
          </div>

          {syncEnabledCourseList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-5 py-8 text-center text-sm text-zinc-500">
              Your selected classes will appear here.
            </div>
          ) : (
            <ul className="space-y-2">
              {syncEnabledCourseList.map((course) => (
                <li key={course.id} className={`rounded-lg border px-3 py-3 ${course.isCurrentlyActive ? "border-zinc-800 bg-zinc-950/85" : "border-zinc-900 bg-zinc-950/50 opacity-70"}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCourseId(course.id);
                      setActiveTab("course");
                    }}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span
                        className={`mb-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getCourseColorClasses(getEffectiveCourseColor(course.id, course.courseCode, course.name)).tag}`}
                      >
                        {(course.courseCode || "UNK").toUpperCase()}
                      </span>
                      <span className="block truncate text-sm font-semibold text-zinc-100">{course.name}</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-zinc-500" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/85 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-zinc-500">Class picker</p>
                <h1 className="mt-1 text-xl font-semibold text-zinc-100">{draftSelectedCount} selected</h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={cancelEditingSyncClasses}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={completeEditingSyncClasses}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  {draftSelectedCount > 0 ? "Save" : "Clear"}
                </button>
              </div>
            </div>
          </div>

          {allCourseList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-5 py-8 text-center text-sm text-zinc-500">
              No classes available.
            </div>
          ) : (
            <ul className="space-y-2">
              {allCourseList.map((course) => {
                const isSelected = !!syncEnabledDraft[normalizeCourseId(course.id)];
                const isActive = !!course.isCurrentlyActive;
                return (
                  <li key={course.id}>
                    <button
                      type="button"
                      onClick={() => toggleSyncCourseInDraft(course.id)}
                      aria-pressed={isSelected}
                      className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${isSelected
                        ? "border-blue-500/45 bg-blue-500/15"
                        : isActive
                          ? "border-zinc-800 bg-zinc-950/85"
                          : "border-zinc-900 bg-zinc-950/50 opacity-70"
                        }`}
                    >
                      {isSelected ? (
                        <CheckCircle2 size={22} className="text-blue-300" />
                      ) : (
                        <Circle size={22} className={isActive ? "text-zinc-500" : "text-zinc-700"} />
                      )}
                      <span className="min-w-0">
                        <span
                          className={`mb-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getCourseColorClasses(getEffectiveCourseColor(course.id, course.courseCode, course.name)).tag}`}
                        >
                          {(course.courseCode || "UNK").toUpperCase()}
                        </span>
                        <span className="block truncate text-sm font-semibold text-zinc-100">{course.name}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );

  const renderMobileCourseView = () => (
    <section className="space-y-4 od-mobile-content-enter">
      <button
        type="button"
        onClick={() => setActiveTab("classSettings")}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-300"
      >
        <ChevronLeft size={16} />
        Classes
      </button>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/85 p-4">
        <p className="text-xs font-semibold uppercase text-zinc-500">Course</p>
        <h1 className="mt-1 text-xl font-semibold text-zinc-100">
          {selectedCourse ? selectedCourse.name : "Select a course"}
        </h1>
        {currentSyncStatus ? (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-medium ${String(currentSyncStatus).toLowerCase().includes("warning")
            ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
            : String(currentSyncStatus).toLowerCase().includes("complete")
              ? "border-green-900 bg-green-950 text-green-300"
            : String(currentSyncStatus).toLowerCase().includes("fail")
              ? "border-red-900 bg-red-950 text-red-300"
              : "border-blue-900 bg-blue-950 text-blue-300"
            }`}>
            <p>{currentSyncStatus}</p>
            {String(currentSyncStatus).toLowerCase().includes("fail") && selectedCourse ? (
              <button
                type="button"
                onClick={() => {
                  const queuedCourseIds = queueSyncCourses([selectedCourse.id]);
                  if (queuedCourseIds.length) {
                    setSyncRunTotal(queuedCourseIds.length);
                    setSyncRunCompleted(0);
                  }
                }}
                className="mt-2 rounded-md border border-current px-2.5 py-1.5 text-xs font-semibold"
              >
                Try sync again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {selectedCourse && !selectedCourseIsSynced ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-5 py-8 text-center">
          <p className="text-sm text-zinc-500">This class has not been synced yet.</p>
          <button
            type="button"
            onClick={() => setActiveTab("classSettings")}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Open Classes
          </button>
        </div>
      ) : sortedCourseItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/70 px-5 py-8 text-center text-sm text-zinc-500">
          No course items synced yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {sortedCourseItems.map((item, idx) => {
            const categoryLabel = normalizeCategoryForViews(item.category) === "EXAM" ? "Exam" : "Assignment";
            const statusLabel = item.status === "CONFLICT" ? "Review" : "";

            return (
              <li key={`${item.name}-${idx}`} className="rounded-lg border border-zinc-800 bg-zinc-950/85 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[15px] font-semibold leading-snug text-zinc-100">{item.name}</p>
                <span className={`shrink-0 text-xs font-semibold ${item.status === "CONFLICT" ? "text-red-300" : "text-zinc-400"}`}>
                  {item.due ? (
                    formatMobileDueLabel(item.due)
                  ) : "--"}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-zinc-500">
                <span>{categoryLabel}</span>
                {statusLabel ? (
                  <span className="ml-auto shrink-0 font-semibold text-amber-300">{statusLabel}</span>
                ) : null}
              </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  if (isDemoMode && !demoSession && !demoBootstrapFailed) {
    return (
      <>
        {!isMobileLayout ? (
          <Toaster position="top-center" offset={16} options={{ fill: "#0b1020", roundness: 12, duration: 2600 }} />
        ) : null}
        <div className="flex h-screen items-center justify-center bg-[#f6f7f9] text-[#172033] md:bg-black md:text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-sm font-medium">Starting demo...</p>
          </div>
        </div>
      </>
    );
  }

  if (isDemoMode && demoBootstrapFailed) {
    return (
      <>
        {!isMobileLayout ? (
          <Toaster position="top-center" offset={16} options={{ fill: "#0b1020", roundness: 12, duration: 2600 }} />
        ) : null}
        <div className="flex h-screen flex-col items-center justify-center bg-[#f6f7f9] px-6 text-[#172033] md:bg-black md:text-white">
          <p className="text-lg font-semibold">Demo is unavailable</p>
          <p className="mt-2 max-w-sm text-center text-sm text-slate-500 md:text-zinc-500">
            The demo sandbox could not start. Check that the backend is running and try again later.
          </p>
          <div className="mt-6 flex items-center gap-2">
            <button
              type="button"
              onClick={handleExitDemo}
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 md:border-zinc-600 md:bg-zinc-800 md:text-zinc-200 md:hover:bg-zinc-700"
            >
              Exit demo
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  // Show loading while checking auth (real accounts only)
  if (authLoading && !isDemoMode) {
    return (
      <>
        {!isMobileLayout ? (
          <Toaster
            position="top-center"
            offset={16}
            options={{ fill: "#0b1020", roundness: 12, duration: 2600 }}
          />
        ) : null}
        <div className="flex h-screen items-center justify-center bg-[#f6f7f9] text-[#172033] md:bg-black md:text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-sm font-medium">Loading CanvasSync...</p>
          </div>
        </div>
      </>
    );
  }

  // Landing page is for signed-out users on / only — never shown inside /demo
  if (!isDemoMode && (!canvasUser || showLandingPage)) {
    return (
      <>
        {!isMobileLayout ? (
          <Toaster
            position="top-right"
            offset={16}
            options={{ fill: "#0b1020", roundness: 12, duration: 2600 }}
          />
        ) : null}
        <div className="mobile-landing h-screen flex flex-col bg-black text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
          {/* Top bar — mirrors the authenticated app header */}
          <header className="h-12 flex items-center justify-between px-5 bg-zinc-950 border-b border-zinc-800 shrink-0">
            {canvasUser ? (
              <button onClick={() => setShowLandingPage(false)} aria-label="Return to app">
                <BrandWordmark height={24} />
              </button>
            ) : (
              <BrandWordmark height={24} />
            )}
            {canvasUser ? (
              <button
                onClick={() => setShowLandingPage(false)}
                className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Back to App
              </button>
            ) : (
              <button
                onClick={handleCanvasSignIn}
                className="text-sm px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
              >
                Sign in
              </button>
            )}
          </header>

          {/* Main content area — same bg-black as app, no grid/glow effects */}
          <div className="flex-1 flex items-start justify-start overflow-auto lg:items-center lg:justify-center">
            <main className="w-full max-w-6xl mx-auto px-6 py-10 grid lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] gap-10 items-center">
              <section>
                <h1 className="text-3xl md:text-4xl font-semibold leading-tight text-zinc-100">
                  See what&rsquo;s due — and where it came from.
                </h1>
                <p className="mt-4 text-zinc-400 text-[15px] leading-relaxed max-w-md">
                  CanvasSync turns official Canvas assignments and course-material dates into one calm weekly timeline. Canvas items stay labeled. AI-assisted dates stay reviewable.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  {canvasUser ? (
                    <button
                      onClick={() => setShowLandingPage(false)}
                      className="inline-flex items-center justify-center gap-2.5 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/70"
                    >
                      Go to App
                    </button>
                  ) : (
                    <button
                      onClick={handleCanvasSignIn}
                      className="inline-flex items-center justify-center gap-2.5 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/70"
                    >
                      <img src="/canvas-logo.png" width="18" height="18" alt="" aria-hidden="true" style={{ filter: "brightness(0) invert(1)" }} />
                      Sign in with Canvas
                    </button>
                  )}
                  <a
                    href="/demo"
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-900 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/70"
                  >
                    Try Demo
                  </a>
                </div>

                <div className="mt-9 space-y-2.5 text-sm">
                  {[
                    ["Official Canvas dates", "Assignments keep a clear Canvas label when they come from the gradebook"],
                    ["Course-material dates", "Dates found in files, pages, modules, and announcements stay reviewable"],
                    ["One weekly timeline", "Completion, filters, and course labels stay focused on deadline recovery"],
                  ].map(([title, desc]) => (
                    <div key={title} className="flex items-start gap-3 p-3 rounded-md bg-zinc-950 border border-zinc-800/60">
                      <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <div>
                        <p className="text-zinc-200 font-medium text-[13px]">{title}</p>
                        <p className="text-zinc-500 text-[12px] mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <LandingDemoSquare />
            </main>
          </div>
          <LegalFooter />
        </div>
      </>
    );
  }

  const showConsentModal = Boolean(canvasUser) && !isDemoMode && !authLoading && !legalConsentAccepted;

  return (
    <>
      {showConsentModal ? (
        <ConsentModal onAccepted={() => setLegalConsentAccepted(true)} />
      ) : null}
      {!isMobileLayout ? (
        <Toaster
          position="top-right"
          offset={syncToastOffset}
          options={{ fill: "#0b1020", roundness: 14, duration: 2600 }}
        />
      ) : null}
      {isMobileLayout && mobileNotice ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] pt-[max(6px,env(safe-area-inset-top))]">
          <div className="pointer-events-auto">
            <MobileNotice notice={mobileNotice} onDismiss={dismissMobileNotice} />
          </div>
        </div>
      ) : null}
      <div className={`h-screen flex flex-col bg-black app-font theme-app ${theme === "light" ? "theme-light" : "theme-dark"} ${colorMode === "vibrant" ? "mode-vibrant" : "mode-standard"}`}>
        <PilotBanner />
        {/* Font Imports */}
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Patrick+Hand&family=Merriweather:wght@400;700&family=Space+Mono:wght@400;700&family=Roboto:wght@400;700&family=Lato:wght@400;700&family=Open+Sans:wght@400;700&family=Poppins:wght@400;600;700&display=swap');

        :root { --app-font: 'Inter', sans-serif; }
        .app-font { font-family: var(--app-font); }

        /* Backwards compatibility: old class names now just use the global font */
        .font-notebook { font-family: var(--app-font); }


/* Theme variables - Dark Standard Mode Only */
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

/* Map existing Tailwind utility classes to the theme variables */
.theme-app { background-color: var(--app-bg) !important; color: var(--text-1); }
.theme-app.bg-black { background-color: var(--app-bg) !important; }
.theme-app .bg-black { background-color: var(--app-bg) !important; }

.theme-app .bg-zinc-950 { background-color: var(--surface-1) !important; }
.theme-app .bg-zinc-900 { background-color: var(--surface-2) !important; }
.theme-app .bg-zinc-800 { background-color: var(--surface-3) !important; }
.theme-app .bg-zinc-700 { background-color: var(--surface-4) !important; }

.theme-app .hover\\:bg-zinc-900:hover { background-color: var(--surface-2) !important; }
.theme-app .hover\\:bg-zinc-800:hover { background-color: var(--surface-3) !important; }
.theme-app .hover\\:bg-zinc-700:hover { background-color: var(--surface-4) !important; }

.theme-app .text-white { color: var(--text-1) !important; }
.theme-app .text-zinc-200 { color: var(--text-2) !important; }
.theme-app .text-zinc-300 { color: var(--text-3) !important; }
.theme-app .text-zinc-400 { color: var(--text-4) !important; }
.theme-app .text-zinc-500 { color: var(--text-5) !important; }

.theme-app .border-zinc-800 { border-color: var(--border-1) !important; }
.theme-app .border-zinc-700 { border-color: var(--border-2) !important; }

.theme-app .bg-blue-600 { background-color: var(--accent) !important; }
.theme-app .hover\\:bg-blue-700:hover { background-color: var(--accent-hover) !important; }
        .theme-app .focus\\:border-blue-500:focus { border-color: var(--accent) !important; }

        /*
          Open Design mobile experiment
          Source: Open Design frontend-design skill + design-systems/application.
          This layer is intentionally scoped to the phone shell so the desktop
          product surface can keep its current dark CanvasSync UI.
        */
        .theme-app .od-mobile-shell {
          --od-bg: #f6f7f9;
          --od-surface: #ffffff;
          --od-surface-warm: #eef4ff;
          --od-fg: #172033;
          --od-fg-2: #3b4658;
          --od-muted: #6b7689;
          --od-border: #d8dee8;
          --od-border-soft: #edf1f6;
          --od-accent: #2563eb;
          --od-accent-on: #ffffff;
          --od-success: #16a34a;
          --od-warn: #f59e0b;
          --od-danger: #dc2626;
          --od-radius-sm: 8px;
          --od-radius-md: 12px;
          --od-radius-lg: 18px;
          --od-shadow-raised: 0 16px 40px rgba(23, 32, 51, 0.10);
          --od-focus-ring: 0 0 0 4px rgba(37, 99, 235, 0.22);
          background: var(--od-bg) !important;
          color: var(--od-fg) !important;
          font-family: Inter, system-ui, sans-serif;
          line-height: 1.5;
          letter-spacing: 0;
        }

        .theme-app .od-mobile-shell.bg-black,
        .theme-app .od-mobile-shell .bg-black,
        .theme-app .od-mobile-shell .bg-zinc-950,
        .theme-app .od-mobile-shell .bg-zinc-900,
        .theme-app .od-mobile-shell .bg-zinc-800,
        .theme-app .od-mobile-shell .bg-zinc-700,
        .theme-app .od-mobile-shell [class~="bg-zinc-950/85"],
        .theme-app .od-mobile-shell [class~="bg-zinc-950/75"],
        .theme-app .od-mobile-shell [class~="bg-zinc-950/70"],
        .theme-app .od-mobile-shell [class~="bg-zinc-950/50"] {
          background-color: var(--od-surface) !important;
        }

        .theme-app .od-mobile-shell header,
        .theme-app .od-mobile-shell nav {
          box-shadow: 0 1px 0 var(--od-border-soft);
        }

        .theme-app .od-mobile-shell nav {
          box-shadow: 0 -1px 0 var(--od-border-soft), 0 -14px 32px rgba(23, 32, 51, 0.06);
        }

        .theme-app .od-mobile-shell main {
          background: var(--od-bg) !important;
        }

        .theme-app .od-mobile-shell section > .rounded-lg,
        .theme-app .od-mobile-shell li.rounded-lg {
          border-radius: var(--od-radius-md) !important;
        }

        .theme-app .od-mobile-shell .border-zinc-900,
        .theme-app .od-mobile-shell .border-zinc-800,
        .theme-app .od-mobile-shell .border-zinc-700,
        .theme-app .od-mobile-shell [class~="border-zinc-600/60"] {
          border-color: var(--od-border) !important;
        }

        .theme-app .od-mobile-shell .border-dashed {
          border-color: var(--od-border) !important;
          background-color: rgba(255, 255, 255, 0.72) !important;
        }

        .theme-app .od-mobile-shell.text-white,
        .theme-app .od-mobile-shell .text-white,
        .theme-app .od-mobile-shell .text-zinc-100,
        .theme-app .od-mobile-shell .text-zinc-200,
        .theme-app .od-mobile-shell .text-zinc-300 {
          color: var(--od-fg) !important;
        }

        .theme-app .od-mobile-shell .text-zinc-400,
        .theme-app .od-mobile-shell .text-zinc-500,
        .theme-app .od-mobile-shell .text-zinc-600,
        .theme-app .od-mobile-shell .text-zinc-700 {
          color: var(--od-muted) !important;
        }

        .theme-app .od-mobile-shell .bg-blue-600,
        .theme-app .od-mobile-shell .hover\\:bg-blue-700:hover {
          background-color: var(--od-accent) !important;
          border-color: var(--od-accent) !important;
          color: var(--od-accent-on) !important;
        }

        .theme-app .od-mobile-shell .text-blue-100,
        .theme-app .od-mobile-shell .text-blue-200,
        .theme-app .od-mobile-shell .text-blue-300 {
          color: var(--od-accent) !important;
        }

        .theme-app .od-mobile-shell .bg-blue-400,
        .theme-app .od-mobile-shell .bg-blue-500,
        .theme-app .od-mobile-shell [class~="bg-blue-400/90"] {
          background-color: var(--od-accent) !important;
        }

        .theme-app .od-mobile-shell [class~="bg-blue-500/15"],
        .theme-app .od-mobile-shell [class~="bg-blue-500/10"],
        .theme-app .od-mobile-shell [class~="bg-blue-950/60"],
        .theme-app .od-mobile-shell .bg-blue-950 {
          background-color: rgba(37, 99, 235, 0.09) !important;
        }

        .theme-app .od-mobile-shell [class~="border-blue-500/45"],
        .theme-app .od-mobile-shell [class~="border-blue-500/35"],
        .theme-app .od-mobile-shell [class~="border-blue-500/30"],
        .theme-app .od-mobile-shell .border-blue-900 {
          border-color: rgba(37, 99, 235, 0.28) !important;
        }

        .theme-app .od-mobile-shell .text-green-200,
        .theme-app .od-mobile-shell .text-green-300,
        .theme-app .od-mobile-shell .text-emerald-200,
        .theme-app .od-mobile-shell .text-emerald-300 {
          color: #15803d !important;
        }

        .theme-app .od-mobile-shell .text-red-200,
        .theme-app .od-mobile-shell .text-red-300 {
          color: #b91c1c !important;
        }

        .theme-app .od-mobile-shell .text-amber-200,
        .theme-app .od-mobile-shell .text-amber-300 {
          color: #92400e !important;
        }

        .theme-app .od-mobile-shell .text-teal-200,
        .theme-app .od-mobile-shell .text-teal-300 {
          color: #0f766e !important;
        }

        .theme-app .od-mobile-shell .text-orange-300 { color: #c2410c !important; }
        .theme-app .od-mobile-shell .text-yellow-300 { color: #a16207 !important; }
        .theme-app .od-mobile-shell .text-lime-300 { color: #4d7c0f !important; }
        .theme-app .od-mobile-shell .text-cyan-300 { color: #0e7490 !important; }
        .theme-app .od-mobile-shell .text-sky-300 { color: #0369a1 !important; }
        .theme-app .od-mobile-shell .text-indigo-300 { color: #4338ca !important; }
        .theme-app .od-mobile-shell .text-violet-300 { color: #6d28d9 !important; }
        .theme-app .od-mobile-shell .text-purple-300 { color: #7e22ce !important; }
        .theme-app .od-mobile-shell .text-fuchsia-300 { color: #a21caf !important; }
        .theme-app .od-mobile-shell .text-pink-300 { color: #be185d !important; }
        .theme-app .od-mobile-shell .text-rose-300 { color: #be123c !important; }
        .theme-app .od-mobile-shell .text-stone-300 { color: #57534e !important; }
        .theme-app .od-mobile-shell .text-slate-300 { color: var(--od-fg-2) !important; }

        .theme-app .od-mobile-shell [class~="bg-green-500/10"],
        .theme-app .od-mobile-shell .bg-green-950 {
          background-color: rgba(22, 163, 74, 0.10) !important;
        }

        .theme-app .od-mobile-shell [class~="border-green-500/35"],
        .theme-app .od-mobile-shell [class~="border-green-500/30"],
        .theme-app .od-mobile-shell .border-green-900 {
          border-color: rgba(22, 163, 74, 0.28) !important;
        }

        .theme-app .od-mobile-shell [class~="bg-red-500/10"],
        .theme-app .od-mobile-shell [class~="bg-red-950/60"],
        .theme-app .od-mobile-shell .bg-red-950 {
          background-color: rgba(220, 38, 38, 0.09) !important;
        }

        .theme-app .od-mobile-shell [class~="border-red-500/35"],
        .theme-app .od-mobile-shell [class~="border-red-500/30"],
        .theme-app .od-mobile-shell .border-red-900 {
          border-color: rgba(220, 38, 38, 0.24) !important;
        }

        .theme-app .od-mobile-shell [class~="bg-amber-500/10"] {
          background-color: rgba(245, 158, 11, 0.12) !important;
        }

        .theme-app .od-mobile-shell [class~="border-amber-500/40"],
        .theme-app .od-mobile-shell [class~="border-amber-500/35"] {
          border-color: rgba(245, 158, 11, 0.30) !important;
        }

        .theme-app .od-mobile-shell [class~="bg-teal-500/10"] {
          background-color: rgba(20, 184, 166, 0.10) !important;
        }

        .theme-app .od-mobile-shell [class~="border-teal-500/30"] {
          border-color: rgba(20, 184, 166, 0.26) !important;
        }

        .theme-app .od-mobile-shell .bg-slate-800 {
          background-color: var(--od-border-soft) !important;
        }

        .theme-app .od-mobile-shell .border-slate-700 {
          border-color: var(--od-border) !important;
        }

        .theme-app .od-mobile-shell .od-mobile-brand {
          color: var(--od-fg) !important;
          letter-spacing: 0;
        }

        .theme-app .od-mobile-shell .od-mobile-brand-icon {
          background: var(--od-surface-warm);
          border-color: rgba(37, 99, 235, 0.18);
          box-shadow: 0 1px 0 rgba(23, 32, 51, 0.04);
        }

        .theme-app .od-mobile-shell .od-mobile-demo-badge {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.30);
          color: #92400e !important;
        }

        .theme-app .od-mobile-shell button:focus-visible,
        .theme-app .od-mobile-shell a:focus-visible {
          outline: none !important;
          box-shadow: var(--od-focus-ring);
        }


        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-enter { animation: fadeInUp 0.4s ease-out forwards; }

        /* Calendar: use the same enter animation language as the weekly view, but with a light stagger. */
        .calendar-grid-enter { opacity: 1; }
        .calendar-cell-enter {
          opacity: 0;
          animation: fadeInUp 0.35s ease-out forwards;
          will-change: transform, opacity;
        }

        @keyframes calOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes calModalIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .calendar-overlay-enter { animation: calOverlayIn 0.18s ease-out forwards; }
        .calendar-modal-enter { animation: calModalIn 0.22s ease-out forwards; will-change: transform, opacity; }

        @media (prefers-reduced-motion: reduce) {
          .animate-enter,
          .calendar-cell-enter,
          .calendar-overlay-enter,
          .calendar-modal-enter {
            animation: none !important;
          }
          .calendar-cell-enter {
            opacity: 1 !important;
            transform: none !important;
          }
        }

      `}</style>


        {/* Profile Popup */}
        {showProfilePopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
              className="od-responsive-dialog relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-xl sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-dialog-title"
            >
              <button
                onClick={() => setShowProfilePopup(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white"
                aria-label="Close"
              >
                <X size={20} />
              </button>

              <h2 id="profile-dialog-title" className="text-xl font-semibold mb-4 text-white">Profile</h2>

              {/* Sections */}
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="shrink-0 sm:w-32">
                  <div className="grid grid-cols-3 gap-1 sm:block sm:space-y-1">
                    <button
                      onClick={() => setProfileTab("account")}
                      className={`w-full px-2 py-2 text-center rounded-md text-sm font-medium transition-colors sm:px-3 sm:text-left ${profileTab === "account"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white"
                        }`}
                    >
                      Account
                    </button>
                    <button
                      onClick={() => setProfileTab("settings")}
                      className={`w-full px-2 py-2 text-center rounded-md text-sm font-medium transition-colors sm:px-3 sm:text-left ${profileTab === "settings"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white"
                        }`}
                    >
                      Settings
                    </button>
                    <button
                      onClick={() => setProfileTab("upgrade")}
                      className={`w-full px-2 py-2 text-center rounded-md text-sm font-medium transition-colors sm:px-3 sm:text-left ${profileTab === "upgrade"
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
                          Used across CanvasSync.
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
                              className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${plan.key === currentPlan
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
                            className={`text-xs px-2 py-1 rounded ${canvasBaseUrl
                              ? "bg-green-950 text-green-300 border border-green-900"
                              : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                              }`}
                          >
                            {canvasBaseUrl ? "Configured" : "Not configured"}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-zinc-500 space-y-1">
                          <div>
                            Base URL: <span className="text-zinc-300">{canvasBaseUrl || "--"}</span>
                          </div>
                          <div>
                            Current font:{" "}
                            <span className="text-zinc-300">
                              {FONT_OPTIONS[globalFont]?.label || FONT_OPTIONS.sans.label}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Canvas OAuth connection */}
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-2">
                          Canvas instance
                        </label>
                        <input
                          value={canvasBaseUrl}
                          readOnly
                          className="w-full bg-zinc-900 text-zinc-400 px-3 py-2 rounded border border-zinc-800"
                          placeholder="https://gatech.instructure.com"
                        />
                      </div>

                      <div className="flex gap-2 justify-end">
                        <button
                          disabled={canvasStatus === "Connecting..." || canvasStatus === "Fetching courses..."}
                          className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => connectCanvas()}
                        >
                          {canvasStatus === "Connecting..." || canvasStatus === "Fetching courses..." ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : null}
                          Reconnect with Canvas OAuth
                        </button>

                        <button
                          disabled={isDisconnectingCanvas}
                          className="inline-flex items-center gap-2 rounded bg-zinc-800 px-4 py-2 text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => disconnectCanvas()}
                        >
                          {isDisconnectingCanvas ? <Loader2 size={15} className="animate-spin" /> : null}
                          {isDisconnectingCanvas ? "Disconnecting..." : "Disconnect"}
                        </button>

                        <button
                          className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white"
                          onClick={() => setShowProfilePopup(false)}
                        >
                          Close
                        </button>
                      </div>

                      {!isDemoMode && (
                        <div className="mt-4 pt-4 border-t border-zinc-800">
                          <p className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wide">
                            Your data
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              disabled={isExportingData}
                              className="inline-flex items-center gap-2 rounded bg-zinc-800 px-3 py-2 text-sm text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => exportMyData()}
                            >
                              {isExportingData ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                              {isExportingData ? "Preparing export..." : "Export my data"}
                            </button>
                            <button
                              className="inline-flex items-center gap-2 rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-200 hover:bg-red-900"
                              onClick={() => deleteAllMyData()}
                            >
                              <Trash2 size={15} />
                              Delete all my data
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">
                            Export downloads your active CanvasSync account and course records as JSON, excluding secrets and operational logs. Delete removes active app data and stored Canvas credentials.
                          </p>
                        </div>
                      )}

                      {canvasStatus && (
                        <div
                          role={/failed|invalid|missing|couldn/i.test(canvasStatus) ? "alert" : "status"}
                          className={`mt-2 rounded border p-3 text-sm ${canvasStatus.includes("Connected")
                            ? "bg-green-950 text-green-300 border border-green-900"
                            : /warning/i.test(canvasStatus)
                              ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
                              : /failed|invalid|missing|couldn/i.test(canvasStatus)
                                ? "border-red-900 bg-red-950 text-red-300"
                                : /connecting|fetching/i.test(canvasStatus)
                                  ? "border-blue-900 bg-blue-950 text-blue-300"
                                  : "border-zinc-700 bg-zinc-800 text-zinc-300"
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



        {showDeleteDataConfirm && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
            <div
              className="od-responsive-dialog od-mobile-dialog-panel w-full max-w-sm rounded-xl border border-red-900 bg-zinc-900 p-5 shadow-2xl"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-data-title"
              aria-describedby="delete-data-description"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-950 text-red-300">
                  <AlertTriangle size={20} />
                </span>
                <div>
                  <h2 id="delete-data-title" className="text-lg font-semibold text-white">
                    Delete all CanvasSync data?
                  </h2>
                  <p id="delete-data-description" className="mt-1 text-sm leading-relaxed text-zinc-400">
                    This permanently deletes your stored profile, courses, assignments, announcements, extracted
                    course text, syllabus rules, and preferences. Stored Canvas credentials are removed and remote
                    revocation is attempted. This cannot be undone.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isDeletingData}
                  onClick={() => setShowDeleteDataConfirm(false)}
                  className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 disabled:opacity-50"
                >
                  Keep my data
                </button>
                <button
                  type="button"
                  disabled={isDeletingData}
                  onClick={() => void confirmDeleteAllMyData()}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeletingData ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {isDeletingData ? "Deleting..." : "Delete everything"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Demo intro — user must acknowledge before syncing */}
        {isDemoMode && showDemoIntro && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div
              className="od-responsive-dialog od-mobile-dialog-panel w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
              role="dialog"
              aria-labelledby="demo-intro-title"
              aria-modal="true"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-400/90">Demo mode</p>
              <h2 id="demo-intro-title" className="mt-2 text-xl font-semibold text-white">
                Welcome to the CanvasSync demo
              </h2>

              <ul className="mt-4 space-y-3 text-sm text-zinc-300 leading-relaxed">
                <li>
                  <span className="font-medium text-white">This is a demo.</span>{" "}
                  No Canvas login is required. The session uses temporary sample data.
                </li>
                <li>
                  <span className="font-medium text-white">Mock MATH 2552 data.</span>{" "}
                  The course includes a syllabus, schedule, and sample assignments rather than your Canvas account.
                </li>
                <li>
                  <span className="font-medium text-white">Real sync pipeline.</span>{" "}
                  Syncing runs the same course-text extraction and date-matching process used by the production app.
                </li>
              </ul>

              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleExitDemo}
                  className="px-4 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 text-sm font-medium hover:bg-zinc-800"
                >
                  Exit demo
                </button>
                <button
                  type="button"
                  onClick={handleDemoIntroOk}
                  className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upgrade Modal (large) */}
        {showUpgradeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div
              className="od-responsive-dialog od-mobile-dialog-panel relative max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="upgrade-dialog-title"
            >
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white"
                aria-label="Close"
              >
                <X size={20} />
              </button>

              <h3 id="upgrade-dialog-title" className="text-lg font-semibold text-white">Upgrade account</h3>
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
                    if (selectedPlanKey) {
                      setCurrentPlan(selectedPlanKey);
                      if (isMobileLayout) {
                        showMobileNotice({
                          tone: "success",
                          title: "Plan selection updated",
                          message: `${PLAN_OPTIONS[selectedPlanKey]?.name || "Selected plan"} is now shown as your current mock plan.`,
                        });
                      }
                    }
                    setShowUpgradeModal(false);
                  }}
                >
                  {selectedPlanKey === currentPlan ? "Keep current plan" : "Select plan"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile app shell */}
        <div className="od-mobile-shell flex min-h-0 flex-1 flex-col bg-black text-white md:hidden">
          <header className="shrink-0 border-b border-zinc-900 bg-zinc-950 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              {isDemoMode ? (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="od-mobile-brand flex min-w-0 items-center gap-2">
                    <span className="od-mobile-brand-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg border">
                      <img src="/canvassync-icon-48.png" width="20" height="20" alt="" aria-hidden="true" />
                    </span>
                    <span className="truncate text-base font-semibold">CanvasSync</span>
                  </span>
                  <span className="od-mobile-demo-badge rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                    Demo
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowLandingPage(true);
                    setShowSyncProgressPopover(false);
                    setShowProfilePopup(false);
                  }}
                  className="od-mobile-brand flex min-w-0 items-center gap-2"
                  aria-label="Open CanvasSync landing page"
                >
                  <span className="od-mobile-brand-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg border">
                    <img src="/canvassync-icon-48.png" width="20" height="20" alt="" aria-hidden="true" />
                  </span>
                  <span className="truncate text-base font-semibold">CanvasSync</span>
                </button>
              )}

              {isDemoMode ? (
                <button
                  type="button"
                  onClick={handleExitDemo}
                  className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200"
                >
                  Exit
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowSyncProgressPopover(false);
                    setShowProfilePopup(true);
                  }}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-zinc-800 bg-black text-zinc-300"
                  aria-label="Account options"
                >
                  <User size={18} />
                </button>
              )}
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-zinc-500">{mobileActiveEyebrow}</p>
                <h1 className="mt-0.5 truncate text-lg font-semibold text-zinc-100">{mobileActiveTitle}</h1>
              </div>
              <div className="shrink-0">
                {renderSyncToolbarControls()}
              </div>
            </div>
          </header>

          {showMobileSyncProgress ? (
            <section className="shrink-0 border-b border-zinc-900 bg-black px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate text-xs font-semibold ${mobileSyncComplete ? "text-green-300" : "text-zinc-300"}`}>
                    {mobileSyncPhaseLabel}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                    {mobileSyncDetailLabel}
                  </p>
                </div>
                <span className={`shrink-0 text-sm font-semibold ${mobileSyncComplete ? "text-green-300" : "text-blue-200"}`}>
                  {mobileSyncProgressPercent}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full border border-zinc-800 bg-zinc-950">
                <div
                  className={`h-full overflow-hidden transition-all duration-700 ease-out ${mobileSyncComplete ? "bg-green-400" : "od-mobile-progress-active bg-blue-400/90"}`}
                  style={{ width: `${mobileSyncProgressPercent}%` }}
                />
              </div>
            </section>
          ) : null}

          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
            {activeTab === "home" && renderMobileWeeklyView()}
            {activeTab === "calendar" && renderMobileCalendarView()}
            {activeTab === "classSettings" && renderMobileClassSettingsView()}
            {activeTab === "course" && renderMobileCourseView()}
            <LegalFooter className="px-0 py-5 text-[10px]" />
          </main>

          <nav className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-2 pb-2 pt-2">
            <div className="grid grid-cols-3 gap-1">
              {[
                { id: "home", label: "Week", Icon: List },
                { id: "calendar", label: "Calendar", Icon: Calendar },
                { id: "classSettings", label: "Classes", Icon: Settings2 },
              ].map(({ id, label, Icon }) => {
                const isActive = activeTab === id || (id === "classSettings" && activeTab === "course");
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg text-xs font-semibold transition-colors ${isActive
                      ? "bg-blue-600 text-white"
                      : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                      }`}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        {/* Top Bar with Profile */}
        <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-6 py-2 bg-zinc-950 border-b border-zinc-800 gap-3 md:grid">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-zinc-800 rounded text-zinc-400"
            >
              <Menu size={20} />
            </button>
            {isDemoMode ? (
              <div className="flex items-center gap-2">
                <BrandWordmark height={29} />
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300/90">
                  Demo
                </span>
              </div>
            ) : (
              <button
                onClick={() => {
                  setShowLandingPage(true);
                  setShowSyncProgressPopover(false);
                  setShowProfilePopup(false);
                }}
                className="flex items-center"
                aria-label="Open CanvasSync landing page"
                title="Open landing page"
              >
                <BrandWordmark height={29} />
              </button>
            )}
          </div>
          <div className="justify-self-center">
            {renderSyncToolbarControls()}
          </div>
          <div className="flex items-center gap-3 justify-self-end">
            <div ref={syncProgressCardRef} className="relative">
              {showSyncProgressPopover && (
                <div className="fixed inset-0 z-40" onClick={() => setShowSyncProgressPopover(false)} />
              )}

              <button
                onClick={() => setShowSyncProgressPopover((prev) => !prev)}
                className="relative z-50 w-[240px] max-w-[calc(100vw-8rem)] rounded-xl border border-zinc-700/70 bg-[#0b1020]/90 px-3.5 py-2.5 text-left shadow-[0_8px_24px_rgba(2,8,20,0.35)] transition-colors hover:bg-[#121c31]/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/70"
                title="Sync progress"
              >
                <div className="flex items-center justify-between gap-2 leading-none">
                  <span className="text-[11px] font-semibold uppercase text-zinc-200">Sync</span>
                  <span className="text-sm font-semibold text-blue-200">{syncProgressDisplayPercent}%</span>
                </div>

                <div className="relative mt-2 h-2.5 rounded-full overflow-hidden border border-zinc-700/80 bg-zinc-950/80">
                  <div
                    className="h-full bg-blue-400/90 transition-all duration-300"
                    style={{ width: `${syncProgressDisplayPercent}%` }}
                  />
                </div>
              </button>

              {showSyncProgressPopover && (
                <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-zinc-700/70 bg-[#0b1020]/95 p-3.5 shadow-2xl backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-zinc-100">Sync Progress</span>
                    <span className="text-base font-semibold text-blue-200">{syncProgressDisplayPercent}%</span>
                  </div>

                  <div className="relative mt-2.5 h-2.5 rounded-full overflow-hidden border border-zinc-700/80 bg-zinc-950/80">
                    <div
                      className="h-full bg-blue-400/90 transition-all duration-300"
                      style={{ width: `${syncProgressDisplayPercent}%` }}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
                      <p className="text-zinc-500">Current</p>
                      <p className="mt-1 truncate font-medium text-zinc-100">{activeSyncCourseLabel}</p>
                    </div>
                    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
                      <p className="text-zinc-500">Phase</p>
                      <p className="mt-1 truncate font-medium text-blue-200">{activeSyncPhase}</p>
                    </div>
                    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
                      <p className="text-zinc-500">Run</p>
                      <p className="mt-1 font-medium text-zinc-100">{syncProgressLabel}</p>
                    </div>
                    <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
                      <p className="text-zinc-500">Elapsed</p>
                      <p className="mt-1 font-medium text-zinc-100">{syncElapsedLabel || "Idle"}</p>
                    </div>
                  </div>

                  <div className="mt-2.5 space-y-1 text-xs">
                    <p className="text-zinc-400">Queue: {syncWaitingCount} waiting</p>
                    <p className="text-zinc-400">Last sync: {lastSyncLabel}</p>
                  </div>

                  {visibleSyncWarnings.length > 0 ? (
                    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                      <p className="font-medium">Warnings</p>
                      <div className="mt-1 space-y-1 text-amber-100/85">
                        {visibleSyncWarnings.slice(0, 2).map((warning) => (
                          <p key={`${warning.courseLabel}-${warning.message}`}>
                            {warning.courseLabel}: {warning.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {isDemoMode ? (
              <button
                type="button"
                onClick={handleExitDemo}
                className="shrink-0 px-3 py-1.5 rounded-md border border-zinc-600 bg-zinc-900 text-sm font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors"
                title="Leave demo and return to the home page"
              >
                Exit demo
              </button>
            ) : null}
          </div>
        </div>

        <div className="hidden flex-1 overflow-hidden md:flex">
          {/* SIDEBAR */}
          {!sidebarCollapsed && (
            <aside className="w-[230px] border-r border-zinc-900 bg-black flex flex-col min-h-0">
              <div className="px-4 py-4 border-b border-zinc-800 shrink-0">
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Navigation</h2>
              </div>

              <div className="p-2 space-y-1 shrink-0">
                <button
                  onClick={() => setActiveTab("home")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "home"
                    ? "bg-blue-600 text-white"
                    : "bg-transparent hover:bg-zinc-900 text-zinc-400"
                    }`}
                >
                  <List size={18} />
                  Weekly
                </button>

                <button
                  onClick={() => setActiveTab("calendar")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "calendar"
                    ? "bg-blue-600 text-white"
                    : "bg-transparent hover:bg-zinc-900 text-zinc-400"
                    }`}
                >
                  <Calendar size={18} />
                  Calendar
                </button>

                <button
                  onClick={() => setActiveTab("classSettings")}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "classSettings"
                    ? "bg-blue-600 text-white"
                    : "bg-transparent hover:bg-zinc-900 text-zinc-400"
                    }`}
                >
                  <Settings2 size={18} />
                  Class Settings
                </button>
              </div>

              {/* Ad slot: extends from below nav up to Account Options, fills available space */}
              <div style={{ flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column', padding: '12px', borderTop: '1px solid #27272a' }}>
                <div style={{ flex: 1, minHeight: 180, borderRadius: 8, border: '1px solid #52525b', backgroundColor: '#27272a', position: 'relative', overflow: 'hidden' }}>
                  <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#71717a', userSelect: 'none' }}>
                    Ad
                  </span>
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 12, color: '#e4e4e7', fontWeight: 500, userSelect: 'none' }}>Advertisement</span>
                  </div>
                </div>
              </div>

              <div style={{ flexShrink: 0 }}>
                <div className="px-4 py-4 border-t border-zinc-900">
                  <button
                    onClick={() => {
                      setShowSyncProgressPopover(false);
                      setShowProfilePopup(true);
                    }}
                    className="w-full flex items-center justify-start gap-2 px-3 py-2 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
                  >
                    <User size={16} />
                    <span>Account Options</span>
                  </button>
                </div>
              </div>
            </aside>
          )}

          {/* MAIN */}
          <main className="flex-1 flex flex-col overflow-hidden bg-black">
            {activeTab === "home" && (
              <div className="flex-1 flex flex-col overflow-hidden animate-enter">
                {/* Toolbar Strip with Navigation, Filter and Color Dropdowns */}
                <div className="h-11 grid grid-cols-[minmax(0,1fr)_auto] items-center px-6 border-b border-zinc-800 bg-zinc-900/50 gap-3">
                  {/* Week Navigation */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => navigateWeek(-1)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400"><ChevronLeft size={18} /></button>
                    <span className="text-sm font-medium text-zinc-300 w-40 text-center">
                      {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <button onClick={() => navigateWeek(1)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400"><ChevronRight size={18} /></button>
                    <button onClick={() => setCurrentWeekStart(new Date())} className="ml-1 text-xs px-2 py-1 bg-blue-900/30 text-blue-300 border border-blue-900 rounded hover:bg-blue-900/50">Today</button>
                  </div>

                  {/* Color and Filter Controls */}
                  <div className="flex items-center gap-3 justify-self-end">
                    {/* Color Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowColorDropdown(!showColorDropdown)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${showColorDropdown ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
                      >
                        <Palette size={16} />
                        <span>Colors</span>
                      </button>

                      {showColorDropdown && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => { setShowColorDropdown(false); setShowColorPicker(null); }} />
                          <div className="absolute right-0 top-full mt-1 bg-zinc-900 rounded-lg shadow-xl border border-zinc-800 z-50 py-2 overflow-visible">
                            <div className="px-3 py-1.5 border-b border-zinc-800 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                              Course Colors
                            </div>
                            <div className="px-3 pb-2 space-y-1">
                              {syncedCourseList.map(course => (
                                <div key={course.id} className="relative">
                                  <button
                                    onClick={() => setShowColorPicker(showColorPicker === course.id ? null : course.id)}
                                    className={`w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded transition-colors ${showColorPicker === course.id ? 'bg-zinc-700 ring-1 ring-zinc-500' : 'hover:bg-zinc-800'}`}
                                  >
                                    <span className="text-xs text-zinc-300 truncate text-left" title={course.name}>
                                      {course.name}
                                    </span>
                                    <div
                                      className={`w-4 h-4 rounded-full shrink-0 ring-1 ring-zinc-600 ${getCourseColorClasses(getEffectiveCourseColor(course.id, course.courseCode, course.name)).dot}`}
                                    />
                                  </button>
                                  {showColorPicker === course.id && (
                                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-zinc-800 rounded-lg shadow-xl border border-zinc-700 z-50 p-2">
                                      <div className="grid grid-cols-3 gap-1.5 w-[72px]">
                                        {COURSE_COLOR_PALETTE.map(color => (
                                          <button
                                            key={color.hex}
                                            onClick={() => { setCourseColor(course.id, color.hex); setShowColorPicker(null); }}
                                            className={`w-5 h-5 rounded-full transition-all hover:scale-110 ${getCourseColorClasses(color.hex).dot} ${getEffectiveCourseColor(course.id, course.courseCode, course.name) === color.hex ? 'ring-2 ring-white scale-110' : 'hover:ring-1 hover:ring-zinc-400'}`}
                                            title={color.name}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                              {syncedCourseList.length === 0 && (
                                <p className="text-xs text-zinc-500 px-2 py-1">No synced courses</p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Filter Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${showFilterDropdown ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
                      >
                        <Filter size={16} />
                        <span>Filter</span>
                      </button>

                      {showFilterDropdown && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowFilterDropdown(false)} />
                          <div className="absolute right-0 top-full mt-1 w-44 bg-zinc-900 rounded-lg shadow-xl border border-zinc-800 z-50 py-1">
                            <div className="px-3 py-1.5 border-b border-zinc-800 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                              Categories
                            </div>
                            {Object.keys(weeklyFilters).map(cat => (
                              <button
                                key={cat}
                                onClick={() => toggleFilter(cat)}
                                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 flex items-center justify-between"
                              >
                                <span>{cat}</span>
                                {weeklyFilters[cat] && <CheckCircle2 size={12} className="text-blue-500" />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <section className="flex-1 overflow-hidden bg-black">
                  <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-5">
                    <div className="mb-4 flex flex-col gap-3 border-b border-zinc-900 pb-4 md:flex-row md:items-end md:justify-between">
                      <div>
                        <h1 className="text-xl font-semibold text-zinc-100">This week</h1>
                        <p className="mt-1 text-sm text-zinc-500">
                          {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                      </div>

                      <div className="w-full max-w-sm">
                        <div className="mb-1.5 flex items-center justify-between text-xs">
                          <span className="text-zinc-400">{completedThisWeek} of {weekItems.length} complete</span>
                          <span className={progressPercent === 100 ? "font-semibold text-green-300" : "font-semibold text-blue-300"}>{Math.round(progressPercent)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full border border-zinc-800 bg-zinc-950">
                          <div
                            className={`h-full transition-all duration-300 ${progressPercent === 100 ? "bg-green-500" : "bg-blue-500"}`}
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                      {weekItems.length === 0 ? (
                        <div className="grid h-full place-items-center">
                          <div className="max-w-md rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 px-6 py-8 text-center">
                            <p className="text-base font-medium text-zinc-200">No dated assignments this week.</p>
                            <p className="mt-2 text-sm text-zinc-500">
                              {selectedSyncCourseCount > 0
                                ? "Synced courses with due dates will appear here after the next refresh."
                                : "Select classes in Class Settings, then run Sync to build your timeline."}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-5 pb-6">
                          {Object.entries(itemsByDay).map(([dayName, dayData]) => {
                            if (dayData.items.length === 0) return null;
                            const dayCue = getDayLabel(dayData.date);
                            const isToday = isSameDay(dayData.date, new Date());

                            return (
                              <section key={dayName} aria-label={dayName}>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="flex items-baseline gap-2">
                                    <h2 className={`text-sm font-semibold ${isToday ? "text-blue-300" : "text-zinc-300"}`}>{dayName}</h2>
                                    <span className="text-xs text-zinc-600">
                                      {dayData.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                    {dayCue ? (
                                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${dayCue === "Past due" ? "border-red-500/35 bg-red-500/10 text-red-200" : dayCue === "Today" ? "border-blue-500/35 bg-blue-500/10 text-blue-200" : "border-amber-500/35 bg-amber-500/10 text-amber-200"}`}>
                                        {dayCue}
                                      </span>
                                    ) : null}
                                  </div>
                                  <span className="text-xs text-zinc-600">{dayData.items.length} due</span>
                                </div>

                                <ul className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70">
                                  {dayData.items.map((item) => {
                                    const isCompleted = isItemCompleted(item);
                                    const deadlineMeta = getDeadlineMeta(item, isCompleted);
                                    const titleClass = isCompleted
                                      ? "text-zinc-500 line-through decoration-zinc-600"
                                      : deadlineMeta.label === "Overdue"
                                        ? "text-zinc-100"
                                        : "text-zinc-200";

                                    return (
                                      <li key={item.id} className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-800/70 px-3.5 py-2.5 last:border-b-0 transition-colors hover:bg-zinc-900/70 ${isCompleted ? "bg-zinc-950/30" : ""}`}>
                                        <button
                                          type="button"
                                          onClick={() => toggleComplete(item)}
                                          aria-label={isCompleted ? `Mark ${item.name} incomplete` : `Mark ${item.name} complete`}
                                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500/70 ${isCompleted ? "text-green-400" : "text-zinc-500 hover:text-zinc-100"}`}
                                        >
                                          {isCompleted ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                                        </button>

                                        <div className="min-w-0">
                                          <div className="flex min-w-0 items-center gap-2">
                                            <span className={`truncate text-sm font-medium ${titleClass}`}>{item.name}</span>
                                          </div>
                                          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                                            <span
                                              className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${getCourseColorClasses(getEffectiveCourseColor(item.courseId, item.courseCode, item.courseName)).tag}`}
                                            >
                                              {item.courseCode ? item.courseCode.toUpperCase() : "UNK"}
                                            </span>
                                            {getCategoryBadge(item.category, "text-[11px] px-1.5")}
                                            <SourceStatusPills item={item} size="xs" limit={3} />
                                          </div>
                                        </div>

                                        <div className="flex min-w-[86px] shrink-0 flex-col items-end gap-1 text-right">
                                          <span className={`text-sm font-semibold tabular-nums ${deadlineMeta.tone}`}>
                                            {formatDueTimeInCourseTZ(item.due)}
                                          </span>
                                          {deadlineMeta.label ? (
                                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${deadlineMeta.pill}`}>
                                              {deadlineMeta.label}
                                            </span>
                                          ) : null}
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </section>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "calendar" && (
              <div className="flex-1 flex flex-col overflow-hidden animate-enter">
                {/* Toolbar Strip with Navigation, Filter and Color Dropdowns */}
                <div className="h-11 grid grid-cols-[minmax(0,1fr)_auto] items-center px-6 border-b border-zinc-800 bg-zinc-900/50 gap-3">
                  {/* Month Navigation */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => navigateMonth(-1)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400"><ChevronLeft size={18} /></button>
                    <span className="text-sm font-medium text-zinc-300 w-36 text-center">
                      {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <button onClick={() => navigateMonth(1)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400"><ChevronRight size={18} /></button>
                    <button onClick={() => setCurrentMonth(new Date())} className="ml-1 text-xs px-2 py-1 bg-blue-900/30 text-blue-300 border border-blue-900 rounded hover:bg-blue-900/50">Today</button>
                  </div>

                  {/* Color and Filter Controls */}
                  <div className="flex items-center gap-3 justify-self-end">
                    {/* Color Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowColorDropdown(!showColorDropdown)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${showColorDropdown ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
                      >
                        <Palette size={16} />
                        <span>Colors</span>
                      </button>

                      {showColorDropdown && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => { setShowColorDropdown(false); setShowColorPicker(null); }} />
                          <div className="absolute right-0 top-full mt-1 bg-zinc-900 rounded-lg shadow-xl border border-zinc-800 z-50 py-2 overflow-visible">
                            <div className="px-3 py-1.5 border-b border-zinc-800 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                              Course Colors
                            </div>
                            <div className="px-3 pb-2 space-y-1">
                              {syncedCourseList.map(course => (
                                <div key={course.id} className="relative">
                                  <button
                                    onClick={() => setShowColorPicker(showColorPicker === course.id ? null : course.id)}
                                    className={`w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded transition-colors ${showColorPicker === course.id ? 'bg-zinc-700 ring-1 ring-zinc-500' : 'hover:bg-zinc-800'}`}
                                  >
                                    <span className="text-xs text-zinc-300 truncate text-left" title={course.name}>
                                      {course.name}
                                    </span>
                                    <div
                                      className={`w-4 h-4 rounded-full shrink-0 ring-1 ring-zinc-600 ${getCourseColorClasses(getEffectiveCourseColor(course.id, course.courseCode, course.name)).dot}`}
                                    />
                                  </button>
                                  {showColorPicker === course.id && (
                                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-zinc-800 rounded-lg shadow-xl border border-zinc-700 z-50 p-2">
                                      <div className="grid grid-cols-3 gap-1.5 w-[72px]">
                                        {COURSE_COLOR_PALETTE.map(color => (
                                          <button
                                            key={color.hex}
                                            onClick={() => { setCourseColor(course.id, color.hex); setShowColorPicker(null); }}
                                            className={`w-5 h-5 rounded-full transition-all hover:scale-110 ${getCourseColorClasses(color.hex).dot} ${getEffectiveCourseColor(course.id, course.courseCode, course.name) === color.hex ? 'ring-2 ring-white scale-110' : 'hover:ring-1 hover:ring-zinc-400'}`}
                                            title={color.name}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                              {syncedCourseList.length === 0 && (
                                <p className="text-xs text-zinc-500 px-2 py-1">No synced courses</p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Filter Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${showFilterDropdown ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
                      >
                        <Filter size={16} />
                        <span>Filter</span>
                      </button>

                      {showFilterDropdown && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowFilterDropdown(false)} />
                          <div className="absolute right-0 top-full mt-1 w-44 bg-zinc-900 rounded-lg shadow-xl border border-zinc-800 z-50 py-1">
                            <div className="px-3 py-1.5 border-b border-zinc-800 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                              Categories
                            </div>
                            {Object.keys(weeklyFilters).map(cat => (
                              <button
                                key={cat}
                                onClick={() => toggleFilter(cat)}
                                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 flex items-center justify-between"
                              >
                                <span>{cat}</span>
                                {weeklyFilters[cat] && <CheckCircle2 size={12} className="text-blue-500" />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 p-6 overflow-hidden flex flex-col min-h-0 relative">
                  {(() => {
                    const { dates, rows } = getMonthDates(currentMonth);
                    const monthKey = `${currentMonth.getFullYear()}-${currentMonth.getMonth()}`;
                    return (
                      <>
                        <div
                          key={monthKey}
                          className={`grid grid-cols-7 rounded-lg overflow-hidden flex-1 min-h-0 gap-px bg-zinc-900 border border-zinc-900 calendar-grid-enter ${getMonthGridRowsClass(rows)}`}
                        >
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                            <div
                              key={day}
                              className="bg-zinc-950 py-2 text-center text-xs font-semibold text-zinc-500 uppercase tracking-wider shrink-0"
                            >
                              {day}
                            </div>
                          ))}

                          {dates.map(({ date, isCurrentMonth }, idx) => {
                            const items = getItemsForDate(date);
                            const isToday = isSameDay(date, new Date());
                            const isMutedMonth = !isCurrentMonth;
                            const isSelected = zoomedDate && isSameDay(date, zoomedDate);

                            return (
                              <div
                                key={idx}
                                onClick={() => {
                                  if (isSelected) {
                                    setZoomedDate(null);
                                  } else {
                                    setZoomedDate(date);
                                  }
                                }}
                                style={{ animationDelay: `${idx * 8}ms` }}
                                className={`calendar-cell-enter p-1.5 relative flex flex-col gap-0.5 transition-colors cursor-pointer overflow-hidden ${isSelected
                                  ? 'bg-blue-950/30 ring-1 ring-blue-500/50 ring-inset z-10'
                                  : isMutedMonth
                                    ? 'bg-zinc-950 hover:bg-zinc-900'
                                    : 'bg-black hover:bg-zinc-900'
                                  }`}
                              >
                                <span className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full shrink-0 ${isToday
                                  ? 'bg-blue-600 text-white'
                                  : isMutedMonth
                                    ? 'text-zinc-600'
                                    : 'text-zinc-500'
                                  }`}>
                                  {date.getDate()}
                                </span>

                                <div className="flex-1 min-h-0 overflow-y-auto space-y-1 custom-scrollbar">
                                  {items.length > 0 ? (
                                    items.slice(0, 4).map((item, itemIdx) => (
                                      <div
                                        key={itemIdx}
                                        className={`px-1.5 py-1 rounded text-[10px] leading-tight truncate border border-transparent border-l-4 hover:border-zinc-700 bg-zinc-800 text-zinc-200 flex items-center gap-1 ${getCourseColorClasses(getEffectiveCourseColor(item.courseId, item.courseCode, item.courseName)).accent}`}
                                        title={item.name}
                                      >
                                        <span className="font-bold opacity-75">{item.courseCode}</span>
                                        <span className="truncate">{item.name}</span>
                                      </div>
                                    ))
                                  ) : null}
                                  {items.length > 4 && (
                                    <div className={`text-[10px] pl-1 ${isMutedMonth ? 'text-zinc-600' : 'text-zinc-500'}`}>
                                      + {items.length - 4} more
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Floating Expanded Cell */}
                        {zoomedDate && (() => {
                          return (
                            <>
                              <div className="fixed inset-0 z-40 bg-black/30 calendar-overlay-enter" onClick={() => setZoomedDate(null)} />
                              <div className="fixed inset-0 z-50 flex items-center justify-center p-3 pointer-events-none">
                                <div
                                  className="pointer-events-auto bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl p-3 w-[250px] max-h-[320px] flex flex-col calendar-modal-enter"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Header */}
                                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-800">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full ${isSameDay(zoomedDate, new Date()) ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
                                        {zoomedDate.getDate()}
                                      </span>
                                      <span className="text-xs text-zinc-400">
                                        {zoomedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short' })}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() => setZoomedDate(null)}
                                      className="p-1 text-zinc-500 hover:text-white rounded hover:bg-zinc-800 transition-colors"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>

                                  {/* Items - same style as calendar cells */}
                                  <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar">
                                    {getItemsForDate(zoomedDate).length === 0 ? (
                                      <p className="text-center text-zinc-500 py-4 text-xs">No events</p>
                                    ) : (
                                      getItemsForDate(zoomedDate).map((item, itemIdx) => (
                                        <div
                                          key={itemIdx}
                                          className={`rounded border border-transparent border-l-4 bg-zinc-800 px-2 py-1.5 text-xs leading-tight text-zinc-200 hover:border-zinc-600 ${getCourseColorClasses(getEffectiveCourseColor(item.courseId, item.courseCode, item.courseName)).accent}`}
                                        >
                                          <div className="flex items-center gap-1.5">
                                            <span className="shrink-0 font-bold opacity-75">{item.courseCode}</span>
                                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                            <span className="shrink-0 text-[10px] text-zinc-500">
                                              {formatDueTimeInCourseTZ(item.due)}
                                            </span>
                                          </div>
                                          <SourceStatusPills item={item} size="xs" limit={2} className="mt-1" />
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {activeTab === "classSettings" && (
              <div className="flex-1 overflow-y-auto p-6 animate-enter">
                <div className="max-w-5xl mx-auto">
                  {!isEditingSyncClasses ? (
                    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h2 className="text-2xl font-semibold text-white">Class Settings</h2>
                          <p className="mt-2 text-base text-zinc-400">
                            {selectedSyncCourseCount > 0
                              ? `${selectedSyncCourseCount} classes selected for Sync / Resync.`
                              : "No classes selected yet. Select courses to configure sync."}
                          </p>
                        </div>

                        <button
                          onClick={startEditingSyncClasses}
                          className={`shrink-0 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-wide ${selectedSyncCourseCount === 0 ? "w-full md:w-auto px-8 py-4 text-base" : "px-8 py-4 text-sm"
                            }`}
                        >
                          {selectedSyncCourseCount === 0 ? "SELECT COURSES" : "EDIT SELECTED CLASSES"}
                        </button>
                      </div>

                      <div className="mt-6 space-y-3">
                        {syncEnabledCourseList.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-6 text-base text-zinc-500">
                            Your selected classes will appear here.
                          </div>
                        ) : (
                          syncEnabledCourseList.map((course) => (
                            <div
                              key={course.id}
                              className={`rounded-xl border px-4 py-3.5 flex items-center justify-between gap-4 transition-colors ${course.isCurrentlyActive
                                ? "border-zinc-700 bg-zinc-900"
                                : "border-zinc-900 bg-zinc-950/90 opacity-65"
                                }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`min-w-0 flex items-baseline gap-2 font-notebook text-lg tracking-wide ${course.isCurrentlyActive ? "text-zinc-200" : "text-zinc-500"}`}>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide shrink-0 ${getCourseColorClasses(getEffectiveCourseColor(course.id, course.courseCode, course.name)).tag}`}
                                  >
                                    {(course.courseCode || "UNK").toUpperCase()}
                                  </span>
                                  <span className="truncate">{course.name}</span>
                                </div>
                              </div>

                              <button
                                onClick={() => {
                                  setSelectedCourseId(course.id);
                                  setActiveTab("course");
                                }}
                                className="px-3 py-1.5 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                              >
                                Open
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </section>
                  ) : (
                    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h3 className="text-2xl font-semibold text-white">Select Classes</h3>
                          <p className="mt-2 text-base text-zinc-400">
                            Choose classes to sync. Active classes are intentionally brighter; inactive classes are visually muted.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 self-start md:self-auto">
                          <span className="text-sm text-zinc-400 mr-1">{draftSelectedCount} selected</span>
                          <button
                            onClick={cancelEditingSyncClasses}
                            className="px-4 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 text-sm"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={completeEditingSyncClasses}
                            className="px-5 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold uppercase tracking-wide"
                          >
                            Complete
                          </button>
                        </div>
                      </div>

                      <div className="mt-6 max-h-[520px] overflow-y-auto space-y-2 pr-1">
                        {allCourseList.length === 0 ? (
                          <p className="text-base text-zinc-500 italic">No classes available.</p>
                        ) : (
                          allCourseList.map((course) => {
                            const isSelected = !!syncEnabledDraft[normalizeCourseId(course.id)];
                            const isActive = !!course.isCurrentlyActive;
                            return (
                              <button
                                key={course.id}
                                onClick={() => toggleSyncCourseInDraft(course.id)}
                                className={`w-full rounded-xl border px-4 py-3.5 flex items-center justify-between gap-4 text-left transition-colors ${isSelected
                                  ? "border-blue-700 bg-blue-950/25"
                                  : isActive
                                    ? "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
                                    : "border-zinc-900 bg-zinc-950/90 hover:bg-zinc-900/80 opacity-75"
                                  }`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  {isSelected ? (
                                    <CheckCircle2 size={20} className="text-blue-400 shrink-0" />
                                  ) : (
                                    <Circle size={20} className={`${isActive ? "text-zinc-400" : "text-zinc-700"} shrink-0`} />
                                  )}
                                  <div className={`min-w-0 flex items-baseline gap-2 font-notebook text-lg tracking-wide ${isActive ? "text-zinc-200" : "text-zinc-500"}`}>
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide shrink-0 ${getCourseColorClasses(getEffectiveCourseColor(course.id, course.courseCode, course.name)).tag}`}
                                    >
                                      {(course.courseCode || "UNK").toUpperCase()}
                                    </span>
                                    <span className="truncate">{course.name}</span>
                                  </div>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>

                    </section>
                  )}
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
                      className={`mb-4 p-3 rounded-lg text-sm font-medium ${String(currentSyncStatus).toLowerCase().includes("complete")
                        ? "bg-green-950 text-green-300 border border-green-900"
                        : String(currentSyncStatus).toLowerCase().includes("fail")
                          ? "bg-red-950 text-red-300 border border-red-900"
                          : "bg-blue-950 text-blue-300 border border-blue-900"
                        }`}
                    >
                      {currentSyncStatus}
                    </div>
                  )}

                  <div className="bg-zinc-950 rounded-lg shadow-lg border border-zinc-800 p-5">
                    {selectedCourse && !selectedCourseIsSynced ? (
                      <div className="text-center py-8">
                        <p className="text-zinc-400 mb-4">
                          This class has not been synced yet. Add it in Class Settings, then run Sync / Resync from the toolbar.
                        </p>
                        <button
                          onClick={() => setActiveTab("classSettings")}
                          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                        >
                          Open Class Settings
                        </button>
                      </div>
                    ) : courseItems.length === 0 ? (
                      <p className="text-sm text-zinc-500 text-center py-8">
                        No course items synced yet. Run Sync / Resync from the toolbar to load assignments and readings.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-zinc-800 bg-black">
                            <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Item</th>
                            <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Category</th>
                            <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Due Date</th>
                            <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Source</th>
                          </tr>
                        </thead>

                        <tbody>
                          {sortedCourseItems.map((a, idx) => {
                            return (
                              <tr key={`${a.name}-${idx}`} className="border-b border-zinc-800 hover:bg-black transition-colors">
                                <td className="py-2 px-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white">{a.name}</span>
                                  </div>
                                </td>

                                <td className="py-2 px-2">
                                  {getCategoryBadge(a.category)}
                                </td>

                                <td
                                  className={`py-2 px-2 ${a.status === "CONFLICT" ? "text-red-400 font-medium" : "text-zinc-400"
                                    }`}
                                >
                                  {a.due ? (
                                    a.status === "RESOLVED"
                                      ? formatDueInCourseTZ(a.due)
                                      : formatDateOnly(a.due)
                                  ) : (
                                    <span className="opacity-30">--</span>
                                  )}
                                </td>

                                <td className="py-2 px-2">
                                  <SourceStatusPills item={a} size="xs" limit={3} />
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

        <LegalFooter className="hidden shrink-0 md:block" />
      </div>
    </>
  );
}

export default App;
