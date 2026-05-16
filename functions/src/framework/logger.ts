// Corsair framework — structured logger
//
// All migration and source operations emit structured log entries via this
// module. Cloud Logging captures these via firebase-functions/logger.
//
// Per framework spec Part Seven: every log entry has source + workspace +
// jobId + event + severity. Standard event codes defined as a string union.

import * as logger from "firebase-functions/logger";

export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface LogEnvelope {
  source?: string;
  workspace?: string;
  jobId?: string;
  attempt?: number;
  event: string;
  message?: string;
  payload?: Record<string, unknown>;
  errorCategory?: string;
  errorCode?: string;
  errorMessage?: string;
  stackTrace?: string;
}

export interface LoggerContext {
  source?: string;
  workspace?: string;
  jobId?: string;
}

export class Logger {
  constructor(private context: LoggerContext = {}) {}

  child(extra: LoggerContext): Logger {
    return new Logger({ ...this.context, ...extra });
  }

  private emit(severity: Severity, event: string, payload?: Record<string, unknown>): void {
    const entry: LogEnvelope = {
      ...this.context,
      event,
      payload,
    };
    switch (severity) {
      case "DEBUG":
        logger.debug(event, entry);
        break;
      case "INFO":
        logger.info(event, entry);
        break;
      case "WARNING":
        logger.warn(event, entry);
        break;
      case "ERROR":
        logger.error(event, entry);
        break;
      case "CRITICAL":
        logger.error(`CRITICAL: ${event}`, entry);
        break;
    }
  }

  debug(event: string, payload?: Record<string, unknown>): void {
    this.emit("DEBUG", event, payload);
  }

  info(event: string, payload?: Record<string, unknown>): void {
    this.emit("INFO", event, payload);
  }

  warn(event: string, payload?: Record<string, unknown>): void {
    this.emit("WARNING", event, payload);
  }

  error(event: string, payload?: Record<string, unknown>): void {
    this.emit("ERROR", event, payload);
  }

  critical(event: string, payload?: Record<string, unknown>): void {
    this.emit("CRITICAL", event, payload);
  }
}

export function createLogger(context: LoggerContext = {}): Logger {
  return new Logger(context);
}

export function generateJobId(prefix: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}
