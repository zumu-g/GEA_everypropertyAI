"use client";

import { useEffect, useState } from "react";
import { QuadrantChart, type QuadrantSegment } from "./QuadrantChart";
import { Skeleton } from "@/components/ui/Skeleton";

export interface QuadrantChartSectionProps {
  suburb: string;
  targetAddress: string;
  propertyType?: string;
  bedrooms?: number;
}

interface MarketSegmentsResponse {
  segments: QuadrantSegment[];
  dataDate: string | null;
}

function formatDataDate(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return `Data as at ${d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`;
}

/** Self-fetching wrapper: pulls real suburb sold-sales segments from
 * /api/market-segments and renders QuadrantChart. Renders nothing on fetch
 * failure or a missing suburb — this is a supplementary market-context
 * section, not a critical path (plan R6). A successful response always
 * renders the chart, even when every segment is flagged insufficient (R5a). */
export function QuadrantChartSection({
  suburb,
  targetAddress,
  propertyType,
  bedrooms,
}: QuadrantChartSectionProps) {
  const [data, setData] = useState<MarketSegmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!suburb) {
      setLoading(false);
      setFailed(true);
      return;
    }

    const params = new URLSearchParams({ suburb });
    if (propertyType) params.set("propertyType", propertyType);
    if (bedrooms != null) params.set("bedrooms", String(bedrooms));

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    fetch(`/api/market-segments?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`market-segments fetch failed: ${res.status}`);
        return res.json() as Promise<MarketSegmentsResponse>;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [suburb, propertyType, bedrooms]);

  if (loading) {
    return (
      <div className="rounded-xl border border-[#E7E9EE] bg-white p-6">
        <Skeleton className="mb-5 h-6 w-2/3" />
        <Skeleton className="mx-auto h-64 w-full max-w-[420px]" />
      </div>
    );
  }

  if (failed || !data || !data.segments?.length) return null;

  return (
    <QuadrantChart
      segments={data.segments}
      targetAddress={targetAddress}
      suburb={suburb}
      dataDate={formatDataDate(data.dataDate)}
    />
  );
}
