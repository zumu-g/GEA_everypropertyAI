"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Building2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PropertyProfile } from "@/components/property/PropertyProfile";
import { AuthButton } from "@/components/auth/AuthButton";
import { Skeleton } from "@/components/ui/Skeleton";

function PropertyPageContent() {
  const searchParams = useSearchParams();
  const address = searchParams.get("address");

  if (!address) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <h2 className="text-xl font-bold text-[#16181D]">
          No address provided
        </h2>
        <p className="mt-2 text-[#4A4E57]">
          Please search for a property from the home page.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#C8A96E] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#B8954A] active:scale-[0.97]"
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
      <header className="flex items-center justify-between border-b border-[#E7E9EE] px-6 py-4 lg:px-12">
        <Link href="/" className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-[#C8A96E]" />
          <span className="text-lg font-semibold text-[#16181D]">everyproperty<span className="text-[#C8A96E]">AI</span></span>
        </Link>
        <AuthButton />
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
