import { describe, it, expect } from 'vitest';
import { renderReport } from './listing-report-render.mjs';

const r = (o = {}) => ({ raw_address: '1 A St, Berwick VIC 3806', suburb: 'Berwick', bedrooms: 4, bathrooms: 2, car_spaces: 2, property_type: 'house',
  display_price: '$800,000 - $850,000', agency_name: 'Grants', agent_name: 'Stuart Grant', listing_url: 'https://x/1', daysOnMarket: 55, firstSeen: false, cut: { cuts: 1, pct: -5 }, ...o });
const meta = { date: '24/11/2026', total55: 312, feedIssues: [], staleCount: 0 };

describe('renderReport', () => {
  it('renders an A4 sheet per suburb group with one table row per listing', () => {
    const html = renderReport('55day', [['Berwick', [r(), r({ raw_address: '2 B St' })]], ['Officer', [r({ suburb: 'Officer' })]]], meta);
    expect(html).toContain('size:A4 portrait');
    expect(html.match(/<tr class="l">/g)).toHaveLength(3);
    expect(html).toContain('Berwick');
    expect(html).toContain('312');
    expect(html).toContain('<svg');
    expect(html).toContain('-5%');
  });
  it('flags first-seen days on market', () => {
    expect(renderReport('55day', [['Berwick', [r({ firstSeen: true })]]], meta)).toContain('first seen');
  });
  it('shows a feed-health banner naming the failed feed', () => {
    expect(renderReport('withdrawn', [], { ...meta, feedIssues: ['homely (blocked)'] })).toContain('homely (blocked)');
  });
  it('empty state says none today; withdrawn shows the backstop count', () => {
    const html = renderReport('withdrawn', [], { ...meta, staleCount: 7 });
    expect(html).toContain('None today');
    expect(html).toContain('7');
  });
  it('skips missing agency/agent without a double separator', () => {
    expect(renderReport('55day', [['Berwick', [r({ agency_name: null })]]], meta)).not.toContain('·  ·');
    expect(renderReport('55day', [['Berwick', [r({ agency_name: null })]]], meta)).toContain('4 / 2 / 2 · Stuart Grant');
  });
  it('escapes HTML in source data', () => {
    expect(renderReport('55day', [['Berwick', [r({ agency_name: '<b>x</b>' })]]], meta)).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
