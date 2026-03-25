import type { MergedPropertyProfile as PropertyProfile } from '@/types/property';

interface CacheEntry {
  profile: PropertyProfile;
  cachedAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Simple in-memory cache for property profiles.
 *
 * This is a placeholder for MVP — will be replaced by Redis or Supabase
 * in production. Data is lost on server restart.
 */
export class PropertyCache {
  private store = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Retrieve a cached property profile by address slug.
   * Returns undefined if not found or expired.
   */
  get(slug: string): PropertyProfile | undefined {
    const entry = this.store.get(slug);
    if (!entry) return undefined;

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.store.delete(slug);
      return undefined;
    }

    return entry.profile;
  }

  /**
   * Store a property profile in the cache.
   */
  set(slug: string, profile: PropertyProfile): void {
    this.store.set(slug, {
      profile,
      cachedAt: Date.now(),
    });
  }

  /**
   * Check if a fresh (non-expired) entry exists for the given slug.
   */
  has(slug: string): boolean {
    return this.get(slug) !== undefined;
  }

  /**
   * Remove a specific entry from the cache.
   */
  invalidate(slug: string): boolean {
    return this.store.delete(slug);
  }

  /**
   * Remove all expired entries from the cache.
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.store) {
      if (now - entry.cachedAt > this.ttlMs) {
        this.store.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of entries currently in the cache (including expired).
   */
  get size(): number {
    return this.store.size;
  }
}

/**
 * Singleton cache instance shared across API routes.
 */
export const propertyCache = new PropertyCache();
