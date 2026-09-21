import { describe, it, expect } from 'vitest';
import { parseHistoryText } from '../history-text';

const REA = `2013
2013 Sold $450,000
Sold
$450,000
10 Jan 2013 by Grant's Estate Agents - Berwick
2013 Listed for sale
Listed for sale

Listed January 2013

11

Listed on 7 Jan 2013
2010
2010 Sold $416,000
Sold
$416,000
16 Feb 2010 by Just Real Estate - Casey Cardinia
2009
2009 Listed for sale
Listed for sale

Listed October 2009

7

Listed on 13 Oct 2009
2004
2004 Sold $165,000
Sold
$165,000
Sold 29 May 2004`;

describe('parseHistoryText', () => {
  it('extracts every sale with date, price and agency from a pasted REA panel', () => {
    const sales = parseHistoryText(REA).filter((r) => r.kind === 'sale');
    expect(sales).toEqual([
      { kind: 'sale', date: '2013-01-10', amount: 450000, agency: "Grant's Estate Agents - Berwick" },
      { kind: 'sale', date: '2010-02-16', amount: 416000, agency: 'Just Real Estate - Casey Cardinia' },
      { kind: 'sale', date: '2004-05-29', amount: 165000, agency: undefined },
    ]);
  });

  it('keeps listings (day-precise date) so the user can see them, without an amount', () => {
    const listings = parseHistoryText(REA).filter((r) => r.kind === 'listing');
    expect(listings.map((l) => l.date)).toEqual(['2013-01-07', '2009-10-13']);
  });

  it('reads a lease line', () => {
    expect(parseHistoryText('Leased $650 pw on 3 Mar 2024 by Ray White')).toEqual([
      { kind: 'rental', date: '2024-03-03', amount: 650, agency: 'Ray White' },
    ]);
  });

  it('returns nothing for unrelated text', () => {
    expect(parseHistoryText('lovely 3 bedroom home')).toEqual([]);
  });
});
