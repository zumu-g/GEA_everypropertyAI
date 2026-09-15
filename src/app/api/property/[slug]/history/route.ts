import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth/session';
import { insertPropertySales, insertPropertyRentalHistory } from '@/lib/db/queries';

/**
 * POST /api/property/[slug]/history — record a sale or lease the feeds missed.
 *
 * Rows land in property_sales / property_rental_history with source
 * 'manual-import' (same as scripts/add-*-sale.mjs), so the profile's
 * Property History picks them up on the next load via topUpHistory() and
 * sold comps / CMA queries see them like any feed row. Signed-in users only.
 */
// Not exported: a Next.js route module may only export route handlers and the
// framework's own config keys, so an extra named export fails `next build`.
const MANUAL_SOURCE = 'manual-import';

interface Body {
  kind?: 'sale' | 'rental';
  date?: string;
  amount?: number;
  agency?: string;
  rawAddress?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!(await getUserId(req))) {
    return NextResponse.json({ error: 'Sign in to add property records' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { kind, date, amount, agency, rawAddress, suburb, state, postcode, latitude, longitude } = body;
  if (kind !== 'sale' && kind !== 'rental') {
    return NextResponse.json({ error: 'kind must be "sale" or "rental"' }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
  }
  if (!rawAddress?.trim() || !state?.trim()) {
    return NextResponse.json({ error: 'rawAddress and state are required' }, { status: 400 });
  }

  const base = {
    address_slug: slug,
    raw_address: rawAddress.trim(),
    suburb: suburb?.trim() || undefined,
    state: state.trim().toUpperCase(),
    postcode: postcode?.trim() || undefined,
    agency_name: agency?.trim() || undefined,
    source: MANUAL_SOURCE,
  };

  try {
    if (kind === 'sale') {
      await insertPropertySales([{
        ...base,
        sale_price: amount,
        sale_date: date,
        ...(typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : {}),
      }]);
    } else {
      await insertPropertyRentalHistory([{ ...base, weekly_rent: amount, lease_date: date }]);
    }
  } catch (e) {
    console.error('[property/history] insert failed:', e);
    return NextResponse.json({ error: 'Failed to save record' }, { status: 500 });
  }

  return NextResponse.json({ success: true, kind, date, amount });
}
