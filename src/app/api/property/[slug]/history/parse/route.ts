import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth/session';
import { parseHistoryText, type ParsedHistoryRecord } from '@/lib/extraction/history-text';
import { callLLM } from '@/lib/extraction/extractor';

/**
 * POST /api/property/[slug]/history/parse — turn pasted history text into records
 * for review. Regex parser first (free); the LLM cascade only when it finds nothing.
 * Nothing is saved here — the client posts each accepted row to ../history.
 */
const SYSTEM = `Extract property transaction history from pasted text. Return ONLY JSON:
{"records":[{"kind":"sale"|"rental"|"listing","date":"YYYY-MM-DD","amount":number|null,"agency":string|null}]}
amount = sale price for a sale, weekly rent for a rental, null for a listing. Use the day-precise date when given; a month-only date becomes the 1st. Omit records with no date.`;

export async function POST(req: NextRequest) {
  if (!(await getUserId(req))) {
    return NextResponse.json({ error: 'Sign in to add property records' }, { status: 401 });
  }
  let text = '';
  try { text = String((await req.json()).text ?? ''); } catch { /* fall through */ }
  if (!text.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  if (text.length > 20_000) return NextResponse.json({ error: 'Paste is too long' }, { status: 400 });

  let records = parseHistoryText(text);
  let via: 'regex' | 'llm' = 'regex';
  if (records.length === 0) {
    const raw = await callLLM(SYSTEM, text, 2048);
    const m = raw?.match(/\{[\s\S]*\}/);
    try {
      const parsed = m ? (JSON.parse(m[0]) as { records?: ParsedHistoryRecord[] }) : null;
      records = (parsed?.records ?? []).filter(
        (r) => (r.kind === 'sale' || r.kind === 'rental' || r.kind === 'listing') && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
      ).map((r) => ({ ...r, amount: r.amount ?? undefined, agency: r.agency ?? undefined }));
      via = 'llm';
    } catch { records = []; }
  }
  return NextResponse.json({ records, via });
}
