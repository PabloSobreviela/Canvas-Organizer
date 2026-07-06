import React from "react";
import { LegalPageLayout, LegalSection } from "../components/LegalPageLayout";

const CONTACT_EMAIL =
  (process.env.REACT_APP_LEGAL_CONTACT_EMAIL || "pablo3@gatech.edu").trim();

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service">
      <LegalSection title="1. Agreement">
        <p>
          By creating or using a CanvasSync account, you agree to these Terms of Service and the Privacy Policy.
          If you do not agree, do not authorize Canvas access or use the Service.
        </p>
      </LegalSection>

      <LegalSection title="2. What CanvasSync is">
        <p>
          CanvasSync is an independent Georgia Tech student-developed tool that aggregates course deadlines from
          Georgia Tech Canvas (<code className="text-zinc-400">gatech.instructure.com</code>) into a unified calendar
          view. It is operated by its student developer and is <strong className="text-zinc-100">not</strong> an
          official, sponsored, or endorsed Georgia Tech or Instructure product.
        </p>
        <p>
          When enabled, AI-assisted date resolution analyzes selected course materials to infer dates that Canvas
          does not provide as structured due dates. Use with Georgia Tech Canvas data remains subject to the
          conditions Georgia Tech sets when issuing and administering its local Developer Key.
        </p>
      </LegalSection>

      <LegalSection title="3. Eligibility and accounts">
        <p>You must be at least 18 years old and authorized to access the Canvas account you connect. CanvasSync does not store your Canvas password.</p>
        <p>You are responsible for activity under your account and for keeping your session secure on devices you control.</p>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <ul className="list-disc pl-5 space-y-1">
          <li>Use the Service only for authorized academic planning.</li>
          <li>Do not share access tokens, scrape other users' data, or attempt to bypass rate limits.</li>
          <li>Comply with the Canvas API Policy, Georgia Tech policies, course rules, and applicable law.</li>
          <li>Do not use the Service to harass, cheat, infringe rights, or disrupt university systems.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Canvas, providers, and ownership">
        <p>
          The Service uses Canvas APIs under your authorization. CanvasSync uses Supabase for its database and
          private storage, Google Cloud for its API, Vercel for the web app, and—only when AI is enabled—DeepInfra
          for direct model inference. Their processing is governed by the operator's arrangements with those
          providers and the disclosures in the Privacy Policy; using CanvasSync does not ordinarily create a
          separate account for you with those providers.
        </p>
        <p>
          CanvasSync claims no ownership of Canvas information, course materials, or AI-assisted results derived
          from them. Rights remain with the applicable Canvas customer, user, instructor, publisher, or other
          rightsholder. You may use the Service only with content and access you are authorized to use.
        </p>
      </LegalSection>

      <LegalSection title="6. Disclaimers">
        <p>
          The Service is provided <strong className="text-zinc-100">"as is"</strong> without warranty. Dates inferred
          by AI or parsed from course materials may be wrong. AI-generated and AI-assisted dates are labeled in the
          app. Always verify deadlines in Canvas. CanvasSync is not liable for missed assignments, incorrect dates,
          or academic consequences to the fullest extent permitted by law.
        </p>
      </LegalSection>

      <LegalSection title="7. Limitation of liability">
        <p>
          To the fullest extent permitted by law, the student developer's liability is limited to direct damages not
          exceeding one hundred U.S. dollars ($100) in the aggregate for claims arising from use of the Service
          during a pilot period.
        </p>
      </LegalSection>

      <LegalSection title="8. Termination">
        <p>
          You may stop using the Service or request deletion of active app data at any time. The student developer
          may suspend the Service for security, legal, operational, or pilot reasons. Georgia Tech may independently
          disable access to its Canvas instance or revoke a Developer Key; that does not imply Georgia Tech operates
          or endorses CanvasSync.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes">
        <p>
          These Terms may be updated prospectively. Material changes will receive actual notice in the Service.
          If a change materially expands collection, use, disclosure, or retention of Canvas data, CanvasSync will
          require affirmative acceptance before future syncing or AI processing. Declining means you may stop using
          the changed Service and request deletion.
        </p>
      </LegalSection>

      <LegalSection title="10. Operator and contact">
        <p>
          CanvasSync is operated in an individual student-developer capacity. Questions, notices, and support
          requests: <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-400 hover:underline">{CONTACT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
