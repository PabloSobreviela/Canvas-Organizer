import React from "react";
import { LegalPageLayout, LegalSection } from "../components/LegalPageLayout";

const CONTACT_EMAIL =
  (process.env.REACT_APP_LEGAL_CONTACT_EMAIL || "canvassync@gatech.edu").trim();

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy">
      <LegalSection title="1. Overview">
        <p>
          This policy describes how CanvasSync collects, uses, stores, and deletes information when you use the
          Service. CanvasSync is not an official Georgia Tech system.
        </p>
      </LegalSection>

      <LegalSection title="2. Information we collect">
        <p><strong className="text-zinc-100">From Canvas OAuth:</strong> email, display name, and Canvas user identifier; encrypted OAuth tokens to access Canvas on your behalf.</p>
        <p><strong className="text-zinc-100">From sync:</strong> course names and codes; assignment titles, dates, and completion/submission status; syllabus and module file text extracts; announcement titles and message excerpts needed for scheduling.</p>
        <p><strong className="text-zinc-100">We do not collect:</strong> grades, submitted work or submission comments, quiz answers, payment information, or government ID numbers.</p>
        <p><strong className="text-zinc-100">Technical metadata:</strong> security and request logs needed to operate the Service. We do not maintain an AI prompt, completion, or token-usage log database.</p>
      </LegalSection>

      <LegalSection title="3. How we use information">
        <ul className="list-disc pl-5 space-y-1">
          <li>Display a unified calendar and task list.</li>
          <li>Refresh data from Canvas when you sync.</li>
          <li>Run AI date resolution when Canvas due dates are missing (core feature).</li>
          <li>Operate, secure, and debug the Service.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. AI processing (direct DeepInfra)">
        <p>
          When you sync a course, we send relevant course text directly to <strong className="text-zinc-100">DeepInfra</strong> using the <strong className="text-zinc-100">Qwen3-235B-A22B-Instruct-2507</strong> model. We use this to infer due dates that Canvas does not expose directly.
        </p>
        <p>
          No AI gateway or alternate-provider fallback is used. We do not intentionally include your name, email, or Canvas user ID in AI prompts, and we do not store AI prompts, completions, or token-usage logs in our database.
        </p>
        <p>
          DeepInfra states that ordinary inference inputs and outputs are processed in memory, are not used for model training, and are not stored to disk. DeepInfra also reserves the right to log a small portion of requests when necessary for debugging or security. Its current privacy terms therefore apply to course text sent for inference.
        </p>
        <p>
          <strong className="text-zinc-100">Important limitation:</strong> course text is not guaranteed anonymous. Syllabi, announcements, and files may contain instructor names, student names, email addresses, office locations, or other identifiers. We apply automated redaction for common patterns such as emails, phone numbers, tokens, and ID-like numbers before sending, but incidental identifying information may remain.
        </p>
      </LegalSection>

      <LegalSection title="5. Other service providers">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-zinc-100">Supabase</strong> — encrypted database hosting (service role access from our API only).</li>
          <li><strong className="text-zinc-100">Google Cloud Run</strong> — backend API.</li>
          <li><strong className="text-zinc-100">Vercel</strong> — frontend hosting.</li>
          <li><strong className="text-zinc-100">DeepInfra</strong> — direct AI inference.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Retention and deletion">
        <p>Synced course content is subject to a 180-day retention window. A scheduled retention job removes stale assignments, courses, announcements, syllabus rules, and extracted file text. We do not maintain a separate AI prompt, completion, or token-usage history.</p>
        <p>You can export or permanently delete all stored account data from Settings. Deletion revokes Canvas access, invalidates active sessions, and erases stored account and course rows. Logging out revokes and removes the stored Canvas OAuth tokens without deleting the rest of your account data.</p>
        <p>Contact us if you need help exercising these controls.</p>
      </LegalSection>

      <LegalSection title="7. Security">
        <p>
          Tokens are encrypted at rest. Direct database access from browsers is blocked (Row Level Security). Sessions use HttpOnly cookies on the API domain in production.
        </p>
      </LegalSection>

      <LegalSection title="8. Your choices">
        <p>You must accept our Terms and this Privacy Policy (including the AI disclosure) before AI date resolution runs. You may stop using the Service at any time.</p>
      </LegalSection>

      <LegalSection title="9. Children">
        <p>The Service is intended for enrolled university students; we do not knowingly collect data from children under 13.</p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Privacy questions or data requests:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-400 hover:underline">{CONTACT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
