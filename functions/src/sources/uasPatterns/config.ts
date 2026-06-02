// uas-patterns DDG Tracker source — per-workspace configuration
//
// The audit (corsair-osint-source-portfolio.md → Proposed New Sources)
// scopes this plugin to a single-page scrape of
// https://uas-patterns.com/ddg/ with daily cadence. No per-workspace
// tunables for v1; just an operator disable flag and a confidence floor.

import type { Logger } from "../../framework/logger";
import { db, sourcePath } from "../../framework/rtdb";

export interface UasPatternsConfig {
  /** Operator marker to disable this source on a per-workspace basis. */
  disabled?: boolean;
  /** Confidence chip floor for emitted Signals. Per audit Section
   *  "Confidence note": third-party curation = INFERRED tier (0.70-0.85). */
  confidence?: number;
  /** Sync timestamp persisted on the first config load. */
  initializedAt?: number;
}

export const DEFAULT_UAS_PATTERNS_CONFIG: UasPatternsConfig = {
  confidence: 0.75,
};

export async function loadConfig(
  workspaceId: string,
  log?: Logger
): Promise<UasPatternsConfig> {
  const snap = await db
    .ref(sourcePath(workspaceId, "uas_patterns", "config"))
    .once("value");
  const raw = (snap.val() as Partial<UasPatternsConfig> | null) ?? {};
  const merged: UasPatternsConfig = { ...DEFAULT_UAS_PATTERNS_CONFIG, ...raw };
  log?.debug("uas_patterns_config_loaded", {
    workspaceId,
    disabled: !!merged.disabled,
    confidence: merged.confidence,
  });
  return merged;
}

export function validateConfig(
  config: UasPatternsConfig
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
