"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  MapPin,
  GraduationCap,
  Train,
  Building2,
  TrendingUp,
  Layers,
  Users,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
  Scale,
  FileText,
  List,
  Baby,
  Flame,
  Droplets,
  Landmark,
} from "lucide-react";
import Link from "next/link";
import { Skeleton } from "../ui/Skeleton";
import type { MergedPropertyProfile, StructuredAddress } from "@/types/property";
import { calculateEnrichedPriceEstimate, type PriceEstimateResult } from '@/lib/estimation/price-estimator';
import { ComparableSales } from "./ComparableSales";
import { PropertyTimeline } from "./PropertyTimeline";
import { TrackPropertyButton } from "./TrackPropertyButton";
import { SuburbPriceChart } from './SuburbPriceChart';

interface EnrichmentData {
  coordinates: { lat: number; lng: number } | null;
  planning: {
    zone?: { code: string; name: string; description?: string };
    overlays: Array<{ code: string; name: string }>;
    council?: string;
    planningScheme?: string;
    source: string;
  } | null;
  schools: Array<{
    name: string;
    type: string;
    sector: string;
    distanceKm: number;
  }>;
  transport: Array<{
    name: string;
    type: string;
    distanceKm: number;
  }>;
  suburbStats: {
    suburb: string;
    state: string;
    medianHousePrice?: number;
    medianUnitPrice?: number;
    annualGrowthPercent?: number;
    averageDaysOnMarket?: number;
    population?: number;
    medianAge?: number;
    ownerOccupiedPercent?: number;
    renterPercent?: number;
    familyPercent?: number;
  } | null;
  buyerDemand: {
    level: 'very-low' | 'low' | 'moderate' | 'high' | 'very-high';
    score: number;
    factors: Array<{ name: string; value: string; impact: 'positive' | 'neutral' | 'negative' }>;
    medianHousePrice?: number;
    medianUnitPrice?: number;
    medianRentHouse?: number;
    medianRentUnit?: number;
    annualGrowth?: number;
    avgDaysOnMarket?: number;
    auctionClearance?: number;
    totalListings?: number;
  } | null;
  marketData: {
    suburb: string;
    houses: {
      medianPrice?: number;
      quarterlyGrowth?: number;
      annualGrowth?: number;
      medianRent?: number;
      grossYield?: number;
      salesCount?: number;
      avgDaysOnMarket?: number;
      monthlyMedians?: Array<{ month: string; value: number }>;
      monthlyRents?: Array<{ month: string; value: number }>;
    };
    units: {
      medianPrice?: number;
      quarterlyGrowth?: number;
      annualGrowth?: number;
      medianRent?: number;
      grossYield?: number;
      salesCount?: number;
      avgDaysOnMarket?: number;
      monthlyMedians?: Array<{ month: string; value: number }>;
      monthlyRents?: Array<{ month: string; value: number }>;
    };
    demographics?: {
      population?: number;
      populationGrowth?: number;
      medianHouseholdIncome?: number;
      predominantAgeGroup?: string;
      ownerOccupiedPercent?: number;
      topOccupation?: string;
    };
    source: string;
  } | null;
  childcare?: Array<{ name: string; distanceKm: number; address?: string }>;
}

interface PropertyProfileProps {
  address: string;
}

interface EditableStatProps {
  field: string;
  value: string;
  label: string;
  suffix?: string;
  editingField: string | null;
  editValue: string;
  editSaving: boolean;
  onEdit: (field: string, currentValue: string) => void;
  onSave: (field: string, value: string) => void;
  onCancel: () => void;
  onEditValueChange: (v: string) => void;
}

function EditableStat({
  field, value, label, suffix = '',
  editingField, editValue, editSaving,
  onEdit, onSave, onCancel, onEditValueChange,
}: EditableStatProps) {
  const isEditing = editingField === field;

  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={editValue}
          onChange={e => onEditValueChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSave(field, editValue);
            if (e.key === 'Escape') onCancel();
          }}
          autoFocus
          className="w-16 rounded-lg border border-[#C8A96E] bg-white px-2 py-1 text-sm font-medium text-[#16181D] tabular-nums outline-none focus:ring-2 focus:ring-[#C8A96E]/30"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
        <button
          onClick={() => onSave(field, editValue)}
          disabled={editSaving}
          className="rounded-lg bg-[#C8A96E] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#B8954A] disabled:opacity-50"
        >
          {editSaving ? '…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-[#E7E9EE] px-2 py-1 text-xs text-[#4A4E57] transition-colors hover:border-[#C8A96E] hover:text-[#C8A96E]"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5">
      <span
        className="text-sm font-medium text-[#16181D] tabular-nums"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {value}{suffix}
      </span>
      <span className="text-xs text-[#6B7077]">{label}</span>
      <button
        onClick={() => onEdit(field, value)}
        title={`Edit ${label}`}
        className="opacity-0 transition-opacity group-hover:opacity-100 ml-0.5"
        aria-label={`Edit ${label}`}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3 w-3 text-[#6B7077] hover:text-[#C8A96E]">
          <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H2.5v-2.5L11.5 2.5Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

export function PropertyProfile({ address }: PropertyProfileProps) {
  const [property, setProperty] = useState<MergedPropertyProfile | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [enrichedEstimate, setEnrichedEstimate] = useState<PriceEstimateResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedAddress, setParsedAddress] = useState<StructuredAddress | null>(
    null
  );
  const [addressSlug, setAddressSlug] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  // Photo gallery lightbox state
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const fetchProperty = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let structured: StructuredAddress;
      try {
        structured = JSON.parse(address);
      } catch {
        structured = {
          streetNumber: "",
          streetName: address,
          streetType: "",
          suburb: "",
          state: "",
          postcode: "",
        };
      }
      setParsedAddress(structured);

      const res = await fetch("/api/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: structured }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || "Failed to load property data. Please try again."
        );
      }
      const data = await res.json();
      setProperty(data.profile);
      setAddressSlug(data.addressSlug ?? null);

      // Kick off enrichment fetch in background
      fetchEnrichment(structured);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  const fetchEnrichment = async (structured: StructuredAddress) => {
    setEnrichLoading(true);
    try {
      const fullAddr =
        structured.displayAddress ??
        [
          structured.streetNumber,
          structured.streetName,
          structured.streetType,
        ]
          .filter(Boolean)
          .join(" ") +
          `, ${structured.suburb} ${structured.state} ${structured.postcode}`;

      const params = new URLSearchParams({
        address: fullAddr,
        suburb: structured.suburb ?? "",
        state: structured.state ?? "",
        postcode: structured.postcode ?? "",
      });

      const res = await fetch(`/api/enrich?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEnrichment(data);

        // Calculate enriched price estimate when market data is available
        if (data?.marketData && property) {
          const pd = property.data;
          const sh =
            (pd.saleHistory as Array<{
              price?: number;
              date?: string;
              type?: string;
              agency?: string;
              agentName?: string;
              daysOnMarket?: number;
              listingPrice?: number;
              isConfidential?: boolean;
              description?: string;
              settlementDate?: string;
              source?: string;
            }>) ?? [];
          const rh =
            (pd.rentalHistory as Array<{
              date?: string;
              weeklyRent?: number;
              bond?: number;
              agency?: string;
              agentName?: string;
              daysOnMarket?: number;
              leaseTerm?: string;
              description?: string;
            }>) ?? [];
          const estimate = calculateEnrichedPriceEstimate(
            {
              propertyType: pd.propertyType as string,
              bedrooms: pd.bedrooms as number | undefined,
              bathrooms: pd.bathrooms as number | undefined,
              carSpaces: pd.carSpaces as number | undefined,
              landAreaSqm: (pd.landArea ?? pd.landAreaSqm) as number | undefined,
              priceNumeric: pd.priceNumeric as number | undefined,
              priceFrom: pd.priceFrom as number | undefined,
              priceTo: pd.priceTo as number | undefined,
              saleHistory: sh,
              rentalHistory: rh,
              listingStatus: pd.listingStatus as string | undefined,
              currentPrice: pd.currentPrice as number | undefined,
              estimatedValue: pd.estimatedValue as number | undefined,
            },
            data.marketData
          );
          setEnrichedEstimate(estimate);
        }
      }
    } catch (err) {
      console.warn("[PropertyProfile] Enrichment failed:", err);
    } finally {
      setEnrichLoading(false);
    }
  };

  const saveOverride = async (field: string, value: string) => {
    if (!addressSlug) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/property/${addressSlug}/override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      });
      if (!res.ok) throw new Error('Save failed');
      // Patch local state immediately so UI updates without re-fetch
      setProperty(prev => prev ? {
        ...prev,
        data: { ...prev.data, [field]: isNaN(Number(value)) ? value : Number(value) }
      } : prev);
      setEditingField(null);
    } catch {
      // silently fail — user can retry
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    if (address) fetchProperty();
  }, [address, fetchProperty]);


  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10 lg:py-14">
        {/* Progress indicator */}
        <div className="mb-10 flex flex-col items-center justify-center py-12">
          <div className="relative mb-6">
            <div className="h-16 w-16 rounded-full border-4 border-gray-200" />
            <div className="absolute inset-0 h-16 w-16 animate-spin rounded-full border-4 border-transparent border-t-[#C8A96E]" />
            <Building2 className="absolute inset-0 m-auto h-6 w-6 text-[#C8A96E]" />
          </div>
          <h3 className="text-lg font-semibold text-[#16181D]">
            Searching property data
          </h3>
          <p className="mt-1 text-sm text-[#6B7077]">
            Searching property records…
          </p>
        </div>

        {/* Skeleton preview */}
        <div className="space-y-8">
          <Skeleton height="16rem" rounded="xl" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height="6rem" rounded="xl" />
            ))}
          </div>
          <Skeleton height="10rem" rounded="xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-md"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#F7E7E5]">
            <AlertCircle className="h-7 w-7 text-[#C5544A]" />
          </div>
          <h2 className="text-xl font-bold text-[#16181D]">
            Something went wrong
          </h2>
          <p className="mt-2 text-[#4A4E57]">{error}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-[#33363D] transition-colors duration-150 hover:bg-[#FBFBFC]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Search
            </Link>
            <button
              onClick={fetchProperty}
              className="inline-flex items-center gap-2 rounded-lg bg-[#C8A96E] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#B8954A] active:scale-[0.97]"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!property) return null;

  const d = property.data;
  const addr = (d.address as Record<string, unknown>) ?? {};
  const displayAddress =
    parsedAddress?.displayAddress ??
    (addr.fullAddress as string) ??
    [addr.streetNumber, addr.streetName, addr.streetType]
      .filter(Boolean)
      .join(" ") +
      (addr.suburb ? `, ${addr.suburb}` : "") +
      (addr.state ? ` ${addr.state}` : "") +
      (addr.postcode ? ` ${addr.postcode}` : "");

  const photos = (d.photos as string[]) ?? [];
  const heroImage = photos[0] ?? null;
  const propertyType = (d.propertyType as string) ?? "Property";
  const saleHistory =
    (d.saleHistory as Array<{
      price?: number;
      date?: string;
      type?: string;
      agency?: string;
      agentName?: string;
      daysOnMarket?: number;
      listingPrice?: number;
      isConfidential?: boolean;
      description?: string;
      settlementDate?: string;
      source?: string;
    }>) ?? [];
  const rentalHistory =
    (d.rentalHistory as Array<{
      date?: string;
      weeklyRent?: number;
      bond?: number;
      agency?: string;
      agentName?: string;
      daysOnMarket?: number;
      leaseTerm?: string;
      description?: string;
    }>) ?? [];
  const features = (d.features as string[]) ?? [];
  const priceLabel = d.priceLabel != null ? String(d.priceLabel) : d.priceText != null ? String(d.priceText) : null;
  const priceLow = d.priceLow != null ? Number(d.priceLow) : null;
  const priceMid = d.priceMid != null ? Number(d.priceMid) : null;
  const priceHigh = d.priceHigh != null ? Number(d.priceHigh) : null;
  const currentPrice = d.currentPrice != null ? Number(d.currentPrice) : d.priceNumeric != null ? Number(d.priceNumeric) : null;
  const priceSource = d.priceSource != null ? String(d.priceSource) : null;

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0,
    }).format(n);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10 lg:py-14">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6B7077] transition-colors duration-150 hover:text-[#C8A96E]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Search
      </Link>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="space-y-16"
      >
        {/* ─── Hero ─── */}
        <section className="overflow-hidden rounded-2xl bg-white border border-[#E7E9EE] ">
          <div
            className="relative h-64 w-full sm:h-80 lg:h-96 cursor-pointer"
            onClick={() => heroImage && setSelectedPhotoIndex(0)}
          >
            {heroImage ? (
              <img
                src={heroImage}
                alt={displayAddress}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-[#C8A96E] to-[#16181D]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
              <span className="mb-2 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {propertyType.charAt(0).toUpperCase() + propertyType.slice(1)}
              </span>
              {d.listingStatus != null && (() => {
                const status = String(d.listingStatus).toLowerCase();
                const cfg =
                  status === 'for-sale' || status === 'active'
                    ? { label: 'For Sale', cls: 'bg-[#2F8F6B]/80' }
                    : status === 'for-rent'
                    ? { label: 'For Rent', cls: 'bg-[#335C7D]/80' }
                    : status === 'under-offer'
                    ? { label: 'Under Offer', cls: 'bg-[#B8954A]/80' }
                    : status === 'sold'
                    ? { label: 'Sold', cls: 'bg-gray-500/80' }
                    : status === 'off-market'
                    ? { label: 'Off Market', cls: 'bg-gray-500/80' }
                    : null;
                if (!cfg) return null;
                return (
                  <span className={`ml-2 inline-block rounded-full ${cfg.cls} px-3 py-1 text-xs font-medium text-white backdrop-blur-sm`}>
                    {cfg.label}
                  </span>
                );
              })()}
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">
                {displayAddress}
              </h1>
              {parsedAddress?.suburb && (
                <div className="mt-1 flex items-center gap-1 text-sm text-white/80">
                  <MapPin className="h-4 w-4" />
                  <span>
                    {[
                      parsedAddress.suburb,
                      parsedAddress.state,
                      parsedAddress.postcode,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                </div>
              )}
              {photos.length > 1 && (
                <div className="absolute top-4 right-4 rounded-full bg-black/40 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                  1 / {photos.length}
                </div>
              )}
            </div>
          </div>

          {/* Thumbnail strip */}
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
              {photos.map((url, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedPhotoIndex(idx)}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-150 ${
                    idx === 0
                      ? "border-[#C8A96E]"
                      : "border-transparent hover:border-[#EFE3CC]"
                  }`}
                  aria-label={`View photo ${idx + 1}`}
                >
                  <img
                    src={url}
                    alt={`Photo ${idx + 1}`}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}

          {addressSlug && property.data && (
            <div className="px-6 pb-4 sm:px-8">
              <TrackPropertyButton
                addressSlug={addressSlug}
                fullAddress={
                  (property.data.address as Record<string, unknown> | undefined)?.fullAddress as string
                  ?? (property.data.fullAddress as string | undefined)
                  ?? ''
                }
              />
            </div>
          )}

          {/* Quick stats */}
          <div className="flex flex-wrap items-center gap-6 border-t border-[#E7E9EE] px-6 py-4 sm:px-8">
            {d.bedrooms != null && (
              <EditableStat
                field="bedrooms"
                value={String(d.bedrooms)}
                label="Beds"
                editingField={editingField}
                editValue={editValue}
                editSaving={editSaving}
                onEdit={(f, v) => { setEditingField(f); setEditValue(v); }}
                onSave={saveOverride}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
              />
            )}
            {d.bathrooms != null && (
              <EditableStat
                field="bathrooms"
                value={String(d.bathrooms)}
                label="Baths"
                editingField={editingField}
                editValue={editValue}
                editSaving={editSaving}
                onEdit={(f, v) => { setEditingField(f); setEditValue(v); }}
                onSave={saveOverride}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
              />
            )}
            {d.carSpaces != null && (
              <EditableStat
                field="carSpaces"
                value={String(d.carSpaces)}
                label="Cars"
                editingField={editingField}
                editValue={editValue}
                editSaving={editSaving}
                onEdit={(f, v) => { setEditingField(f); setEditValue(v); }}
                onSave={saveOverride}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
              />
            )}
            {d.landArea != null && (
              <EditableStat
                field="landArea"
                value={String(d.landArea)}
                label="Land"
                suffix="m²"
                editingField={editingField}
                editValue={editValue}
                editSaving={editSaving}
                onEdit={(f, v) => { setEditingField(f); setEditValue(v); }}
                onSave={saveOverride}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
              />
            )}
          </div>
        </section>

        {/* ─── About This Property ─── */}
        {typeof d.description === 'string' && (d.description as string).length > 20 && (
          <section>
            <SectionTitle icon={FileText} title="About This Property" />
            <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
              <p className="max-w-[68ch] text-sm leading-relaxed text-[#33363D]">{d.description as string}</p>
            </div>
          </section>
        )}

        {/* ─── Estimated Price Range ─── */}
        {(enrichedEstimate || priceLow != null || priceMid != null || currentPrice != null || priceLabel != null) && (
          <section>
            <div className="grid gap-6 sm:grid-cols-2">
              {/* Price estimate card */}
              <div>
                {enrichedEstimate ? (
                  <>
                    <div className="mb-6 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FBFBFC]">
                        <TrendingUp className="h-4 w-4 text-[#C8A96E]" />
                      </div>
                      <h2 className="text-2xl font-semibold tracking-tight text-[#16181D]">
                        {enrichedEstimate.priceSource === 'listing-guide' ? 'Price Guide' :
                         enrichedEstimate.priceSource === 'listing-price' ? 'Listing Price' :
                         enrichedEstimate.priceSource === 'recent-sale' ? 'Estimated Value' :
                         enrichedEstimate.priceSource === 'sale-adjusted' || enrichedEstimate.priceSource === 'old-sale-adjusted' ? 'Estimated Value' :
                         enrichedEstimate.priceSource === 'rental-yield' ? 'Estimated Value (Rental)' :
                         enrichedEstimate.priceSource === 'suburb-median' ? 'Estimated Value (Suburb)' :
                         'Estimated Price Range'}
                      </h2>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                        enrichedEstimate.confidenceLevel === 'high' ? 'bg-[#E4F1EB] text-[#2F8F6B]' :
                        enrichedEstimate.confidenceLevel === 'medium' ? 'bg-[#F5EEDD] text-[#B8954A]' :
                        'bg-[#F7E7E5] text-[#C5544A]'
                      }`}>
                        {enrichedEstimate.confidenceLevel} confidence
                      </span>
                    </div>
                    <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
                      <div>
                        <div className="flex items-end gap-4 mb-4">
                          <div className="text-center flex-1">
                            <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide">Low</p>
                            <p className="text-xl font-bold text-[#6B7077] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(enrichedEstimate.priceLow)}</p>
                          </div>
                          <div className="text-center flex-1">
                            <p className="text-xs font-medium text-[#C8A96E] uppercase tracking-wide">Estimated</p>
                            <p className="text-3xl font-bold text-[#C8A96E] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(enrichedEstimate.priceMid)}</p>
                          </div>
                          <div className="text-center flex-1">
                            <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide">High</p>
                            <p className="text-xl font-bold text-[#6B7077] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(enrichedEstimate.priceHigh)}</p>
                          </div>
                        </div>
                        <div className="relative h-3 rounded-full bg-[#F4F5F7] overflow-hidden">
                          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-gray-300 via-[#C8A96E] to-gray-300" />
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white border-3 border-[#C8A96E] shadow-md" />
                        </div>
                        {enrichedEstimate.growthAdjustment && (
                          <p className="mt-3 text-xs text-[#6B7077] text-center">
                            Last sold: {fmtCurrency(enrichedEstimate.growthAdjustment.originalPrice)}
                            {enrichedEstimate.growthAdjustment.originalDate && ` (${formatDate(enrichedEstimate.growthAdjustment.originalDate)})`}
                            {' → adjusted to '}
                            {fmtCurrency(enrichedEstimate.growthAdjustment.adjustedPrice)}
                          </p>
                        )}
                        <p className="mt-3 text-xs text-[#8A8F97] text-center leading-relaxed">
                          {enrichedEstimate.methodology}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <SectionTitle icon={TrendingUp} title={
                      priceSource === 'listing-guide' ? 'Price Guide' :
                      priceSource === 'listing-price' ? 'Listing Price' :
                      priceSource === 'last-sale' ? 'Estimated Value' :
                      'Estimated Price Range'
                    } />
                    <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
                      {(priceLow != null && priceHigh != null) ? (
                        <div>
                          <div className="flex items-end gap-4 mb-4">
                            <div className="text-center flex-1">
                              <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide">Low</p>
                              <p className="text-xl font-bold text-[#6B7077] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(priceLow)}</p>
                            </div>
                            <div className="text-center flex-1">
                              <p className="text-xs font-medium text-[#C8A96E] uppercase tracking-wide">
                                {priceSource === 'listing-guide' ? 'Guide' : priceSource === 'listing-price' ? 'Listed' : 'Estimated'}
                              </p>
                              <p className="text-3xl font-bold text-[#C8A96E] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(priceMid ?? currentPrice ?? 0)}</p>
                            </div>
                            <div className="text-center flex-1">
                              <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide">High</p>
                              <p className="text-xl font-bold text-[#6B7077] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(priceHigh)}</p>
                            </div>
                          </div>
                          <div className="relative h-3 rounded-full bg-[#F4F5F7] overflow-hidden">
                            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-gray-300 via-[#C8A96E] to-gray-300" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white border-3 border-[#C8A96E] shadow-md" />
                          </div>
                          <p className="mt-3 text-sm text-[#8A8F97] text-center">
                            {priceSource === 'listing-guide' ? 'Based on listing price guide' :
                             priceSource === 'listing-price' ? 'Based on listing price' :
                             priceSource === 'last-sale' ? 'Based on most recent sale' :
                             priceLabel ? priceLabel : 'Estimated from available data'}
                          </p>
                        </div>
                      ) : currentPrice != null ? (
                        <div className="text-center">
                          <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide mb-1">
                            {priceSource === 'listing-price' ? 'Listing Price' : 'Guide Price'}
                          </p>
                          <p className="text-3xl font-bold text-[#C8A96E] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(currentPrice)}</p>
                          {priceLabel && <p className="mt-2 text-sm text-[#6B7077]">{priceLabel}</p>}
                        </div>
                      ) : priceLabel ? (
                        <div className="text-center">
                          <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide mb-1">Price Guide</p>
                          <p className="text-2xl font-bold text-[#16181D]">{priceLabel}</p>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>

              {/* Rental income estimate card */}
              {(() => {
                const now = Date.now();
                const recentRental = rentalHistory
                  .filter(r => r.weeklyRent != null && r.date != null)
                  .sort((a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime())[0];

                let midRent: number | null = null;
                let confidence: 'high' | 'medium' = 'medium';

                if (recentRental?.weeklyRent) {
                  const ageMs = now - new Date(recentRental.date!).getTime();
                  if (ageMs < 24 * 30 * 24 * 60 * 60 * 1000) {
                    midRent = recentRental.weeklyRent;
                    confidence = 'high';
                  }
                }

                if (midRent === null && enrichedEstimate && enrichment?.marketData?.houses?.grossYield) {
                  midRent = Math.round((enrichedEstimate.priceMid * (enrichment.marketData.houses.grossYield / 100)) / 52);
                  confidence = 'medium';
                }

                if (midRent === null) return null;

                const lowRent = Math.round(midRent * 0.9);
                const highRent = Math.round(midRent * 1.1);

                return (
                  <div>
                    <div className="mb-6 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FBFBFC]">
                        <TrendingUp className="h-4 w-4 text-[#C8A96E]" />
                      </div>
                      <h2 className="text-2xl font-semibold tracking-tight text-[#16181D]">
                        Estimated Rental Income
                      </h2>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                        confidence === 'high' ? 'bg-[#E4F1EB] text-[#2F8F6B]' : 'bg-[#F5EEDD] text-[#B8954A]'
                      }`}>
                        {confidence} confidence
                      </span>
                    </div>
                    <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
                      <div className="flex items-end gap-4 mb-4">
                        <div className="text-center flex-1">
                          <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide">Low</p>
                          <p className="text-xl font-bold text-[#6B7077] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>${lowRent}/pw</p>
                        </div>
                        <div className="text-center flex-1">
                          <p className="text-xs font-medium text-[#C8A96E] uppercase tracking-wide">Estimated</p>
                          <p className="text-3xl font-bold text-[#C8A96E] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>${midRent}/pw</p>
                        </div>
                        <div className="text-center flex-1">
                          <p className="text-xs font-medium text-[#8A8F97] uppercase tracking-wide">High</p>
                          <p className="text-xl font-bold text-[#6B7077] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>${highRent}/pw</p>
                        </div>
                      </div>
                      <p className="text-xs text-[#8A8F97] text-center leading-relaxed">
                        {confidence === 'high' ? 'Based on recent rental history' : 'Estimated from suburb rental yield'}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>
        )}

        {/* ─── Buyer Demand ─── */}
        {enrichment?.buyerDemand && (
          <section>
            <SectionTitle icon={Users} title="Buyer Demand" />
            <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
              <div className="flex items-center gap-4 mb-6">
                <DemandGauge score={enrichment.buyerDemand.score} level={enrichment.buyerDemand.level} />
                <div>
                  <p className="text-lg font-bold text-[#16181D] capitalize">
                    {enrichment.buyerDemand.level.replace('-', ' ')} demand
                  </p>
                  <p className="text-sm text-[#6B7077]">
                    Based on {enrichment.buyerDemand.factors.length} market indicators
                  </p>
                </div>
              </div>

              {/* Factors */}
              <div className="space-y-2">
                {enrichment.buyerDemand.factors.map((f, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-[#FBFBFC] px-4 py-2.5">
                    <span className="text-sm text-[#33363D]">{f.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#16181D]">{f.value}</span>
                      <span className={`h-2 w-2 rounded-full ${
                        f.impact === 'positive' ? 'bg-[#2F8F6B]' :
                        f.impact === 'negative' ? 'bg-[#C5544A]' : 'bg-[#B8954A]'
                      }`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ─── Market Overview (CoreLogic data) ─── */}
        {enrichment?.marketData && (
          <section>
            <SectionTitle icon={Building2} title={`${enrichment.marketData.suburb} Market Overview`} />

            {/* Houses vs Units comparison */}
            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              {/* Houses */}
              <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
                <h4 className="text-sm font-bold text-[#16181D] uppercase tracking-wide mb-4">Houses</h4>
                <div className="space-y-3">
                  {enrichment.marketData.houses.medianPrice != null && (
                    <DataRow label="Median Price" value={fmtCurrency(enrichment.marketData.houses.medianPrice)} />
                  )}
                  {enrichment.marketData.houses.annualGrowth != null && (
                    <DataRow label="Annual Growth" value={`${enrichment.marketData.houses.annualGrowth > 0 ? '+' : ''}${enrichment.marketData.houses.annualGrowth}%`}
                      color={enrichment.marketData.houses.annualGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.houses.quarterlyGrowth != null && (
                    <DataRow label="Quarterly Growth" value={`${enrichment.marketData.houses.quarterlyGrowth > 0 ? '+' : ''}${enrichment.marketData.houses.quarterlyGrowth}%`}
                      color={enrichment.marketData.houses.quarterlyGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.houses.medianRent != null && (
                    <DataRow label="Median Rent" value={`$${enrichment.marketData.houses.medianRent}/wk`} />
                  )}
                  {enrichment.marketData.houses.grossYield != null && (
                    <DataRow label="Gross Yield" value={`${enrichment.marketData.houses.grossYield}%`} />
                  )}
                  {enrichment.marketData.houses.avgDaysOnMarket != null && (
                    <DataRow label="Avg Days on Market" value={`${enrichment.marketData.houses.avgDaysOnMarket} days`} />
                  )}
                  {enrichment.marketData.houses.salesCount != null && (
                    <DataRow label="Sales (12 months)" value={String(enrichment.marketData.houses.salesCount)} />
                  )}
                </div>
              </div>

              {/* Units */}
              <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 ">
                <h4 className="text-sm font-bold text-[#16181D] uppercase tracking-wide mb-4">Units</h4>
                <div className="space-y-3">
                  {enrichment.marketData.units.medianPrice != null && (
                    <DataRow label="Median Price" value={fmtCurrency(enrichment.marketData.units.medianPrice)} />
                  )}
                  {enrichment.marketData.units.annualGrowth != null && (
                    <DataRow label="Annual Growth" value={`${enrichment.marketData.units.annualGrowth > 0 ? '+' : ''}${enrichment.marketData.units.annualGrowth}%`}
                      color={enrichment.marketData.units.annualGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.units.quarterlyGrowth != null && (
                    <DataRow label="Quarterly Growth" value={`${enrichment.marketData.units.quarterlyGrowth > 0 ? '+' : ''}${enrichment.marketData.units.quarterlyGrowth}%`}
                      color={enrichment.marketData.units.quarterlyGrowth > 0 ? 'green' : 'red'} />
                  )}
                  {enrichment.marketData.units.medianRent != null && (
                    <DataRow label="Median Rent" value={`$${enrichment.marketData.units.medianRent}/wk`} />
                  )}
                  {enrichment.marketData.units.grossYield != null && (
                    <DataRow label="Gross Yield" value={`${enrichment.marketData.units.grossYield}%`} />
                  )}
                  {enrichment.marketData.units.avgDaysOnMarket != null && (
                    <DataRow label="Avg Days on Market" value={`${enrichment.marketData.units.avgDaysOnMarket} days`} />
                  )}
                  {enrichment.marketData.units.salesCount != null && (
                    <DataRow label="Sales (12 months)" value={String(enrichment.marketData.units.salesCount)} />
                  )}
                </div>
              </div>
            </div>

            {/* Demographics */}
            {enrichment.marketData.demographics && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {enrichment.marketData.demographics.population != null && (
                  <StatCard label="Population" value={enrichment.marketData.demographics.population.toLocaleString()} />
                )}
                {enrichment.marketData.demographics.medianHouseholdIncome != null && (
                  <StatCard label="Median Household Income" value={`$${enrichment.marketData.demographics.medianHouseholdIncome.toLocaleString()}/wk`} />
                )}
                {enrichment.marketData.demographics.ownerOccupiedPercent != null && (
                  <StatCard label="Owner Occupied" value={`${enrichment.marketData.demographics.ownerOccupiedPercent}%`} />
                )}
                {enrichment.marketData.demographics.predominantAgeGroup && (
                  <StatCard label="Main Age Group" value={enrichment.marketData.demographics.predominantAgeGroup} />
                )}
                {enrichment.marketData.demographics.topOccupation && (
                  <StatCard label="Top Occupation" value={enrichment.marketData.demographics.topOccupation} />
                )}
              </div>
            )}

            {/* Median trend charts */}
            {(enrichment.marketData.houses.monthlyMedians?.length ?? 0) >= 2 && (
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-[#16181D]">
                    Median House Price — 24 Months
                  </h4>
                  <SuburbPriceChart
                    title="Median House Price"
                    data={enrichment.marketData.houses.monthlyMedians!}
                    type="price"
                  />
                </div>
                {(enrichment.marketData.houses.monthlyRents?.length ?? 0) >= 2 && (
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-[#16181D]">
                      Median Weekly Rent — 24 Months
                    </h4>
                    <SuburbPriceChart
                      title="Median Rent"
                      data={enrichment.marketData.houses.monthlyRents!}
                      type="rent"
                    />
                  </div>
                )}
              </div>
            )}

            <p className="mt-4 text-xs text-[#8A8F97]">
              Source: {enrichment.marketData.source}
            </p>
          </section>
        )}

        {/* ─── Property Details ─── */}
        {(d.yearBuilt != null || d.landArea != null) && (
          <section>
            <SectionTitle title="Property Details" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {d.yearBuilt != null && (
                <StatCard label="Year Built" value={String(d.yearBuilt)} />
              )}
              {d.landArea != null && (
                <StatCard label="Land Area" value={`${d.landArea} m²`} />
              )}
            </div>
          </section>
        )}

        {/* ─── Property Features ─── */}
        {(() => {
          const featureRows: Array<{ label: string; value: string }> = [];
          if (d.propertyType != null) featureRows.push({ label: 'Type', value: String(d.propertyType).charAt(0).toUpperCase() + String(d.propertyType).slice(1) });
          if (d.bedrooms != null) featureRows.push({ label: 'Bedrooms', value: String(d.bedrooms) });
          if (d.bathrooms != null) featureRows.push({ label: 'Bathrooms', value: String(d.bathrooms) });
          if (d.carSpaces != null) featureRows.push({ label: 'Car spaces', value: String(d.carSpaces) });
          if (d.garages != null) featureRows.push({ label: 'Garage spaces', value: String(d.garages) });
          const openSpaces = (d.carSpaces != null && d.garages != null) ? Number(d.carSpaces) - Number(d.garages) : null;
          if (openSpaces != null && openSpaces > 0) featureRows.push({ label: 'Open car spaces', value: String(openSpaces) });
          if (d.landArea != null) featureRows.push({ label: 'Land size', value: `${d.landArea}m²` });
          if (d.buildingArea != null) featureRows.push({ label: 'Building area', value: `${d.buildingArea}m²` });
          if (d.yearBuilt != null) featureRows.push({ label: 'Year built', value: String(d.yearBuilt) });
          const connectivity = d.connectivity as Record<string, unknown> | undefined;
          if (connectivity?.nbn) {
            const nbn = connectivity.nbn as Record<string, unknown>;
            if (nbn.connectionType) featureRows.push({ label: 'NBN connection', value: String(nbn.connectionType).toUpperCase() });
          }
          if (connectivity?.mobileCoverage) {
            const cov = connectivity.mobileCoverage as string[];
            if (Array.isArray(cov) && cov.length > 0) featureRows.push({ label: 'Mobile coverage', value: cov.join(', ') });
          }

          if (featureRows.length < 3) return null;

          return (
            <section>
              <SectionTitle icon={List} title="Property Features" />
              <div className="overflow-hidden rounded-xl border border-[#E7E9EE] bg-white ">
                {featureRows.map((row, i) => (
                  <div
                    key={row.label}
                    className={`flex items-center justify-between px-5 py-3 text-sm ${
                      i % 2 === 0 ? 'bg-white' : 'bg-[#FBFBFC]'
                    } ${i < featureRows.length - 1 ? 'border-b border-[#E7E9EE]' : ''}`}
                  >
                    <span className="text-[#6B7077]">{row.label}</span>
                    <span className="font-medium text-[#16181D]">{row.value}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        {/* ─── Property History ─── */}
        <section>
          <SectionTitle title="Property History" />
          <PropertyTimeline sales={saleHistory} rentals={rentalHistory} />
        </section>

        {/* ─── Comparable Sales ─── */}
        {parsedAddress?.suburb && (
          <section>
            <SectionTitle icon={Scale} title="Comparable Sales" />
            <ComparableSales
              suburb={parsedAddress.suburb}
              beds={d.bedrooms != null ? Number(d.bedrooms) : undefined}
              baths={d.bathrooms != null ? Number(d.bathrooms) : undefined}
              propertyType={(d.propertyType as string) ?? undefined}
              excludeSlug={(d.slug as string) ?? (d.id as string) ?? undefined}
            />
          </section>
        )}

        {/* ─── Features ─── */}
        {features.length > 0 && (
          <section>
            <SectionTitle title="Features" />
            <div className="flex flex-wrap gap-2">
              {features.map((f, i) => (
                <span
                  key={i}
                  className="rounded-full bg-[#FBFBFC] px-3 py-1.5 text-sm font-medium text-[#B8954A]"
                >
                  {f}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ─── Enrichment: Loading ─── */}
        {enrichLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-[#E7E9EE] bg-white p-6 ">
            <Loader2 className="h-5 w-5 animate-spin text-[#C8A96E]" />
            <span className="text-sm text-[#6B7077]">
              Loading planning, schools, transport &amp; suburb data...
            </span>
          </div>
        )}

        {/* ─── Planning & Zoning ─── */}
        {enrichment?.planning && (
          <section>
            <SectionTitle icon={Layers} title="Planning & Zoning" />
            <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 space-y-4">
              {enrichment.planning.zone && (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[#C8A96E] px-2.5 py-1 text-xs font-bold text-white">
                      {enrichment.planning.zone.code}
                    </span>
                    <span className="text-lg font-semibold text-[#16181D]">
                      {enrichment.planning.zone.name}
                    </span>
                  </div>
                </div>
              )}

              {/* Risk indicator cards */}
              {(() => {
                const overlays = enrichment.planning.overlays;
                const hasBushfire = overlays.some(o =>
                  /^(BMO|BPA|BSMO)/i.test(o.code) || /bushfire/i.test(o.name)
                );
                const bushfireOverlay = overlays.find(o =>
                  /^(BMO|BPA|BSMO)/i.test(o.code) || /bushfire/i.test(o.name)
                );
                const hasFlood = overlays.some(o =>
                  /^(FO|LSIO|FMO)/i.test(o.code) || /flood|inundation/i.test(o.name)
                );
                const floodOverlay = overlays.find(o =>
                  /^(FO|LSIO|FMO)/i.test(o.code) || /flood|inundation/i.test(o.name)
                );
                const hasHeritage = overlays.some(o =>
                  /^(HO|VHR)/i.test(o.code) || /heritage/i.test(o.name)
                );
                const heritageOverlay = overlays.find(o =>
                  /^(HO|VHR)/i.test(o.code) || /heritage/i.test(o.name)
                );

                const risks = [
                  { label: 'Bushfire', found: hasBushfire, overlay: bushfireOverlay, icon: Flame, color: 'orange' },
                  { label: 'Flood', found: hasFlood, overlay: floodOverlay, icon: Droplets, color: 'blue' },
                  { label: 'Heritage', found: hasHeritage, overlay: heritageOverlay, icon: Landmark, color: 'purple' },
                ];

                return (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {risks.map(risk => (
                      <div
                        key={risk.label}
                        className={`rounded-xl border p-4 text-center ${
                          risk.found
                            ? 'border-[#EADFC2] bg-[#F5EEDD]'
                            : 'border-[#CDE6D9] bg-[#E4F1EB]'
                        }`}
                      >
                        <risk.icon className={`mx-auto mb-2 h-5 w-5 ${risk.found ? 'text-[#B8954A]' : 'text-[#2F8F6B]'}`} />
                        <p className="text-xs font-semibold text-[#16181D]">{risk.label}</p>
                        <p className={`mt-1 text-xs ${risk.found ? 'text-[#B8954A]' : 'text-[#2F8F6B]'}`}>
                          {risk.found ? (risk.overlay ? `${risk.overlay.code}` : 'Overlay present') : 'Not found'}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Other overlays */}
              {enrichment.planning.overlays.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-[#6B7077] mb-2">All Planning Overlays</h4>
                  <div className="flex flex-wrap gap-2">
                    {enrichment.planning.overlays.map((o, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-[#F5EEDD] border border-[#EADFC2] px-3 py-1 text-xs font-medium text-[#B8954A]"
                      >
                        {o.code} — {o.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(enrichment.planning.council ||
                enrichment.planning.planningScheme) && (
                <div className="flex flex-wrap gap-4 text-sm text-[#6B7077]">
                  {enrichment.planning.council && (
                    <span>Council: {enrichment.planning.council}</span>
                  )}
                  {enrichment.planning.planningScheme && (
                    <span>
                      Planning Scheme: {enrichment.planning.planningScheme}
                    </span>
                  )}
                </div>
              )}

              <p className="text-xs text-[#8A8F97]">
                Source: {enrichment.planning.source}
              </p>
            </div>
          </section>
        )}

        {/* ─── Nearby Schools ─── */}
        {enrichment && enrichment.schools.length > 0 && (
          <section>
            <SectionTitle icon={GraduationCap} title="Nearby Schools" />
            <div className="grid gap-3 sm:grid-cols-2">
              {enrichment.schools.map((school, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-[#E7E9EE] bg-white p-4 "
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E4F1EB]">
                    <GraduationCap className="h-5 w-5 text-[#2F8F6B]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#16181D]">
                      {school.name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#6B7077]">
                      <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 font-medium">
                        {school.type}
                      </span>
                      <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 font-medium">
                        {school.sector}
                      </span>
                      <span>{school.distanceKm} km</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Nearby Childcare ─── */}
        {enrichment?.childcare && enrichment.childcare.length > 0 && (
          <section>
            <SectionTitle icon={Baby} title="Nearby Childcare" />
            <div className="grid gap-3 sm:grid-cols-2">
              {enrichment.childcare.map((centre, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-[#E7E9EE] bg-white p-4 "
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F4F5F7]">
                    <Baby className="h-5 w-5 text-[#6B7077]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#16181D]">{centre.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#6B7077]">
                      <span>{centre.distanceKm} km</span>
                      {centre.address && <span className="truncate">{centre.address}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-[#8A8F97]">NQS ratings not available from map data source.</p>
          </section>
        )}

        {/* ─── Transport ─── */}
        {enrichment && enrichment.transport.length > 0 && (
          <section>
            <SectionTitle icon={Train} title="Transport" />
            <div className="grid gap-3 sm:grid-cols-2">
              {enrichment.transport.map((stop, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-[#E7E9EE] bg-white p-4 "
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E4EBF1]">
                    <Train className="h-5 w-5 text-[#335C7D]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#16181D]">
                      {stop.name}
                    </p>
                    <p className="text-xs text-[#6B7077]">
                      <span className="capitalize">{stop.type}</span> ·{" "}
                      {stop.distanceKm} km
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Suburb Statistics ─── */}
        {enrichment?.suburbStats && (
          <section>
            <SectionTitle
              icon={Building2}
              title={`${enrichment.suburbStats.suburb} Suburb Profile`}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enrichment.suburbStats.medianHousePrice != null && (
                <StatCard
                  label="Median House Price"
                  value={fmtCurrency(enrichment.suburbStats.medianHousePrice)}
                />
              )}
              {enrichment.suburbStats.medianUnitPrice != null && (
                <StatCard
                  label="Median Unit Price"
                  value={fmtCurrency(enrichment.suburbStats.medianUnitPrice)}
                />
              )}
              {enrichment.suburbStats.annualGrowthPercent != null && (
                <StatCard
                  label="Annual Growth"
                  value={`${enrichment.suburbStats.annualGrowthPercent}%`}
                />
              )}
              {enrichment.suburbStats.averageDaysOnMarket != null && (
                <StatCard
                  label="Avg Days on Market"
                  value={String(enrichment.suburbStats.averageDaysOnMarket)}
                />
              )}
              {enrichment.suburbStats.population != null && (
                <StatCard
                  label="Population"
                  value={enrichment.suburbStats.population.toLocaleString()}
                />
              )}
              {enrichment.suburbStats.medianAge != null && (
                <StatCard
                  label="Median Age"
                  value={String(enrichment.suburbStats.medianAge)}
                />
              )}
              {enrichment.suburbStats.ownerOccupiedPercent != null && (
                <StatCard
                  label="Owner Occupied"
                  value={`${enrichment.suburbStats.ownerOccupiedPercent}%`}
                />
              )}
              {enrichment.suburbStats.renterPercent != null && (
                <StatCard
                  label="Renters"
                  value={`${enrichment.suburbStats.renterPercent}%`}
                />
              )}
              {enrichment.suburbStats.familyPercent != null && (
                <StatCard
                  label="Family Households"
                  value={`${enrichment.suburbStats.familyPercent}%`}
                />
              )}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="border-t border-[#E7E9EE] pt-8 pb-4">
          <p className="text-xs text-[#6B7077] text-center">
            All data © {new Date().getFullYear()} GEA · Grants Estate Agents · Berwick.
            Not financial advice — always verify with a licensed professional.
          </p>
        </footer>
      </motion.div>

      {/* ─── Photo Lightbox ─── */}
      <AnimatePresence>
        {selectedPhotoIndex !== null && photos.length > 0 && (
          <motion.div
            key="lightbox"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={() => setSelectedPhotoIndex(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelectedPhotoIndex(null);
              if (e.key === "ArrowLeft")
                setSelectedPhotoIndex((prev) =>
                  prev !== null ? (prev - 1 + photos.length) % photos.length : null
                );
              if (e.key === "ArrowRight")
                setSelectedPhotoIndex((prev) =>
                  prev !== null ? (prev + 1) % photos.length : null
                );
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Photo lightbox"
            tabIndex={-1}
          >
            {/* Photo counter */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
              {selectedPhotoIndex + 1} / {photos.length}
            </div>

            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedPhotoIndex(null);
              }}
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/70"
              aria-label="Close lightbox"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Previous arrow */}
            {photos.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPhotoIndex(
                    (prev) =>
                      prev !== null
                        ? (prev - 1 + photos.length) % photos.length
                        : 0
                  );
                }}
                className="absolute left-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/70"
                aria-label="Previous photo"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}

            {/* Main image */}
            <motion.img
              key={selectedPhotoIndex}
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              src={photos[selectedPhotoIndex]}
              alt={`Photo ${selectedPhotoIndex + 1} of ${displayAddress}`}
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Next arrow */}
            {photos.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPhotoIndex(
                    (prev) =>
                      prev !== null ? (prev + 1) % photos.length : 0
                  );
                }}
                className="absolute right-4 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/70"
                aria-label="Next photo"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Small helper components ─── */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[#33363D]">
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-sm text-[#6B7077]">{label}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E7E9EE] bg-white p-6 transition-shadow duration-200 hover:shadow-md">
      <span className="text-sm font-medium text-[#6B7077]">{label}</span>
      <p className="mt-2 text-2xl font-bold text-[#16181D]">{value}</p>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon?: typeof TrendingUp;
  title: string;
}) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {Icon && (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FBFBFC]">
          <Icon className="h-4 w-4 text-[#C8A96E]" />
        </div>
      )}
      <h2 className="text-2xl font-semibold tracking-tight text-[#16181D]">{title}</h2>
    </div>
  );
}

function DataRow({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#6B7077]">{label}</span>
      <span className={`text-sm font-semibold ${
        color === 'green' ? 'text-[#2F8F6B]' : color === 'red' ? 'text-[#C5544A]' : 'text-[#16181D]'
      }`}>{value}</span>
    </div>
  );
}

function DemandGauge({
  score,
  level,
}: {
  score: number;
  level: string;
}) {
  const color =
    level === 'very-high' || level === 'high'
      ? 'text-[#2F8F6B]'
      : level === 'moderate'
      ? 'text-[#B8954A]'
      : 'text-[#C5544A]';

  const bgColor =
    level === 'very-high' || level === 'high'
      ? 'bg-[#E4F1EB] border-[#CDE6D9]'
      : level === 'moderate'
      ? 'bg-[#F5EEDD] border-[#EADFC2]'
      : 'bg-[#F7E7E5] border-[#EFCBC7]';

  const strokeColor =
    level === 'very-high' || level === 'high'
      ? '#2F8F6B'
      : level === 'moderate'
      ? '#B8954A'
      : '#C5544A';

  // SVG arc for the gauge
  const radius = 28;
  const circumference = Math.PI * radius; // Half circle
  const filled = (score / 100) * circumference;

  return (
    <div className={`relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 ${bgColor}`}>
      <svg className="absolute inset-0" viewBox="0 0 64 64">
        <path
          d="M 8 44 A 28 28 0 1 1 56 44"
          fill="none"
          stroke="#E7E9EE"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M 8 44 A 28 28 0 1 1 56 44"
          fill="none"
          stroke={strokeColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <span className={`text-xl font-extrabold ${color}`}>{score}</span>
    </div>
  );
}
