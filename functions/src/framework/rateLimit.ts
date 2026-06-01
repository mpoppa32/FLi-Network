// Corsair framework — token bucket rate limiter with RTDB persistence
//
// Per framework spec Part Four: each source has a token bucket. Persistence
// to RTDB ensures concurrent Cloud Function instances don't over-consume.
//
// Per-source config:
//   SAM.gov:        10/sec burst, 1000/hr daily budget
//   USAspending:    5/sec, 1000/hr daily budget
//   DoD News:       1 req/2sec (polite scrape)
//   GAO Protest:    1 req/2sec (polite scrape)
//   SEC EDGAR:      10/sec strict (IP ban risk if exceeded)
//   Congress.gov:   5/sec, 5000/hr daily budget

import { db } from "./rtdb";

export interface RateLimitConfig {
  capacity: number; // max tokens (burst limit)
  refillPerSecond: number; // tokens added per second
  dailyBudget?: number; // optional daily cap (resets at UTC midnight)
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  sam_gov: { capacity: 10, refillPerSecond: 0.278, dailyBudget: 1000 },
  usaspending: { capacity: 5, refillPerSecond: 0.278, dailyBudget: 1000 },
  dod_news: { capacity: 1, refillPerSecond: 0.5 },
  gao_protest: { capacity: 1, refillPerSecond: 0.5 },
  sec_edgar: { capacity: 10, refillPerSecond: 10 },
  congress_gov: { capacity: 5, refillPerSecond: 1.389, dailyBudget: 5000 },
  // Tier 2 — Phase 8.6+
  faca: { capacity: 2, refillPerSecond: 0.5 }, // polite weekly cadence; no documented limit
  think_tank: { capacity: 3, refillPerSecond: 0.5 }, // polite per-tank polling; RSS-based
  dsca_fms: { capacity: 1, refillPerSecond: 0.5 }, // polite scrape, weekly cadence
  service_news: { capacity: 3, refillPerSecond: 0.5 }, // polite per-service RSS
  gao_reports: { capacity: 2, refillPerSecond: 0.5 }, // polite RSS, daily cadence
  dod_oig: { capacity: 2, refillPerSecond: 0.5 }, // polite RSS, daily cadence (sibling to gao_reports)
  darpa_news: { capacity: 2, refillPerSecond: 0.5 }, // polite RSS, daily cadence (DARPA news feed)
  nasa_oig: { capacity: 2, refillPerSecond: 0.5 }, // polite RSS, daily cadence (sibling to dod_oig)
  dod_comptroller: { capacity: 1, refillPerSecond: 0.5 }, // polite monthly PDF walk (R-2/P-1 budget books)
  state_department: { capacity: 2, refillPerSecond: 0.5 }, // polite multi-feed RSS aggregator
  defense_scoop: { capacity: 3, refillPerSecond: 0.5 }, // polite per-publication RSS (Breaking Defense / DefenseScoop / etc.)
  plum_book: { capacity: 1, refillPerSecond: 0.5 }, // polite monthly PDF walk (FVRA vacancy reports)
  senate_lda: { capacity: 3, refillPerSecond: 0.5 }, // polite weekly REST (lda.senate.gov)
  advisory_boards: { capacity: 1, refillPerSecond: 0.5 }, // polite weekly HTML+PDF walk (DSB/DBB/DIB)
  industry_assoc: { capacity: 1, refillPerSecond: 0.5 }, // polite quarterly HTML scrape (NDIA/AFA/AUSA rosters)
};

interface BucketState {
  tokens: number;
  lastRefillAt: number;
  dailyConsumed: number;
  dailyResetAt: number; // epoch ms of next UTC midnight
}

const STATE_PATH = (source: string) => `_systemState/rateLimiters/${source}`;

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Attempt to consume N tokens from the bucket. Returns success/failure with
 * suggested wait time on failure.
 */
export async function consumeTokens(
  source: string,
  count: number = 1
): Promise<{ success: boolean; waitMs: number; remainingTokens: number; dailyRemaining: number | null }> {
  const config = RATE_LIMITS[source];
  if (!config) {
    throw new Error(`No rate limit config for source: ${source}`);
  }

  const now = Date.now();
  const ref = db.ref(STATE_PATH(source));

  const txResult = await ref.transaction((current: BucketState | null) => {
    if (current === null) {
      // First call — initialize bucket
      if (count > config.capacity) {
        return; // can't satisfy; abort transaction
      }
      return {
        tokens: config.capacity - count,
        lastRefillAt: now,
        dailyConsumed: count,
        dailyResetAt: nextUtcMidnight(now),
      };
    }

    // Daily reset check
    let dailyConsumed = current.dailyConsumed ?? 0;
    let dailyResetAt = current.dailyResetAt ?? nextUtcMidnight(now);
    if (now >= dailyResetAt) {
      dailyConsumed = 0;
      dailyResetAt = nextUtcMidnight(now);
    }

    // Daily budget gate
    if (config.dailyBudget && dailyConsumed + count > config.dailyBudget) {
      return; // daily budget exhausted; abort
    }

    // Refill
    const elapsedSec = Math.max(0, (now - (current.lastRefillAt ?? now)) / 1000);
    const refill = elapsedSec * config.refillPerSecond;
    const tokens = Math.min(config.capacity, (current.tokens ?? 0) + refill);

    if (tokens < count) {
      return; // not enough tokens; abort
    }

    return {
      tokens: tokens - count,
      lastRefillAt: now,
      dailyConsumed: dailyConsumed + count,
      dailyResetAt,
    } as BucketState;
  });

  if (!txResult.committed) {
    // Compute suggested wait
    const snap = await ref.once("value");
    const current = snap.val() as BucketState | null;
    let waitMs = 1000;
    if (current) {
      // Refill-based wait
      const needed = count - (current.tokens ?? 0);
      if (needed > 0) {
        waitMs = Math.ceil((needed / config.refillPerSecond) * 1000);
      }
      // Daily-budget-exhausted wait (longer)
      if (config.dailyBudget && current.dailyConsumed >= config.dailyBudget) {
        waitMs = Math.max(waitMs, current.dailyResetAt - Date.now());
      }
    }
    return {
      success: false,
      waitMs: Math.min(waitMs, 3600_000), // cap at 1 hour
      remainingTokens: current?.tokens ?? 0,
      dailyRemaining: config.dailyBudget
        ? Math.max(0, config.dailyBudget - (current?.dailyConsumed ?? 0))
        : null,
    };
  }

  const newState = txResult.snapshot.val() as BucketState;
  return {
    success: true,
    waitMs: 0,
    remainingTokens: newState.tokens,
    dailyRemaining: config.dailyBudget
      ? Math.max(0, config.dailyBudget - newState.dailyConsumed)
      : null,
  };
}

/**
 * Acquire N tokens, waiting if necessary. Throws if the wait would exceed
 * `maxWaitMs` (default 5 minutes).
 */
export async function acquireTokens(
  source: string,
  count: number = 1,
  maxWaitMs: number = 300_000
): Promise<{ remainingTokens: number; dailyRemaining: number | null }> {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    const r = await consumeTokens(source, count);
    if (r.success) return { remainingTokens: r.remainingTokens, dailyRemaining: r.dailyRemaining };
    const wait = Math.min(r.waitMs, deadline - Date.now());
    if (wait <= 0) break;
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  throw new Error(
    `Rate limit acquire timeout after ${maxWaitMs}ms for source: ${source} (attempts: ${attempt})`
  );
}

/**
 * Read current state without modifying.
 */
export async function getRateLimitState(source: string): Promise<BucketState | null> {
  const snap = await db.ref(STATE_PATH(source)).once("value");
  return (snap.val() as BucketState | null) ?? null;
}
