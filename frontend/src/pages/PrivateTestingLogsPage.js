import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthToken, isAuthenticated } from "../auth";
import { API_BASE } from "../config";

const DEFAULT_MODEL_FILTER = "";

function formatUsd(value) {
  const n = Number(value || 0);
  if (n === 0) return "$0.000000";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function formatTokens(value) {
  return Number(value || 0).toLocaleString();
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-100">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function MessagePanel({ title, text, tone = "zinc" }) {
  const toneClasses = tone === "blue"
    ? "border-blue-900/60 bg-blue-950/20"
    : "border-zinc-800 bg-black/40";

  return (
    <div className={`rounded-md border ${toneClasses}`}>
      <div className="border-b border-zinc-800/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
        {title}
      </div>
      <pre className="max-h-72 overflow-auto p-3 text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-words font-mono">
        {text || "(empty)"}
      </pre>
    </div>
  );
}

function LogEntry({ log, expanded, onToggle }) {
  const statusColor = log.status === "ok"
    ? "text-green-400 border-green-900/50 bg-green-950/30"
    : "text-red-400 border-red-900/50 bg-red-950/30";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-zinc-900/60 transition-colors"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded border ${statusColor}`}>
                {log.status || "unknown"}
              </span>
              <span className="text-xs text-zinc-500">{formatTimestamp(log.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-200 font-medium truncate">
              {log.operation || "unknown operation"}
              <span className="text-zinc-500 font-normal"> · {log.model || "unknown model"}</span>
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {log.courseId ? `course ${log.courseId}` : "no course"}
              {log.llmProvider ? ` · ${log.llmProvider}` : ""}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-zinc-100">{formatUsd(log.estimatedCostUsd)}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              in {formatTokens(log.inputTokens)} · out {formatTokens(log.outputTokens)}
            </p>
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-zinc-800 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-zinc-500">Request ID</p>
              <p className="text-zinc-300 font-mono break-all">{log.requestId || "—"}</p>
            </div>
            <div>
              <p className="text-zinc-500">Total tokens</p>
              <p className="text-zinc-300">{formatTokens(log.totalTokens)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Prompt chars</p>
              <p className="text-zinc-300">{formatTokens(log.promptChars)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Pricing source</p>
              <p className="text-zinc-300">{log.pricingSource || "—"}</p>
            </div>
          </div>

          {log.status !== "ok" && (log.errorType || log.errorMessage) ? (
            <MessagePanel
              title="Error"
              text={`${log.errorType || "Error"}: ${log.errorMessage || ""}`.trim()}
              tone="blue"
            />
          ) : null}

          {log.promptText ? <MessagePanel title="Prompt" text={log.promptText} /> : null}
          {log.responseText ? <MessagePanel title="Response" text={log.responseText} tone="blue" /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function PrivateTestingLogsPage() {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [modelFilter, setModelFilter] = useState(DEFAULT_MODEL_FILTER);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [authorized, setAuthorized] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!isAuthenticated()) {
      setError("Please sign in to view private logs.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (modelFilter.trim()) {
        params.set("model", modelFilter.trim());
      }
      const authToken = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/ai/usage-logs/dashboard?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to load logs (${res.status})`);
      }
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setSummary(data);
    } catch (err) {
      setError(err?.message || String(err));
      setLogs([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [limit, modelFilter]);

  useEffect(() => {
    setAuthorized(isAuthenticated());
  }, []);

  if (!authorized) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-sm text-zinc-400">Sign in required to view this page.</p>
      </div>
    );
  }

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const providerBreakdown = useMemo(() => {
    const map = new Map();
    for (const log of logs) {
      const key = log.llmProvider || log.model || "unknown";
      const prev = map.get(key) || { count: 0, cost: 0, input: 0, output: 0 };
      prev.count += 1;
      prev.cost += Number(log.estimatedCostUsd || 0);
      prev.input += Number(log.inputTokens || 0);
      prev.output += Number(log.outputTokens || 0);
      map.set(key, prev);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].cost - a[1].cost);
  }, [logs]);

  return (
    <div className="min-h-screen bg-black text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-zinc-500">Private testing</p>
            <h1 className="text-xl font-semibold text-zinc-100">AI Usage Logs</h1>
            <p className="text-sm text-zinc-500 mt-1">
              OpenRouter Qwen 3.5 Flash token and cost tracking
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="text-sm px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:text-white">
              Home
            </a>
            <button
              type="button"
              onClick={() => void loadLogs()}
              className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="text-xs text-zinc-500">Model filter (substring)</span>
            <input
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="mt-1 block w-64 rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm text-zinc-100"
              placeholder="qwen/qwen3.5-flash (optional)"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">Limit</span>
            <input
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 100)}
              className="mt-1 block w-28 rounded-md border border-zinc-700 bg-black px-3 py-2 text-sm text-zinc-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void loadLogs()}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Apply
          </button>
        </section>

        {error ? (
          <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Requests"
            value={loading ? "…" : formatTokens(summary?.count)}
            hint={modelFilter ? `filter: ${modelFilter}` : "all models"}
          />
          <StatCard
            label="Avg cost / request"
            value={loading ? "…" : formatUsd(summary?.avg_estimated_cost_usd)}
            hint={`total ${formatUsd(summary?.total_estimated_cost_usd)}`}
          />
          <StatCard
            label="Avg input tokens"
            value={loading ? "…" : formatTokens(summary?.avg_input_tokens)}
            hint={`total ${formatTokens(summary?.total_input_tokens)}`}
          />
          <StatCard
            label="Avg output tokens"
            value={loading ? "…" : formatTokens(summary?.avg_output_tokens)}
            hint={`total ${formatTokens(summary?.total_output_tokens)}`}
          />
        </section>

        {providerBreakdown.length > 0 ? (
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-sm font-medium text-zinc-300 mb-3">By provider / model</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-800">
                    <th className="py-2 pr-4">Provider / model</th>
                    <th className="py-2 pr-4">Requests</th>
                    <th className="py-2 pr-4">Input</th>
                    <th className="py-2 pr-4">Output</th>
                    <th className="py-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {providerBreakdown.map(([name, stats]) => (
                    <tr key={name} className="border-b border-zinc-900/80 text-zinc-300">
                      <td className="py-2 pr-4 font-mono text-xs">{name}</td>
                      <td className="py-2 pr-4">{stats.count}</td>
                      <td className="py-2 pr-4">{formatTokens(stats.input)}</td>
                      <td className="py-2 pr-4">{formatTokens(stats.output)}</td>
                      <td className="py-2">{formatUsd(stats.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">Requests</h2>
            <p className="text-xs text-zinc-500">{loading ? "Loading…" : `${logs.length} shown`}</p>
          </div>

          {!loading && logs.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-8 text-center text-sm text-zinc-500">
              No logs yet. Run a course sync (e.g. /demo) to generate AI usage entries.
            </div>
          ) : null}

          {logs.map((log) => (
            <LogEntry
              key={log.id || log.requestId}
              log={log}
              expanded={expandedId === log.id}
              onToggle={() => setExpandedId((prev) => (prev === log.id ? null : log.id))}
            />
          ))}
        </section>
      </main>
    </div>
  );
}
