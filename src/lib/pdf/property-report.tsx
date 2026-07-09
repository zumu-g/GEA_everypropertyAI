import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

/**
 * GEA-branded property-details report PDF (for GET /api/property-report).
 * Details only by design: no comparables, no market commentary, no agent profile.
 * Renders whatever fields exist; gaps are noted in the footnote.
 */

export interface PropertyReportData {
  address: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landAreaSqm?: number;
  buildingAreaSqm?: number;
  priceEstimate?: { low?: number; mid?: number; high?: number };
  confidence: number;
  saleHistory: Array<{ date?: string; price?: number }>;
  listingStatus?: string;
  /** Pre-fetched image bytes — remote URLs are fetched by the route so a dead CDN link can be skipped, not crash the render. */
  heroPhotos: Array<{ data: Buffer; format: 'jpg' | 'png' }>;
  sources?: string[];
}

// GEA palette (DESIGN.md): ink / steel accent / muted / border.
const INK = '#16181D';
const STEEL = '#2E5470';
const MUTED = '#6B7077';
const BORDER = '#E7E9EE';
const SURFACE = '#F4F5F7';

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: 'Helvetica', color: INK },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 12,
    marginBottom: 24,
  },
  wordmark: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  wordmarkAccent: { color: STEEL },
  byline: { fontSize: 7, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  address: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  subtitle: { fontSize: 10, color: MUTED, marginBottom: 20 },
  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  photo: { flex: 1, height: 160, objectFit: 'cover', borderRadius: 4 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: STEEL,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 16,
  },
  factsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  fact: { width: '33%', marginBottom: 10 },
  factLabel: { fontSize: 8, color: MUTED, marginBottom: 2 },
  factValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  estimateBand: {
    flexDirection: 'row',
    backgroundColor: SURFACE,
    borderRadius: 6,
    padding: 14,
    justifyContent: 'space-between',
  },
  estimateCol: { alignItems: 'center', flex: 1 },
  estimateLabel: { fontSize: 8, color: MUTED, marginBottom: 3 },
  estimateValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  estimateMid: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: STEEL },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 6,
  },
  footnote: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    fontSize: 7,
    color: MUTED,
  },
});

const aud = (n?: number) =>
  n !== undefined
    ? n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
    : '—';

function Fact({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{String(value)}</Text>
    </View>
  );
}

export function buildFootnote(d: PropertyReportData, generatedDate: string): string {
  const gaps: string[] = [];
  if (!d.priceEstimate?.mid && !d.priceEstimate?.low) gaps.push('price estimate');
  if (d.saleHistory.length === 0) gaps.push('sales history');
  if (d.heroPhotos.length === 0) gaps.push('photos');
  const gapNote = gaps.length ? ` Not available for this property: ${gaps.join(', ')}.` : '';
  const sources = d.sources?.length ? ` Sources: ${d.sources.join(', ')}.` : '';
  return (
    `Data confidence ${Math.round(d.confidence)}%. Compiled from public listing and sales records;` +
    ` figures are indicative only and not a formal valuation.${gapNote}${sources}` +
    ` Generated ${generatedDate} by everypropertyAI — Grants Estate Agents.`
  );
}

export function renderPropertyReport(d: PropertyReportData, generatedDate: string): Promise<Buffer> {
  const est = d.priceEstimate;
  const doc = (
    <Document title={`Property Report — ${d.address}`} author="everypropertyAI — Grants Estate Agents">
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <View>
            <Text style={styles.wordmark}>
              everyproperty<Text style={styles.wordmarkAccent}>AI</Text>
            </Text>
            <Text style={styles.byline}>by Grants Estate Agents</Text>
          </View>
          <Text style={{ fontSize: 8, color: MUTED }}>Property Report</Text>
        </View>

        <Text style={styles.address}>{d.address}</Text>
        <Text style={styles.subtitle}>
          {[d.propertyType, d.listingStatus ? `Status: ${d.listingStatus}` : undefined]
            .filter(Boolean)
            .join('  ·  ') || 'Residential property'}
        </Text>

        {d.heroPhotos.length > 0 && (
          <View style={styles.photoRow}>
            {d.heroPhotos.slice(0, 2).map((p, i) => (
              <Image key={i} style={styles.photo} src={{ data: p.data, format: p.format }} />
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Property details</Text>
        <View style={styles.factsGrid}>
          <Fact label="Bedrooms" value={d.bedrooms} />
          <Fact label="Bathrooms" value={d.bathrooms} />
          <Fact label="Car spaces" value={d.carSpaces} />
          <Fact label="Land area" value={d.landAreaSqm ? `${d.landAreaSqm} m²` : undefined} />
          <Fact label="Building area" value={d.buildingAreaSqm ? `${d.buildingAreaSqm} m²` : undefined} />
          <Fact label="Property type" value={d.propertyType} />
        </View>

        {(est?.low !== undefined || est?.mid !== undefined || est?.high !== undefined) && (
          <>
            <Text style={styles.sectionTitle}>Price estimate</Text>
            <View style={styles.estimateBand}>
              <View style={styles.estimateCol}>
                <Text style={styles.estimateLabel}>Low</Text>
                <Text style={styles.estimateValue}>{aud(est?.low)}</Text>
              </View>
              <View style={styles.estimateCol}>
                <Text style={styles.estimateLabel}>Estimate</Text>
                <Text style={styles.estimateMid}>{aud(est?.mid)}</Text>
              </View>
              <View style={styles.estimateCol}>
                <Text style={styles.estimateLabel}>High</Text>
                <Text style={styles.estimateValue}>{aud(est?.high)}</Text>
              </View>
            </View>
          </>
        )}

        {d.saleHistory.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Sales history</Text>
            {d.saleHistory.slice(0, 10).map((s, i) => (
              <View key={i} style={styles.historyRow}>
                <Text>{s.date ?? 'Date unknown'}</Text>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{aud(s.price)}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.footnote} fixed>
          {buildFootnote(d, generatedDate)}
        </Text>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
