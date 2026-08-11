"use client";

import { formatLandArea } from "@/lib/utils/area";
import { isOptimizerBlocked } from "@/lib/utils/image";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Home, KeyRound } from "lucide-react";

interface NearbyRental {
  rawAddress: string;
  suburb: string | null;
  displayPrice: string | null;
  weeklyRent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landAreaSqm: number | null;
  listingUrl: string | null;
  imageUrl: string | null;
}

export interface OnMarketRentalsNearbyProps {
  lat: number;
  lng: number;
  excludeAddress?: string;
}

/**
 * "On the market rentals" — current rental listings around the subject
 * property, with photos. Same layout/behaviour as On the Market Nearby
 * (for-sale) but backed by /api/rental-listings. Hides itself entirely when
 * nothing is on market nearby.
 */
const RENT_FMT = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

/** Display price for a rental: the feed's display string when present, else
 * `$<weeklyRent>/wk` — mirrors OnMarketNearby.listingPrice's fallback shape. */
export function rentalListingPrice(
  l: Pick<NearbyRental, "displayPrice" | "weeklyRent">
): string | null {
  if (l.displayPrice) return l.displayPrice;
  if (l.weeklyRent == null) return null;
  return `$${RENT_FMT.format(l.weeklyRent)}/wk`;
}

export function OnMarketRentalsNearby({ lat, lng, excludeAddress }: OnMarketRentalsNearbyProps) {
  const [listings, setListings] = useState<NearbyRental[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius: "2",
      limit: "6",
    });
    fetch(`/api/rental-listings?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const results: NearbyRental[] = (json?.results ?? []).filter(
          (l: NearbyRental) =>
            !excludeAddress ||
            l.rawAddress.trim().toLowerCase() !== excludeAddress.trim().toLowerCase()
        );
        setListings(results);
      })
      .catch(() => {
        if (!cancelled) setListings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, excludeAddress]);

  if (!listings || listings.length === 0) return null;

  return (
    <section>
      <div className="mb-6 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FBFBFC]">
          <KeyRound className="h-4 w-4 text-[#2E5470]" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-[#16181D]">
          On the Market Rentals
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((l, i) => {
          const card = (
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#E7E9EE] bg-white transition-shadow duration-150 hover:shadow-md">
              {l.imageUrl ? (
                <div className="relative h-40 w-full">
                  <Image
                    src={l.imageUrl}
                    alt={l.rawAddress}
                    fill
                    sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                    unoptimized={isOptimizerBlocked(l.imageUrl)}
                  />
                </div>
              ) : (
                // Filled placeholder keeps every card the same height when a
                // listing has no photo.
                <div className="flex h-40 w-full items-center justify-center bg-[#F4F5F7]" aria-hidden="true">
                  <Home className="h-8 w-8 text-[#C9CDD3]" />
                </div>
              )}
              <div className="flex flex-1 flex-col gap-1 p-4">
                <p className="text-sm font-semibold text-[#16181D]">{l.rawAddress}</p>
                {rentalListingPrice(l) && (
                  <p className="text-sm font-medium text-[#2E5470] tabular-nums">{rentalListingPrice(l)}</p>
                )}
                <p className="mt-auto pt-1 text-xs text-[#6B7077]">
                  {[
                    l.bedrooms != null ? `${l.bedrooms} bed` : null,
                    l.bathrooms != null ? `${l.bathrooms} bath` : null,
                    l.carSpaces != null ? `${l.carSpaces} car` : null,
                    l.landAreaSqm != null ? `${formatLandArea(l.landAreaSqm)} land` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
          );
          return l.listingUrl ? (
            <a
              key={`${l.rawAddress}-${i}`}
              href={l.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470]/30 rounded-xl"
            >
              {card}
            </a>
          ) : (
            <div key={`${l.rawAddress}-${i}`}>{card}</div>
          );
        })}
      </div>
    </section>
  );
}
