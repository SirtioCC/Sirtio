"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import TraderSearch from "@/components/TraderSearch";
import { createClient } from "@/lib/supabase/client";
import { logout } from "@/app/auth/actions";

const NAV_LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/methodology", label: "Methodology" },
  { href: "/contact", label: "Contact" },
];

export default function Nav({ freshness }: { freshness?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: User | null } }) => setLoggedIn(!!user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => setLoggedIn(!!session?.user)
    );
    return () => subscription.unsubscribe();
  }, []);

  const authLinks = loggedIn
    ? [{ href: "/following", label: "Following" }]
    : [
        { href: "/login", label: "Log In" },
        { href: "/signup", label: "Sign Up" },
      ];

  return (
    <header className="border-b border-hairline">
      <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Image src="/logo.png" alt="Sirtio" width={44} height={44} priority />
          <span className="font-[family-name:var(--font-display)] italic text-2xl tracking-tight text-parchment">
            Sirtio
          </span>
        </Link>

        {/* Desktop: full inline layout, unchanged */}
        <div className="hidden md:block flex-1 max-w-sm">
          <TraderSearch compact />
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-muted shrink-0">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-parchment transition-colors">
              {link.label}
            </Link>
          ))}
          {authLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-parchment transition-colors">
              {link.label}
            </Link>
          ))}
          {loggedIn && (
            <form action={logout}>
              <button type="submit" className="hover:text-parchment transition-colors">
                Log Out
              </button>
            </form>
          )}
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

      {freshness && (
        <div className="max-w-6xl mx-auto px-6 pb-3 -mt-2">
          {freshness}
        </div>
      )}

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
            {authLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="hover:text-parchment transition-colors"
              >
                {link.label}
              </Link>
            ))}
            {loggedIn && (
              <form action={logout}>
                <button type="submit" className="text-left hover:text-parchment transition-colors">
                  Log Out
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
