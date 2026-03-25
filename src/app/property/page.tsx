"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Building2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PropertyProfile } from "@/components/property/PropertyProfile";
import { Skeleton } from "@/components/ui/Skeleton";

function PropertyPageContent() {
  const searchParams = useSearchParams();
  const address = searchParams.get("address");

  if (!address) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <h2 className="text-xl font-bold text-gray-900">
          No address provided
        </h2>
        <p className="mt-2 text-gray-600">
          Please search for a property from the home page.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-brand-700 active:scale-[0.97]"
        >
          <ArrowLeft className="h-4 w-4" />
          Go to Search
        </Link>
      </div>
    );
  }

  return <PropertyProfile address={address} />;
}

export default function PropertyPage() {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 lg:px-12">
        <Link href="/" className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-brand-600" />
          <span className="text-lg font-bold text-brand-900">PropertyIQ</span>
        </Link>
      </header>

      <Suspense
        fallback={
          <div className="mx-auto max-w-4xl space-y-8 px-6 py-10">
            <Skeleton height="20rem" rounded="xl" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height="8rem" rounded="xl" />
              ))}
            </div>
          </div>
        }
      >
        <PropertyPageContent />
      </Suspense>
    </main>
  );
}
