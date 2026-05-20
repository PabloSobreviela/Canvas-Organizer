import React, { useState } from "react";
import { API_BASE } from "../config";
import { apiFetchOptions } from "../auth";

const CONSENT_VERSION = "2026-05-20";

export function ConsentModal({ onAccepted }) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleContinue() {
    if (!agreed) return;
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
      setError(err?.message || "Could not save consent. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
      <div
        role="dialog"
        aria-labelledby="consent-title"
        className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-950 p-6 shadow-xl"
      >
        <h2 id="consent-title" className="text-lg font-semibold text-white">
          Before you sync
        </h2>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
          CanvasSync uses AI to find due dates in your course materials. Please review how we handle your data.
        </p>

        <ul className="mt-4 space-y-2 text-sm text-zinc-300 list-disc pl-5">
          <li>
            We access Canvas with OAuth (read-only course data). We do not collect grades or submissions.
          </li>
          <li>
            To resolve missing due dates, we send course text (syllabus excerpts, assignment titles, short
            announcement snippets) to <strong className="text-zinc-100">OpenRouter</strong>. We do not send your
            name or email in those requests.
          </li>
          <li>
            OpenRouter input/output logging is <strong className="text-zinc-100">disabled</strong> on our
            account. OpenRouter does not retain prompt content by default; we also request zero-data-retention
            routing where supported.
          </li>
          <li>
            <strong className="text-zinc-100">Content anonymity is not fully guaranteed:</strong> syllabi may
            contain instructor names, emails, or other text. We redact common patterns before sending, but cannot
            remove all identifying information.
          </li>
          <li>You can delete all stored data anytime from Settings (when available) or by contacting us.</li>
        </ul>

        <label className="mt-5 flex items-start gap-3 cursor-pointer text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 rounded border-zinc-600"
          />
          <span>
            I agree to the{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              Privacy Policy
            </a>
            , and I understand how AI processing works as described above.
          </span>
        </label>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <button
          type="button"
          disabled={!agreed || submitting}
          onClick={handleContinue}
          className="mt-5 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Saving…" : "Continue to CanvasSync"}
        </button>
      </div>
    </div>
  );
}
