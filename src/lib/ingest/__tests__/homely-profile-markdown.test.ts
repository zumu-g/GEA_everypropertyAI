import { describe, it, expect } from 'vitest';
import {
  homelyProfileHtmlToMarkdown,
  homelyProfileHtmlToExtraction,
} from '../homely-profile-markdown';

// Representative __NEXT_DATA__ shape calibrated against a live Homely capture
// (1 Murndal Court, Berwick — props.pageProps.listing).
const listing = {
  id: 13230431,
  statusType: 'available',
  listingType: 'sale',
  propertyType: 'house',
  propertyTypeDescription: 'House',
  title: 'Effortless Living in a Peaceful Berwick Court',
  description: 'Tucked away in a quiet court setting, this well-proportioned home offers a flexible layout.',
  priceDetails: { longDescription: '$800,000 - $880,000', shortDescription: '$800k-$880k' },
  saleDetails: {
    listingDetails: { listedOn: '2026-06-10T00:35:30.403Z' },
    soldDetails: { soldOn: null },
    loanPrice: 800000,
  },
  address: {
    subNumber: null,
    streetNumber: '1',
    street: 'Murndal Court',
    suburb: 'Berwick',
    state: 'Victoria',
    stateCode: 'VIC',
    postcode: '3806',
    longAddress: '1 Murndal Court, Berwick VIC 3806',
    shortAddress: '1 Murndal Court, Berwick',
    latitude: -38.03,
    longitude: 145.34,
  },
  features: { bathrooms: 2, bedrooms: 3, cars: 2, tags: ['Air conditioning'], extraFeatures: [], otherFeatures: '' },
  landFeatures: { areaSqm: 689 },
  agents: [{ name: 'Darsh Naidoo', mobile: '0413 530 041' }],
  office: { fullName: 'ION Real Estate', phone: '0401053553' },
  media: {
    photos: [
      { webDefaultURI: 'https://www.homely.com.au/img-variant/l-Rex-13230431-1.jpg?x=1' },
      { webDefaultURI: 'https://www.homely.com.au/img-variant/l-Rex-13230431-2.jpg?x=2' },
    ],
  },
};

function htmlFor(node: unknown): string {
  const data = { props: { pageProps: { listing: node } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

describe('homelyProfileHtmlToExtraction', () => {
  it('extracts subject attributes from __NEXT_DATA__', () => {
    const ext = homelyProfileHtmlToExtraction(htmlFor(listing));
    expect(ext).not.toBeNull();
    const raw = ext!.raw as Record<string, unknown>;
    expect(ext!.source).toBe('homely.com.au');
    expect(raw.propertyType).toBe('house');
    expect(raw.bedrooms).toBe(3);
    expect(raw.bathrooms).toBe(2);
    expect(raw.carSpaces).toBe(2);
    expect(raw.landArea).toBe(689);
    expect(raw.latitude).toBe(-38.03);
    expect(raw.longitude).toBe(145.34);
    expect(raw.priceFrom).toBe(800000);
    expect(raw.priceTo).toBe(880000);
    expect(raw.priceLabel).toBe('$800,000 - $880,000');
    expect(raw.agencyName).toBe('ION Real Estate');
    expect(raw.agentName).toBe('Darsh Naidoo');
    expect(raw.agentPhone).toBe('0413 530 041');
    expect(raw.features).toContain('Air conditioning');
    expect((raw.photos as string[]).length).toBe(2);
    const addr = raw.address as Record<string, unknown>;
    expect(addr.streetNumber).toBe('1');
    expect(addr.streetName).toBe('Murndal');
    expect(addr.streetType).toBe('Court');
    expect(addr.state).toBe('VIC');
    expect(addr.postcode).toBe('3806');
  });

  it('builds a saleHistory entry for sold listings', () => {
    const sold = {
      ...listing,
      statusType: 'sold',
      saleDetails: { ...listing.saleDetails, soldDetails: { soldOn: '2026-05-20T00:00:00.000Z' }, loanPrice: 870000 },
    };
    const ext = homelyProfileHtmlToExtraction(htmlFor(sold));
    const hist = (ext!.raw as Record<string, unknown>).saleHistory as Array<Record<string, unknown>>;
    expect(hist).toHaveLength(1);
    expect(hist[0].date).toBe('2026-05-20');
    expect(hist[0].price).toBe(870000);
    expect(hist[0].type).toBe('Sold');
  });

  it('returns null on a shell / 404 page (no listing node)', () => {
    expect(homelyProfileHtmlToExtraction('<html><body>not found</body></html>')).toBeNull();
    expect(homelyProfileHtmlToMarkdown(htmlFor(null))).toBeNull();
  });

  it('returns null when no subject attributes are present', () => {
    const addressOnly = { address: listing.address, features: {} };
    expect(homelyProfileHtmlToExtraction(htmlFor(addressOnly))).toBeNull();
  });
});

describe('homelyProfileHtmlToMarkdown', () => {
  it('renders subject + price + photos as markdown', () => {
    const md = homelyProfileHtmlToMarkdown(htmlFor(listing));
    expect(md).toContain('1 Murndal Court, Berwick VIC 3806');
    expect(md).toContain('**Bedrooms:** 3');
    expect(md).toContain('**Land Area:** 689 sqm');
    expect(md).toContain('$800,000 - $880,000');
    expect(md).toContain('img-variant/l-Rex-13230431-1.jpg');
  });
});
