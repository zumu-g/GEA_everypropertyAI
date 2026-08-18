import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allhomesProfileHtmlToExtraction } from '../allhomes-profile';

const fixture = readFileSync(join(__dirname, 'fixtures', 'allhomes-66a-duncan.html'), 'utf8');

describe('allhomes building-area capture', () => {
  it('null building fields produce no buildingArea key', () => {
    const raw = allhomesProfileHtmlToExtraction(fixture)!.raw as Record<string, unknown>;
    expect('buildingArea' in raw).toBe(false);
  });

  it('a populated floorArea is captured as buildingArea', () => {
    const doctored = fixture.replace('"floorArea":null', '"floorArea":187');
    const raw = allhomesProfileHtmlToExtraction(doctored)!.raw as Record<string, unknown>;
    expect(raw.buildingArea).toBe(187);
  });

  it('buildingSize is used when floorArea is null', () => {
    const doctored = fixture.replace('"buildingSize":null', '"buildingSize":204');
    const raw = allhomesProfileHtmlToExtraction(doctored)!.raw as Record<string, unknown>;
    expect(raw.buildingArea).toBe(204);
  });
});

describe('allhomes history daysOnMarket capture', () => {
  it('rental history entries carry daysOnMarket when the payload provides it', () => {
    const raw = allhomesProfileHtmlToExtraction(fixture)!.raw as Record<string, unknown>;
    const rentals = raw.rentalHistory as Array<{ date: string; weeklyRent: number | null; daysOnMarket?: number }>;
    expect(rentals[0].daysOnMarket).toBe(11);
    expect(rentals[0].weeklyRent).toBe(360);
  });
});
