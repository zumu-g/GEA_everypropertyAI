import type { ExtractedPropertyData, PropertySummary } from '@/types/property';
import { propertyExtractionSchema } from './schemas';
import {
  PROPERTY_EXTRACTION_SYSTEM_PROMPT,
  PROPERTY_EXTRACTION_USER_PROMPT,
  PROPERTY_SUMMARY_SYSTEM_PROMPT,
  PROPERTY_SUMMARY_USER_PROMPT,
} from './prompts';

// ─── LLM Configuration ─────────────────────────────────────────────────────
// Supports OpenRouter (cheap models like Kimi K, DeepSeek, Llama) or direct Anthropic.
// Set OPENROUTER_API_KEY for OpenRouter, or ANTHROPIC_API_KEY for direct Anthropic.

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// OpenRouter model — change this to any model on openrouter.ai
// Popular cheap options:
//   'moonshotai/kimi-k2'           — Kimi K2 (very cheap, good at extraction)
//   'deepseek/deepseek-chat-v3-0324' — DeepSeek V3
//   'meta-llama/llama-4-maverick'  — Llama 4 Maverick
//   'google/gemini-2.5-flash'      — Gemini Flash (very fast + cheap)
//   'anthropic/claude-sonnet-4'    — Claude Sonnet via OpenRouter
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'moonshotai/kimi-k2';

const HAS_LLM = Boolean(OPENROUTER_API_KEY || ANTHROPIC_API_KEY);

/**
 * Call an LLM via OpenRouter or direct Anthropic API.
 * Returns the text response.
 */
async function callLLM(
  system: string,
  userMessage: string,
  maxTokens: number = 4096
): Promise<string | null> {
  if (OPENROUTER_API_KEY) {
    return callOpenRouter(system, userMessage, maxTokens);
  }
  if (ANTHROPIC_API_KEY) {
    return callAnthropic(system, userMessage, maxTokens);
  }
  return null;
}

/**
 * OpenRouter — OpenAI-compatible API.
 * Works with 300+ models including Kimi K, DeepSeek, Llama, Gemini, Claude.
 */
async function callOpenRouter(
  system: string,
  userMessage: string,
  maxTokens: number
): Promise<string | null> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://propertyiq.app',
      'X-Title': 'PropertyIQ',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.warn(`[extractor] OpenRouter ${res.status}: ${err.slice(0, 200)}`);
    return null;
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

/**
 * Direct Anthropic API fallback.
 */
async function callAnthropic(
  system: string,
  userMessage: string,
  maxTokens: number
): Promise<string | null> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : null;
}

// ─── Extraction Functions ───────────────────────────────────────────────────

/**
 * Extract structured property data from raw webpage markdown using an LLM.
 * Falls back to basic regex extraction when no LLM is configured.
 */
export async function extractPropertyData(
  markdown: string,
  source: string
): Promise<ExtractedPropertyData> {
  if (!HAS_LLM) {
    console.log(`[extractor] No LLM key — using basic extraction for ${source}`);
    return basicExtract(markdown, source);
  }

  try {
    const provider = OPENROUTER_API_KEY ? `OpenRouter/${OPENROUTER_MODEL}` : 'Anthropic';
    console.log(`[extractor] Using ${provider} for ${source}`);

    const text = await callLLM(
      PROPERTY_EXTRACTION_SYSTEM_PROMPT,
      PROPERTY_EXTRACTION_USER_PROMPT(markdown, source)
    );

    if (!text) {
      console.warn(`[extractor] No response from LLM for ${source}`);
      return basicExtract(markdown, source);
    }

    const rawJson = parseJsonResponse(text);
    if (!rawJson) {
      console.warn(`[extractor] Failed to parse JSON from LLM response for ${source}`);
      return basicExtract(markdown, source);
    }

    // Validate against Zod schema
    const parsed = propertyExtractionSchema.safeParse(rawJson);

    if (parsed.success) {
      return {
        source,
        raw: rawJson,
        data: parsed.data,
        extractedAt: new Date(),
      };
    }

    // Partial extraction — schema validation failed but we still have raw data
    console.warn(
      `[extractor] Schema validation failed for ${source}:`,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    );

    return {
      source,
      raw: rawJson,
      extractedAt: new Date(),
      validationErrors: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Unknown extraction error';
    console.warn(`[extractor] Extraction failed for ${source}: ${msg}`);

    // Fall back to basic extraction on LLM failure
    return basicExtract(markdown, source);
  }
}

/**
 * Generate an AI-powered property summary from structured property data.
 */
export async function generatePropertySummary(
  propertyData: Record<string, unknown>
): Promise<PropertySummary | null> {
  if (!HAS_LLM) return null;

  try {
    const text = await callLLM(
      PROPERTY_SUMMARY_SYSTEM_PROMPT,
      PROPERTY_SUMMARY_USER_PROMPT(propertyData),
      1024
    );

    if (!text) return null;

    const parsed = parseJsonResponse(text);
    return parsed as unknown as PropertySummary;
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Unknown summary error';
    console.warn(`[extractor] Summary generation failed: ${msg}`);
    return null;
  }
}

// ─── Basic Regex Extractor ──────────────────────────────────────────────────

/**
 * Basic regex-based extraction fallback when no LLM is available.
 */
function basicExtract(markdown: string, source: string): ExtractedPropertyData {
  const raw: Record<string, unknown> = {};
  const text = markdown.toLowerCase();

  // Bedrooms
  const bedPatterns = [
    /\b(\d{1,2})\s*(?:bed(?:room)?s?|bd)\b/i,
    /\bbeds?\s*[:=]\s*(\d{1,2})\b/i,
    /\bbedrooms?\s*[:=]\s*(\d{1,2})\b/i,
  ];
  for (const pat of bedPatterns) {
    const m = markdown.match(pat);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 20) { raw.bedrooms = n; break; }
    }
  }

  // Bathrooms
  const bathPatterns = [
    /\b(\d{1,2})\s*(?:bath(?:room)?s?|ba)\b/i,
    /\bbaths?\s*[:=]\s*(\d{1,2})\b/i,
    /\bbathrooms?\s*[:=]\s*(\d{1,2})\b/i,
  ];
  for (const pat of bathPatterns) {
    const m = markdown.match(pat);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 10) { raw.bathrooms = n; break; }
    }
  }

  // Car spaces
  const carPatterns = [
    /\b(\d{1,2})\s*(?:car\s*(?:space)?s?|garage|parking)\b/i,
    /\bcar\s*(?:space)?s?\s*[:=]\s*(\d{1,2})\b/i,
    /\bparking\s*[:=]\s*(\d{1,2})\b/i,
  ];
  for (const pat of carPatterns) {
    const m = markdown.match(pat);
    if (m) {
      const n = parseInt(m[1] ?? m[2], 10);
      if (n >= 1 && n <= 10) { raw.carSpaces = n; break; }
    }
  }

  // Land area
  const landMatch = markdown.match(/(\d[\d,]*)\s*(?:m²|m2|sqm|sq\s*m)/i);
  if (landMatch) {
    const area = parseInt(landMatch[1].replace(/,/g, ''), 10);
    if (area >= 50 && area <= 100000) raw.landArea = area;
  }

  // Property type
  if (text.includes('house')) raw.propertyType = 'house';
  else if (text.includes('apartment') || text.includes('unit')) raw.propertyType = 'apartment';
  else if (text.includes('townhouse')) raw.propertyType = 'townhouse';
  else if (text.includes('villa')) raw.propertyType = 'villa';
  else if (text.includes('land')) raw.propertyType = 'land';

  // Price range
  const allPrices: number[] = [];
  const priceMatches = [...markdown.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:m(?:illion)?)?/gi)];
  for (const pm of priceMatches) {
    let price = parseFloat(pm[1].replace(/,/g, ''));
    if (pm[0].toLowerCase().includes('m')) price *= 1_000_000;
    if (price >= 100_000 && price <= 50_000_000) allPrices.push(price);
  }

  const rangeMatch = markdown.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:m(?:illion)?)?\s*[-–—to]+\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:m(?:illion)?)?/i);
  if (rangeMatch) {
    let low = parseFloat(rangeMatch[1].replace(/,/g, ''));
    let high = parseFloat(rangeMatch[2].replace(/,/g, ''));
    if (rangeMatch[0].toLowerCase().indexOf('m') > -1) {
      if (low < 1000) low *= 1_000_000;
      if (high < 1000) high *= 1_000_000;
    }
    if (low >= 100_000 && high >= 100_000) {
      const pl = Math.min(low, high);
      const ph = Math.max(low, high);
      raw.priceLow = pl;
      raw.priceHigh = ph;
      raw.priceMid = Math.round((pl + ph) / 2);
    }
  }

  if (!raw.priceLow && allPrices.length > 0) {
    const sorted = [...new Set(allPrices)].sort((a, b) => a - b);
    const propertyPrices = sorted.filter((p) => p >= 200_000 && p <= 20_000_000);
    if (propertyPrices.length >= 2) {
      const pl2 = propertyPrices[0];
      const ph2 = propertyPrices[propertyPrices.length - 1];
      raw.priceLow = pl2;
      raw.priceHigh = ph2;
      raw.priceMid = Math.round((pl2 + ph2) / 2);
    } else if (propertyPrices.length === 1) {
      const p = propertyPrices[0];
      raw.priceMid = p;
      raw.priceLow = Math.round(p * 0.95);
      raw.priceHigh = Math.round(p * 1.05);
    }
  }

  if (allPrices.length > 0 && !raw.currentPrice) {
    raw.currentPrice = allPrices[0];
  }

  // Price label
  const priceLabelMatch = markdown.match(/((?:offers?\s+(?:over|above|from)|auction|contact\s+agent|price\s+guide|guide|expressions?\s+of\s+interest)[^\n]{0,60})/i);
  if (priceLabelMatch) raw.priceLabel = priceLabelMatch[1].trim();

  // Year built
  const yearMatch = markdown.match(/(?:built|year\s*built|constructed)\s*(?:in\s*)?(\d{4})/i);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 1800 && year <= 2030) raw.yearBuilt = year;
  }

  // Features
  const featureKeywords = [
    'pool', 'solar', 'air conditioning', 'ducted', 'fireplace', 'dishwasher',
    'study', 'balcony', 'courtyard', 'garden', 'shed', 'granny flat',
    'renovated', 'new kitchen', 'ensuite', 'walk-in robe', 'alarm',
  ];
  const foundFeatures = featureKeywords.filter((kw) => text.includes(kw));
  if (foundFeatures.length > 0) raw.features = foundFeatures;

  // Photos
  const imgMatches = [...markdown.matchAll(/(?:https?:\/\/[^\s"')]+\.(?:jpg|jpeg|png|webp))/gi)];
  if (imgMatches.length > 0) {
    raw.photos = [...new Set(imgMatches.map((m) => m[0]))].slice(0, 20);
  }

  return { source, raw, extractedAt: new Date() };
}

// ─── JSON Parser ────────────────────────────────────────────────────────────

function parseJsonResponse(text: string): Record<string, unknown> | null {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
