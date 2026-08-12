"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TraderSearch({ compact = false }: { compact?: boolean }) {
  const [value, setValue] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(`/trader/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search wallet or username..."
        className={`bg-surface border border-hairline rounded-md text-parchment placeholder:text-muted focus:outline-none focus:border-accent transition-colors ${
          compact ? "text-sm px-3 py-1.5 w-48" : "px-4 py-2 w-full"
        }`}
      />
    </form>
  );
}
