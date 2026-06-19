import React, { useState } from "react";
import { API_BASE } from "../config";
import { apiFetchOptions } from "../auth";

const CONSENT_VERSION = "2026-05-20";

export function ConsentModal({ onAccepted }) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleContinue(event) {
    event?.preventDefault();
    if (!agreed || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/user/legal-consent`,
        apiFetchOptions({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accepted: true, version: CONSENT_VERSION }),
        }),
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed (${res.status})`);
      }
      onAccepted?.();
    } catch (err) {
      setError(err?.message || "Could not save consent. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mobile-consent-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
      <form
        onSubmit={handleContinue}
        role="dialog"
        aria-labelledby="consent-title"
        aria-describedby="consent-summary"
        className="mobile-consent-dialog w-full max-w-lg overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl"
      >
        <div className="max-h-[calc(100vh-13rem)] overflow-y-auto p-5 sm:p-6">
          <h2 id="consent-title" className="text-lg font-semibold text-white">
            Before you sync
          </h2>
          <p id="consent-summary" className="mt-2 text-sm leading-relaxed text-zinc-400">
            CanvasSync reads your Canvas course data to build a calendar and may use AI to find dates in course
            materials when Canvas does not provide structured due dates.
          </p>

          <div className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-300">
            <section className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <h3 className="text-sm font-medium text-zinc-100">Canvas access</h3>
              <p className="mt-1 text-zinc-400">
                We use read-only Canvas OAuth access for course calendars, assignments, modules, files,
                announcements, and syllabus text. We do not write to Canvas, and we do not collect grades or
                submissions.
              </p>
            </section>

            <section className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <h3 className="text-sm font-medium text-zinc-100">AI processing</h3>
              <p className="mt-1 text-zinc-400">
                For missing dates, we send the minimum course text needed for extraction, such as syllabus excerpts,
                assignment titles, and short announcement snippets. Requests go through{" "}
                <strong className="text-zinc-100">OpenRouter</strong> and are pinned to{" "}
                <strong className="text-zinc-100">DeepInfra</strong> with zero-data-retention required, data
                collection denied, and provider fallback disabled. If that route is unavailable, the request should
                fail instead of using another provider.
              </p>
            </section>

            <section className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <h3 className="text-sm font-medium text-zinc-100">Privacy limits</h3>
              <p className="mt-1 text-zinc-400">
                We do not intentionally include your name, email, Canvas user ID, full prompts, or full AI
                completions in stored AI logs. Course text is not guaranteed anonymous: syllabi and announcements can
                contain instructor names, emails, student names, office locations, or other identifiers. We redact
                common patterns before sending, but incidental identifying information may remain.
              </p>
            </section>

            <section className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <h3 className="text-sm font-medium text-zinc-100">Your controls</h3>
              <p className="mt-1 text-zinc-400">
                You can export or delete stored data from Settings, or by contacting us.
              </p>
            </section>
          </div>
        </div>

        <div className="mobile-consent-actions border-t border-zinc-800 bg-zinc-950 p-4 sm:p-5">
          <div className="flex items-start gap-3 text-sm text-zinc-300">
            <input
              id="legal-consent-checkbox"
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-zinc-600"
            />
            <div>
              <label htmlFor="legal-consent-checkbox" className="cursor-pointer">
                I agree to the Terms of Service and Privacy Policy, and I understand the AI processing described
                above.
              </label>
              <p className="mt-1 text-xs text-zinc-500">
                Review the{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  Terms
                </a>{" "}
                and{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  Privacy Policy
                </a>
                .
              </p>
            </div>
          </div>

          {error ? <p role="alert" className="mt-3 text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={!agreed || submitting}
            className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Saving..." : error ? "Try again" : "Continue to CanvasSync"}
          </button>
        </div>
      </form>
    </div>
  );
}
