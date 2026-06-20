import React from "react";
import { LegalPageLayout, LegalSection } from "../components/LegalPageLayout";

const CONTACT_EMAIL =
  (process.env.REACT_APP_LEGAL_CONTACT_EMAIL || "pablo3@gatech.edu").trim();

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy">
      <LegalSection title="1. Overview">
        <p>
          This policy describes how CanvasSync collects, uses, stores, and deletes information when you use the
          Service. CanvasSync is an independent Georgia Tech student-developed app operated by its student developer.
          It is not an official, sponsored, or endorsed Georgia Tech or Instructure system.
        </p>
      </LegalSection>

      <LegalSection title="2. Information we collect">
        <p><strong className="text-zinc-100">From Canvas OAuth:</strong> email address or Canvas login identifier, display name, Canvas user identifier, Canvas instance URL, and encrypted OAuth tokens used to access Canvas on your behalf.</p>
        <p><strong className="text-zinc-100">From sync:</strong> course names, codes, and metadata; assignment titles, descriptions, dates, and current-user completion/submission status; syllabus, page, module, and relevant course-file text extracts; and announcement titles and full message content used for date extraction.</p>
        <p><strong className="text-zinc-100">On your device:</strong> the web app uses browser storage for a cached user profile, Canvas instance URL, course and assignment caches, completion state, sync status, filters, colors, and display preferences. Production Canvas OAuth tokens are not stored in browser storage. The public demo uses a short-lived synthetic demo token in session storage.</p>
        <p><strong className="text-zinc-100">We do not collect:</strong> grades, submitted work or submission comments, quiz answers, payment information, or government ID numbers.</p>
        <p><strong className="text-zinc-100">Technical metadata:</strong> IP address and request, security, error, and deployment metadata that may be created by CanvasSync, Google Cloud, Vercel, Supabase, Canvas, or DeepInfra to operate and secure their services. CanvasSync does not maintain a separate AI prompt, completion, cost, or token-usage history table.</p>
      </LegalSection>

      <LegalSection title="3. How we use information">
        <ul className="list-disc pl-5 space-y-1">
          <li>Display a unified calendar and task list.</li>
          <li>Refresh data from Canvas when you request a sync.</li>
          <li>Run AI date resolution, when enabled, for dates missing from structured Canvas fields.</li>
          <li>Operate, secure, troubleshoot, and improve the Service.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. AI processing (direct DeepInfra, when enabled)">
        <p>
          When AI is enabled and you use date resolution, CanvasSync sends a minimized selection of assignment
          titles, limited assignment context, announcement snippets, and relevant extracted course text directly to{" "}
          <strong className="text-zinc-100">DeepInfra</strong> using the{" "}
          <strong className="text-zinc-100">Qwen3-235B-A22B-Instruct-2507</strong> model. AI is used only to infer
          or reconcile scheduling dates.
        </p>
        <p>
          No AI gateway or alternate-provider fallback is used. CanvasSync does not intentionally include your name,
          email, Canvas user ID, session ID, or OAuth token in AI prompts and does not store prompts or completions
          in a separate application telemetry database.
        </p>
        <p>
          DeepInfra describes its ordinary synchronous inference API as zero-data-retention by default: inputs and
          outputs are processed in memory, are not used for model training, and are not stored to disk after
          inference. CanvasSync uses that standard synchronous endpoint, not DeepInfra's bulk API. DeepInfra reserves
          the right to log a small portion of requests when necessary for debugging or security, so that exception
          remains part of this disclosure.
        </p>
        <p>
          <strong className="text-zinc-100">Important limitation:</strong> course text is not guaranteed anonymous.
          Syllabi, announcements, descriptions, and files may contain instructor names, student names, email
          addresses, office locations, or other identifiers. Automated redaction removes common email, phone, token,
          and ID-like patterns before transmission, but incidental identifying information may remain.
        </p>
        <p>
          CanvasSync will not have access to Georgia Tech Canvas data until Georgia Tech issues and enables a local
          Developer Key. Georgia Tech may restrict or disallow this AI data flow as a condition of development,
          pilot, or production access.
        </p>
      </LegalSection>

      <LegalSection title="5. Service providers">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-zinc-100">Supabase</strong> — private database and storage.</li>
          <li><strong className="text-zinc-100">Google Cloud Run and Cloud Logging</strong> — backend API and operational logging.</li>
          <li><strong className="text-zinc-100">Vercel</strong> — frontend hosting and deployment metadata.</li>
          <li><strong className="text-zinc-100">Instructure Canvas</strong> — authentication and source course data.</li>
          <li><strong className="text-zinc-100">DeepInfra</strong> — direct AI inference only when the AI feature is enabled.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Retention, export, and deletion">
        <p>Active synced course content is subject to a 180-day retention window. A scheduled retention job removes stale assignments, courses, announcements, syllabus rules, and extracted file text. CanvasSync does not maintain a separate AI prompt, completion, cost, or token-usage history.</p>
        <p>You can export your active CanvasSync profile, preferences, and course records from Settings; encrypted credentials, browser-only display settings, and provider operational logs are excluded. Successful account deletion removes active database rows and private storage objects, removes stored Canvas credentials, invalidates app sessions, attempts remote Canvas-token revocation, and clears CanvasSync browser caches on the device performing the deletion. If private-storage cleanup cannot be confirmed, deletion fails so it can be retried safely.</p>
        <p>Other devices may retain browser-only caches until CanvasSync is opened again with the invalidated session, the user signs out, or the browser's site data is cleared. Those caches cannot refresh or retrieve server data after session invalidation.</p>
        <p>Cloud, security, abuse-prevention, backup, and provider logs may remain for the provider's configured retention period and are not necessarily removed immediately by the in-app deletion control. Logging out removes locally stored Canvas credentials and attempts remote revocation without deleting the rest of your course data.</p>
        <p>Contact us if you need help exercising these controls.</p>
      </LegalSection>

      <LegalSection title="7. Security">
        <p>
          Tokens are encrypted at rest. Browser database roles are denied direct table access using Row Level
          Security, while the backend uses a protected service role. Production sessions use Secure, HttpOnly
          cookies. State-changing cookie requests require a trusted origin and a custom CSRF header.
        </p>
      </LegalSection>

      <LegalSection title="8. Your choices">
        <p>You must affirmatively accept the current Terms and Privacy Policy before Canvas data is synced. Material changes to data practices require acceptance of a new policy version before future sync or AI processing. You may decline, stop using the Service, disconnect Canvas, export active records, or request deletion.</p>
      </LegalSection>

      <LegalSection title="9. Age">
        <p>The Service is intended for authorized Georgia Tech Canvas users who are at least 18 years old. CanvasSync does not knowingly offer the Service to or process Canvas data for users under 18.</p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Privacy, support, or data requests:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-400 hover:underline">{CONTACT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
