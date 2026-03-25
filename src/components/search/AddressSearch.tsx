"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";

interface AddressSuggestion {
  display: string;
  suburb: string;
  state: string;
  postcode: string;
  streetAddress: string;
  fullAddress: string;
  slug?: string;
}

interface AddressSearchProps {
  size?: "lg" | "md";
}

export function AddressSearch({ size = "lg" }: AddressSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
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
        const items: AddressSuggestion[] = data.suggestions ?? [];
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

  const handleSelect = (suggestion: AddressSuggestion) => {
    setQuery(suggestion.fullAddress);
    setIsOpen(false);

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
    if (suggestions.length > 0) {
      handleSelect(suggestions[0]);
    }
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
      <div
        className={`relative flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow duration-200 focus-within:shadow-md focus-within:ring-2 focus-within:ring-brand-500/30 ${
          size === "lg" ? "h-16" : "h-12"
        }`}
      >
        {/* Map pin icon */}
        <svg
          className={`absolute left-4 text-gray-400 ${
            size === "lg" ? "h-6 w-6" : "h-5 w-5"
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
          className={`w-full bg-transparent outline-none placeholder-gray-400 ${
            size === "lg"
              ? "pl-14 pr-14 text-lg"
              : "pl-12 pr-12 text-base"
          }`}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `suggestion-${activeIndex}` : undefined
          }
        />

        {isLoading ? (
          <Loader2
            className={`absolute right-4 animate-spin text-brand-500 ${
              size === "lg" ? "h-6 w-6" : "h-5 w-5"
            }`}
            aria-label="Searching..."
          />
        ) : query.length >= 3 ? (
          <button
            type="button"
            onClick={handleSubmit}
            className={`absolute right-2 rounded-lg bg-brand-600 text-white font-medium transition-colors duration-150 hover:bg-brand-700 active:scale-[0.97] ${
              size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"
            }`}
          >
            Search
          </button>
        ) : null}
      </div>

      {/* Helper text */}
      {query.length < 3 && (
        <p className="mt-2 text-center text-sm text-gray-400">
          Start typing to search Australian addresses
          {userLocation?.state && (
            <span className="ml-1 text-brand-500">
              · Prioritising {userLocation.state}
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
            className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.fullAddress}-${index}`}
                id={`suggestion-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onClick={() => handleSelect(suggestion)}
                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 min-h-[48px] text-left transition-colors duration-150 ${
                  index === activeIndex
                    ? "bg-brand-50"
                    : "hover:bg-gray-50"
                }`}
              >
                {/* Map pin */}
                <svg
                  className="h-4 w-4 shrink-0 text-gray-400"
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
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {suggestion.streetAddress}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {[suggestion.suburb, suggestion.state, suggestion.postcode]
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                </div>
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
