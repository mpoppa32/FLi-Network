// Corsair framework — retry utility with exponential backoff
//
// Per framework spec Part Five: retries on transient errors, fail-fast on
// permanent. Source-specific overrides per FIQ retry config.

import { categorizeError } from "./errors";
import { Logger } from "./logger";

export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number[];
  retriableStatusCodes?: number[];
  retriableErrorTypes?: string[];
  perAttemptTimeoutMs?: number;
  totalDeadlineMs?: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 4,
  backoffMs: [1000, 5000, 30000],
  retriableStatusCodes: [408, 429, 500, 502, 503, 504],
  retriableErrorTypes: ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"],
  perAttemptTimeoutMs: 30_000,
  totalDeadlineMs: 120_000,
};

// Per-source overrides (framework spec Part Five)
export const RETRY_CONFIGS: Record<string, Partial<RetryConfig>> = {
  sec_edgar: {
    maxAttempts: 6,
    backoffMs: [30_000, 60_000, 120_000, 300_000, 600_000],
  },
  dod_news: {
    maxAttempts: 3,
    backoffMs: [2000, 10_000],
  },
  gao_protest: {
    maxAttempts: 4,
    backoffMs: [2000, 10_000, 30_000],
  },
};

export function resolveRetryConfig(source: string): RetryConfig {
  return { ...DEFAULT_RETRY, ...(RETRY_CONFIGS[source] ?? {}) };
}

/**
 * Run a function with retry. Retries on transient errors; fails-fast on
 * permanent. Returns the function's result on success; throws the final
 * error on exhaustion.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    source?: string;
    config?: RetryConfig;
    log?: Logger;
    operationName?: string;
  } = {}
): Promise<T> {
  const cfg: RetryConfig = options.config ?? (options.source ? resolveRetryConfig(options.source) : DEFAULT_RETRY);
  const deadline = Date.now() + (cfg.totalDeadlineMs ?? Infinity);
  const opName = options.operationName ?? "operation";

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    if (Date.now() >= deadline) {
      options.log?.warn("retry_deadline_exceeded", { operationName: opName, attempt });
      throw new Error(`Retry deadline exceeded for ${opName}`);
    }
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Per-attempt timeout after ${cfg.perAttemptTimeoutMs}ms`)),
            cfg.perAttemptTimeoutMs ?? 30_000
          )
        ),
      ]);
      if (attempt > 1) {
        options.log?.info("retry_succeeded", { operationName: opName, attempt });
      }
      return result;
    } catch (err) {
      lastError = err;
      const categorized = categorizeError(err);

      if (!categorized.retriable) {
        options.log?.error("retry_non_retriable", {
          operationName: opName,
          attempt,
          category: categorized.category,
          message: categorized.message,
        });
        throw err;
      }

      if (attempt >= cfg.maxAttempts) {
        options.log?.error("retry_exhausted", {
          operationName: opName,
          attempts: attempt,
          category: categorized.category,
        });
        throw err;
      }

      const backoffMs = cfg.backoffMs[Math.min(attempt - 1, cfg.backoffMs.length - 1)] ?? 5000;
      options.log?.info("retry_attempt", {
        operationName: opName,
        attempt,
        nextBackoffMs: backoffMs,
        category: categorized.category,
      });

      const waitDeadline = Date.now() + backoffMs;
      const waitTime = Math.min(backoffMs, deadline - Date.now());
      if (waitTime <= 0) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  // Unreachable but TypeScript needs an explicit return path
  throw lastError ?? new Error(`${opName} failed after ${cfg.maxAttempts} attempts`);
}
