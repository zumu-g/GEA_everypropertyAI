"use client";

import { useCallback, useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { UserPlus, Shield, Trash2, CheckCircle, Lock, Building2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/db/supabase";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Member {
  email: string;
  invited_by: string | null;
  is_admin: boolean;
  created_at: string;
}

type Phase = "loading" | "ready" | "forbidden" | "signed-out";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [members, setMembers] = useState<Member[]>([]);
  const [selfEmail, setSelfEmail] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAdmin, setInviteAdmin] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [inviteError, setInviteError] = useState("");

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers.Authorization) {
      setPhase("signed-out");
      return;
    }
    const res = await fetch("/api/team", { headers });
    if (res.status === 403) {
      setPhase("forbidden");
      return;
    }
    if (!res.ok) {
      setPhase("forbidden");
      return;
    }
    const { members } = (await res.json()) as { members: Member[] };
    setMembers(members);
    setPhase("ready");
  }, []);

  useEffect(() => {
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => setSelfEmail(data.session?.user.email ?? ""));
    load();
  }, [load]);

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteStatus("sending");
    setInviteError("");
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ email: inviteEmail, isAdmin: inviteAdmin }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      setInviteStatus("error");
      setInviteError(error ?? "Couldn't send the invite. Please try again.");
      return;
    }
    setInviteStatus("sent");
    setInviteEmail("");
    setInviteAdmin(false);
    await load();
  }

  async function handleRevoke(email: string) {
    if (!confirm(`Revoke access for ${email}? They'll no longer be able to sign in.`)) return;
    const res = await fetch("/api/team", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      alert(error ?? "Couldn't revoke access.");
      return;
    }
    await load();
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FBFBFC]">
      {/* ── Navigation ── */}
      <header className="sticky top-0 z-40 border-b border-[#E7E9EE] bg-[#FBFBFC]/90 px-safe pt-safe backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="group flex items-center gap-3" aria-label="everypropertyAI home">
            <Building2
              className="h-6 w-6 shrink-0 text-[#2E5470] transition-opacity duration-150 group-hover:opacity-80"
              aria-hidden="true"
            />
            <div className="leading-none">
              <span className="block text-[1.1rem] leading-tight tracking-tight text-[#16181D]">
                everyproperty<span className="text-[#2E5470]">AI</span>
              </span>
              <span className="block text-[0.65rem] uppercase tracking-wide text-[#6B7077]">
                by Grants Estate Agents
              </span>
            </div>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="text-2xl tracking-tight text-[#16181D]">Team</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[#6B7077]">
          Invite teammates to everypropertyAI. Access is limited to invited{" "}
          <span className="font-medium text-[#16181D]">@grantsea.com.au</span> users.
        </p>

        {phase === "loading" && (
          <div className="mt-8 space-y-3">
            <div className="h-28 animate-pulse rounded-2xl bg-[#F4F5F7]" />
            <div className="h-16 animate-pulse rounded-xl bg-[#F4F5F7]" />
          </div>
        )}

        {phase === "signed-out" && (
          <LockedState
            title="Sign in required"
            body="You need to be signed in to manage the team."
            cta={{ href: "/sign-in?returnTo=/settings", label: "Sign in" }}
          />
        )}

        {phase === "forbidden" && (
          <LockedState
            title="Admins only"
            body="Only administrators can invite or remove teammates. Ask an admin if you need access."
          />
        )}

        {phase === "ready" && (
          <>
            {/* Invite form */}
            <form
              onSubmit={handleInvite}
              className="mt-8 rounded-2xl border border-[#E7E9EE] bg-white p-6"
            >
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-[#2E5470]" aria-hidden="true" />
                <h2 className="text-base font-medium text-[#16181D]">Invite a teammate</h2>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    if (inviteStatus !== "idle") setInviteStatus("idle");
                  }}
                  placeholder="name@grantsea.com.au"
                  className="w-full rounded-xl border border-[#E7E9EE] bg-white px-4 py-3 text-base text-[#16181D] placeholder-[#6B7077] transition-colors focus:border-[#2E5470] focus:outline-none focus:ring-2 focus:ring-[#2E5470]/30"
                />
                <button
                  type="submit"
                  disabled={inviteStatus === "sending"}
                  className="shrink-0 rounded-xl bg-[#2E5470] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#24435A] focus:outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {inviteStatus === "sending" ? "Sending…" : "Send invite"}
                </button>
              </div>

              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-[#4A4E57]">
                <input
                  type="checkbox"
                  checked={inviteAdmin}
                  onChange={(e) => setInviteAdmin(e.target.checked)}
                  className="h-4 w-4 rounded border-[#E7E9EE] text-[#2E5470] focus:ring-[#2E5470]/30"
                />
                Make this person an admin (can invite and remove teammates)
              </label>

              {inviteStatus === "sent" && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-[#2F8F6B]">
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  Invite sent — they&apos;ll get a magic-link email to sign in.
                </p>
              )}
              {inviteStatus === "error" && (
                <p role="alert" className="mt-3 text-xs text-[#C5544A]">
                  {inviteError}
                </p>
              )}
            </form>

            {/* Members list */}
            <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-[#6B7077]">
              Members ({members.length})
            </h2>
            <ul className="mt-3 divide-y divide-[#E7E9EE] overflow-hidden rounded-2xl border border-[#E7E9EE] bg-white">
              {members.map((m) => {
                const isSelf = m.email === selfEmail.toLowerCase();
                return (
                  <li key={m.email} className="flex items-center gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-[#16181D]">{m.email}</span>
                        {m.is_admin && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-[#8A6425]">
                            <Shield className="h-3 w-3" aria-hidden="true" />
                            Admin
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-[0.65rem] uppercase tracking-wide text-[#6B7077]">
                            You
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-[#6B7077]">
                        Added {formatDate(m.created_at)}
                        {m.invited_by ? ` · by ${m.invited_by}` : ""}
                      </span>
                    </div>
                    {!isSelf && (
                      <button
                        onClick={() => handleRevoke(m.email)}
                        aria-label={`Revoke ${m.email}`}
                        className="shrink-0 rounded-lg p-2 text-[#6B7077] transition-colors hover:bg-[#FDECEA] hover:text-[#C5544A] focus:outline-none focus:ring-2 focus:ring-[#C5544A]/30"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

// ─── Locked state ───────────────────────────────────────────────────────────

function LockedState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-[#E7E9EE] bg-white px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FBFBFC]">
        <Lock className="h-6 w-6 text-[#6B7077]" aria-hidden="true" />
      </div>
      <h2 className="text-lg text-[#16181D]">{title}</h2>
      <p className="max-w-sm text-sm leading-relaxed text-[#6B7077]">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-2 rounded-xl bg-[#2E5470] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#24435A]"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
