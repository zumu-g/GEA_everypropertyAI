import { describe, it, expect } from 'vitest';
import {
  parseNextData,
  findListingNodes,
  listingNodeToDomainItem,
  extractDomainListings,
} from '../domain-page-extractor';
import { mapItem } from '../domain-mapper';

// Representative __NEXT_DATA__ shape (the ASSUMED Domain structure — recalibrate
// against a live Web Unlocker capture). Two sold listings in Berwick.
const nextDataObj = {
  props: {
    pageProps: {
      componentProps: {
        listingsMap: {
          '2019123456': {
            url: 'https://www.domain.com.au/12-smith-st-berwick-vic-3806-2019123456',
            listingModel: {
              price: '$850,000',
              dateListed: '2024-10-07',
              address: {
                displayAddress: '12 Smith St, Berwick VIC 3806',
                suburb: 'Berwick', state: 'VIC', postcode: '3806', lat: -38.03, lng: 145.34,
              },
              features: { beds: 4, baths: 2, parking: 2, landSize: 600 },
              tags: { tagText: 'Sold 07 Oct 2024' },
              branding: { name: "O'Brien Real Estate Berwick" },
              propertyType: 'House',
              images: [{ url: 'https://img.domain.com.au/a.jpg' }],
            },
          },
          '2019999999': {
            listingModel: {
              price: '$720,000',
              address: { displayAddress: '5 Jones Ct, Berwick VIC 3806', suburb: 'Berwick', state: 'VIC', postcode: '3806' },
              features: { beds: 3, baths: 1, parking: 1 },
              tags: { tagText: 'Sold 01 Sep 2024' },
            },
          },
        },
      },
    },
  },
};

const html = `<html><head></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextDataObj)}</script>
</body></html>`;

describe('parseNextData / findListingNodes', () => {
  it('parses the embedded __NEXT_DATA__ JSON', () => {
    const d = parseNextData(html);
    expect(d).not.toBeNull();
    expect(findListingNodes(d)).toHaveLength(2);
  });

  it('returns null / [] when the script is missing or malformed', () => {
    expect(parseNextData('<html>no script</html>')).toBeNull();
    expect(parseNextData('<script id="__NEXT_DATA__">{bad json</script>')).toBeNull();
    expect(findListingNodes(null)).toEqual([]);
  });
});

describe('listingNodeToDomainItem', () => {
  it('maps a listing node to the DomainItem shape mapItem consumes', () => {
    const nodes = findListingNodes(parseNextData(html));
    const item = listingNodeToDomainItem(nodes[0]);
    expect(item).toMatchObject({
      location: { display_address: '12 Smith St, Berwick VIC 3806', suburb: 'Berwick', postcode: '3806' },
      pricing: { display_price: '$850,000' },
      property: { bedrooms: 4, bathrooms: 2, parking: 2 },
    });
    // The output must feed mapItem cleanly (the real consumer).
    const row = mapItem('sold', item!);
    expect(row).toMatchObject({ raw_address: '12 Smith St, Berwick VIC 3806', sale_price: 850000, sale_date: '2024-10-07' });
  });

  it('feeds an on-market mapItem with listed_date from the node dateListed', () => {
    const nodes = findListingNodes(parseNextData(html));
    const row = mapItem('on-market', listingNodeToDomainItem(nodes[0])!);
    expect(row).toMatchObject({ raw_address: '12 Smith St, Berwick VIC 3806', listed_date: '2024-10-07' });
  });

  it('returns null for a node without a display address', () => {
    expect(listingNodeToDomainItem({ listingModel: { price: '$1' } })).toBeNull();
  });
});

describe('extractDomainListings', () => {
  it('extracts all listings end-to-end and they map to valid sold rows', () => {
    const items = extractDomainListings(html);
    expect(items).toHaveLength(2);
    const rows = items.map((it) => mapItem('sold', it)).filter(Boolean);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sale_price: 850000 });
  });

  it('returns [] for a blocked/empty page (no listings) without throwing', () => {
    expect(extractDomainListings('<html>Access Denied</html>')).toEqual([]);
  });
});
