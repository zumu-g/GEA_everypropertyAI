import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchAndCacheProfile = vi.fn();
const renderPropertyReport = vi.fn();

vi.mock('@/lib/jobs/fetch-profile', () => ({
  fetchAndCacheProfile: (...args: unknown[]) => fetchAndCacheProfile(...args),
}));

vi.mock('@/lib/pdf/property-report', () => ({
  renderPropertyReport: (...args: unknown[]) => renderPropertyReport(...args),
}));

describe('buildPropertyReportPdf', () => {
  beforeEach(() => {
    fetchAndCacheProfile.mockReset();
    renderPropertyReport.mockReset();
  });

  it('returns notFound when the address has neither streetName nor suburb after parsing', async () => {
    const { buildPropertyReportPdf } = await import('../build-property-report');
    const result = await buildPropertyReportPdf('   ');
    expect(result).toEqual({ notFound: true });
    expect(fetchAndCacheProfile).not.toHaveBeenCalled();
  });

  it('returns notFound when the fetch pipeline throws', async () => {
    fetchAndCacheProfile.mockRejectedValue(new Error('pipeline down'));
    const { buildPropertyReportPdf } = await import('../build-property-report');
    const result = await buildPropertyReportPdf('22 Boundary Road, Narre Warren East VIC 3804');
    expect(result).toEqual({ notFound: true });
  });

  it('resolves a valid address into PDF bytes and a normalized address string', async () => {
    fetchAndCacheProfile.mockResolvedValue({
      profile: {
        overallConfidence: 0.8,
        data: {
          address: { fullAddress: '22 Boundary Road, Narre Warren East VIC 3804' },
          bedrooms: 4,
          bathrooms: 2,
          saleHistory: [{ date: '2026-03-20', price: 1_500_000 }],
        },
      },
    });
    renderPropertyReport.mockResolvedValue(Buffer.from('%PDF-fake'));

    const { buildPropertyReportPdf } = await import('../build-property-report');
    const result = await buildPropertyReportPdf('22 Boundary Road, Narre Warren East VIC 3804');

    expect('notFound' in result).toBe(false);
    if (!('notFound' in result)) {
      expect(result.pdf).toEqual(Buffer.from('%PDF-fake'));
      expect(result.address).toContain('Boundary Road');
    }
    expect(renderPropertyReport).toHaveBeenCalledTimes(1);
    const [reportData] = renderPropertyReport.mock.calls[0];
    expect(reportData.bedrooms).toBe(4);
    expect(reportData.bathrooms).toBe(2);
    expect(reportData.saleHistory).toEqual([{ date: '2026-03-20', price: 1_500_000 }]);
  });
});
