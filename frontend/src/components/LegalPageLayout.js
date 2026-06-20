import React from "react";
import { LegalFooter } from "./LegalFooter";

export function LegalPageLayout({ title, children }) {
  return (
    <div className="min-h-screen bg-black text-zinc-200 flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header className="h-12 flex items-center px-5 bg-zinc-950 border-b border-zinc-800 shrink-0">
        <a href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">
          ← CanvasSync
        </a>
      </header>
      <main className="flex-1 overflow-auto">
        <article className="max-w-3xl mx-auto px-6 py-10 prose-invert">
          <h1 className="text-2xl font-semibold text-white mb-2">{title}</h1>
          <p className="text-xs text-zinc-500 mb-8">Last updated: June 19, 2026 · Version 2026-06-19</p>
          <div className="space-y-6 text-sm text-zinc-300 leading-relaxed">{children}</div>
        </article>
      </main>
      <LegalFooter className="border-t border-zinc-800 bg-zinc-950" />
    </div>
  );
}

export function LegalSection({ title, children }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-zinc-100 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
