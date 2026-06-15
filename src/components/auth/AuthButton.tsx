"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/db/supabase";

type AuthState = "loading" | "signed-out" | "signed-in";

export function AuthButton() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user.email) {
        setEmail(data.session.user.email);
        setAuthState("signed-in");
      } else {
        setAuthState("signed-out");
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.email) {
        setEmail(session.user.email);
        setAuthState("signed-in");
      } else {
        setEmail("");
        setAuthState("signed-out");
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSignOut = async () => {
    await getSupabaseBrowserClient().auth.signOut();
    window.location.href = "/";
  };

  const toggleDropdown = () => setOpen((prev) => !prev);

  if (authState === "loading") return null;

  if (authState === "signed-out") {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    return (
      <a
        href={`/sign-in?returnTo=${returnTo}`}
        className="rounded-lg border border-[#E7E9EE] bg-white px-4 py-2 text-sm font-medium text-[#16181D] transition-all hover:border-[#C8A96E] hover:text-[#C8A96E]"
      >
        Sign in
      </a>
    );
  }

  const truncatedEmail = email.length > 22 ? email.slice(0, 22) + "…" : email;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="flex items-center gap-1.5 rounded-lg border border-[#E7E9EE] bg-white px-4 py-2.5 text-sm font-medium text-[#16181D] transition-all hover:border-[#C8A96E] hover:text-[#C8A96E]"
      >
        {truncatedEmail}
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 max-w-[90vw] rounded-xl border border-[#E7E9EE] bg-white shadow-md z-50 py-1">
          <a
            href="/my-properties"
            className="block px-4 py-2.5 text-sm text-[#16181D] hover:bg-[#FBFBFC]"
          >
            My Properties
          </a>
          <button
            onClick={handleSignOut}
            className="block w-full px-4 py-2.5 text-left text-sm text-[#4A4E57] hover:bg-[#FBFBFC]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
