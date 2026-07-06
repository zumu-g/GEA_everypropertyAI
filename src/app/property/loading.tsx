import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading state (U5) — paints instantly on navigation, before the
 * client component even hydrates. Mirrors the shape of PropertyProfile's own
 * `isLoading` skeleton so there's no visual jump when the client takes over.
 */
export default function PropertyLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10 lg:py-14">
      <Skeleton height="16rem" rounded="xl" />
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height="6rem" rounded="xl" />
        ))}
      </div>
      <Skeleton height="10rem" rounded="xl" />
    </div>
  );
}
