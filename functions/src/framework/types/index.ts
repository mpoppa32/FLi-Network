// Corsair framework — shared type definitions
//
// Phase 8.5 schema per architecture v1 E-1 through E-4 and per-source specs.
// Re-export from one entry point so source modules can `import type` cleanly.

export * from "./entities";
export * from "./signals";
export * from "./awards";
export { type SourceProvenance, type SourceSystem } from "./provenance";
