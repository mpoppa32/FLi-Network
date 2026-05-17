// Corsair framework — SourceClient interface
//
// Every Tier 1+ source integration extends this. The framework's scheduled
// jobs invoke `syncDelta` per workspace; clients handle source-specific
// extraction, mapping, and reconciliation.
//
// Per framework spec Part Three: the SourceClient interface is the
// stabilization point. Source-specific code lives behind this contract;
// framework code drives it.

import type { Logger } from "./logger";

export interface SyncOptions {
  since?: number;
  until?: number;
  limit?: number;
  dryRun?: boolean;
  forceRefresh?: boolean;
}

export interface BackfillOptions {
  startDate?: number;
  endDate?: number;
  pageSize?: number;
  maxRecords?: number;
}

export interface SyncResult {
  recordsFetched: number;
  recordsUpserted: number;
  recordsSkipped: number;
  recordsErrored: number;
  errors: Array<{ recordId: string; error: { category: string; message: string } }>;
  durationMs: number;
  apiCallsCount: number;
  apiCallsBudget?: number;
  apiCallsRemaining?: number;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export interface SourceHealthSnapshot {
  source: string;
  lastSyncAt: number | null;
  lastError: {
    occurredAt: number;
    category: string;
    message: string;
    retriable: boolean;
  } | null;
  recordsLastSync?: number;
  state: "operational" | "stale" | "degraded" | "stopped" | "disabled" | "initializing";
}

export interface MappingContext {
  workspaceId: string;
  logger: Logger;
  now: number;
  config: unknown;
}

export interface SourceClient<TConfig, TRecord = unknown, TEntity = unknown> {
  readonly name: string;
  readonly displayName: string;
  readonly version: string;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  loadConfig(workspaceId: string): Promise<TConfig>;
  validateConfig(config: TConfig): ConfigValidationResult;

  syncDelta(workspaceId: string, options: SyncOptions): Promise<SyncResult>;
  syncBackfill(workspaceId: string, options: BackfillOptions): Promise<SyncResult>;
  syncOnDemand(workspaceId: string, recordId: string): Promise<TEntity | null>;

  mapRecord(record: TRecord, context: MappingContext): Promise<TEntity[]>;

  reportHealth(workspaceId: string): Promise<SourceHealthSnapshot>;
}

// Abstract base class — sources extend this for default lifecycle behavior.
export abstract class BaseSourceClient<TConfig, TRecord = unknown, TEntity = unknown>
  implements SourceClient<TConfig, TRecord, TEntity>
{
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly version: string;

  // Default no-op lifecycle methods — subclasses override as needed
  async initialize(): Promise<void> {
    /* default: nothing to set up */
  }
  async shutdown(): Promise<void> {
    /* default: nothing to clean up */
  }

  abstract loadConfig(workspaceId: string): Promise<TConfig>;
  abstract validateConfig(config: TConfig): ConfigValidationResult;
  abstract syncDelta(workspaceId: string, options: SyncOptions): Promise<SyncResult>;
  abstract syncBackfill(workspaceId: string, options: BackfillOptions): Promise<SyncResult>;
  abstract syncOnDemand(workspaceId: string, recordId: string): Promise<TEntity | null>;
  abstract mapRecord(record: TRecord, context: MappingContext): Promise<TEntity[]>;
  abstract reportHealth(workspaceId: string): Promise<SourceHealthSnapshot>;
}
