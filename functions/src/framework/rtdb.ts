// Corsair framework — RTDB Admin SDK wrapper
//
// Workspace-scoped path helpers. The migration code (and future source
// integrations) goes through these to ensure consistent path construction
// and to provide a single place to swap RTDB for Firestore later if needed.

import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

export const db = admin.database();

export function wsPath(workspaceId: string, ...parts: string[]): string {
  if (!workspaceId) {
    throw new Error("wsPath requires non-empty workspaceId");
  }
  return ["workspaces", workspaceId, ...parts].join("/");
}

export function migrationPath(workspaceId: string, version: string, ...parts: string[]): string {
  return wsPath(workspaceId, "migrations", version, ...parts);
}

export function sourcePath(workspaceId: string, system: string, ...parts: string[]): string {
  return wsPath(workspaceId, "sources", system, ...parts);
}

/**
 * Recursively strip `undefined` values from any object/array before writing
 * to RTDB. Firebase RTDB rejects writes containing undefined ANYWHERE in the
 * tree with: "set failed: value argument contains undefined in property...".
 *
 * Source records frequently have missing optional fields (state, city,
 * dates, codes, related IDs). Mappers historically wrote them as
 * `field: undefined` which breaks the entire write. Use this helper before
 * any `db.ref(path).set(value)` to drop undefined keys/elements cleanly.
 *
 * Preserves: null, empty string, 0, false, empty array, empty object.
 * Only drops: undefined.
 *
 * P13.266 — added framework-level after SAM.gov + defense_scoop first-activation
 * both hit the same Firebase undefined-rejection. Future plugins should
 * default to writing through this.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((v) => stripUndefinedDeep(v))
      .filter((v) => v !== undefined) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const cleaned = stripUndefinedDeep(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out as unknown as T;
  }
  return value;
}

// Batched multi-path update with a soft per-batch cap.
// Per migration spec OIQ-3 (LOCKED): 500 entities per batch.
export const BATCH_SIZE = 500;

export async function batchedUpdate(updates: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(updates);
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = Object.fromEntries(entries.slice(i, i + BATCH_SIZE));
    await db.ref().update(chunk);
  }
}

export async function readJson<T = unknown>(path: string): Promise<T | null> {
  const snap = await db.ref(path).once("value");
  return (snap.val() as T) ?? null;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await db.ref(path).set(value);
}

export async function removePath(path: string): Promise<void> {
  await db.ref(path).remove();
}

export async function pathExists(path: string): Promise<boolean> {
  const snap = await db.ref(path).once("value");
  return snap.exists();
}

// List all workspace IDs the migration has visibility into.
// Reads `workspaces/` top-level keys.
export async function listWorkspaceIds(): Promise<string[]> {
  const snap = await db.ref("workspaces").once("value");
  const val = snap.val() as Record<string, unknown> | null;
  return val ? Object.keys(val) : [];
}
