import { describe, it, expect, vi } from 'vitest';
import { homelySource } from '../homely';
import type { StructuredAddress } from '@/types/property';

const address: StructuredAddress = {
  streetNumber: '1',
  streetName: 'Murndal',
  streetType: 'Court',
  suburb: 'Berwick',
  state: 'VIC',
  postcode: '3806',
};

// A trimmed for-sale index page: anchor tags to /homes/{slug}/{id}.
const indexHtml = `
  <a href="/homes/1-venables-court-berwick-vic-3806/13217138">x</a>
  <a href="/homes/1-murndal-court-berwick-vic-3806/13230431">x</a>
  <a href="/homes/10-stefan-drive-berwick-vic-3806/13226719">x</a>
`;

describe('homelySource.discoverPropertyUrl', () => {
  it('resolves the detail URL (with numeric id) by matching the address slug', async () => {
    const fetchPage = vi.fn().mockResolvedValue(indexHtml);
    const url = await homelySource.discoverPropertyUrl!(address, fetchPage);
    expect(url).toBe('https://www.homely.com.au/homes/1-murndal-court-berwick-vic-3806/13230431');
    // for-sale index is tried first and matched, so sold index is not fetched.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0]).toBe('https://www.homely.com.au/for-sale/berwick-vic-3806');
  });

  it('expands an abbreviated street type before matching', async () => {
    const fetchPage = vi.fn().mockResolvedValue(indexHtml);
    const url = await homelySource.discoverPropertyUrl!({ ...address, streetType: 'Ct' }, fetchPage);
    expect(url).toBe('https://www.homely.com.au/homes/1-murndal-court-berwick-vic-3806/13230431');
  });

  it('falls through to the sold index when for-sale has no match', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce('<a href="/homes/99-other-street-berwick-vic-3806/1">x</a>')
      .mockResolvedValueOnce(indexHtml);
    const url = await homelySource.discoverPropertyUrl!(address, fetchPage);
    expect(url).toBe('https://www.homely.com.au/homes/1-murndal-court-berwick-vic-3806/13230431');
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0]).toBe('https://www.homely.com.au/sold-properties/berwick-vic-3806');
  });

  it('returns null when no link matches the address', async () => {
    const fetchPage = vi.fn().mockResolvedValue('<a href="/homes/99-other-street-berwick-vic-3806/1">x</a>');
    const url = await homelySource.discoverPropertyUrl!(address, fetchPage);
    expect(url).toBeNull();
  });

  it('returns null when the index cannot be fetched', async () => {
    const fetchPage = vi.fn().mockResolvedValue(null);
    const url = await homelySource.discoverPropertyUrl!(address, fetchPage);
    expect(url).toBeNull();
  });
});
