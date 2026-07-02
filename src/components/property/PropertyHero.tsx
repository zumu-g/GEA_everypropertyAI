"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Camera, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { PropertyProfile } from "@/types/property";

interface PropertyHeroProps {
  property: PropertyProfile;
}

const LISTING_BADGE: Record<string, { label: string; colours: string }> = {
  active:       { label: "For Sale",  colours: "bg-[#2E5470] text-white" },
  "under-offer":{ label: "Under Offer", colours: "bg-[#8A6425] text-white" },
  sold:         { label: "Sold",      colours: "bg-[#16181D] text-white" },
  leased:       { label: "Leased",    colours: "bg-[#2E5470] text-white" },
};

export function PropertyHero({ property }: PropertyHeroProps) {
  const { address, physicalAttributes, media, currentListing } = property;
  const photos = media.photos.slice().sort((a, b) => a.order - b.order);
  const photoUrls = photos.map((p) => p.url);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    setPrefersReducedMotion(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }, []);

  const openLightbox = (idx: number) => setLightboxIndex(idx);
  const closeLightbox = () => setLightboxIndex(null);

  const prev = useCallback(() => {
    setLightboxIndex((i) =>
      i !== null ? (i - 1 + photoUrls.length) % photoUrls.length : null
    );
  }, [photoUrls.length]);

  const next = useCallback(() => {
    setLightboxIndex((i) =>
      i !== null ? (i + 1) % photoUrls.length : null
    );
  }, [photoUrls.length]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, prev, next]);

  const listingBadge = currentListing
    ? (LISTING_BADGE[currentListing.status] ?? null)
    : null;

  const typeLabel =
    physicalAttributes.propertyType.charAt(0).toUpperCase() +
    physicalAttributes.propertyType.slice(1);

  const mainPhoto  = photoUrls[0] ?? null;
  const sidePhoto1 = photoUrls[1] ?? null;
  const sidePhoto2 = photoUrls[2] ?? null;

  const addressLine = address.displayAddress ?? address.fullAddress ?? "";
  const suburbLine = [address.suburb, address.state, address.postcode]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-[#E7E9EE] bg-white ">
        {/* ── Photo grid ── */}
        {mainPhoto ? (
          <>
            {/* Desktop: 2/3 + 1/3 grid | Mobile: full-width hero + scroll strip */}
            <div className="hidden sm:grid sm:grid-cols-3 sm:gap-1 h-80 lg:h-[26rem]">
              {/* Main image — 2 columns */}
              <button
                className="relative col-span-2 overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470] focus-visible:ring-offset-2"
                onClick={() => openLightbox(0)}
                aria-label="Open photo gallery"
              >
                <img
                  src={mainPhoto}
                  alt={`${addressLine} — main photo`}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />

                {/* Address overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                      {typeLabel}
                    </span>
                    {listingBadge && (
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${listingBadge.colours}`}>
                        {listingBadge.label}
                      </span>
                    )}
                  </div>
                  <h1
                    className="text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl"
                  >
                    {addressLine}
                  </h1>
                  {suburbLine && (
                    <div className="mt-1 flex items-center gap-1 text-sm text-white/80">
                      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{suburbLine}</span>
                    </div>
                  )}
                </div>

                {/* Photo count badge */}
                {photoUrls.length > 1 && (
                  <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
                    <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{photoUrls.length} photos</span>
                  </div>
                )}
              </button>

              {/* Side column — 1 column, 2 stacked images */}
              <div className="flex flex-col gap-1">
                {sidePhoto1 && (
                  <button
                    className="relative flex-1 overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470]"
                    onClick={() => openLightbox(1)}
                    aria-label="View photo 2"
                  >
                    <img
                      src={sidePhoto1}
                      alt={`${addressLine} — photo 2`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  </button>
                )}
                {sidePhoto2 ? (
                  <button
                    className="relative flex-1 overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470]"
                    onClick={() => openLightbox(2)}
                    aria-label="View photo 3"
                  >
                    <img
                      src={sidePhoto2}
                      alt={`${addressLine} — photo 3`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                    {/* "See all" overlay on last tile when there are more photos */}
                    {photoUrls.length > 3 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] transition-opacity duration-150 group-hover:bg-black/55">
                        <span className="text-sm font-semibold text-white">
                          +{photoUrls.length - 3} more
                        </span>
                      </div>
                    )}
                  </button>
                ) : (
                  /* Fill the empty slot with a surface placeholder */
                  <div className="flex-1 bg-[#F4F5F7]" />
                )}
              </div>
            </div>

            {/* Mobile: single hero + horizontal scroll strip */}
            <div className="sm:hidden">
              <button
                className="relative h-64 w-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470]"
                onClick={() => openLightbox(0)}
                aria-label="Open photo gallery"
              >
                <img
                  src={mainPhoto}
                  alt={`${addressLine} — main photo`}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                      {typeLabel}
                    </span>
                    {listingBadge && (
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${listingBadge.colours}`}>
                        {listingBadge.label}
                      </span>
                    )}
                  </div>
                  <h1
                    className="text-xl font-semibold tracking-tight text-white"
                  >
                    {addressLine}
                  </h1>
                  {suburbLine && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-white/80">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{suburbLine}</span>
                    </div>
                  )}
                </div>
                {photoUrls.length > 1 && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    <Camera className="h-3 w-3" aria-hidden="true" />
                    <span>{photoUrls.length}</span>
                  </div>
                )}
              </button>

              {/* Horizontal thumbnail scroll */}
              {photoUrls.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto px-4 py-3 scrollbar-hide">
                  {photoUrls.slice(1).map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => openLightbox(idx + 1)}
                      className="h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-transparent transition-all duration-150 hover:border-[#2E5470] focus:outline-none focus-visible:border-[#2E5470]"
                      aria-label={`View photo ${idx + 2}`}
                    >
                      <img
                        src={url}
                        alt={`Photo ${idx + 2}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          /* ── No photos placeholder ── */
          <div className="relative flex h-64 w-full items-center justify-center bg-gradient-to-br from-[#F4F5F7] to-[#EDEFF2] sm:h-80 lg:h-96">
            <div className="text-center">
              <Camera className="mx-auto mb-3 h-12 w-12 text-[#2E5470] opacity-60" aria-hidden="true" />
              <h1
                className="px-6 text-xl font-semibold tracking-tight text-[#16181D] sm:text-2xl lg:text-3xl"
              >
                {addressLine}
              </h1>
              {suburbLine && (
                <p className="mt-1 flex items-center justify-center gap-1 text-sm text-[#6B7077]">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {suburbLine}
                </p>
              )}
              <p className="mt-3 text-xs text-[#6B7077]">No photos available</p>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[#F4F5F7]/50 to-transparent" />
          </div>
        )}

        {/* ── Stats row ── */}
        {(physicalAttributes.bedrooms != null ||
          physicalAttributes.bathrooms != null ||
          physicalAttributes.carSpaces != null ||
          physicalAttributes.landAreaSqm != null) && (
          <div className="flex flex-wrap items-center gap-6 border-t border-[#E7E9EE] px-6 py-4 sm:px-8">
            {physicalAttributes.bedrooms != null && (
              <StatItem value={String(physicalAttributes.bedrooms)} label="Beds" />
            )}
            {physicalAttributes.bathrooms != null && (
              <StatItem value={String(physicalAttributes.bathrooms)} label="Baths" />
            )}
            {physicalAttributes.carSpaces != null && (
              <StatItem value={String(physicalAttributes.carSpaces)} label="Cars" />
            )}
            {physicalAttributes.landAreaSqm != null && (
              <StatItem
                value={`${physicalAttributes.landAreaSqm.toLocaleString("en-AU")}m²`}
                label="Land"
              />
            )}
          </div>
        )}
      </section>

      {/* ── Lightbox ── */}
      <AnimatePresence>
        {lightboxIndex !== null && photoUrls.length > 0 && (
          <motion.div
            key="lightbox"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/92"
            onClick={closeLightbox}
            role="dialog"
            aria-modal="true"
            aria-label={`Photo ${lightboxIndex + 1} of ${photoUrls.length}`}
          >
            {/* Counter */}
            <div className="absolute top-safe-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
              {lightboxIndex + 1} / {photoUrls.length}
            </div>

            {/* Close */}
            <button
              onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
              className="absolute top-safe-4 right-safe-4 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470]"
              aria-label="Close lightbox"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Prev */}
            {photoUrls.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-safe-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470]"
                aria-label="Previous photo"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}

            {/* Image */}
            <motion.img
              key={lightboxIndex}
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              src={photoUrls[lightboxIndex]}
              alt={`Photo ${lightboxIndex + 1} of ${addressLine}`}
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Next */}
            {photoUrls.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-safe-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2E5470]"
                aria-label="Next photo"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-lg font-semibold text-[#16181D] tabular-nums"
      >
        {value}
      </span>
      <span className="text-sm text-[#6B7077]">{label}</span>
    </div>
  );
}
