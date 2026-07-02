"use client";

import { useState, FormEvent } from "react";
import { Mail, CheckCircle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/db/supabase";

// Request a password-reset email. Neutral confirmation regardless of outcome so we
// never reveal whether an account exists (no enumeration).
function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      // Pre-check so we don't email a reset link to non-invited addresses. The
      // neutral success copy below is shown either way (no enumeration).
      const check = await fetch("/api/auth/check-allowed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const { allowed } = (await check.json()) as { allowed?: boolean };
      if (allowed) {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?returnTo=/auth/set-password`,
        });
      }
      setStatus("sent");
    } catch {
      // Still show the neutral confirmation — never leak failure detail.
      setStatus("sent");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E4F1EB]">
          <CheckCircle className="h-7 w-7 text-[#2F8F6B]" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl text-[#16181D]">Check your email</h2>
          <p className="text-sm leading-relaxed text-[#6B7077]">
            If an account exists for that address, we&apos;ve sent a link to reset your password.
          </p>
        </div>
        <a
          href="/sign-in"
          className="mt-1 text-sm text-[#2E5470] underline-offset-2 hover:underline focus:outline-none"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FBFBFC]">
          <Mail className="h-6 w-6 text-[#2E5470]" aria-hidden="true" />
        </div>
      </div>
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl tracking-tight text-[#16181D]">Reset your password</h1>
        <p className="text-sm leading-relaxed text-[#6B7077]">
          Enter your email and we&apos;ll send you a link to set a new password.
        </p>
      </div>

      <div className="mt-2">
        <label htmlFor="email" className="sr-only">Email address</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@grantsea.com.au"
          className="w-full rounded-xl border border-[#E7E9EE] bg-white px-4 py-3 text-base text-[#16181D] placeholder-[#6B7077] transition-colors focus:border-[#2E5470] focus:outline-none focus:ring-2 focus:ring-[#2E5470]/30"
        />
      </div>

      {error && <p role="alert" className="text-xs text-[#C5544A]">{error}</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-xl bg-[#2E5470] py-3 text-sm font-medium text-white transition-colors hover:bg-[#24435A] focus:outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "Sending…" : "Send reset link"}
      </button>

      <div className="text-center">
        <a href="/sign-in" className="text-sm text-[#2E5470] underline-offset-2 hover:underline">
          Back to sign in
        </a>
      </div>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#FBFBFC]">
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md rounded-2xl border border-[#E7E9EE] bg-white p-8">
          <ForgotPasswordForm />
        </div>
      </main>
    </div>
  );
}
