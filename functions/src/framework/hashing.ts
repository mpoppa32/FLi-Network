// Corsair framework — content hashing for change detection
//
// Per AIQ-6 (LOCKED): every entity computes a hash of stable fields. On
// sync, hash comparison skips writes when content unchanged. Saves RTDB
// bandwidth and rate-limit budget.
//
// Per-entity-type field selections live with each source implementation;
// this module provides the hash primitive only.

import { createHash } from "crypto";

/**
 * Deterministic SHA-256 hash of a value. Objects are stringified with sorted
 * keys so insertion order doesn't affect the hash.
 */
export function contentHash(value: unknown): string {
  const serialized = stableStringify(value);
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * JSON.stringify with deterministic key ordering. Strings, numbers, booleans,
 * null, arrays, and plain objects are supported. Functions, symbols, and
 * dates fall back to their default toString behavior.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]));
    return "{" + pairs.join(",") + "}";
  }
  return JSON.stringify(String(value));
}

/**
 * Pick a stable subset of fields from an entity for hashing. Operator-input
 * fields are typically excluded so operator edits don't trigger sync-as-changed.
 */
export function pickFields<T extends Record<string, unknown>>(obj: T, fields: string[]): Partial<T> {
  const out: Partial<T> = {};
  for (const f of fields) {
    if (f in obj) (out as Record<string, unknown>)[f] = obj[f];
  }
  return out;
}

/**
 * Compute a hash from a selection of fields.
 */
export function hashFields<T extends Record<string, unknown>>(obj: T, fields: string[]): string {
  return contentHash(pickFields(obj, fields));
}
