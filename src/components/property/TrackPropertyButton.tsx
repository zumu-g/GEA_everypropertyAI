"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookmarkPlus, CheckCircle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/db/supabase";

type TrackState = "loading" | "signed-out" | "not-tracking" | "tracking";

interface TrackPropertyButtonProps {
  addressSlug: string;
  fullAddress: string;
}

export function TrackPropertyButton({ addressSlug, fullAddress }: TrackPropertyButtonProps) {
  const [state, setState] = useState<TrackState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        if (!cancelled) setState("signed-out");
        return;
      }

      try {
        const res = await fetch(`/api/user/properties/${addressSlug}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) {
          setState(res.ok ? "tracking" : "not-tracking");
        }
      } catch {
        if (!cancelled) setState("not-tracking");
      }
    }

    init();
    return () => { cancelled = true; };
  }, [addressSlug]);

  const handleTrack = async () => {
    setBusy(true);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      await fetch("/api/user/properties", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slug: addressSlug, fullAddress }),
      });
      setState("tracking");
    } finally {
      setBusy(false);
    }
  };

  const handleUntrack = async () => {
    if (!confirm("Stop tracking this property?")) return;
    setBusy(true);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      await fetch(`/api/user/properties/${addressSlug}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setState("not-tracking");
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return null;

  if (state === "signed-out") {
    const returnTo = encodeURIComponent(
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : ""
    );
    return (
      <Link
        href={`/sign-in?returnTo=${returnTo}`}
        className="border border-[#E7E9EE] rounded-xl px-4 py-2 text-sm text-[#6B7077] hover:border-[#2E5470] hover:text-[#2E5470] transition-colors"
      >
        Track this property
      </Link>
    );
  }

  if (state === "not-tracking") {
    return (
      <button
        onClick={handleTrack}
        disabled={busy}
        className="bg-[#2E5470] hover:bg-[#24435A] text-white rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-60"
      >
        <BookmarkPlus className="h-4 w-4" />
        Track this property
      </button>
    );
  }

  return (
    <button
      onClick={handleUntrack}
      disabled={busy}
      className="border border-[#2F8F6B] text-[#2F8F6B] rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2 hover:bg-[#F7E7E5] hover:border-[#EFCBC7] hover:text-[#C5544A] transition-colors disabled:opacity-60"
    >
      <CheckCircle className="h-4 w-4" />
      Tracking ✓
    </button>
  );
}
