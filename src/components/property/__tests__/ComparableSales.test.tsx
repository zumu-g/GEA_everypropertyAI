// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComparableSales, type ComparableResult } from '../ComparableSales';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const comp = (overrides: Partial<ComparableResult> = {}): ComparableResult => ({
  address: '12 Smith St, Berwick VIC 3806',
  suburb: 'Berwick',
  price: 750000,
  saleDate: '2026-05-01',
  beds: 3,
  baths: 2,
  landAreaSqm: 500,
  similarityScore: 120,
  ...overrides,
});

function mockFetch(comparables: ComparableResult[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comparables }),
    }),
  );
}

describe('ComparableSales links', () => {
  it('renders each card as a link carrying a structured address with the suburb field set', async () => {
    mockFetch([comp()]);
    render(<ComparableSales suburb="Berwick" />);

    const link = await waitFor(() => screen.getByRole('link'));
    const href = link.getAttribute('href')!;
    expect(href).toMatch(/^\/property\?address=/);
    const structured = JSON.parse(decodeURIComponent(href.replace('/property?address=', '')));
    expect(structured.suburb).toBe('Berwick');
    expect(structured.streetName).not.toContain('Berwick');
  });

  it('splits a plain street address into number/name/type', async () => {
    mockFetch([comp({ address: '12 Smith Street', suburb: 'Berwick' })]);
    render(<ComparableSales suburb="Berwick" />);

    const link = await waitFor(() => screen.getByRole('link'));
    const href = link.getAttribute('href')!;
    const structured = JSON.parse(decodeURIComponent(href.replace('/property?address=', '')));
    expect(structured.streetNumber).toBe('12');
    expect(structured.streetName).toBe('Smith');
    expect(structured.streetType).toBe('Street');
  });

  it('does not double-suffix an address that already contains the suburb', async () => {
    mockFetch([comp({ address: '12 Smith St, Berwick VIC 3806', suburb: 'Berwick' })]);
    render(<ComparableSales suburb="Berwick" />);

    const link = await waitFor(() => screen.getByRole('link'));
    const href = link.getAttribute('href')!;
    const structured = JSON.parse(decodeURIComponent(href.replace('/property?address=', '')));
    expect(structured.suburb).toBe('Berwick');
    expect((structured.streetName + ' ' + structured.streetType).match(/berwick/i)).toBeNull();
  });

  it('wraps the whole card (price, date, badges) inside the link, not just the address text', async () => {
    mockFetch([comp()]);
    render(<ComparableSales suburb="Berwick" />);

    const link = await waitFor(() => screen.getByRole('link'));
    expect(link).toHaveTextContent('750,000');
    expect(link).toHaveTextContent('3 bed');
  });

  it('renders the empty state with no link when there are no comparables', async () => {
    mockFetch([]);
    render(<ComparableSales suburb="Berwick" />);

    await waitFor(() => screen.getByText('Not enough local data yet'));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
