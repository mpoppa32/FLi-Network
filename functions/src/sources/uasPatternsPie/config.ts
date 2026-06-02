// uas-patterns PIE Supply-Chain Intelligence — per-workspace configuration
//
// Companion plugin to uasPatterns (DDG Tracker). The PIE page at
// https://uas-patterns.com/patterns/ carries supply-chain risk forecasts
// (SCENARIOS array, ~38 records) and per-manufacturer status profiles
// (MANUFACTURERS array, ~51 records). v1 emits these two static slices;
// the dynamic FLAGS / PREDICTIONS / signals streams on the page load
// from a token-gated `/api/data?token=...` endpoint and are deferred to
// a v1.1 follow-up once an operator-supplied token gets wired.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface UasPatternsPieConfig {
  /** Operator marker to disable this source on a per-workspace basis. */
  disabled?: boolean;
  /** Confidence chip floor for emitted Signals. INFERRED tier (0.70-0.85)
   *  per audit; same default as DDG. */
  confidence?: number;
  /** Sync timestamp persisted on the first config load. */
  initializedAt?: number;
}

export const DEFAULT_UAS_PATTERNS_PIE_CONFIG: UasPatternsPieConfig = {
  confidence: 0.75,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<UasPatternsPieConfig> {
  const snap = await db
    .ref(sourcePath(workspaceId, "uas_patterns_pie", "config"))
    .once("value");
  const raw = (snap.val() as Partial<UasPatternsPieConfig> | null) ?? {};
  const merged: UasPatternsPieConfig = {
    ...DEFAULT_UAS_PATTERNS_PIE_CONFIG,
    ...raw,
  };
  log?.debug("uas_patterns_pie_config_loaded", {
    workspaceId,
    disabled: !!merged.disabled,
    confidence: merged.confidence,
  });
  return merged;
}

export function validateConfig(
  config: UasPatternsPieConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (
    config.confidence !== undefined &&
    (typeof config.confidence !== "number" ||
      config.confidence < 0 ||
      config.confidence > 1)
  ) {
    errors.push("confidence must be 0-1 if set");
  }
  return { valid: errors.length === 0, errors };
}
