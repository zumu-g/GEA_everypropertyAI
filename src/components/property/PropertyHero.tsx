"use client";

import { motion } from "framer-motion";
import { MapPin, Bed, Bath, Car, Maximize } from "lucide-react";
import type { PropertyProfile } from "@/types/property";

interface PropertyHeroProps {
  property: PropertyProfile;
}

export function PropertyHero({ property }: PropertyHeroProps) {
  const { address, physicalAttributes, media } = property;
  const heroImage = media.photos[0]?.url;

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const stats = [
    {
      icon: Bed,
      value: physicalAttributes.bedrooms,
      label: "Beds",
    },
    {
      icon: Bath,
      value: physicalAttributes.bathrooms,
      label: "Baths",
    },
    {
      icon: Car,
      value: physicalAttributes.carSpaces,
      label: "Cars",
    },
    {
      icon: Maximize,
      value: physicalAttributes.landAreaSqm
        ? `${physicalAttributes.landAreaSqm.toLocaleString()}m\u00B2`
        : null,
      label: "Land",
    },
  ].filter((s) => s.value != null);

  const typeLabel =
    physicalAttributes.propertyType.charAt(0).toUpperCase() +
    physicalAttributes.propertyType.slice(1);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {/* Image / gradient placeholder */}
      <div className="relative h-64 w-full sm:h-80 lg:h-96">
        {heroImage ? (
          <img
            src={heroImage}
            alt={address.displayAddress}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-600 to-brand-900" />
        )}
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

        {/* Address overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <span className="mb-2 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {typeLabel}
            </span>
            <h1 className="text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
              {address.displayAddress}
            </h1>
            <div className="mt-1 flex items-center gap-1 text-sm text-white/80">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <span>
                {address.suburb}, {address.state} {address.postcode}
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Stats row */}
      {stats.length > 0 && (
        <div className="flex flex-wrap items-center gap-6 border-t border-gray-100 px-6 py-4 sm:px-8">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="flex items-center gap-2 text-gray-700"
              >
                <Icon className="h-5 w-5 text-brand-500" aria-hidden="true" />
                <span className="text-lg font-semibold">{stat.value}</span>
                <span className="text-sm text-gray-500">{stat.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
