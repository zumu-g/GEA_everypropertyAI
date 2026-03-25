import type { CrawlJobId, PropertyId, DataSource, StructuredAddress } from './property';
import type { DataSourceName } from './source';

// ─── Crawl Status ────────────────────────────────────────────────────────────

export type CrawlStatus =
  | 'queued'
  | 'running'
  | 'extracting'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rate-limited';

export type CrawlPriority = 'low' | 'normal' | 'high' | 'critical';

// ─── Crawl Job ───────────────────────────────────────────────────────────────

export interface CrawlJob {
  id: CrawlJobId;
  propertyId?: PropertyId;
  /** The address or URL being crawled */
  target: CrawlTarget;
  sources: DataSourceName[];
  status: CrawlStatus;
  priority: CrawlPriority;

  /** Per-source status */
  sourceStatuses: Record<DataSourceName, SourceCrawlStatus>;

  /** Retry tracking */
  attemptCount: number;
  maxAttempts: number;
  lastError?: CrawlError;
  errors: CrawlError[];

  /** Timing */
  createdAt: string; // ISO datetime
  startedAt?: string;
  completedAt?: string;
  /** Estimated time remaining in ms */
  estimatedTimeRemainingMs?: number;

  /** Who or what triggered this crawl */
  triggeredBy: 'user' | 'schedule' | 'webhook' | 'system';
  /** Optional user or system ID */
  triggeredById?: string;

  /** Results once complete */
  result?: CrawlJobResult;
}

export type CrawlTarget =
  | { type: 'address'; address: string; state?: string }
  | { type: 'url'; url: string; sourceName: DataSourceName }
  | { type: 'property-id'; propertyId: PropertyId };

export interface SourceCrawlStatus {
  sourceName: DataSourceName;
  status: CrawlStatus;
  url?: string;
  startedAt?: string;
  completedAt?: string;
  pagesScraped: number;
  bytesDownloaded: number;
  error?: CrawlError;
}

export interface CrawlError {
  code: CrawlErrorCode;
  message: string;
  /** The source that errored, if source-specific */
  sourceName?: DataSourceName;
  timestamp: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Raw error details for debugging */
  details?: Record<string, unknown>;
}

export type CrawlErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'CAPTCHA'
  | 'NOT_FOUND'
  | 'PARSE_ERROR'
  | 'EXTRACTION_FAILED'
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'SOURCE_UNAVAILABLE'
  | 'UNKNOWN';

// ─── Crawl Job Result (aggregate) ────────────────────────────────────────────

export interface CrawlJobResult {
  jobId: CrawlJobId;
  propertyId: PropertyId;
  /** Number of sources successfully crawled */
  sourcesCompleted: number;
  sourcesFailed: number;
  sourcesSkipped: number;
  /** Total fields extracted across all sources */
  totalFieldsExtracted: number;
  /** Fields that had conflicting values across sources */
  conflictCount: number;
  /** Processing times per phase in ms */
  timing: {
    totalMs: number;
    crawlMs: number;
    extractionMs: number;
    mergingMs: number;
  };
  /** Sources that contributed data */
  dataSources: DataSource[];
}

// ─── Single-page Crawl Result (used by Firecrawl client) ────────────────────

/**
 * Result of scraping a single URL via Firecrawl.
 * Used by the crawl orchestrator and extraction pipeline.
 */
export interface CrawlResult {
  source: string;
  url: string;
  status: 'success' | 'failed' | 'timeout';
  markdown?: string;
  html?: string;
  metadata?: Record<string, unknown>;
  crawledAt: Date;
  error?: string;
}

// ─── Source Configuration ────────────────────────────────────────────────────

export interface SourceConfig {
  name: DataSourceName | string;
  /** Is this source currently enabled? */
  enabled: boolean;

  // ─── URL builders (used by orchestrator) ──────────────────────────────────
  /** Build the direct property page URL for this source */
  buildPropertyUrl: (address: StructuredAddress) => string;
  /** Build a search/fallback URL for this source */
  buildSearchUrl?: (address: StructuredAddress) => string;
  /** Options passed to Firecrawl scrapeUrl */
  scrapeOptions?: {
    waitFor?: string;
    timeout?: number;
    formats?: string[];
  };

  // ─── Extended configuration (for advanced pipeline) ───────────────────────
  /** Base URL for the source */
  baseUrl?: string;
  /** Rate limiting */
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerHour: number;
    concurrentRequests: number;
  };
  /** How often to re-crawl data from this source */
  refreshIntervalHours?: number;
  /** Does this source require authentication? */
  requiresAuth?: boolean;
  /** Priority order when merging conflicting data (lower = higher priority) */
  trustRank?: number;
  /** CSS selectors or extraction hints for this source */
  extractionConfig?: Record<string, unknown>;
  /** Custom headers to send */
  headers?: Record<string, string>;
  /** Source-specific options */
  options?: Record<string, unknown>;
}

// ─── Crawl Queue ─────────────────────────────────────────────────────────────

export interface CrawlQueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  averageCompletionTimeMs: number;
  /** Estimated time to drain the queue at current throughput */
  estimatedDrainTimeMs: number;
  /** Source-level stats */
  perSource: Record<DataSourceName, {
    queued: number;
    running: number;
    rateLimitRemaining: number;
    rateLimitResetsAt?: string;
  }>;
}
