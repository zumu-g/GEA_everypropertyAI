import { describe, it, expect } from 'vitest';
import nextConfig from '../../../../next.config';

/**
 * Mirrors next/image remotePatterns hostname semantics for the two shapes we
 * use: an exact host, or `**.example` which matches SUBDOMAINS ONLY (the bare
 * apex does not match — that was the 2026-09-11 "View photos are blank" bug).
 */
function hostAllowed(url: string): boolean {
  const host = new URL(url).hostname;
  const patterns = (nextConfig.images?.remotePatterns ?? []) as Array<{ hostname?: string }>;
  return patterns.some(({ hostname }) => {
    if (!hostname) return false;
    if (hostname.startsWith('**.')) return host.endsWith(hostname.slice(2)) && host !== hostname.slice(3);
    return host === hostname;
  });
}

// One real image_url per feed source, sampled from prod rows.
const LIVE_PHOTO_URLS = [
  'https://view.com.au/viewstatic/images/listing/3-bedroom-house-in-berwick-vic-3806/800-w/17925248-1-1404400.jpg', // property_rentals (bare host)
  'https://rimh2.domainstatic.com.au/abc=/720x540/filters:format(webp):quality(85)/2020838541_1_1_260513_053834-w3000-h2000',
  'https://i3.au.reastatic.net/1200x900-fit,format=webp/5b436f1a/image.jpg',
  'https://images.allhomes.com.au/property/photo/3039182dbf3b251035f33c0d8053be79_hd.jpg',
  'https://www.homely.com.au/img-variant/l-VaultRE-13493352-1.jpg?named-transform=webDefaultTransform',
];

describe('next.config images.remotePatterns', () => {
  it.each(LIVE_PHOTO_URLS)('allows live feed photo host: %s', (url) => {
    expect(hostAllowed(url)).toBe(true);
  });

  it('rejects an unknown host (allow-list is still an allow-list)', () => {
    expect(hostAllowed('https://evil.example.com/x.jpg')).toBe(false);
  });
});
