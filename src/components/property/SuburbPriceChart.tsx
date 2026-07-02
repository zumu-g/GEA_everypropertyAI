"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SuburbPriceChartProps {
  title: string;
  data: Array<{ month: string; value: number }>;
  type: "price" | "rent";
}

function fmtMonth(month: string): string {
  try {
    const d = new Date(month);
    if (isNaN(d.getTime())) return month;
    return d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
  } catch {
    return month;
  }
}

function fmtYAxis(value: number, type: "price" | "rent"): string {
  if (type === "rent") return `$${value}`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function fmtTooltipValue(value: number, type: "price" | "rent"): string {
  if (type === "rent") return `$${value.toLocaleString("en-AU")}`;
  if (value >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(3).replace(/\.?0+$/, "")}m`;
  if (value >= 1_000) return `$${Math.round(value / 1_000).toLocaleString("en-AU")}k`;
  return `$${value}`;
}

interface TooltipPayloadEntry {
  payload?: { month?: string };
  value?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  type: "price" | "rent";
}

function CustomTooltip({ active, payload, type }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const value = entry.value;
  const month = entry.payload?.month ?? "";
  return (
    <div
      style={{
        borderRadius: "8px",
        border: "1px solid #E7E9EE",
        background: "#FBFBFC",
        padding: "8px 12px",
        fontSize: "13px",
      }}
    >
      <p style={{ color: "#6B7077", marginBottom: "2px" }}>{fmtMonth(month)}</p>
      <p style={{ color: "#16181D", fontWeight: 600 }}>
        {value != null ? fmtTooltipValue(value, type) : "—"}
      </p>
    </div>
  );
}

export function SuburbPriceChart({ data, type }: SuburbPriceChartProps) {
  const trimmed = data.slice(-24);

  if (trimmed.length < 2) return null;

  const yAxisFormatter = (value: number) => fmtYAxis(value, type);

  const xTickFormatter = (_value: string, index: number) => {
    // Show every 6th label to avoid crowding
    if (index % 6 !== 0) return "";
    return fmtMonth(_value);
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart
        data={trimmed}
        margin={{ top: 10, right: 16, left: 8, bottom: 0 }}
      >
        <defs>
          <linearGradient id="suburbPriceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(51, 92, 125, 0.3)" stopOpacity={1} />
            <stop offset="100%" stopColor="rgba(51, 92, 125, 0)" stopOpacity={1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#E7E9EE" />
        <XAxis
          dataKey="month"
          tickFormatter={xTickFormatter}
          tick={{ fontSize: 11, fill: "#6B7077" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={yAxisFormatter}
          tick={{ fontSize: 11, fill: "#6B7077" }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip content={<CustomTooltip type={type} />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#2E5470"
          strokeWidth={2}
          fill="url(#suburbPriceGradient)"
          dot={false}
          activeDot={{ r: 5, fill: "#2E5470", strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
