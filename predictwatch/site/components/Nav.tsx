"use client";

import { useState } from "react";
import Link from "next/link";
import TraderSearch from "@/components/TraderSearch";

const NAV_LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/leaderboard", label: "Traders" },
  { href: "/methodology", label: "Methodology" },
  { href: "/contact", label: "Contact" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-hairline">
      <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-6">
        <Link href="/" className="font-[family-name:var(--font-display)] italic text-xl tracking-tight text-parchment shrink-0">
          Sirtio
        </Link>

        {/* Desktop: full inline layout, unchanged */}
        <div className="hidden md:block flex-1 max-w-xs">
          <TraderSearch compact />
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-muted shrink-0">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-parchment transition-colors">
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile: hamburger toggle */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="md:hidden p-2 -mr-2 text-parchment"
        >
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile: dropdown panel, only rendered when open */}
      {open && (
        <div className="md:hidden border-t border-hairline px-6 py-5 space-y-5">
          <TraderSearch compact />
          <div className="flex flex-col gap-4 text-sm text-muted">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="hover:text-parchment transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
