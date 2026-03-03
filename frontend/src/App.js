import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Calendar, List, CheckCircle2, Circle, User, X, Menu, Filter, Palette, Settings2 } from "lucide-react";
import { signInWithGoogle, logout, onAuthChange, getAuthToken, completeRedirectSignIn } from './firebase';
import { sileo, Toaster } from "sileo";
import "sileo/styles.css";

// API Base URL - required in production to avoid hardcoded fallback pointing at wrong project
const API_BASE = (() => {
  const url = process.env.REACT_APP_API_URL?.trim();
  if (process.env.NODE_ENV === 'production' && !url) {
    throw new Error('REACT_APP_API_URL is required for production builds. Set it in your build environment.');
  }
  return url || 'https://canvas-organizer-backend-93870731079.us-central1.run.app';
})();
const BRAND_LOGO_SRC = process.env.REACT_APP_BRAND_LOGO_SRC || `${process.env.PUBLIC_URL || ''}/canvassync-logo-v2.png`;

const COURSE_TIMEZONE = "America/New_York";

async function fetchWithTimeout(resource, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...(options || {}), signal: controller.signal });
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

function formatShortDueInCourseTZ(dueStr) {
  const dt = parseDueToDate(dueStr);
  if (!dt) return "--";
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

function isAIDiscoveredItem(item) {
  const status = String(item?.status || "").trim().toUpperCase();
  if (status === "DISCOVERED") return true;

  const discoveredKey = extractDiscoveredKeyFromItem(item);
  if (discoveredKey) return true;

  const sourceOfTruth = String(item?.sourceOfTruth ?? item?.source_of_truth ?? "").trim().toLowerCase();
  if (sourceOfTruth.includes("schedule")) return true;

  return false;
}

function getAIIndicatorMeta(item) {
  const status = String(item?.status || "").trim().toUpperCase();
  const discovered = isAIDiscoveredItem(item);
  const resolved = status === "RESOLVED";

  if (discovered && resolved) {
    return {
      kind: "both",
      tooltip: "Found + date enhanced by AI",
      toneClass: "text-teal-300",
    };
  }
  if (discovered) {
    return {
      kind: "discovered",
      tooltip: "Assignment found by AI",
      toneClass: "text-sky-300",
    };
  }
  if (resolved) {
    return {
      kind: "resolved",
      tooltip: "Date enhanced by AI",
      toneClass: "text-amber-300",
    };
  }
  return null;
}

// Icons sourced from Material Symbols (filled SVG paths) for a compact AI marker style.
const AI_DISCOVERED_ICON_PATH = "M11.95 17.55L8.8 11.3 2.55 8.15 8.8 5l3.15-6.25L15.1 5l6.25 3.15-6.25 3.15Zm0-2.6L14.45 10l4.95-2.5-4.95-2.5L11.95.05 9.45 5 4.5 7.5 9.45 10Zm0-7.45Zm5.6 17.85L15.95 22l-3.4-1.7 3.4-1.7 1.7-3.4 1.7 3.4 3.4 1.7-3.4 1.7Z";
const AI_RESOLVED_ICON_PATH = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

function AIIndicatorGlyph({ kind = "discovered" }) {
  const d = kind === "resolved" ? AI_RESOLVED_ICON_PATH : AI_DISCOVERED_ICON_PATH;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-full w-full">
      <path d={d} />
    </svg>
  );
}

function AIDiscoveredIndicator({ item, size = 12, className = "", showTooltip = true }) {
  const meta = getAIIndicatorMeta(item);
  if (!meta) return null;
  const iconSize = typeof size === "number" ? `${size}px` : size;

  return (
    <span
      className={`group relative inline-grid shrink-0 place-items-center align-middle leading-none ${className}`}
      aria-label={meta.tooltip}
      style={{ width: iconSize, height: iconSize }}
    >
      <span className={`inline-grid h-full w-full place-items-center ${meta.toneClass}`}>
        <AIIndicatorGlyph kind={meta.kind} />
      </span>
      {showTooltip && (
        <span className="pointer-events-none absolute left-1/2 top-[calc(100%+2px)] z-[60] -translate-x-1/2 whitespace-nowrap rounded-sm border border-zinc-700 bg-zinc-950 px-1 py-[1px] text-[8px] font-medium leading-tight text-zinc-200 opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100">
          {meta.tooltip}
        </span>
      )}
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

function clearSavedCourseSyncState(baseUrl = "", token = "") {
  const scopedKey = buildCourseSyncStateKey(baseUrl, token);
  localStorage.removeItem(scopedKey);
  localStorage.removeItem(LEGACY_COURSE_SYNC_STATE_KEY);
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

function clearSavedCompletedItems(userId = "", baseUrl = "", token = "") {
  const key = buildCompletedItemsKey(userId, baseUrl, token);
  localStorage.removeItem(key);
  const tokenHash = hashScopeToken(token);
  if (tokenHash) {
    const tokenlessKey = buildCompletedItemsKey(userId, baseUrl, "");
    if (tokenlessKey !== key) localStorage.removeItem(tokenlessKey);
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

function clearSavedCoursesCache(userId = "", baseUrl = "") {
  const key = buildCoursesCacheKey(userId, baseUrl);
  localStorage.removeItem(key);
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

function clearSavedAssignmentsCache(userId = "", baseUrl = "") {
  const key = buildAssignmentsCacheKey(userId, baseUrl);
  localStorage.removeItem(key);
}

function App() {
  // Firebase Authentication State
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

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

  // Load cached user data from Firestore on login
  const loadCachedData = useCallback(async ({ authToken: authTokenArg, userId } = {}) => {
    try {
      const authToken = authTokenArg || await getAuthToken();
      if (!authToken) return;
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
      const bootstrapRes = await fetchWithTimeout(`${API_BASE}/api/user/bootstrap?includeAssignments=1`, {
        headers: { "Authorization": `Bearer ${authToken}` }
      }, 9000).catch(err => {
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
          fetchWithTimeout(`${API_BASE}/api/user/canvas-credentials`, {
            headers: { "Authorization": `Bearer ${authToken}` }
          }, 8000).catch(err => {
            console.error(`Failed to fetch credentials from ${API_BASE}:`, err.message);
            return null;
          }),
          fetchWithTimeout(`${API_BASE}/api/user/courses`, {
            headers: { "Authorization": `Bearer ${authToken}` }
          }, 8000).catch(err => {
            console.error(`Failed to fetch cached courses from ${API_BASE}:`, err.message);
            return null;
          }),
          fetchWithTimeout(`${API_BASE}/api/user/preferences`, {
            headers: { "Authorization": `Bearer ${authToken}` }
          }, 6000).catch(err => {
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
          if (["Syncing...", "Queued...", "Sync failed"].includes(c.status)) return c;
          return { ...c, status: desired };
        }));
      };

      if (Array.isArray(assignmentsFromBootstrap)) {
        hydrateAssignments(assignmentsFromBootstrap);
      } else {
        // Fallback/background hydration when bootstrap payload is unavailable.
        void (async () => {
          const assignmentsRes = await fetch(`${API_BASE}/api/user/assignments?lite=1`, {
            headers: { "Authorization": `Bearer ${authToken}` }
          }).catch(err => {
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
            const refreshedCoursesRes = await fetch(`${API_BASE}/api/canvas/courses`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${authToken}`
              },
              body: JSON.stringify({ base_url: resolvedBaseUrl, token: resolvedToken }),
            }).catch(() => null);

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

  // Listen to Firebase auth state changes
  useEffect(() => {
    // If we were forced into redirect-based auth (popup blocked), finalize it on load.
    // This is safe to call even when there's no pending redirect result.
    completeRedirectSignIn().catch((err) => {
      console.error("Redirect sign-in completion failed:", err);
    });

    const unsubscribe = onAuthChange(async ({ user, token }) => {
      setFirebaseUser(user);
      setAuthLoading(false);

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

        // Reuse token for follow-up bootstrap-dependent calls.
        const tokenPromise = token
          ? Promise.resolve(token)
          : getAuthToken().catch((e) => {
            console.warn("Failed to get auth token during bootstrap:", e?.message || e);
            return null;
          });

        loadCachedData({ authToken: token || undefined, userId: user.uid }).catch(err => {
          console.error("Background loadCachedData failed:", err);
        });

        // Reload completion watcher: keep this throttled to avoid repeat
        // all-course Canvas scans on each page load.
        const refreshBaseUrl = (localStorage.getItem("canvas_base_url") || connectedBaseUrl || "").trim();
        const refreshThrottleMs = CANVAS_COMPLETION_REFRESH_THROTTLE_MS;
        const lastRefreshAt = getLastCompletionRefreshAt(user.uid, refreshBaseUrl);
        const shouldRefreshCompletion = !!refreshBaseUrl && (!lastRefreshAt || (Date.now() - lastRefreshAt) >= refreshThrottleMs);

        const refreshToken = token || await tokenPromise;
        if (shouldRefreshCompletion && refreshToken) {
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

              const refreshRes = await fetch(`${API_BASE}/api/assignments/refresh-completion`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${refreshToken}`,
                },
                body: JSON.stringify({
                  base_url: refreshBaseUrl,
                  token: "",
                  course_ids: syncedCourseIds,
                }),
              });

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

  const handleGoogleSignIn = async () => {
    try {
      const res = await signInWithGoogle();
      // Redirect-based sign-in will navigate away; nothing else to do here.
      if (res && res.redirect) return;
    } catch (err) {
      console.error('Sign-in failed:', err);
      const code = err?.code || 'unknown';
      const message = err?.message || 'Unknown error';

      if (code === 'auth/popup-closed-by-user') {
        // User closed the popup, no need to alert
        return;
      } else if (code === 'auth/cancelled-popup-request') {
        // Another popup was already open, no need to alert
        return;
      } else if (code === 'auth/unauthorized-domain') {
        const origin = window?.location?.origin || '(unknown origin)';
        alert(`Sign-in blocked: unauthorized domain (${origin}). Add it in Firebase Console > Authentication > Settings > Authorized domains.`);
      } else if (code === 'auth/operation-not-allowed') {
        alert('Google sign-in is not enabled. Enable Google as a sign-in provider in Firebase Console > Authentication > Sign-in method.');
      } else if (code === 'auth/popup-blocked') {
        alert('Sign-in popup was blocked by your browser. Please allow popups for this site and try again (or refresh after the redirect flow starts).');
      } else if (code === 'auth/network-request-failed') {
        alert('Network error. Please check your internet connection and try again.');
      } else if (code === 'config/missing-firebase-env') {
        alert(`Firebase config is missing in this build: ${message}`);
      } else if (code === 'auth/invalid-api-key') {
        alert('Firebase API key is invalid for this deployment (auth/invalid-api-key). Check REACT_APP_FIREBASE_API_KEY in the deployed build env.');
      } else {
        alert(`Sign-in failed (${code}): ${message}`);
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
      // Clear Canvas credentials too
      clearSavedCourseSyncState(canvasBaseUrl, canvasToken);
      if (firebaseUser?.uid) {
        clearSavedCoursesCache(firebaseUser.uid, canvasBaseUrl);
        clearSavedAssignmentsCache(firebaseUser.uid, canvasBaseUrl);
        clearSavedCompletedItems(firebaseUser.uid, canvasBaseUrl, canvasToken || "");
      }
      localStorage.removeItem('canvas_base_url');
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

    setSyncStatus((prev) => {
      const next = { ...(prev || {}) };
      for (const courseId of courseIdsToQueue) {
        next[courseId] = "Queued...";
      }
      return next;
    });

    return courseIdsToQueue;
  }, [syncQueue, syncingCourseId]);

  // Persist checklist state by user + connected Canvas credentials so reloads keep checkbox status.
  useEffect(() => {
    if (!firebaseUser?.uid) {
      setCompletedItems({});
      return;
    }

    const connectedBaseUrl = (canvasBaseUrl || localStorage.getItem("canvas_base_url") || "").trim();
    const connectedToken = (canvasToken || "").trim(); // may be empty in cloud mode
    if (!connectedBaseUrl) {
      setCompletedItems({});
      return;
    }

    setCompletedItems(getSavedCompletedItems(firebaseUser.uid, connectedBaseUrl, connectedToken));
  }, [firebaseUser?.uid, canvasBaseUrl, canvasToken]);

  useEffect(() => {
    if (!firebaseUser?.uid) return;

    const connectedBaseUrl = (canvasBaseUrl || localStorage.getItem("canvas_base_url") || "").trim();
    const connectedToken = (canvasToken || "").trim(); // may be empty in cloud mode
    if (!connectedBaseUrl) return;

    setSavedCompletedItems(
      completedItems,
      firebaseUser.uid,
      connectedBaseUrl,
      connectedToken
    );
  }, [completedItems, firebaseUser?.uid, canvasBaseUrl, canvasToken]);

  const toggleFilter = (category) => {
    setWeeklyFilters(prev => ({ ...prev, [category]: !prev[category] }));
  };

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
    localStorage.setItem("sync_enabled_courses", JSON.stringify(normalizeTruthyCourseMap(syncEnabledCourses)));
  }, [syncEnabledCourses]);

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
      const authToken = await getAuthToken();
      if (!authToken) return;

      const res = await fetch(`${API_BASE}/api/user/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify(updates || {}),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("Failed to persist preferences:", res.status, text);
      }
    } catch (e) {
      console.warn("Failed to persist preferences:", e);
    }
  }, []);

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

  const setSyncEnabledCoursesAndPersist = useCallback((updater) => {
    setSyncEnabledCourses((prev) => {
      const nextRaw = typeof updater === "function" ? updater(prev || {}) : (updater || {});
      const next = normalizeTruthyCourseMap(nextRaw);
      queuePreferenceUpdates({ syncEnabledCourses: next }, 700);
      return next;
    });
  }, [queuePreferenceUpdates]);

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

  const pushSyncPromiseToast = useCallback((promiseOrFactory, options = {}) => {
    const {
      id: toastId,
      position = "top-right",
      loadingTitle = "Syncing...",
      successTitle = "Sync complete",
      successDescription,
      errorTitle = "Sync failed",
      errorDescription,
    } = options;
    const resolveDescription = (value, arg) => (typeof value === "function" ? value(arg) : value);

    const loadingId = toastId ? `${toastId}-loading` : `sync-loading-${Date.now()}`;
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

    const promise = typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory;

    return promise.then((data) => {
      sileo.success({
        id: loadingId,
        position,
        title: successTitle,
        description: resolveDescription(successDescription, data),
        duration: 4200,
        fill: "#0b1020",
        styles: {
          title: "text-white",
          description: "text-white/90",
        },
      });
      return data;
    }).catch((err) => {
      sileo.error({
        id: loadingId,
        position,
        title: errorTitle,
        description: resolveDescription(errorDescription, err),
        duration: 4200,
        fill: "#0b1020",
        styles: {
          title: "text-white",
          description: "text-white/90",
        },
      });
      throw err;
    });
  }, [trackSyncToast]);

  const queueSelectedSyncCourses = useCallback(() => {
    const queuedCourseIds = queueSyncCourses(syncEnabledCourseIds);
    if (!queuedCourseIds.length) return;
    setSyncRunTotal(queuedCourseIds.length);
    setSyncRunCompleted(0);
  }, [queueSyncCourses, syncEnabledCourseIds]);

  const fetchSyncWithRetry = useCallback(async (url, options = {}, retryOptions = {}) => {
    const timeoutMs = Number(retryOptions?.timeoutMs) > 0 ? Number(retryOptions.timeoutMs) : 30000;
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
  const syncRunProgressPercent = useMemo(() => {
    if (!isSyncInProgress || syncRunTotal <= 0) return 0;
    const finished = Math.min(syncRunCompleted, syncRunTotal);
    const inFlightBoost = syncingCourseId ? 0.35 : 0;
    return Math.min(99, Math.round(((finished + inFlightBoost) / syncRunTotal) * 100));
  }, [isSyncInProgress, syncRunCompleted, syncRunTotal, syncingCourseId]);
  const syncSelectionProgressPercent = isSyncInProgress && syncRunTotal > 0
    ? syncRunProgressPercent
    : baseSyncSelectionProgressPercent;
  const syncProgressDisplayPercent = selectedSyncCourseCount === 0 ? 0 : syncSelectionProgressPercent;
  const syncProgressLabel = isSyncInProgress && syncRunTotal > 0
    ? `${Math.min(syncRunCompleted, syncRunTotal)}/${syncRunTotal} synced`
    : `${selectedSyncSyncedCount}/${selectedSyncCourseCount || 0} synced`;
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
  }, [setSyncEnabledCoursesAndPersist, syncEnabledDraft]);

  const cancelEditingSyncClasses = useCallback(() => {
    setSyncEnabledDraft({});
    setIsEditingSyncClasses(false);
  }, []);

  const draftSelectedCount = useMemo(() => {
    return Object.keys(syncEnabledDraft || {}).length;
  }, [syncEnabledDraft]);

  const renderSyncToolbarControls = useCallback(() => (
    <div className="flex items-center">
      <button
        onClick={queueSelectedSyncCourses}
        disabled={selectedSyncCourseCount === 0 || isSyncInProgress}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${selectedSyncCourseCount === 0 || isSyncInProgress
          ? "cursor-not-allowed bg-blue-700 text-blue-100 border-blue-700 opacity-70"
          : "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
          }`}
        title={selectedSyncCourseCount === 0 ? "Select classes in Class Settings first" : "Sync all selected classes"}
      >
        <span>
          {isSyncInProgress
            ? "Syncing..."
            : allSelectedCoursesAlreadySynced
              ? "Resync"
              : "Sync"}
        </span>
      </button>
    </div>
  ), [
    allSelectedCoursesAlreadySynced,
    isSyncInProgress,
    queueSelectedSyncCourses,
    selectedSyncCourseCount,
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
    }

    return Array.from(merged.values());
  }, [itemsByCourse]);

  async function connectCanvas() {
    const baseUrl = canvasBaseUrl.trim();
    const token = canvasToken.trim();


    if (!baseUrl || !token) {
      setCanvasStatus("Missing URL or token");
      return;
    }

    setCanvasStatus("Connecting...");

    try {
      // Get fresh auth token for API calls
      const authToken = await getAuthToken();
      if (!authToken) {
        setCanvasStatus("Please sign in first");
        return;
      }
      const authHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`
      };

      const testRes = await fetch(`${API_BASE}/api/canvas/test`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ base_url: baseUrl, token }),
      });

      const testData = await testRes.json();

      if (!testData.valid) {
        setCanvasStatus("Invalid token");
        return;
      }

      // Save credentials to server (tied to Google account)
      const saveCredsRes = await fetch(`${API_BASE}/api/user/canvas-credentials`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ base_url: baseUrl, token }),
      });
      if (!saveCredsRes.ok) {
        let detail = `status ${saveCredsRes.status}`;
        try {
          const j = await saveCredsRes.json();
          if (j?.error) detail = j.error;
        } catch (_) {
          // ignore
        }
        // Continue with the session token so the user can at least proceed,
        // but warn that reloads may require reconnecting if the server can't persist creds.
        console.warn("Failed to persist Canvas credentials:", detail);
        setCanvasStatus(`Warning: couldn't save credentials (${detail})`);
      }

      // Keep only non-sensitive URL locally
      localStorage.setItem("canvas_base_url", baseUrl);

      setCanvasStatus("Fetching courses...");

      const courseRes = await fetch(`${API_BASE}/api/canvas/courses`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ base_url: baseUrl, token }),
      });

      const courses = await courseRes.json();

      // Check if courses API returned an error
      if (!courseRes.ok) {
        console.error('Courses API error:', courses);
        const serverMsg = courses?.error ? `: ${courses.error}` : "";
        setCanvasStatus(`Failed to fetch courses${serverMsg}`);
        return;
      }

      // Ensure courses is an array
      if (!Array.isArray(courses)) {
        console.error('Courses response is not an array:', courses);
        setCanvasStatus("Invalid courses response");
        return;
      }

      // Debug: Log course data to see what Canvas API returns
      console.log('Canvas courses received:', courses.length);
      if (courses.length > 0) {
        console.log('Sample course with term data:', courses[0]);
        courses.forEach(c => {
          console.log(`Course: ${c.name?.substring(0, 40) || 'Unknown'} | concluded: ${c.concluded} | term: ${c.term?.name} | term_end: ${c.term?.end_at}`);
        });
      }

      const existingCourseCodeById = Object.fromEntries(
        activeCourses.map(c => [normalizeCourseId(c.id), c.courseCode])
      );
      const existingCourseStatusById = Object.fromEntries(
        activeCourses.map(c => [normalizeCourseId(c.id), c.status])
      );
      const savedCourseSyncState = getSavedCourseSyncState(baseUrl, token);

      const active = courses
        .filter((c) => c.workflow_state === "available")
        .map((c) => {
          const cid = normalizeCourseId(c.id);
          const now = new Date();
          const backendActiveFlag = typeof c._app_is_currently_active === "boolean"
            ? c._app_is_currently_active
            : null;

          // Canvas API returns 'concluded' flag when include[]=concluded is used
          // Also returns 'term' object with term dates when include[]=term is used
          const isConcluded = c.concluded === true;

          // Use term end date if available (most reliable)
          const termEndAt = c.term?.end_at ? new Date(c.term.end_at) : null;
          const termStartAt = c.term?.start_at ? new Date(c.term.start_at) : null;

          // Course dates as fallback
          const courseEndAt = c.end_at ? new Date(c.end_at) : null;
          const courseStartAt = c.start_at ? new Date(c.start_at) : null;

          // Use term dates first, then course dates
          const effectiveEndAt = termEndAt || courseEndAt;
          const effectiveStartAt = termStartAt || courseStartAt;

          // Determine if course is currently active
          let isCurrentlyActive;

          if (backendActiveFlag !== null) {
            isCurrentlyActive = backendActiveFlag;
          } else if (isConcluded) {
            // Canvas explicitly says this course is concluded
            isCurrentlyActive = false;
          } else if (effectiveEndAt && now > effectiveEndAt) {
            // Term/course has ended
            isCurrentlyActive = false;
          } else if (effectiveStartAt && effectiveEndAt) {
            // Has both dates - check if we're in range
            isCurrentlyActive = now >= effectiveStartAt && now <= effectiveEndAt;
          } else if (effectiveStartAt && !effectiveEndAt) {
            // Has start but no end - active if we're past start
            isCurrentlyActive = now >= effectiveStartAt;
          } else {
            // No dates or flags: don't mark everything as active.
            isCurrentlyActive = false;
          }

          return {
            id: cid,
            name: c.name,
            courseCode: deriveCourseCode(existingCourseCodeById[cid] || c.course_code, c.name),
            status: existingCourseStatusById[cid] || savedCourseSyncState[cid] || "NOT_SYNCED",
            startAt: effectiveStartAt?.toISOString(),
            endAt: effectiveEndAt?.toISOString(),
            termName: c.term?.name || null,
            isCurrentlyActive,
          };
        });

      setActiveCourses(active);
      if (firebaseUser?.uid) {
        setSavedCoursesCache(firebaseUser.uid, baseUrl, active);
      }
      setCanvasStatus("Connected");
    } catch (err) {
      console.error('Canvas connection error:', err);
      setCanvasStatus(`Connection failed: ${err.message || 'Network error'}`);
    }
  }

  function disconnectCanvas() {
    clearSavedCourseSyncState(canvasBaseUrl, canvasToken);
    localStorage.removeItem("canvas_base_url");
    if (firebaseUser?.uid) {
      clearSavedCoursesCache(firebaseUser.uid, canvasBaseUrl);
      clearSavedAssignmentsCache(firebaseUser.uid, canvasBaseUrl);
      clearSavedCompletedItems(firebaseUser.uid, canvasBaseUrl, canvasToken || "");
    }
    setCanvasBaseUrl("");
    setCanvasToken("");
    setActiveCourses([]);
    setItemsByCourse({});
    setCanvasStatus("Disconnected");
  }

  async function syncCourse(courseIdInput) {
    const courseId = normalizeCourseId(courseIdInput);
    const token = (canvasToken || "").trim();
    const baseUrl = (canvasBaseUrl || localStorage.getItem("canvas_base_url") || "").trim();
    const courseMeta = activeCourses.find((c) => normalizeCourseId(c.id) === courseId);
    const derivedCourseCode = deriveCourseCode(courseMeta?.courseCode, courseMeta?.name || "");
    const classCodeLabel = derivedCourseCode && derivedCourseCode !== "UNK"
      ? derivedCourseCode
      : (courseMeta?.name || `Course ${courseId}`);
    const syncToastId = `sync-live-status-${courseId || "unknown"}`;

    // In cloud mode, the Canvas token is stored server-side. A missing client-side token
    // is not necessarily an error, as long as we have saved credentials on the backend.
    if (!baseUrl && !token) {
      alert("Please connect to Canvas first");
      return;
    }

    // Get fresh auth token for API calls
    const authToken = await getAuthToken();
    if (!authToken) {
      alert("Please sign in first");
      return;
    }
    const authHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`
    };

    setIsSyncing(true);
    setSyncingCourseId(courseId);
    setSyncStatus((prev) => ({ ...prev, [courseId]: "Syncing materials..." }));

    try {
      await pushSyncPromiseToast(async () => {
        setSyncStatus((prev) => ({
          ...prev,
          [courseId]: "Fetching syllabus & schedule files...",
        }));

        const materialsRes = await fetchSyncWithRetry(
          `${API_BASE}/api/sync_course_materials`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              base_url: baseUrl,
              token,
              course_id: courseId,
            }),
          }
        );

        if (!materialsRes.ok) {
          throw new Error(await readSyncErrorMessage(materialsRes, "Failed to sync materials"));
        }
        const materialsData = await materialsRes.json();

        setSyncStatus((prev) => ({
          ...prev,
          [courseId]: `Found ${materialsData.materials_extracted} materials`,
        }));

        const announcementsRes = await fetchSyncWithRetry(`${API_BASE}/api/sync_announcements`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            base_url: baseUrl,
            token,
            course_ids: [courseId],
          }),
        });
        if (!announcementsRes.ok) {
          throw new Error(await readSyncErrorMessage(announcementsRes, "Failed to sync announcements"));
        }

        setSyncStatus((prev) => ({
          ...prev,
          [courseId]: "Syncing assignments...",
        }));

        const assignmentsRes = await fetchSyncWithRetry(
          `${API_BASE}/api/sync_assignments`,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              base_url: baseUrl,
              token,
              course_id: courseId,
            }),
          }
        );

        if (!assignmentsRes.ok) {
          throw new Error(await readSyncErrorMessage(assignmentsRes, "Failed to sync assignments"));
        }
        const initialAssignmentsData = await assignmentsRes.json().catch(() => ({}));
        const initialAssignListRaw = Array.isArray(initialAssignmentsData?.a)
          ? initialAssignmentsData.a
          : Array.isArray(initialAssignmentsData?.assignments)
            ? initialAssignmentsData.assignments
            : [];

        setSyncStatus((prev) => ({
          ...prev,
          [courseId]: "Resolving dates with AI...",
        }));

        const resolveRes = await fetchSyncWithRetry(`${API_BASE}/api/resolve_course_dates`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            course_id: courseId,
            course_timezone: "America/New_York",
          }),
        });

        if (!resolveRes.ok) {
          throw new Error(await readSyncErrorMessage(resolveRes, "Failed to resolve course dates"));
        }

        const courseObj = courseMeta;
        const previousCourseItems = Array.isArray(itemsByCourse[courseId]) ? itemsByCourse[courseId] : [];

        const mapAssignmentsForCourse = (assignments) => {
          const mapped = (Array.isArray(assignments) ? assignments : []).map((a) => {
            const assignmentId = normalizeAssignmentToken(a.canvas_assignment_id ?? a.canvasAssignmentId ?? a.cid);
            const discoveredKey = normalizeAssignmentToken(a.discovered_key ?? a.discoveredKey ?? a.dk).toLowerCase();
            const stableToken = assignmentId || (discoveredKey ? `disc:${discoveredKey}` : "");
            const nameValue = a.nam ?? a.name ?? "";
            const dueValue = a.due ?? a.normalized_due_at ?? a.due_at ?? a.original_due_at ?? null;

            return {
              id: buildAssignmentStableId(courseId, stableToken, nameValue, dueValue),
              courseId,
              canvasAssignmentId: assignmentId || null,
              discoveredKey: discoveredKey || null,
              courseName: courseObj?.name || "Unknown",
              courseCode: deriveCourseCode(courseObj?.courseCode, courseObj?.name),

              name: nameValue,
              due: dueValue,

              status: a.st ?? a.status ?? null,
              category: normalizeCategoryForViews(a.cat ?? a.category),
            };
          });
          return dedupeAssignmentsWithinCourse(mapped);
        };

        let finalAssignListRaw = [];
        const maxFinalFetchAttempts = 1;

        for (let attempt = 1; attempt <= maxFinalFetchAttempts; attempt++) {
          const finalRes = await fetchSyncWithRetry(`${API_BASE}/api/sync_assignments`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              base_url: baseUrl,
              token,
              course_id: courseId,
            }),
          });

          if (!finalRes.ok) {
            throw new Error(await readSyncErrorMessage(finalRes, "Failed to fetch final assignments"));
          }

          const finalData = await finalRes.json().catch(() => ({}));
          finalAssignListRaw = Array.isArray(finalData?.a)
            ? finalData.a
            : Array.isArray(finalData?.assignments)
              ? finalData.assignments
              : [];

          if (finalAssignListRaw.length > 0 || attempt === maxFinalFetchAttempts) {
            break;
          }
        }

        const initialNormalizedAssignments = mapAssignmentsForCourse(initialAssignListRaw);
        let normalizedAssignments = mapAssignmentsForCourse(finalAssignListRaw);
        if (!normalizedAssignments.length) {
          if (initialNormalizedAssignments.length > 0) {
            normalizedAssignments = initialNormalizedAssignments;
          } else if (previousCourseItems.length > 0) {
            normalizedAssignments = previousCourseItems;
            console.warn(`Sync returned an empty assignment payload for course ${courseId}; keeping previous assignments.`);
          }
        }

        const previousCompletedSignatures = new Set();
        for (const item of previousCourseItems) {
          if (!completedItems[item?.id]) continue;
          const itemSignatures = buildAssignmentCompletionSignatures({
            courseId,
            assignmentId: extractAssignmentIdFromItem(item, courseId),
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
          [courseId]: normalizedAssignments,
        }));

        if (previousCompletedSignatures.size > 0) {
          setCompletedItems((prev) => {
            const next = { ...(prev || {}) };
            let changed = false;

            for (const item of normalizedAssignments) {
              const signatures = buildAssignmentCompletionSignatures({
                courseId,
                assignmentId: extractAssignmentIdFromItem(item, courseId),
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

            if (changed && firebaseUser?.uid) {
              persistCompletedItemsDebounced(next);
            }
            return changed ? next : prev;
          });
        }

        setSyncStatus((prev) => ({ ...prev, [courseId]: "Sync Complete" }));

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
          prev.map((c) => (normalizeCourseId(c.id) === courseId ? { ...c, status: "SYNCED" } : c))
        );
        const savedSyncState = getSavedCourseSyncState(baseUrl, token);
        savedSyncState[courseId] = "SYNCED";
        setSavedCourseSyncState(savedSyncState, baseUrl, token);
        setLastSyncAt(new Date().toISOString());

        return {
          itemCount: normalizedAssignments.length,
        };
      }, {
        id: syncToastId,
        loadingTitle: `Syncing ${classCodeLabel}`,
        successTitle: `Synced ${classCodeLabel}`,
        errorTitle: `Sync Failed for ${classCodeLabel}`,
        errorDescription: (err) => err?.message || String(err),
      });
    } catch (err) {
      console.error("Sync failed", err);
      setSyncStatus((prev) => ({
        ...prev,
        [courseId]: `Sync Failed: ${err?.message || String(err)}`,
      }));
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
  const courseItems = itemsByCourse[normalizedSelectedCourseId] || [];
  const currentSyncStatus = syncStatus[normalizedSelectedCourseId];

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

  // Confetti - using canvas-confetti library
  const progressBarRef = useRef(null);
  const prevProgressRef = useRef(progressPercent);

  // Fire confetti explosion from progress bar
  const fireConfetti = useCallback(() => {
    // Load canvas-confetti from CDN if not already loaded
    if (!window.confetti) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
      script.onload = () => fireConfettiBurst();
      document.head.appendChild(script);
    } else {
      fireConfettiBurst();
    }
  }, []);

  const fireConfettiBurst = useCallback(() => {
    if (!window.confetti || !progressBarRef.current) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const originX = (rect.left + rect.width / 2) / window.innerWidth;
    const originY = (rect.top + rect.height * 0.3) / window.innerHeight;

    const defaults = {
      origin: { x: originX, y: originY },
      colors: ['#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899'],
      zIndex: 9999,
      disableForReducedMotion: true,
    };

    // Burst 1: Upward fan
    window.confetti({
      ...defaults,
      particleCount: 30,
      spread: 60,
      angle: 90,
      startVelocity: 45,
      gravity: 1.2,
      scalar: 0.9,
      ticks: 150,
    });

    // Burst 2: Left spray (delayed)
    setTimeout(() => {
      window.confetti({
        ...defaults,
        particleCount: 20,
        spread: 50,
        angle: 120,
        startVelocity: 35,
        gravity: 1,
        scalar: 0.8,
        ticks: 120,
      });
    }, 100);

    // Burst 3: Right spray (delayed)
    setTimeout(() => {
      window.confetti({
        ...defaults,
        particleCount: 20,
        spread: 50,
        angle: 60,
        startVelocity: 35,
        gravity: 1,
        scalar: 0.8,
        ticks: 120,
      });
    }, 100);

    // Burst 4: Small follow-up poof
    setTimeout(() => {
      window.confetti({
        ...defaults,
        particleCount: 15,
        spread: 100,
        angle: 90,
        startVelocity: 20,
        gravity: 0.8,
        scalar: 0.6,
        ticks: 100,
      });
    }, 250);
  }, []);

  // Trigger confetti when progress reaches 100%
  useEffect(() => {
    if (progressPercent === 100 && prevProgressRef.current < 100 && weekItems.length > 0) {
      fireConfetti();
    }
    prevProgressRef.current = progressPercent;
  }, [progressPercent, weekItems.length, fireConfetti]);

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

      // Cross-browser persistence (Firestore) is best-effort and debounced.
      if (firebaseUser?.uid) {
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

  // Show loading while checking auth
  if (authLoading) {
    return (
      <>
        <Toaster
          position="top-center"
          offset={16}
          options={{ fill: "#0b1020", roundness: 12, duration: 2600 }}
        />
        <div className="h-screen flex items-center justify-center bg-black text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p>Loading...</p>
          </div>
        </div>
      </>
    );
  }

  // Show landing screen when unauthenticated OR when user explicitly opens landing from app.
  if (!firebaseUser || showLandingPage) {
    return (
      <>
        <Toaster
          position="top-center"
          offset={16}
          options={{ fill: "#0b1020", roundness: 12, duration: 2600 }}
        />
        <div className="min-h-screen bg-[#06080c] text-white">
          <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap');
          .landing-font { font-family: 'Space Grotesk', sans-serif; }
          .landing-grid {
            background-image:
              linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px);
            background-size: 46px 46px;
          }
        `}</style>

          <div className="landing-font min-h-screen landing-grid">
            <header className="max-w-6xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between">
              {firebaseUser ? (
                <button
                  onClick={() => setShowLandingPage(false)}
                  className="flex items-center"
                  aria-label="Return to app"
                  title="Return to app"
                >
                  <img src={BRAND_LOGO_SRC} alt="CanvasSync" className="h-[24px] w-auto" />
                </button>
              ) : (
                <div className="flex items-center" aria-label="CanvasSync logo">
                  <img src={BRAND_LOGO_SRC} alt="CanvasSync" className="h-[24px] w-auto" />
                </div>
              )}
              {firebaseUser ? (
                <button
                  onClick={() => setShowLandingPage(false)}
                  className="text-sm px-4 py-2 rounded-md border border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:text-white transition-colors"
                >
                  Back to App
                </button>
              ) : (
                <button
                  onClick={handleGoogleSignIn}
                  className="text-sm px-4 py-2 rounded-md border border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:text-white transition-colors"
                >
                  Sign in
                </button>
              )}
            </header>

            <main className="max-w-6xl mx-auto px-6 pb-14 pt-10 grid lg:grid-cols-2 gap-10 items-center">
              <section>
                <p className="text-xs uppercase tracking-[0.2em] text-blue-300 mb-4">Full-course deadline capture</p>
                <h1 className="text-4xl md:text-5xl font-bold leading-tight">
                  Get all your assignments, even when they are hidden in files or modules.
                </h1>
                <p className="mt-5 text-zinc-300 text-base md:text-lg max-w-xl">
                  CanvasSync combines native Canvas assignments with dates extracted from modules, files, pages, announcements, and syllabus documents, then shows everything in one timeline.
                </p>

                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                  {firebaseUser ? (
                    <>
                      <button
                        onClick={() => setShowLandingPage(false)}
                        className="inline-flex items-center justify-center gap-3 bg-white text-black px-6 py-3 rounded-md font-medium hover:bg-zinc-100 transition"
                      >
                        Go to App
                      </button>
                      <span className="inline-flex items-center text-sm text-zinc-400">
                        Continue to your synced dashboard
                      </span>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleGoogleSignIn}
                        className="inline-flex items-center justify-center gap-3 bg-white text-black px-6 py-3 rounded-md font-medium hover:bg-zinc-100 transition"
                      >
                        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Continue with Google
                      </button>
                      <span className="inline-flex items-center text-sm text-zinc-400">
                        Secure sign-in and cloud sync
                      </span>
                    </>
                  )}
                </div>

                <div className="mt-10 grid sm:grid-cols-3 gap-3 text-sm">
                  <div className="p-3 rounded-md border border-zinc-800 bg-zinc-950/70">
                    <p className="text-zinc-200 font-medium">Beyond the assignments tab</p>
                    <p className="text-zinc-500 mt-1">Pulls due dates from module items and uploaded files</p>
                  </div>
                  <div className="p-3 rounded-md border border-zinc-800 bg-zinc-950/70">
                    <p className="text-zinc-200 font-medium">Parses real course docs</p>
                    <p className="text-zinc-500 mt-1">Reads pages, announcements, and syllabus text for deadlines</p>
                  </div>
                  <div className="p-3 rounded-md border border-zinc-800 bg-zinc-950/70">
                    <p className="text-zinc-200 font-medium">One deduped weekly view</p>
                    <p className="text-zinc-500 mt-1">Merges overlapping items so you do not miss or double-count work</p>
                  </div>
                </div>
              </section>

              <section className="relative">
                <div className="absolute -inset-10 bg-blue-600/10 blur-3xl rounded-full pointer-events-none" />
                <div className="relative border border-zinc-800 rounded-xl bg-zinc-950/80 backdrop-blur p-5 shadow-2xl">
                  <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
                    <p className="text-sm text-zinc-400">This Week (All Sources)</p>
                    <p className="text-xs px-2 py-1 rounded bg-blue-900/40 text-blue-300 border border-blue-900">Synced</p>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <span className="text-zinc-200">MATH 3235 - Homework 4</span>
                        <p className="text-[11px] text-zinc-500">from module file</p>
                      </div>
                      <span className="text-zinc-400">Mon</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <span className="text-zinc-200">CS 1332 - Quiz 2</span>
                        <p className="text-[11px] text-zinc-500">from announcement</p>
                      </div>
                      <span className="text-zinc-400">Wed</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <span className="text-zinc-200">PHYS 2211 - Lab Report</span>
                        <p className="text-[11px] text-zinc-500">from syllabus page</p>
                      </div>
                      <span className="text-zinc-400">Thu</span>
                    </div>
                  </div>
                  <div className="mt-5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full w-2/3 bg-blue-500" />
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">4 of 6 tasks complete</p>
                </div>
              </section>
            </main>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Toaster
        position="top-right"
        offset={syncToastOffset}
        options={{ fill: "#0b1020", roundness: 14, duration: 2600 }}
      />
      <div className={`h-screen flex flex-col bg-black app-font theme-app ${theme === "light" ? "theme-light" : "theme-dark"} ${colorMode === "vibrant" ? "mode-vibrant" : "mode-standard"}`}>
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
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${profileTab === "account"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white"
                        }`}
                    >
                      Account
                    </button>
                    <button
                      onClick={() => setProfileTab("settings")}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${profileTab === "settings"
                        ? "bg-blue-600 text-white"
                        : "bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white"
                        }`}
                    >
                      Settings
                    </button>
                    <button
                      onClick={() => setProfileTab("upgrade")}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${profileTab === "upgrade"
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
                          Applies to the whole app (including the "notebook" sections).
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
                            className={`text-xs px-2 py-1 rounded ${canvasBaseUrl && canvasToken
                              ? "bg-green-950 text-green-300 border border-green-900"
                              : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                              }`}
                          >
                            {canvasBaseUrl && canvasToken ? "Configured" : "Not configured"}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-zinc-500 space-y-1">
                          <div>
                            Base URL: <span className="text-zinc-300">{canvasBaseUrl || "--"}</span>
                          </div>
                          <div>
                            Token:{" "}
                            <span className="text-zinc-300">
                              {canvasToken ? `****${canvasToken.slice(-4)}` : "--"}
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
                          className={`mt-2 p-3 rounded text-sm ${canvasStatus.includes("Connected")
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
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-6 py-2 bg-zinc-950 border-b border-zinc-800 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-zinc-800 rounded text-zinc-400"
            >
              <Menu size={20} />
            </button>
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
              <img src={BRAND_LOGO_SRC} alt="CanvasSync" className="h-[20px] w-auto" />
            </button>
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
                className="relative z-50 w-[240px] max-w-[calc(100vw-8rem)] rounded-xl border border-zinc-700/70 bg-[#0b1020]/90 px-3.5 py-2.5 text-left shadow-[0_8px_24px_rgba(2,8,20,0.35)] hover:bg-[#121c31]/90 transition-colors"
                title="Sync progress"
              >
                <div className="flex items-center justify-between gap-2 leading-none">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-200">Sync</span>
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
                <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-zinc-700/70 bg-[#0b1020]/95 p-3.5 shadow-2xl backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold tracking-wide text-zinc-100">Sync Progress</span>
                    <span className="text-base font-semibold text-blue-200">{syncProgressDisplayPercent}%</span>
                  </div>

                  <div className="relative mt-2.5 h-2.5 rounded-full overflow-hidden border border-zinc-700/80 bg-zinc-950/80">
                    <div
                      className="h-full bg-blue-400/90 transition-all duration-300"
                      style={{ width: `${syncProgressDisplayPercent}%` }}
                    />
                  </div>

                  <div className="mt-2.5 space-y-1 text-xs">
                    <p className="text-zinc-200">{syncProgressLabel}</p>
                    <p className="text-zinc-400">Last sync: {lastSyncLabel}</p>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
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
                                      const isCompleted = isItemCompleted(item);

                                      return (
                                        <li key={item.id} className={`group relative flex items-start gap-3 py-3 border-b border-zinc-800/60 hover:bg-zinc-900/30 transition-all duration-300 ${isCompleted ? 'opacity-40' : ''}`}>
                                          {/* Strikethrough line across entire row */}
                                          {isCompleted && (
                                            <div className="absolute left-0 right-0 top-1/2 h-[2px] bg-zinc-500/60 pointer-events-none z-10" />
                                          )}
                                          {/* Checkbox */}
                                          <button
                                            onClick={() => toggleComplete(item)}
                                            className="mt-1 text-zinc-600 hover:text-green-500 transition-colors relative z-20"
                                          >
                                            {isCompleted ? <CheckCircle2 size={20} className="text-green-500" /> : <Circle size={20} />}
                                          </button>

                                          <div className="flex-1 flex items-center justify-between gap-4 font-notebook text-lg tracking-wide">
                                            <div className={`flex items-baseline gap-2 ${isCompleted ? 'text-zinc-600' : 'text-zinc-200'}`}>
                                              {/* Course Code Tag with color */}
                                              <span
                                                className={`px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${getCourseColorClasses(getEffectiveCourseColor(item.courseId, item.courseCode, item.courseName)).tag}`}
                                              >
                                                {item.courseCode ? item.courseCode.toUpperCase() : "UNK"}
                                              </span>
                                              {/* Item Name */}
                                              <span className="inline-flex min-w-0 items-center gap-1.5">
                                                <span className="truncate">{item.name}</span>
                                                <AIDiscoveredIndicator item={item} size={9} />
                                              </span>
                                            </div>

                                            <div className="flex items-center gap-3 shrink-0">
                                              {/* Due Time */}
                                              <span className="text-sm text-zinc-500 font-sans">
                                                {(() => {
                                                  const dt = parseDueToDate(item.due);
                                                  return dt
                                                    ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                                                    : "--";
                                                })()}
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
                  <div
                    ref={progressBarRef}
                    className="w-16 sm:w-24 bg-zinc-950 rounded-lg shadow-lg border border-zinc-800 p-2 sm:p-4 shrink-0 flex flex-col items-center relative"
                  >
                    <p className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2 vertical-text sm:horizontal-text text-center">Progress</p>
                    <div className="flex-1 w-2 sm:w-4 bg-zinc-900 rounded-full overflow-hidden p-0.5 flex flex-col-reverse gap-0.5">
                      {Array.from({ length: 20 }).map((_, idx) => {
                        const filledSegments = Math.round(progressPercent / 5);
                        const filled = idx < filledSegments;
                        return (
                          <div
                            key={idx}
                            className={`w-full flex-1 rounded-sm transition-colors duration-300 ${filled ? (progressPercent === 100 ? 'bg-green-500' : 'bg-blue-600') : 'bg-transparent'}`}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-3 text-center"><p className={`text-lg sm:text-xl font-bold ${progressPercent === 100 ? 'text-green-500' : 'text-blue-500'}`}>{Math.round(progressPercent)}%</p></div>
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
                                        <AIDiscoveredIndicator item={item} size={8} showTooltip={false} />
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
                                          className={`px-2 py-1.5 rounded text-xs leading-tight border border-transparent border-l-4 hover:border-zinc-600 bg-zinc-800 text-zinc-200 flex items-center gap-1.5 ${getCourseColorClasses(getEffectiveCourseColor(item.courseId, item.courseCode, item.courseName)).accent}`}
                                        >
                                          <span className="font-bold opacity-75 shrink-0">{item.courseCode}</span>
                                          <span className="truncate flex-1">{item.name}</span>
                                          <AIDiscoveredIndicator item={item} size={9} className="shrink-0" />
                                          <span className="text-[10px] text-zinc-500 shrink-0">
                                            {(() => {
                                              const dt = parseDueToDate(item.due);
                                              return dt ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : "";
                                            })()}
                                          </span>
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
                    {selectedCourse?.status === "NOT_SYNCED" ? (
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
                            <th className="text-left py-2 px-2 text-zinc-400 font-semibold">Status</th>
                          </tr>
                        </thead>

                        <tbody>
                          {sortedCourseItems.map((a, idx) => {
                            return (
                              <tr key={`${a.name}-${idx}`} className="border-b border-zinc-800 hover:bg-black transition-colors">
                                <td className="py-2 px-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white">{a.name}</span>
                                    <AIDiscoveredIndicator item={a} size={10} />
                                    {getStatusBadge(a.status)}
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

                                <td className="py-2 px-2 text-xs text-zinc-500">
                                  {a.status || "OK"}
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
    </>
  );
}

export default App;
