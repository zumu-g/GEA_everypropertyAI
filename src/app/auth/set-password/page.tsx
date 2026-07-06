"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { KeyRound, CheckCircle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/db/supabase";

// Mirror Supabase's configured minimum (see Operational Notes in the plan).
const MIN_PASSWORD_LENGTH = 8;

type Phase = "checking" | "ready" | "no-session" | "saving" | "done";

// Set a password from within the session established by an invite or recovery link.
function SetPasswordForm() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // The invite/recovery link (via /auth/callback) leaves the user in a session.
    // No session = direct visit or expired link.
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => setPhase(data.session ? "ready" : "no-session"));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPhase("saving");
    const { error: updErr } = await getSupabaseBrowserClient().auth.updateUser({ password });
    if (updErr) {
      setPhase("ready");
      setError(updErr.message || "Couldn't set your password. Please try again.");
      return;
    }
    setPhase("done");
    window.location.href = "/my-properties";
  }

  if (phase === "checking") {
    return <div className="h-32 animate-pulse rounded-xl bg-[#F4F5F7]" aria-hidden="true" />;
  }

  if (phase === "no-session") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-xl text-[#16181D]">Link expired</h1>
        <p className="max-w-sm text-sm leading-relaxed text-[#6B7077]">
          This link is invalid or has expired. Request a new one to set your password.
        </p>
        <Link
          href="/forgot-password"
          className="mt-2 rounded-xl bg-[#2E5470] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#24435A]"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E4F1EB]">
          <CheckCircle className="h-7 w-7 text-[#2F8F6B]" aria-hidden="true" />
        </div>
        <p className="text-sm text-[#6B7077]">Password set — signing you in…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FBFBFC]">
          <KeyRound className="h-6 w-6 text-[#2E5470]" aria-hidden="true" />
        </div>
      </div>
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl tracking-tight text-[#16181D]">Set your password</h1>
        <p className="text-sm leading-relaxed text-[#6B7077]">
          Choose a password to finish setting up your account.
        </p>
      </div>

      <div className="mt-2">
        <label htmlFor="password" className="sr-only">New password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="w-full rounded-xl border border-[#E7E9EE] bg-white px-4 py-3 text-base text-[#16181D] placeholder-[#6B7077] transition-colors focus:border-[#2E5470] focus:outline-none focus:ring-2 focus:ring-[#2E5470]/30"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="sr-only">Confirm password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          className="w-full rounded-xl border border-[#E7E9EE] bg-white px-4 py-3 text-base text-[#16181D] placeholder-[#6B7077] transition-colors focus:border-[#2E5470] focus:outline-none focus:ring-2 focus:ring-[#2E5470]/30"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-[#C5544A]">{error}</p>
      )}

      <button
        type="submit"
        disabled={phase === "saving"}
        className="w-full rounded-xl bg-[#2E5470] py-3 text-sm font-medium text-white transition-colors hover:bg-[#24435A] focus:outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {phase === "saving" ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#FBFBFC]">
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md rounded-2xl border border-[#E7E9EE] bg-white p-8">
          <SetPasswordForm />
        </div>
      </main>
    </div>
  );
}
