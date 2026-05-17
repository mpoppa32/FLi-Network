// Corsair framework — source provenance helper
//
// Per architecture E-4 (LOCKED): every entity created or updated from an
// external source carries a `source` attribute. Operator-input entities use
// `system: 'operator_manual'` and are never overwritten by external feeds.
//
// Canonical type lives in framework/types/provenance.ts; this module
// provides constructor helpers.

import type { SourceProvenance, SourceSystem } from "./types/provenance";

export type { SourceProvenance, SourceSystem };

export const OPERATOR_MANUAL_SYSTEM: SourceSystem = "operator_manual";

export function operatorManualProvenance(at: number = Date.now()): SourceProvenance {
  return {
    system: OPERATOR_MANUAL_SYSTEM,
    externalId: null,
    url: null,
    fetchedAt: at,
    refreshedAt: at,
    hash: null,
  };
}

export function externalProvenance(
  system: SourceSystem,
  externalId: string,
  url: string | null = null,
  hash: string | null = null,
  at: number = Date.now()
): SourceProvenance {
  return {
    system,
    externalId,
    url,
    fetchedAt: at,
    refreshedAt: at,
    hash,
  };
}

export function isOperatorManual(provenance: SourceProvenance | null | undefined): boolean {
  return provenance?.system === OPERATOR_MANUAL_SYSTEM;
}
