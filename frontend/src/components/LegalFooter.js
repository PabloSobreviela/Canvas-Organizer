import React from "react";

const CONTACT_EMAIL =
  (process.env.REACT_APP_LEGAL_CONTACT_EMAIL || "canvassync@gatech.edu").trim();

export function LegalFooter({ className = "" }) {
  return (
    <footer className={`px-6 py-4 text-xs text-zinc-500 ${className}`.trim()}>
      <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
        <p>© {new Date().getFullYear()} CanvasSync · Not an official Georgia Tech service</p>
        <nav className="flex flex-wrap gap-4">
          <a href="/privacy" className="hover:text-zinc-300 transition-colors">Privacy</a>
          <a href="/terms" className="hover:text-zinc-300 transition-colors">Terms</a>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-zinc-300 transition-colors">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
