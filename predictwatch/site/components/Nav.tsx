import Link from "next/link";

export default function Nav() {
  return (
    <header className="border-b border-hairline">
      <nav className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] italic text-xl tracking-tight text-parchment"
        >
          PredictWatch
        </Link>
        <div className="flex items-center gap-8 text-sm text-muted">
          <Link href="/markets" className="hover:text-parchment transition-colors">
            Markets
          </Link>
          <Link href="/leaderboard" className="hover:text-parchment transition-colors">
            Traders
          </Link>
          <Link href="/methodology" className="hover:text-parchment transition-colors">
            Methodology
          </Link>
        </div>
      </nav>
    </header>
  );
}
