"use client";

import { Suspense, useState, FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, CheckCircle } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/db/supabase";

// ─── Inner form (needs useSearchParams, must be inside Suspense) ─────────────

function SignInForm() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "/my-properties";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [sentTo, setSentTo] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`,
        },
      });

      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
      } else {
        setSentTo(email);
        setStatus("success");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E4F1EB]">
          <CheckCircle className="h-7 w-7 text-[#2F8F6B]" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h2
            className="text-xl text-[#16181D]"
          >
            Check your email
          </h2>
          <p className="text-sm leading-relaxed text-[#6B7077]">
            We&apos;ve sent a sign-in link to{" "}
            <span className="font-medium text-[#16181D]">{sentTo}</span>.
            <br />
            It expires in 10 minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEmail("");
            setStatus("idle");
            setSentTo("");
          }}
          className="mt-1 text-sm text-[#C8A96E] underline-offset-2 hover:underline focus:outline-none"
        >
          Wrong email? Try again
        </button>
      </div>
    );
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {/* Icon */}
      <div className="flex justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FBFBFC]">
          <Mail className="h-6 w-6 text-[#C8A96E]" aria-hidden="true" />
        </div>
      </div>

      {/* Heading */}
      <div className="space-y-1.5 text-center">
        <h1
          className="text-2xl tracking-tight text-[#16181D]"
        >
          Sign in to PropertyIQ
        </h1>
        <p className="text-sm leading-relaxed text-[#6B7077]">
          Enter your email and we&apos;ll send you a magic link — no password needed.
        </p>
      </div>

      {/* Email field */}
      <div className="mt-2">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border border-[#E7E9EE] bg-white px-4 py-3 text-base text-[#16181D] placeholder-[#6B7077] transition-colors focus:border-[#C8A96E] focus:outline-none focus:ring-2 focus:ring-[#C8A96E]/30"
        />
      </div>

      {/* Error message */}
      {status === "error" && (
        <p role="alert" className="text-xs text-[#C5544A]">
          {errorMessage}
        </p>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-xl bg-[#C8A96E] py-3 text-sm font-medium text-white transition-colors hover:bg-[#B8954A] focus:outline-none focus:ring-2 focus:ring-[#C8A96E] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#FBFBFC]">
      {/* ── Navigation ── */}
      <header className="sticky top-0 z-40 border-b border-[#E7E9EE] bg-[#FBFBFC]/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a
            href="/"
            className="group flex items-center gap-3"
            aria-label="PropertyIQ home"
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#16181D] text-xs font-medium tracking-wide text-[#C8A96E] transition-opacity duration-150 group-hover:opacity-80"
              aria-hidden="true"
            >
              GEA
            </span>
            <div className="leading-none">
              <span
                className="block text-[1.1rem] leading-tight tracking-tight text-[#16181D]"
              >
                Property<span className="text-[#C8A96E]">IQ</span>
              </span>
              <span className="block text-[0.65rem] uppercase tracking-wide text-[#6B7077]">
                by Grants Estate Agents
              </span>
            </div>
          </a>
        </div>
      </header>

      {/* ── Centred card ── */}
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md rounded-2xl border border-[#E7E9EE] bg-white p-8 ">
          <Suspense fallback={<SignInFormFallback />}>
            <SignInForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

// Minimal skeleton shown while useSearchParams resolves
function SignInFormFallback() {
  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto h-12 w-12 animate-pulse rounded-xl bg-[#F4F5F7]" />
      <div className="space-y-2 text-center">
        <div className="mx-auto h-7 w-48 animate-pulse rounded-lg bg-[#F4F5F7]" />
        <div className="mx-auto h-4 w-64 animate-pulse rounded bg-[#F4F5F7]" />
      </div>
      <div className="mt-2 h-11 animate-pulse rounded-xl bg-[#F4F5F7]" />
      <div className="h-11 animate-pulse rounded-xl bg-[#F4F5F7]" />
    </div>
  );
}
