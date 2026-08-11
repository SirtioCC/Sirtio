"use client";

import { useState } from "react";
import { truncateWallet } from "@/lib/format";

export default function CopyableWallet({ wallet }: { wallet: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fail silently — non-critical convenience feature
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : `Click to copy: ${wallet}`}
      className="font-mono text-xs text-muted hover:text-parchment transition-colors cursor-pointer"
    >
      {copied ? "Copied!" : truncateWallet(wallet)}
    </button>
  );
}