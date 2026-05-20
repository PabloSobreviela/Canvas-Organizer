import React from "react";
import { LegalPageLayout, LegalSection } from "../components/LegalPageLayout";

const CONTACT_EMAIL =
  (process.env.REACT_APP_LEGAL_CONTACT_EMAIL || "canvassync@gatech.edu").trim();

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service">
      <LegalSection title="1. Agreement">
        <p>
          By using CanvasSync (“Service”), you agree to these Terms of Service and our Privacy Policy. If you do
          not agree, do not use the Service.
        </p>
      </LegalSection>

      <LegalSection title="2. What CanvasSync is">
        <p>
          CanvasSync is an independent student-built tool that aggregates course deadlines from Georgia Tech
          Canvas (<code className="text-zinc-400">gatech.instructure.com</code>) into a unified calendar view.
          It is <strong className="text-zinc-100">not</strong> an official Georgia Tech or Instructure product.
        </p>
        <p>
          AI-assisted date resolution is a core feature: when Canvas does not provide a due date, the Service may
          analyze course materials to infer one.
        </p>
      </LegalSection>

      <LegalSection title="3. Eligibility and accounts">
        <p>You must be authorized to access your Canvas account. You sign in via Canvas OAuth; we do not store your Canvas password.</p>
        <p>You are responsible for activity under your account and for keeping your session secure on devices you control.</p>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <ul className="list-disc pl-5 space-y-1">
          <li>Use the Service only for your own academic planning.</li>
          <li>Do not share access tokens, scrape other users’ data, or attempt to bypass rate limits.</li>
          <li>Comply with the Canvas API Policy, Georgia Tech policies, and applicable law.</li>
          <li>Do not use the Service to harass, cheat, or disrupt university systems.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Canvas and third-party services">
        <p>
          The Service uses Canvas APIs under your authorization. We use Supabase (database), Google Cloud (API
          hosting), Vercel (web app), and OpenRouter (AI routing) as subprocessors. Their terms apply to their
          respective services.
        </p>
      </LegalSection>

      <LegalSection title="6. Disclaimers">
        <p>
          The Service is provided <strong className="text-zinc-100">“as is”</strong> without warranty. Due dates
          inferred by AI or parsed from syllabi may be wrong. Always verify deadlines in Canvas. We are not
          liable for missed assignments, incorrect dates, or academic consequences.
        </p>
      </LegalSection>

      <LegalSection title="7. Limitation of liability">
        <p>
          To the fullest extent permitted by law, the maintainers’ liability is limited to direct damages not
          exceeding one hundred U.S. dollars ($100) in the aggregate for claims arising from use of the Service
          during a pilot period.
        </p>
      </LegalSection>

      <LegalSection title="8. Termination">
        <p>
          You may stop using the Service at any time and request deletion of your data. We or Georgia Tech OIT may
          suspend or terminate access during a pilot, including by revoking the Canvas developer key.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes">
        <p>
          We may update these Terms. Material changes will be reflected in the “Last updated” date. Continued use
          after changes constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Questions: <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-400 hover:underline">{CONTACT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
