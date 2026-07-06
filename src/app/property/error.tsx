"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

/**
 * Route-level error boundary (U5 follow-up). next/image throws a hard render
 * error if a photo's hostname isn't in next.config.ts's remotePatterns — with
 * no boundary here, that would blank the whole page instead of degrading to a
 * retry UI. Also catches any other render-time error on this route.
 */
export default function PropertyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PropertyProfile] Render error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F4F5F7]">
        <AlertCircle className="h-7 w-7 text-[#2E5470] opacity-60" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-medium text-[#16181D]">Something went wrong loading this property</h1>
      <p className="max-w-sm text-sm text-[#6B7077]">
        Please try again, or head back and search a different address.
      </p>
      <div className="mt-2 flex gap-3">
        <button
          onClick={reset}
          className="rounded-xl bg-[#2E5470] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#24435A]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-xl border border-[#E7E9EE] px-5 py-2.5 text-sm font-medium text-[#16181D] transition-colors hover:border-[#2E5470] hover:text-[#2E5470]"
        >
          Search an address
        </Link>
      </div>
    </div>
  );
}
