"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, List } from "lucide-react";

interface AddressSuggestion {
  display: string;
  suburb: string;
  state: string;
  postcode: string;
  streetAddress: string;
  fullAddress: string;
  slug?: string;
}

interface StreetSuggestion {
  kind: "street";
  query: string;
  label: string;
  /** Street name without a number, e.g. "May Rd" */
  streetLabel: string;
  suburb: string;
  state: string;
  postcode: string;
}

/** Strip a leading street number (and optional "Lot"/unit) to get the street name. */
function deriveStreetLabel(streetAddress: string): string {
  return streetAddress
    .replace(/^\s*(?:lot\s+)?\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?\s+/i, "")
    .trim();
}

/** "Beaconsfield VIC 3807" suburb line for a street suggestion. */
function suburbLine(s: { suburb: string; state: string; postcode: string }): string {
  return [s.suburb, s.state, s.postcode].filter(Boolean).join(" ");
}

type Suggestion = ({ kind: "address" } & AddressSuggestion) | StreetSuggestion;

interface AddressSearchProps {
  size?: "lg" | "md";
}

export function AddressSearch({ size = "lg" }: AddressSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    state: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Get user's location on mount
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // Determine Australian state from rough lat/lng bounds
        const state = detectAustralianState(lat, lng);
        setUserLocation({ lat, lng, state });
      },
      () => {
        // Geolocation denied or unavailable — no-op
      },
      { timeout: 5000, maximumAge: 300000 }
    );
  }, []);

  const fetchSuggestions = useCallback(
    async (q: string) => {
      if (q.length < 3) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      setIsLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (userLocation) {
          params.set("lat", String(userLocation.lat));
          params.set("lng", String(userLocation.lng));
          if (userLocation.state) {
            params.set("state", userLocation.state);
          }
        }
        const res = await fetch(`/api/address-suggest?${params.toString()}`);
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        const rawAddresses: AddressSuggestion[] = data.suggestions ?? [];
        const addressItems: Suggestion[] = rawAddresses.map(
          (s: AddressSuggestion) => ({ kind: "address" as const, ...s })
        );

        // Street-only search (no leading digit): show distinct streets grouped by
        // suburb (e.g. "May Rd, Beaconsfield VIC") rather than individual addresses.
        const isStreetQuery = !/^\d/.test(q.trim());

        let items: Suggestion[];
        if (isStreetQuery) {
          const seen = new Set<string>();
          const streets: StreetSuggestion[] = [];
          for (const s of rawAddresses) {
            const streetLabel = deriveStreetLabel(s.streetAddress);
            if (!streetLabel || !s.suburb) continue;
            const key = `${streetLabel.toLowerCase()}|${s.suburb.toLowerCase()}|${s.state}`;
            if (seen.has(key)) continue;
            seen.add(key);
            streets.push({
              kind: "street",
              streetLabel,
              suburb: s.suburb,
              state: s.state,
              postcode: s.postcode,
              query: `${streetLabel} ${s.suburb} ${s.state}`.trim(),
              label: `${streetLabel}, ${s.suburb} ${s.state}`.trim(),
            });
          }
          // Fall back to a generic browse option if nothing could be grouped.
          items =
            streets.length > 0
              ? streets
              : [
                  {
                    kind: "street",
                    streetLabel: q.trim(),
                    suburb: "",
                    state: "",
                    postcode: "",
                    query: q.trim(),
                    label: `Browse all properties on "${q.trim()}"`,
                  },
                ];
        } else {
          items = addressItems;
        }

        setSuggestions(items);
        if (items.length > 0) {
          setIsOpen(true);
        }
      } catch (err) {
        console.error("[AddressSearch] fetch error:", err);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    },
    [userLocation]
  );

  const handleChange = (value: string) => {
    setQuery(value);
    setActiveIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  const handleSelect = (suggestion: Suggestion) => {
    setIsOpen(false);

    if (suggestion.kind === "street") {
      router.push(`/street?q=${encodeURIComponent(suggestion.query)}`);
      return;
    }

    setQuery(suggestion.fullAddress);

    // Parse streetAddress into number + name + type
    // e.g. "17 Rose Garden Ave" → { streetNumber: "17", streetName: "Rose Garden", streetType: "Ave" }
    const parts = suggestion.streetAddress.match(
      /^(\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?)\s+(.+?)(?:\s+(St|Rd|Ave|Dr|Cres|Ct|Pl|Ln|Tce|Pde|Cct|Cl|Way|Gr|Blvd|Hwy|Esp|Prom|Circuit|Street|Road|Avenue|Drive|Crescent|Court|Place|Lane|Terrace|Parade|Close|Grove|Boulevard|Highway))?\s*$/i
    );

    const structured = {
      streetNumber: parts?.[1] ?? "",
      streetName: parts?.[2] ?? suggestion.streetAddress,
      streetType: parts?.[3] ?? "",
      suburb: suggestion.suburb,
      state: suggestion.state,
      postcode: suggestion.postcode,
      displayAddress: suggestion.fullAddress,
    };
    router.push(
      `/property?address=${encodeURIComponent(JSON.stringify(structured))}`
    );
  };

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (trimmed.length < 3) return;

    // Street-only query (no leading street number) → go straight to the street list,
    // even if address suggestions also matched.
    const isStreetQuery = !/^\d/.test(trimmed);
    if (isStreetQuery) {
      // Prefer the first grouped street (top-ranked suburb, VIC first).
      const street =
        suggestions.find((s): s is StreetSuggestion => s.kind === "street") ??
        ({
          kind: "street",
          query: trimmed,
          label: "",
          streetLabel: trimmed,
          suburb: "",
          state: "",
          postcode: "",
        } as StreetSuggestion);
      handleSelect(street);
      return;
    }

    // Otherwise prefer the first specific address suggestion.
    const first = suggestions.find((s) => s.kind === "address") ?? suggestions[0];
    if (first) handleSelect(first);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && activeIndex >= 0) {
        handleSelect(suggestions[activeIndex]);
      } else {
        handleSubmit();
      }
      return;
    }

    if (e.key === "Escape") {
      setIsOpen(false);
      return;
    }

    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto">
      {/* Input wrapper */}
      <div
        className={`relative flex items-center rounded-xl border border-[#E7E9EE] bg-white transition-all duration-200 focus-within:border-[#2E5470] focus-within:shadow-md focus-within:ring-2 focus-within:ring-[#2E5470]/25 ${
          size === "lg" ? "min-h-[3.5rem]" : "min-h-[3rem]"
        }`}
      >
        {/* Map pin icon */}
        <svg
          className={`absolute left-4 shrink-0 text-[#8A8F97] ${
            size === "lg" ? "h-5 w-5" : "h-4 w-4"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
          />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          placeholder="Search any Australian address..."
          autoComplete="off"
          className={`w-full bg-transparent text-[#16181D] outline-none placeholder:text-[#8A8F97] ${
            size === "lg"
              ? "py-3.5 pl-11 pr-24 text-base"
              : "py-3 pl-10 pr-20 text-base"
          }`}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `suggestion-${activeIndex}` : undefined
          }
        />

        {/* Right-side: spinner or Search button */}
        <div className="absolute right-2 flex items-center">
          {isLoading ? (
            <Loader2
              className={`animate-spin text-[#2E5470] ${
                size === "lg" ? "h-5 w-5" : "h-4 w-4"
              }`}
              aria-label="Searching…"
            />
          ) : query.length >= 3 ? (
            <button
              type="button"
              onClick={handleSubmit}
              className={`rounded-lg bg-[#16181D] font-medium text-white transition-all duration-150 hover:bg-[#2E5470] active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-[#2E5470] focus:ring-offset-1 ${
                size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"
              }`}
            >
              Search
            </button>
          ) : null}
        </div>
      </div>

      {/* Helper text */}
      {query.length < 3 && (
        <p className="mt-2 text-center text-xs text-[#8A8F97]">
          Type a street address, suburb, or postcode
          {userLocation?.state && (
            <span className="ml-1 text-[#2E5470]">
              &middot; Prioritising {userLocation.state}
            </span>
          )}
        </p>
      )}

      {/* Suggestions dropdown */}
      <AnimatePresence>
        {isOpen && suggestions.length > 0 && (
          <motion.ul
            initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            role="listbox"
            className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-[#E7E9EE] bg-white shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.kind === "address" ? suggestion.fullAddress : suggestion.query}-${index}`}
                id={`suggestion-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => handleSelect(suggestion)}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 min-h-[48px] text-left transition-colors duration-150 border-b border-[#F4F5F7] last:border-b-0 ${
                  index === activeIndex
                    ? "bg-[#F4F5F7]"
                    : "hover:bg-[#FBFBFC]"
                }`}
              >
                {suggestion.kind === "street" ? (
                  <>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                        index === activeIndex ? "bg-[#E4EBF1]" : "bg-[#F4F5F7]"
                      }`}
                      aria-hidden="true"
                    >
                      <List className="h-3.5 w-3.5 text-[#2E5470]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#16181D]">
                        {suggestion.suburb
                          ? `${suggestion.streetLabel}, ${suburbLine(suggestion)}`
                          : suggestion.label}
                      </p>
                      <p className="truncate text-xs text-[#6B7077]">
                        Browse all properties on this street
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Map pin */}
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                        index === activeIndex ? "bg-[#E4EBF1]" : "bg-[#F4F5F7]"
                      }`}
                      aria-hidden="true"
                    >
                      <svg
                        className="h-3.5 w-3.5 text-[#2E5470]"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                        />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#16181D]">
                        {suggestion.streetAddress}
                      </p>
                      <p className="truncate text-xs text-[#6B7077]">
                        {[suggestion.suburb, suggestion.state, suggestion.postcode]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                  </>
                )}
              </button>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Detect which Australian state the user is in based on rough lat/lng bounds.
 */
function detectAustralianState(lat: number, lng: number): string {
  // ACT (small, check first)
  if (lat >= -35.95 && lat <= -35.1 && lng >= 148.7 && lng <= 149.4) return "ACT";
  // TAS
  if (lat <= -39.5 && lng >= 143.5 && lng <= 149.0) return "TAS";
  // NT
  if (lat >= -26.0 && lat <= -10.5 && lng >= 129.0 && lng <= 138.0) return "NT";
  // SA
  if (lat >= -38.1 && lat <= -26.0 && lng >= 129.0 && lng <= 141.0) return "SA";
  // WA
  if (lng < 129.0) return "WA";
  // QLD
  if (lat > -29.0 && lng >= 138.0) return "QLD";
  // VIC
  if (lat <= -33.9 && lng >= 141.0 && lng <= 150.2) return "VIC";
  // NSW (default for eastern Australia)
  if (lng >= 141.0) return "NSW";

  return "";
}
