"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function FollowButton({ wallet }: { wallet: string }) {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const { data } = await supabase
        .from("follows")
        .select("id")
        .eq("user_id", user.id)
        .eq("wallet", wallet)
        .maybeSingle();
      setFollowing(!!data);
      setLoading(false);
    }
    load();
  }, [wallet, supabase]);

  async function toggle() {
    if (!userId) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    if (following) {
      const { error } = await supabase.from("follows").delete().eq("user_id", userId).eq("wallet", wallet);
      if (!error) setFollowing(false);
    } else {
      const { error } = await supabase.from("follows").insert({ user_id: userId, wallet });
      if (!error) setFollowing(true);
    }
    setLoading(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`px-4 py-1.5 text-sm rounded-md border transition-colors disabled:opacity-50 ${
        following
          ? "border-accent text-accent hover:bg-accent/10"
          : "border-hairline text-parchment hover:border-accent"
      }`}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
