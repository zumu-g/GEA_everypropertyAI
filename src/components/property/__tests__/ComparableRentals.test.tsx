// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComparableRentals } from '../ComparableRentals';
import type { WeightedRentalComp } from '@/lib/estimation/rental-comparables-estimator';

afterEach(cleanup);

const comp = (overrides: Partial<WeightedRentalComp> = {}): WeightedRentalComp => ({
  rawAddress: '12 Smith St, Berwick VIC 3806',
  suburb: 'Berwick',
  weeklyRent: 620,
  asOf: '2026-05-01',
  bedrooms: 3,
  bathrooms: 2,
  landAreaSqm: 500,
  adjustedRent: 630,
  monthsAgo: 2,
  weight: 0.8,
  ...overrides,
});

describe('ComparableRentals', () => {
  it('renders at most 4 cards sorted by weight, top comp at 100% match', () => {
    const comps = [0.2, 0.9, 0.5, 0.7, 0.3, 0.6].map((weight, i) =>
      comp({ weight, rawAddress: `${i} Test St, Berwick VIC 3806` }),
    );
    render(<ComparableRentals comps={comps} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    // Highest weight (0.9 = card index 1) renders first at 100%
    expect(links[0]).toHaveTextContent('1 Test St');
    expect(links[0]).toHaveTextContent('100% match');
  });

  it('formats weekly rent as $X/wk and asOf as a readable date', () => {
    render(<ComparableRentals comps={[comp({ weeklyRent: 1250 })]} />);
    expect(screen.getByText('$1,250/wk')).toBeTruthy();
    expect(screen.getByText(/1 May 2026/)).toBeTruthy();
  });

  it('omits the date line for an empty asOf instead of rendering Invalid Date', () => {
    render(<ComparableRentals comps={[comp({ asOf: '' })]} />);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('renders the placeholder block when a comp has no image', () => {
    const { container } = render(<ComparableRentals comps={[comp()]} />);
    expect(container.querySelector('img')).toBeNull(); // placeholder, not next/image
  });

  it('links to /property with the comp suburb in the structured address', () => {
    render(<ComparableRentals comps={[comp()]} />);
    const href = screen.getByRole('link').getAttribute('href') ?? '';
    const structured = JSON.parse(decodeURIComponent(href.replace('/property?address=', '')));
    expect(structured.suburb.toLowerCase()).toBe('berwick');
    expect(structured.state).toBe('VIC');
  });

  it('builds a sane href for a comp with no suburb (no ", undefined" parse)', () => {
    render(<ComparableRentals comps={[comp({ suburb: undefined })]} />);
    const href = screen.getByRole('link').getAttribute('href') ?? '';
    expect(href).not.toContain('undefined');
    const structured = JSON.parse(decodeURIComponent(href.replace('/property?address=', '')));
    expect(structured.state).toBe('VIC');
  });

  it('renders nothing for an empty comps array', () => {
    const { container } = render(<ComparableRentals comps={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
