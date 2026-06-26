import { describe, it, expect } from 'vitest';
import { hasAllowedDomain, ALLOWED_EMAIL_DOMAIN } from '../allowlist';

describe('hasAllowedDomain', () => {
  it('accepts @grantsea.com.au addresses (case/space-insensitive)', () => {
    expect(hasAllowedDomain('stuart@grantsea.com.au')).toBe(true);
    expect(hasAllowedDomain('  Stuart@GrantsEA.com.au  ')).toBe(true);
  });

  it('rejects other domains', () => {
    expect(hasAllowedDomain('stuart@gmail.com')).toBe(false);
    expect(hasAllowedDomain('stuart@grantse.com.au')).toBe(false); // lookalike domain
    expect(hasAllowedDomain('stuart@sub.grantsea.com.au')).toBe(false); // @-anchored: only the exact domain
    expect(hasAllowedDomain('evil@grantsea.com.au.attacker.com')).toBe(false); // suffix-spoof attempt
  });

  it('rejects empty / nullish input', () => {
    expect(hasAllowedDomain('')).toBe(false);
    expect(hasAllowedDomain(null)).toBe(false);
    expect(hasAllowedDomain(undefined)).toBe(false);
  });

  it('exposes the configured domain', () => {
    expect(ALLOWED_EMAIL_DOMAIN).toBe('grantsea.com.au');
  });
});
