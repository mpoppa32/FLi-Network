// Corsair framework — error types and categorization
//
// Per framework spec Part Eight: errors fall into named categories that
// determine retry behavior and operator alerting.

export type ErrorCategory =
  | "transient"
  | "rate_limited"
  | "permanent"
  | "auth_failed"
  | "config_invalid"
  | "schema_mismatch"
  | "quota_exhausted"
  | "partial_success"
  | "doctrine_violation";

export interface CategorizedError {
  category: ErrorCategory;
  retriable: boolean;
  requiresOperator: boolean;
  urgent: boolean;
  message: string;
  cause?: unknown;
}

export class CorsairError extends Error {
  category: ErrorCategory;
  cause?: unknown;

  constructor(category: ErrorCategory, message: string, cause?: unknown) {
    super(message);
    this.name = "CorsairError";
    this.category = category;
    this.cause = cause;
  }
}

export class ConfigError extends CorsairError {
  constructor(message: string, cause?: unknown) {
    super("config_invalid", message, cause);
    this.name = "ConfigError";
  }
}

export class SchemaValidationError extends CorsairError {
  constructor(message: string, cause?: unknown) {
    super("schema_mismatch", message, cause);
    this.name = "SchemaValidationError";
  }
}

export class DoctrineViolationError extends CorsairError {
  constructor(message: string, cause?: unknown) {
    super("doctrine_violation", message, cause);
    this.name = "DoctrineViolationError";
  }
}

export class MigrationError extends CorsairError {
  step: number;
  constructor(step: number, message: string, cause?: unknown) {
    super("permanent", `Migration step ${step}: ${message}`, cause);
    this.name = "MigrationError";
    this.step = step;
  }
}

export function categorizeError(error: unknown): CategorizedError {
  if (error instanceof CorsairError) {
    return {
      category: error.category,
      retriable: error.category === "transient" || error.category === "rate_limited",
      requiresOperator:
        error.category === "auth_failed" ||
        error.category === "config_invalid" ||
        error.category === "schema_mismatch" ||
        error.category === "doctrine_violation",
      urgent: error.category === "doctrine_violation",
      message: error.message,
      cause: error.cause,
    };
  }

  const err = error as { code?: string; statusCode?: number; message?: string };
  const code = err?.code;
  const status = err?.statusCode;

  if (status === 429) {
    return mkCategory("rate_limited", true, false, false, err?.message ?? "Rate limited");
  }
  if (status === 401 || status === 403) {
    return mkCategory("auth_failed", false, true, true, err?.message ?? "Authentication failed");
  }
  if (status && status >= 500) {
    return mkCategory("transient", true, false, false, err?.message ?? `Server error ${status}`);
  }
  if (status && status >= 400) {
    return mkCategory("permanent", false, false, false, err?.message ?? `Client error ${status}`);
  }

  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return mkCategory("transient", true, false, false, err?.message ?? `Network error ${code}`);
  }

  return mkCategory("permanent", false, false, false, err?.message ?? "Unknown error");
}

function mkCategory(
  category: ErrorCategory,
  retriable: boolean,
  requiresOperator: boolean,
  urgent: boolean,
  message: string
): CategorizedError {
  return { category, retriable, requiresOperator, urgent, message };
}
