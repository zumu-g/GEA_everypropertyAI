"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Home, Building2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/db/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackedProperty {
  slug: string;
  fullAddress: string;
  estimatedValue: number | null;
  claimedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const auCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function truncateEmail(email: string, max = 20): string {
  return email.length > max ? email.slice(0, max) + "…" : email;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PropertySkeleton() {
  return (
    <div
      className="h-28 animate-pulse rounded-xl bg-[#F4F5F7]"
      aria-hidden="true"
    />
  );
}

// ─── Property Card ────────────────────────────────────────────────────────────

interface PropertyCardProps {
  property: TrackedProperty;
  onRemove: (slug: string) => void;
}

function PropertyCard({ property, onRemove }: PropertyCardProps) {
  const [removing, setRemoving] = useState(false);

  async function handleStopTracking() {
    setRemoving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      const res = await fetch(`/api/user/properties/${property.slug}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.ok) {
        onRemove(property.slug);
      } else {
        setRemoving(false);
      }
    } catch {
      setRemoving(false);
    }
  }

  return (
    <article className="rounded-xl border border-[#E7E9EE] bg-white p-6 transition-shadow hover:shadow-md">
      {/* Address row */}
      <div className="flex items-start gap-3">
        <MapPin
          className="mt-0.5 h-4 w-4 shrink-0 text-[#2E5470]"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-[#16181D]">
          {property.fullAddress}
        </span>
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex gap-8">
          <div>
            <p className="text-[0.65rem] uppercase tracking-wide text-[#6B7077]">
              Estimated Value
            </p>
            <p
              className="mt-0.5 text-base font-medium text-[#2E5470]"
            >
              {property.estimatedValue !== null
                ? auCurrency.format(property.estimatedValue)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-wide text-[#6B7077]">
              Tracked since
            </p>
            <p className="mt-0.5 text-xs text-[#6B7077]">
              {formatDate(property.claimedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Actions row */}
      <div className="mt-4 flex items-center justify-between">
        <Link
          href={`/property?address=${encodeURIComponent(property.fullAddress)}`}
          className="text-sm font-medium text-[#2E5470] transition-colors hover:text-[#24435A] focus:outline-none focus:underline"
        >
          View Property →
        </Link>

        <button
          type="button"
          onClick={handleStopTracking}
          disabled={removing}
          className="-mx-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm text-[#C5544A] transition-colors hover:bg-[#F7E7E5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C5544A]/30 disabled:opacity-50"
        >
          {removing ? "Removing…" : "Stop tracking"}
        </button>
      </div>
    </article>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <Home className="h-12 w-12 text-[#E7E9EE]" aria-hidden="true" />
      <div className="space-y-1.5">
        <p className="text-lg font-medium text-[#16181D]">
          No properties tracked yet
        </p>
        <p className="text-sm text-[#6B7077]">
          Search for your property to start tracking its value.
        </p>
      </div>
      <Link
        href="/"
        className="mt-2 rounded-xl border border-[#2E5470] px-5 py-2.5 text-sm font-medium text-[#2E5470] transition-colors hover:bg-[#2E5470] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-2"
      >
        Search a property →
      </Link>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MyPropertiesPage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string>("");
  const [properties, setProperties] = useState<TrackedProperty[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProperties = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (sessionData.session?.user?.email) {
        setUserEmail(sessionData.session.user.email);
      }

      const res = await fetch("/api/user/properties", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.ok) {
        const json = (await res.json()) as { properties: TrackedProperty[] };
        setProperties(json.properties ?? []);
      }
    } catch {
      // silently fail — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProperties();
  }, [fetchProperties]);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/");
  }

  function handleRemove(slug: string) {
    setProperties((prev) => prev.filter((p) => p.slug !== slug));
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FBFBFC]">
      {/* ── Navigation ── */}
      <header className="sticky top-0 z-40 border-b border-[#E7E9EE] bg-[#FBFBFC]/90 backdrop-blur-sm pt-safe px-safe">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          {/* Wordmark */}
          <Link
            href="/"
            className="group flex items-center gap-3"
            aria-label="everypropertyAI home"
          >
            <Building2
              className="h-6 w-6 shrink-0 text-[#2E5470] transition-opacity duration-150 group-hover:opacity-80"
              aria-hidden="true"
            />
            <div className="leading-none">
              <span
                className="block text-[1.1rem] leading-tight tracking-tight text-[#16181D]"
              >
                everyproperty<span className="text-[#2E5470]">AI</span>
              </span>
              <span className="block text-[0.65rem] uppercase tracking-wide text-[#6B7077]">
                by Grants Estate Agents
              </span>
            </div>
          </Link>

          {/* User actions */}
          <div className="flex items-center gap-4">
            {userEmail && (
              <span
                className="hidden text-sm text-[#6B7077] sm:block"
                title={userEmail}
              >
                {truncateEmail(userEmail)}
              </span>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-[#E7E9EE] bg-white px-4 py-2 text-sm font-medium text-[#16181D] transition-all duration-150 hover:border-[#2E5470] hover:text-[#2E5470] focus:outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        {/* ── Hero ── */}
        <section className="mb-10">
          <h1
            className="text-3xl tracking-tight text-[#16181D]"
          >
            My Properties
          </h1>
          <p className="mt-2 text-sm text-[#6B7077]">
            Track your home&apos;s value and details.
          </p>
        </section>

        {/* ── Property list ── */}
        <section aria-label="Tracked properties">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
              <PropertySkeleton />
              <PropertySkeleton />
            </div>
          ) : properties.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
              {properties.map((property) => (
                <PropertyCard
                  key={property.slug}
                  property={property}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
