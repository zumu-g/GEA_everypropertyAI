import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading state (U5) — paints instantly on navigation, before the
 * client component even hydrates.
 */
export default function MyPropertiesLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-10 lg:py-14">
      <Skeleton height="2rem" width="12rem" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-[#F4F5F7]" aria-hidden="true" />
      ))}
    </div>
  );
}
