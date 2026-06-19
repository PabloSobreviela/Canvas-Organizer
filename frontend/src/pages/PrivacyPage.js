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
        <p><strong className="text-zinc-100">From sync:</strong> course names and codes; assignment titles and dates; syllabus and module file text extracts; announcement titles and message excerpts needed for scheduling.</p>
        <p><strong className="text-zinc-100">We do not collect:</strong> grades, submission content, quiz answers, payment information, or government ID numbers.</p>
        <p><strong className="text-zinc-100">Technical metadata:</strong> API usage logs (e.g. token counts for AI billing) without storing full AI prompts or responses in our database.</p>
      </LegalSection>

      <LegalSection title="3. How we use information">
        <ul className="list-disc pl-5 space-y-1">
          <li>Display a unified calendar and task list.</li>
          <li>Refresh data from Canvas when you sync.</li>
          <li>Run AI date resolution when Canvas due dates are missing (core feature).</li>
          <li>Operate, secure, and debug the Service.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. AI processing (OpenRouter to DeepInfra)">
        <p>
          When you sync a course, we send relevant course text to <strong className="text-zinc-100">OpenRouter</strong> (an API gateway), which routes the request to <strong className="text-zinc-100">DeepInfra</strong> for AI inference. We use this to infer due dates that Canvas does not expose directly.
        </p>
        <p>
          AI requests are pinned to DeepInfra, require zero-data-retention (ZDR) routing, deny provider data collection, and disable provider fallback. If a matching DeepInfra ZDR endpoint is not available, the request should fail instead of routing to another provider. We do not intentionally include your name, email, or Canvas user ID in AI prompts, and we do not store full AI prompts or completions in our database.
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
        </ul>
      </LegalSection>

      <LegalSection title="6. Retention and deletion">
        <p>We retain synced data until you delete it or stop using the Service. You can export or permanently delete all stored data from Settings, which revokes Canvas tokens and erases stored rows.</p>
        <p>OAuth tokens are removed on logout. Contact us if you need help deleting data.</p>
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
